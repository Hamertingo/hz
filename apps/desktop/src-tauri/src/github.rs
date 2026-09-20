//! A session's pull request, read and acted on through the `gh` CLI.
//!
//! `gh` rather than the REST API on purpose: it already holds the user's auth,
//! their enterprise host config, and the token refresh we would otherwise have
//! to own. The cost is that the feature is absent where `gh` isn't installed or
//! isn't logged in — both surface as a readable line in the panel rather than
//! an error, since this is a side view and never the reason the app is open.

use anyhow::Result;
use serde_json::json;
use serde::de::IgnoredAny;
use serde::{Deserialize, Serialize};
use std::{collections::HashMap, path::Path, process::Stdio, sync::LazyLock};
use tokio::{process::Command, sync::Mutex};
use ts_rs::TS;

use crate::binpath;
use crate::git;

/// Where a check ended up, flattened from the two different shapes GitHub
/// reports one in. Callers branch on this and never on the wire's own strings.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[ts(export, export_to = "events.ts")]
#[serde(rename_all = "snake_case")]
pub enum CheckState {
    Success,
    Failure,
    Pending,
    Skipped,
    Cancelled,
    Neutral,
}

#[derive(Debug, Clone, Serialize, TS)]
#[ts(export, export_to = "events.ts")]
#[serde(rename_all = "camelCase")]
pub struct PrCheck {
    pub name: String,
    pub state: CheckState,
    /// Where the log lives. `None` for a check that reports no link.
    pub url: Option<String>,
    /// The Actions workflow this run belongs to, when it is one — several
    /// workflows can contribute checks of the same name.
    pub workflow: Option<String>,
    /// The mark of whoever reports this check — Vercel's logo on a Vercel
    /// check. It is what makes a list of check names scannable without reading
    /// them, and it cannot be built from the login: see [`QUERY`].
    pub avatar: Option<String>,
}

/// What kind of entry a timeline row is. A review carries a verdict where a
/// plain comment carries none, and that verdict is most of what the row says.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[ts(export, export_to = "events.ts")]
#[serde(rename_all = "snake_case")]
pub enum CommentKind {
    Comment,
    Approved,
    ChangesRequested,
    Reviewed,
}

#[derive(Debug, Clone, Serialize, TS)]
#[ts(export, export_to = "events.ts")]
#[serde(rename_all = "camelCase")]
pub struct PrComment {
    pub author: String,
    /// The commenter's picture. `None` for an account that has none, which the
    /// panel draws as their initial rather than as a gap.
    pub avatar: Option<String>,
    pub body: String,
    pub created_at: String,
    pub url: String,
    pub kind: CommentKind,
    /// The file an inline review comment hangs on — `path:line`, or the path
    /// alone once GitHub has forgotten which line it pointed at. `None` for
    /// everything on the conversation timeline, which hangs on nothing.
    pub path: Option<String>,
    /// Whether the thread has been settled. False for every row that is not a
    /// thread, since only a review thread can be resolved.
    pub resolved: bool,
    /// The rest of the thread, oldest first. Only an inline comment carries
    /// any: a PR's own conversation is flat, so a reply is either part of a
    /// review thread or it is a new comment.
    pub replies: Vec<PrComment>,
    /// GitHub's node id for the review thread this comment opens, on the one
    /// comment that does open one.
    ///
    /// **Carried so the panel can answer a thread and settle one.** Both are
    /// GraphQL mutations keyed on this id and on nothing else — not on the PR
    /// number, not on the path, not on the line, all three of which a reply or a
    /// resolve has no way to address. `None` everywhere that is not a thread
    /// root, which is every timeline row.
    pub thread_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, TS)]
#[ts(export, export_to = "events.ts")]
#[serde(rename_all = "camelCase")]
pub struct PullRequest {
    pub number: u64,
    pub title: String,
    pub url: String,
    /// `OPEN`, `CLOSED` or `MERGED`, carried through as GitHub's own word.
    pub state: String,
    pub is_draft: bool,
    pub author: String,
    pub base_ref_name: String,
    pub head_ref_name: String,
    /// Whether that branch is still on the remote. `headRefName` survives the
    /// branch itself — a merged PR keeps naming the branch it came from — so
    /// the name cannot answer this and `headRef` going null is what does.
    pub head_ref_exists: bool,
    /// Whether the head branch lives in a fork rather than in this repo.
    ///
    /// `head_ref_name` is bare either way — a PR from `alice/hz:feature`
    /// reports `feature` — so the name cannot be told apart from a branch of
    /// our own, and joining it to this repo's slug addresses a *different*
    /// branch that merely shares its name. Unknown reads as `true`, because
    /// the only thing this gates is a deletion.
    pub is_cross_repository: bool,
    /// `MERGEABLE`, `CONFLICTING`, or `UNKNOWN` while GitHub is still working
    /// the merge out — which it starts doing lazily, on being asked.
    pub mergeable: String,
    /// The finer answer: `CLEAN`, `BLOCKED`, `BEHIND`, `DIRTY`, `UNSTABLE`,
    /// `DRAFT`, `HAS_HOOKS`, `UNKNOWN`.
    pub merge_state_status: String,
    /// `APPROVED`, `CHANGES_REQUESTED`, `REVIEW_REQUIRED`. `None` where the
    /// repo requires no review, which `gh` reports as an empty string.
    pub review_decision: Option<String>,
    pub checks: Vec<PrCheck>,
    /// What the author wrote, as markdown. Empty is ordinary — plenty of pull
    /// requests are a title and a diff.
    ///
    /// Rendered now, having been deliberately left out when the pane was a list
    /// of *states*: it is the longest thing here and it pushed the checks below
    /// the fold. Read against the sections around it — the files, the commits —
    /// it is the one part of a pull request that says why any of it changed,
    /// and the pane has somewhere to put it.
    pub body: String,
    /// What the repository has filed it under, with their colours.
    pub labels: Vec<PrLabel>,
    /// Every file the change touches, with its own line counts.
    ///
    /// `changedFiles` is the count and this is the list, so the header can say
    /// "12 files" while the section draws them. Capped at a hundred by the
    /// query — past that the section says so rather than pretending.
    pub files: Vec<PrFile>,
    /// The commits on the branch, newest last — GitHub's own order, which is
    /// how the reviewer above them reads them.
    pub commits: Vec<PrCommit>,
    /// Comments, reviews and inline threads in one list, oldest first — the
    /// order GitHub reads them in, and the only order in which a bot's reply to
    /// a review makes sense. A thread is one entry carrying its own replies.
    pub comments: Vec<PrComment>,
    /// Lines added and removed across the whole PR, and how many files moved.
    /// The same figures the changes panel shows for a turn, for the same
    /// reason: a row naming a PR says nothing about how much of one it is.
    pub additions: u32,
    pub deletions: u32,
    pub changed_files: u32,
    pub updated_at: String,
}

/// One file a pull request touches.
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export, export_to = "events.ts")]
#[serde(rename_all = "camelCase")]
pub struct PrFile {
    /// Repo-relative, the way every path in this app is.
    pub path: String,
    pub additions: u32,
    pub deletions: u32,
    /// `ADDED`, `MODIFIED`, `DELETED`, `RENAMED` or `COPIED`, GitHub's own
    /// word, carried through untranslated — the panel draws a glyph for the
    /// three it knows and nothing for the rest.
    pub change_type: String,
}

/// One commit on the branch, cut down to what a row draws.
///
/// Not the same shape as the commits panel's `Commit`, which reads a working
/// tree's history with `git` and carries a full body and tree. This is
/// GitHub's, reached with `gh`, and the pane wants a line per commit.
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export, export_to = "events.ts")]
#[serde(rename_all = "camelCase")]
pub struct PrCommit {
    /// The full sha, which is what the row's own link would need.
    pub oid: String,
    /// GitHub's own abbreviation, so the row shows the length GitHub shows.
    pub short_oid: String,
    /// The first line of the message and only the first — a full body here
    /// would be one commit's essay among a list of one-liners.
    pub headline: String,
    pub committed_at: String,
    /// The name git was configured with, which is the only thing a commit
    /// *always* has. Attribution to an account is below, and can be missing.
    pub author: String,
    /// The account GitHub credits it to, where it can attribute one — an email
    /// that matches no account resolves to the name alone.
    pub login: Option<String>,
    pub avatar: Option<String>,
}

/// How to land it. The three GitHub offers; the flag each maps to is `gh`'s.
#[derive(Debug, Clone, Copy, Deserialize, Serialize, TS)]
#[ts(export, export_to = "events.ts")]
#[serde(rename_all = "snake_case")]
pub enum MergeMethod {
    Merge,
    Squash,
    Rebase,
}

impl MergeMethod {
    fn flag(self) -> &'static str {
        match self {
            Self::Merge => "--merge",
            Self::Squash => "--squash",
            Self::Rebase => "--rebase",
        }
    }
}

// ── the wire, as GraphQL answers it ──────────────────────────────────────────

/// Everything the panel draws, in one round trip.
///
/// GraphQL rather than `gh pr list --json`, which carries the same fields and
/// was what this used first. The difference is avatars: the rollup `gh` hands
/// back has no image on it at all, and neither does its comment author — only
/// a login, and `github.com/<login>.png` 404s for exactly the accounts that
/// matter, since a GitHub App's real login ends in `[bot]` and `gh` strips it.
/// One query gets the images with the data instead of three REST calls after
/// it.
///
/// `mergeStateStatus` needs no preview header here, checked against the live
/// API rather than assumed.
///
/// **Page sizes are the point cost, and this shape is measured at 3.** GraphQL
/// charges on the shape asked for, not on what comes back: nested `first`s
/// multiply, so one connection at `20 × 50 × 50` reserved a thousand thread
/// comments and cost 11 points per read *of a branch with no PR at all* —
/// 2640 an hour at the settling poll, which is how two hz instances alone
/// drained the 5000/hour budget and every agent's own `gh` call started
/// failing (DRA-247). Only a connection's *parents* multiply, so the fifty
/// replies under each thread are a leaf and cost nothing; thirty threads is
/// where a reviewer bot's inline comments still fit, and past it the rest is
/// silently absent, as it was past fifty before — paging would cost the points
/// this saves.
///
/// **A hundred files and a hundred commits cost the third point**, measured
/// with `rateLimit{cost}` before and after rather than assumed: both are
/// siblings of the connections above, so neither multiplies against them.
/// `commits` is asked **twice under two aliases** and must be — GraphQL refuses
/// one field asked twice with different arguments, and one connection cannot
/// serve both: `first:100` for the list, `last:1` for the tip whose rollup the
/// checks read. The list deliberately does *not* carry a rollup, or a hundred
/// contexts would ride on it.
///
/// **Open and settled are two aliased connections**, the bargain [`QUERY_MARKS`]
/// makes for the sidebar: a single `first:5` newest-first would drop an older
/// open PR behind five settled ones on a reused branch, and the open-first
/// sort in `read_prs` runs after the cut. Five open covers a stack; two
/// settled is what the panel has to say about a branch whose work landed.
const QUERY: &str = r#"
query($owner:String!,$repo:String!,$branch:String!){
 repository(owner:$owner,name:$repo){
  open: pullRequests(headRefName:$branch,states:OPEN,first:5,orderBy:{field:CREATED_AT,direction:DESC}){nodes{...pr}}
  settled: pullRequests(headRefName:$branch,states:[MERGED,CLOSED],first:2,orderBy:{field:CREATED_AT,direction:DESC}){nodes{...pr}}
 }}
fragment pr on PullRequest{
 number title url state isDraft baseRefName headRefName headRef{name} isCrossRepository mergeable mergeStateStatus reviewDecision updatedAt
 additions deletions changedFiles
 body
 author{login avatarUrl}
 labels(first:20){nodes{name color}}
 files(first:100){nodes{path additions deletions changeType}}
 history: commits(first:100){nodes{commit{oid abbreviatedOid messageHeadline committedDate author{name user{login avatarUrl}}}}}
 comments(first:50){nodes{author{login avatarUrl} body createdAt url}}
 reviews(first:50){nodes{id author{login avatarUrl} body submittedAt state}}
 reviewThreads(first:30){nodes{id isResolved path line comments(first:50){nodes{author{login avatarUrl} body createdAt url pullRequestReview{id}}}}}
 tip: commits(last:1){nodes{commit{statusCheckRollup{contexts(first:50){nodes{
   __typename
   ... on StatusContext{context state targetUrl avatarUrl}
   ... on CheckRun{name status conclusion detailsUrl checkSuite{workflowRun{workflow{name}} app{name logoUrl}}}
 }}}}}}
}
"#;

/// Every pull request the sidebar can mark a row with, by head branch.
///
/// One query for the whole sidebar rather than one per row: `gh` costs the
/// better part of a second, so asking per session would be a spawn per visible
/// row on every refresh.
///
/// **Two aliased connections, not `states:[OPEN,MERGED]` in one.** A single
/// connection spends one `first:100` budget across both, ordered by update — so
/// a repo that merges briskly buries an open pull request nobody has touched
/// this week under a hundred recent merges, and the row loses the mark that
/// already worked. Separate budgets cost nothing extra: it is still one query
/// and one spawn.
///
/// Merged is here because a settled branch is what tells the reader the session
/// is done and can be archived. Closed-without-merging is deliberately not:
/// that is work abandoned rather than landed, and it says nothing the row's own
/// timestamp doesn't.
///
/// The open half also carries its tip commit's check rollup — one field, the
/// rollup's own verdict rather than the fifty contexts the panel's query asks
/// for. Only the tip's, for the panel's reason: a check reported against a
/// commit that has since been pushed over describes code nobody is waiting on.
/// The merged half asks for none — its checks are over, and the row says merged.
///
/// `first:100` is a real cap on both halves. A repo with more than a hundred
/// open pull requests marks the hundred most recently touched; a branch merged
/// long enough ago to fall past the hundredth loses its mark, which is the
/// right way round — those are the sessions already dealt with.
const QUERY_MARKS: &str = r#"
query($owner:String!,$repo:String!){
 repository(owner:$owner,name:$repo){
  open: pullRequests(states:OPEN,first:100,orderBy:{field:UPDATED_AT,direction:DESC}){nodes{
   number headRefName isDraft mergeable mergeStateStatus
   commits(last:1){nodes{commit{statusCheckRollup{state}}}}
  }}
  merged: pullRequests(states:MERGED,first:100,orderBy:{field:UPDATED_AT,direction:DESC}){nodes{
   number headRefName isDraft
  }}
 }}
"#;

/// A GraphQL connection. `nodes` is nullable on every one of them, so the
/// `Option` is load-bearing rather than defensive.
#[derive(Deserialize)]
struct Nodes<T> {
    #[serde(default = "Option::default")]
    nodes: Option<Vec<T>>,
}

impl<T> Nodes<T> {
    fn take(this: Option<Self>) -> Vec<T> {
        this.and_then(|n| n.nodes).unwrap_or_default()
    }
}

/// Generic over the repository shape, because both queries here answer with
/// the same two envelopes around `repository` and only what is asked of it
/// differs: which states each aliased `pullRequests` connection asks for.
#[derive(Deserialize)]
struct Response<R> {
    data: Option<ResponseData<R>>,
    /// GraphQL reports a failed query with a 200 and an `errors` array, so a
    /// zero exit code proves nothing on its own.
    #[serde(default)]
    errors: Vec<GraphQlError>,
}

impl<R> Response<R> {
    /// The repository answered with, or the first error GitHub reported.
    ///
    /// Errors are checked before the data: a failed query answers with a 200
    /// and a null `data`, so reading the connection first turns "could not
    /// resolve repository" into "this repo has no pull requests".
    fn repository(self) -> Result<Option<R>, String> {
        if let Some(first) = self.errors.first() {
            return Err(first.message.clone());
        }
        Ok(self.data.and_then(|d| d.repository))
    }
}

#[derive(Deserialize)]
struct GraphQlError {
    #[serde(default)]
    message: String,
}

#[derive(Deserialize)]
struct ResponseData<R> {
    repository: Option<R>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PrsRepository {
    open: Option<Nodes<RawPr>>,
    settled: Option<Nodes<RawPr>>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawAuthor {
    #[serde(default)]
    login: String,
    #[serde(default)]
    avatar_url: Option<String>,
}

#[derive(Deserialize)]
#[serde(tag = "__typename")]
enum RawCheck {
    #[serde(rename_all = "camelCase")]
    CheckRun {
        #[serde(default)]
        name: String,
        #[serde(default)]
        status: String,
        /// Null while the run is still going — GraphQL sends null where `gh`
        /// sent an empty string, and reading either as terminal draws a running
        /// check as finished.
        #[serde(default)]
        conclusion: Option<String>,
        #[serde(default)]
        details_url: Option<String>,
        #[serde(default)]
        check_suite: Option<RawCheckSuite>,
    },
    #[serde(rename_all = "camelCase")]
    StatusContext {
        #[serde(default)]
        context: String,
        #[serde(default)]
        state: String,
        #[serde(default)]
        target_url: Option<String>,
        #[serde(default)]
        avatar_url: Option<String>,
    },
    /// A rollup entry of a kind we don't model costs one row, not the whole
    /// response.
    #[serde(other)]
    Unknown,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawCheckSuite {
    #[serde(default)]
    workflow_run: Option<RawWorkflowRun>,
    #[serde(default)]
    app: Option<RawApp>,
}

#[derive(Deserialize)]
struct RawWorkflowRun {
    #[serde(default)]
    workflow: Option<RawWorkflow>,
}

#[derive(Deserialize)]
struct RawWorkflow {
    #[serde(default)]
    name: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawApp {
    #[serde(default)]
    logo_url: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawComment {
    #[serde(default)]
    author: Option<RawAuthor>,
    #[serde(default)]
    body: String,
    #[serde(default)]
    created_at: String,
    #[serde(default)]
    url: String,
    /// The review this was left under. Absent on a conversation comment, which
    /// belongs to no review at all.
    #[serde(default)]
    pull_request_review: Option<RawNodeId>,
}

/// A node named only so it can be pointed at.
#[derive(Deserialize)]
struct RawNodeId {
    #[serde(default)]
    id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawReview {
    /// What the threads left under it name it by.
    #[serde(default)]
    id: String,
    #[serde(default)]
    author: Option<RawAuthor>,
    #[serde(default)]
    body: String,
    #[serde(default)]
    submitted_at: String,
    #[serde(default)]
    state: String,
}

/// One inline conversation: where it hangs, whether it is settled, and every
/// comment on it — the first is what opened it and the rest are replies.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawThread {
    /// GitHub's node id, which every reply and every resolve addresses.
    #[serde(default)]
    id: Option<String>,
    #[serde(default)]
    is_resolved: bool,
    #[serde(default)]
    path: Option<String>,
    /// Null once the code it pointed at has been pushed over: GitHub keeps the
    /// thread and forgets the line.
    #[serde(default)]
    line: Option<u32>,
    #[serde(default)]
    comments: Option<Nodes<RawComment>>,
}

#[derive(Deserialize)]
struct RawCommitNode {
    #[serde(default)]
    commit: Option<RawCommit>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawCommit {
    #[serde(default)]
    status_check_rollup: Option<RawRollup>,
    // The history half's fields. Absent on the tip's selection, which asks for
    // the rollup alone — hence defaults, and one struct for both.
    #[serde(default)]
    oid: String,
    #[serde(default)]
    abbreviated_oid: String,
    #[serde(default)]
    message_headline: String,
    #[serde(default)]
    committed_date: String,
    #[serde(default)]
    author: Option<RawCommitAuthor>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawCommitAuthor {
    /// What git recorded — a person's name, or whatever the machine was set to.
    #[serde(default)]
    name: String,
    /// The account, where GitHub can match the address to one. Absent for a
    /// commit pushed with an address no account owns.
    #[serde(default)]
    user: Option<RawAuthor>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawFile {
    #[serde(default)]
    path: String,
    #[serde(default)]
    additions: u32,
    #[serde(default)]
    deletions: u32,
    #[serde(default)]
    change_type: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawRollup {
    #[serde(default)]
    contexts: Option<Nodes<RawCheck>>,
    /// The rollup's own verdict over every context, which is all the sidebar's
    /// mark needs. Absent from the panel's query, which reads the contexts and
    /// counts them itself; absent from the sidebar's, which asks only for this.
    /// Both fields optional so one shape serves both.
    #[serde(default)]
    state: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawPr {
    number: u64,
    #[serde(default)]
    title: String,
    #[serde(default)]
    url: String,
    #[serde(default)]
    state: String,
    #[serde(default)]
    is_draft: bool,
    #[serde(default)]
    author: Option<RawAuthor>,
    #[serde(default)]
    base_ref_name: String,
    #[serde(default)]
    head_ref_name: String,
    /// Null once the branch is deleted, and only then — the one field on the
    /// node that tells a branch still there from one already gone. Only its
    /// presence is read: GraphQL needs a selection under it, but the name it
    /// would carry is `head_ref_name`, which outlives the ref.
    #[serde(default)]
    head_ref: Option<IgnoredAny>,
    /// `Option` so that absent can be told from `false` and read as *fork* —
    /// see [`PullRequest::is_cross_repository`].
    #[serde(default)]
    is_cross_repository: Option<bool>,
    #[serde(default)]
    mergeable: String,
    #[serde(default)]
    merge_state_status: String,
    #[serde(default)]
    review_decision: Option<String>,
    #[serde(default)]
    additions: u32,
    #[serde(default)]
    deletions: u32,
    #[serde(default)]
    changed_files: u32,
    #[serde(default)]
    body: String,
    #[serde(default)]
    labels: Option<Nodes<RawLabel>>,
    #[serde(default)]
    files: Option<Nodes<RawFile>>,
    /// The commits on the branch, asked for under `history`. The tip's rollup is
    /// a *separate* connection ([`RawPr::commits`]) because GraphQL refuses one
    /// field asked twice with different arguments — and it must be separate:
    /// asking the rollup on a hundred commits would cost a hundred contexts.
    #[serde(default)]
    history: Option<Nodes<RawCommitNode>>,
    #[serde(default)]
    comments: Option<Nodes<RawComment>>,
    #[serde(default)]
    reviews: Option<Nodes<RawReview>>,
    /// The inline conversations. Not reachable through `reviews`: the review
    /// they were left under carries only its own body, which for a review that
    /// is nothing but file comments is empty.
    #[serde(default)]
    review_threads: Option<Nodes<RawThread>>,
    /// Only the tip commit's rollup is asked for: a check reported against an
    /// older commit is describing code that has since been pushed over.
    ///
    /// **Named for the alias in the query, not for the field it selects.** The
    /// query asks `commits` twice — `tip` for this and `history` for the list —
    /// because GraphQL refuses one field twice with different arguments, and the
    /// response keys are the *aliases*. Reading `commits` here looked right and
    /// found nothing, which is a Checks section that says "No checks on this
    /// branch" over a pull request whose CI is green.
    #[serde(default)]
    tip: Option<Nodes<RawCommitNode>>,
    #[serde(default)]
    updated_at: String,
}

impl RawComment {
    /// A timeline row with nothing hanging off it. A thread's own root fills
    /// the rest in afterwards; everything else is already complete.
    fn map(self, kind: CommentKind) -> PrComment {
        PrComment {
            author: login(&self.author),
            avatar: avatar(&self.author),
            body: self.body,
            created_at: self.created_at,
            url: self.url,
            kind,
            path: None,
            resolved: false,
            replies: Vec::new(),
            thread_id: None,
        }
    }
}

impl RawThread {
    /// The thread as one row — the comment that opened it, carrying the rest —
    /// and the id of the review it was left under, which is what files it.
    ///
    /// `None` for a thread whose comments have all been deleted: there is
    /// nothing left to draw, and the file it hung on is not a comment.
    fn map(self) -> Option<(Option<String>, PrComment)> {
        let mut comments = Nodes::take(self.comments).into_iter();
        let opener = comments.next()?;

        let review = opener
            .pull_request_review
            .as_ref()
            .map(|r| r.id.clone())
            .filter(|id| !id.is_empty());

        let mut root = opener.map(CommentKind::Comment);
        root.path = self.path.map(|path| match self.line {
            Some(line) => format!("{path}:{line}"),
            None => path,
        });
        root.resolved = self.is_resolved;
        root.thread_id = self.id.filter(|id| !id.is_empty());
        root.replies = comments.map(|c| c.map(CommentKind::Comment)).collect();

        Some((review, root))
    }
}

fn login(author: &Option<RawAuthor>) -> String {
    author.as_ref().map(|a| a.login.clone()).unwrap_or_default()
}

fn avatar(author: &Option<RawAuthor>) -> Option<String> {
    author.as_ref().and_then(|a| a.avatar_url.clone())
}

impl RawCheck {
    fn map(self) -> Option<PrCheck> {
        match self {
            Self::CheckRun {
                name,
                status,
                conclusion,
                details_url,
                check_suite,
            } => {
                let suite = check_suite.unwrap_or(RawCheckSuite {
                    workflow_run: None,
                    app: None,
                });

                Some(PrCheck {
                    name,
                    // A run that hasn't finished has no conclusion yet, so the
                    // status is the answer; once it has one, the conclusion is.
                    state: match conclusion.as_deref() {
                        Some(word) if !word.is_empty() => conclusion_state(word),
                        _ if status == "COMPLETED" => CheckState::Neutral,
                        _ => CheckState::Pending,
                    },
                    url: details_url.filter(|u| !u.is_empty()),
                    workflow: suite
                        .workflow_run
                        .and_then(|r| r.workflow)
                        .map(|w| w.name)
                        .filter(|n| !n.is_empty()),
                    // The app that owns the check suite — the Vercel mark on a
                    // Vercel check. Missing on a check no app claims.
                    avatar: suite.app.and_then(|a| a.logo_url),
                })
            }
            Self::StatusContext {
                context,
                state,
                target_url,
                avatar_url,
            } => Some(PrCheck {
                name: context,
                state: conclusion_state(&state),
                url: target_url.filter(|u| !u.is_empty()),
                workflow: None,
                avatar: avatar_url,
            }),
            Self::Unknown => None,
        }
    }
}

/// Both shapes' terminal words, in one table. `ERROR` and `TIMED_OUT` are
/// failures rather than a state of their own: the panel's question is whether
/// the check is standing in the way, and every one of these does.
fn conclusion_state(word: &str) -> CheckState {
    match word {
        "SUCCESS" => CheckState::Success,
        "FAILURE" | "ERROR" | "TIMED_OUT" | "STARTUP_FAILURE" | "ACTION_REQUIRED" => {
            CheckState::Failure
        }
        "SKIPPED" => CheckState::Skipped,
        "CANCELLED" => CheckState::Cancelled,
        "PENDING" | "EXPECTED" | "QUEUED" | "IN_PROGRESS" | "WAITING" | "REQUESTED" => {
            CheckState::Pending
        }
        _ => CheckState::Neutral,
    }
}

fn review_kind(state: &str) -> CommentKind {
    match state {
        "APPROVED" => CommentKind::Approved,
        "CHANGES_REQUESTED" => CommentKind::ChangesRequested,
        _ => CommentKind::Reviewed,
    }
}

impl RawPr {
    fn map(self) -> PullRequest {
        let url = self.url;

        let mut comments: Vec<PrComment> = Nodes::take(self.comments)
            .into_iter()
            .map(|c| c.map(CommentKind::Comment))
            .collect();

        // The inline conversations, filed under the review that left them.
        // Every review comment carries the id of its review, which is the only
        // thing joining the two: a thread standing on its own row says nothing
        // about which pass over the code produced it, and next to a
        // conversation comment it does not read as a reply to anything.
        let mut threads: HashMap<String, Vec<PrComment>> = HashMap::new();
        let mut loose: Vec<PrComment> = Vec::new();

        for raw in Nodes::take(self.review_threads) {
            let Some((review, thread)) = raw.map() else { continue };
            match review {
                Some(id) => threads.entry(id).or_default().push(thread),
                None => loose.push(thread),
            }
        }

        comments.extend(Nodes::take(self.reviews).into_iter().filter_map(|r| {
            let mut replies = threads.remove(&r.id).unwrap_or_default();
            replies.sort_by(|a, b| a.created_at.cmp(&b.created_at));

            // A review with no body is the envelope GitHub wraps inline file
            // comments in. Empty and holding nothing, it draws a card that says
            // nothing — but empty and holding threads it is the only row that
            // names who left them, so it stays and they hang off it.
            if r.body.trim().is_empty() && replies.is_empty() && r.state != "APPROVED" {
                return None;
            }

            Some(PrComment {
                kind: review_kind(&r.state),
                author: login(&r.author),
                avatar: avatar(&r.author),
                body: r.body,
                created_at: r.submitted_at,
                // Reviews carry a node id rather than a URL, so the thread
                // they belong to is the closest honest link.
                url: url.clone(),
                path: None,
                resolved: false,
                replies,
                // A review is not a thread: only a review *comment* opens one,
                // and the mutation that answers a thread takes that thread's id.
                thread_id: None,
            })
        }));

        // A thread whose review is not on the list — one left beyond the fifty
        // we ask for — still belongs on the timeline. It reads as its own note,
        // which is what it is once the review it hung off is out of reach.
        comments.extend(threads.into_values().flatten());
        comments.extend(loose);

        comments.sort_by(|a, b| a.created_at.cmp(&b.created_at));

        let checks = Nodes::take(self.tip)
            .into_iter()
            .filter_map(|node| node.commit)
            .filter_map(|commit| commit.status_check_rollup)
            .flat_map(|rollup| Nodes::take(rollup.contexts))
            .filter_map(RawCheck::map)
            .collect();

        // Newest last, which is the order GitHub answers with and the order the
        // branch was written in — a reader checking what a pull request contains
        // reads downward through it.
        let commits: Vec<PrCommit> = Nodes::take(self.history)
            .into_iter()
            .filter_map(|node| node.commit)
            .filter(|commit| !commit.oid.is_empty())
            .map(|commit| {
                let author = commit.author;
                let user = author.as_ref().and_then(|a| a.user.as_ref());
                PrCommit {
                    oid: commit.oid,
                    short_oid: commit.abbreviated_oid,
                    headline: commit.message_headline,
                    committed_at: commit.committed_date,
                    // The name is always there; the account behind it need not
                    // be, so the two are read apart rather than one standing in
                    // for the other.
                    author: author.as_ref().map(|a| a.name.clone()).unwrap_or_default(),
                    login: user
                        .map(|u| u.login.clone())
                        .filter(|login| !login.is_empty()),
                    avatar: user.and_then(|u| u.avatar_url.clone()),
                }
            })
            .collect();

        // A file with no path is not a file — `files` is a connection of paths
        // and counts, and one that arrived without its path cannot be drawn.
        let files: Vec<PrFile> = Nodes::take(self.files)
            .into_iter()
            .filter(|file| !file.path.is_empty())
            .map(|file| PrFile {
                path: file.path,
                additions: file.additions,
                deletions: file.deletions,
                change_type: file.change_type,
            })
            .collect();

        let labels: Vec<PrLabel> = Nodes::take(self.labels)
            .into_iter()
            .filter(|label| !label.name.is_empty())
            .map(|label| PrLabel {
                name: label.name,
                color: label.color.filter(|color| !color.is_empty()),
            })
            .collect();

        PullRequest {
            number: self.number,
            title: self.title,
            url,
            state: self.state,
            is_draft: self.is_draft,
            author: login(&self.author),
            base_ref_name: self.base_ref_name,
            head_ref_name: self.head_ref_name,
            head_ref_exists: self.head_ref.is_some(),
            is_cross_repository: self.is_cross_repository.unwrap_or(true),
            mergeable: self.mergeable,
            merge_state_status: self.merge_state_status,
            review_decision: self.review_decision.filter(|d| !d.is_empty()),
            checks,
            body: self.body,
            labels,
            files,
            commits,
            comments,
            additions: self.additions,
            deletions: self.deletions,
            changed_files: self.changed_files,
            updated_at: self.updated_at,
        }
    }
}

/// Why there is nothing to show, when the reason is not "this branch has no PR".
///
/// Typed rather than a string because the frontend acts differently on each:
/// a missing `gh` hides the tab outright — the app has no business claiming a
/// GitHub feature on a machine with no GitHub CLI — while a `gh` that is merely
/// logged out keeps the tab and says so, since someone who installed it clearly
/// works with GitHub and the fix is one command.
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export, export_to = "events.ts")]
#[serde(rename_all = "snake_case", tag = "kind", content = "detail")]
pub enum PrUnavailable {
    /// `gh` isn't installed.
    NoCli,
    /// `gh` is installed but has no credentials.
    NotAuthenticated,
    /// Not a git repository, or one with no GitHub remote.
    NoRemote,
    /// **Signed in, and refused anyway.** A token that authenticates but cannot
    /// read what the page asks for — a fine-grained PAT without *Commit
    /// statuses* or *Checks*, or an app installation without the repository.
    ///
    /// Its own variant because it is its own failure and the two neighbours are
    /// both wrong for it: nothing is missing from the machine, and the reader is
    /// signed in. Carries nothing, **deliberately** — GitHub answers this with
    /// one error per field path, so the raw text is a list of a dozen
    /// `repository.pullRequests.nodes.N.…` strings with the actual reason
    /// nowhere in it, which is what the panel used to print.
    MissingPermission,
    /// Anything else, carrying `gh`'s own sentence.
    Other(String),
}

impl PrUnavailable {
    /// Reads `gh`'s stderr for the two failures worth telling apart.
    ///
    /// Matched on substrings of the sentences `gh` prints, captured live:
    /// "To get started with GitHub CLI, please run:  gh auth login" and
    /// "failed to run git: fatal: not a git repository". A reworded message
    /// falls through to `Other`, which still puts the text on screen — the
    /// cost of drift is a tab that stays visible, not a wrong answer.
    fn classify(message: String) -> Self {
        let lower = message.to_lowercase();

        if lower.contains("gh auth login") || lower.contains("authentication token") {
            Self::NotAuthenticated
        } else if lower.contains("resource not accessible")
            || lower.contains("not accessible by personal access token")
            || lower.contains("not accessible by integration")
        {
            Self::MissingPermission
        } else if lower.contains("not a git repository")
            || lower.contains("no git remotes")
            || lower.contains("none of the git remotes")
        {
            Self::NoRemote
        } else {
            Self::Other(message)
        }
    }
}

// ── running it ────────────────────────────────────────────────────────────────

/// The one message that is ours rather than `gh`'s, since a binary that does
/// not exist writes no stderr. Sentinel as well as text: [`unavailable`] reads
/// it back to tell "no CLI" from a CLI that answered badly.
const NO_CLI: &str = "GitHub CLI (gh) not found.";

/// Runs `gh` in `cwd`. `Err` is the message to put on screen: `gh` writes a
/// readable sentence to stderr for every failure that matters here — not
/// logged in, no remote, no such repo — and rewording them would only make them
/// less like what the user sees in their own terminal.
async fn gh(cwd: &str, args: &[&str]) -> Result<String, String> {
    gh_with_stdin(cwd, args, None).await
}

/// [`gh`] with something written to its stdin.
///
/// The body of a comment, a review or a thread reply goes down the pipe rather
/// than through argv: prose is of any length and holds anything, and an argument
/// is neither. `gh`'s `--body-file -` and `gh api --input -` are the two doors
/// that take it.
///
/// `None` keeps stdin null, which is what every read wants: `gh` prompts when it
/// cannot decide something on its own, and a prompt written to a pipe nobody
/// reads is a command that never returns.
async fn gh_with_stdin(cwd: &str, args: &[&str], input: Option<&str>) -> Result<String, String> {
    let bin = binpath::gh().await.ok_or(NO_CLI)?;

    // A worktree removed outside hz leaves the session's `cwd` naming a
    // directory that is gone, and the spawn then fails with ENOENT *before*
    // `gh` is reached — which reads as `gh` itself being missing. The startup
    // backfill repairs the entry, so this is the window before the next launch.
    if !Path::new(cwd).is_dir() {
        return Err(format!("{cwd} no longer exists."));
    }

    let mut command = Command::new(bin);
    command
        .args(args)
        .current_dir(cwd)
        .env("GIT_OPTIONAL_LOCKS", "0")
        // `gh` prompts when it can't decide something on its own, and a prompt
        // written to a pipe nobody reads is a command that never returns.
        .env("GH_PROMPT_DISABLED", "1")
        .env("GH_NO_UPDATE_NOTIFIER", "1")
        .stdin(if input.is_some() {
            Stdio::piped()
        } else {
            Stdio::null()
        })
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let mut child = command.spawn().map_err(|e| format!("could not run gh: {e}"))?;

    if let Some(text) = input {
        // Written from its own task: `gh` streams its answer as it reads, and
        // filling the pipe before draining the other end is a deadlock on
        // anything bigger than one pipe buffer.
        let mut stdin = child.stdin.take().ok_or("gh closed its input")?;
        let body = text.to_string();
        tokio::spawn(async move {
            use tokio::io::AsyncWriteExt;
            let _ = stdin.write_all(body.as_bytes()).await;
            let _ = stdin.shutdown().await;
        });
    }

    let out = child
        .wait_with_output()
        .await
        .map_err(|e| format!("could not run gh: {e}"))?;

    if !out.status.success() {
        let err = String::from_utf8_lossy(&out.stderr).trim().to_string();
        return Err(if err.is_empty() {
            "gh exited with an error".to_string()
        } else {
            err
        });
    }

    Ok(String::from_utf8_lossy(&out.stdout).into_owned())
}

/// `owner/name` for the repo `cwd` sits in, cached for the process.
///
/// GraphQL takes the repo as arguments where every `gh pr` subcommand works it
/// out from the directory, so this is the one extra call the switch costs. It
/// is paid once per checkout: a remote does not move while the app is running,
/// and the same bargain the command cache and `binpath` already make.
async fn repo_slug(cwd: &str) -> Result<(String, String), String> {
    static SLUGS: LazyLock<Mutex<HashMap<String, (String, String)>>> =
        LazyLock::new(|| Mutex::new(HashMap::new()));

    if let Some(hit) = SLUGS.lock().await.get(cwd) {
        return Ok(hit.clone());
    }

    let out = gh(cwd, &["repo", "view", "--json", "nameWithOwner", "-q", ".nameWithOwner"]).await?;
    let slug = out.trim();

    let (owner, name) = slug
        .split_once('/')
        .ok_or_else(|| format!("could not read the repository name from {slug:?}"))?;
    let pair = (owner.to_string(), name.to_string());

    SLUGS.lock().await.insert(cwd.to_string(), pair.clone());
    Ok(pair)
}

/// Every pull request opened from `branch`, newest first, open ones ahead of
/// settled ones.
///
/// A list rather than one answer, because one branch really can carry several:
/// the same fix opened against `main` and a release branch, or a stack where
/// each PR's base is the branch below it. `gh pr view <branch>` collapses that
/// to whichever one it finds first and says nothing about the rest, which is
/// the one failure here the reader could not possibly notice.
///
/// An empty list is the resting state of most branches and reads as `Ok(vec![])`
/// — a branch nobody has opened a PR from is not an error. Everything that
/// stopped us asking comes back as a typed [`PrUnavailable`], because the tab
/// hides for one of those reasons and stays for the rest.
#[tauri::command]
pub async fn prs_for_branch(
    cwd: String,
    branch: String,
) -> Result<Vec<PullRequest>, PrUnavailable> {
    match prs_for_branch_inner(&cwd, &branch).await.map_err(unavailable) {
        // With no `gh`, *every* directory answers `NoCli` — the first call
        // fails before anything has looked at the checkout — and the panel
        // keeps its tab for that reason so the install can be offered. So git
        // is asked the question `gh` would have answered, or a machine without
        // the CLI grows a PR tab on sessions that have nothing to do with
        // GitHub.
        Err(PrUnavailable::NoCli) if !git::has_github_remote(&cwd).await => {
            Err(PrUnavailable::NoRemote)
        }
        answer => answer,
    }
}

// ── what this machine can do with source control ─────────────────────────────

/// Git and GitHub as one read, for the settings section that explains them.
///
/// **About the machine, not about a checkout**, and that is the whole reason it
/// is not another `cwd`-taking command: every other read here answers for one
/// repository, and the questions a reader has when pull requests will not load —
/// is `gh` even here, who is it signed in as, what may that token read — are
/// answered once for the whole app.
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export, export_to = "events.ts")]
#[serde(rename_all = "camelCase")]
pub struct SourceControlState {
    /// `git --version`'s own words, or `None` where git is not on the PATH.
    pub git: Option<String>,
    /// `None` where the CLI is not installed at all.
    pub gh: Option<GhAccount>,
}

/// Who `gh` is signed in as, and what its credential may read.
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export, export_to = "events.ts")]
#[serde(rename_all = "camelCase")]
pub struct GhAccount {
    /// Where the credential came from — `keyring` for `gh auth login`, or the
    /// name of the variable when a token was handed in from the environment.
    /// **The distinction matters to the cure**: one is refreshed with
    /// `gh auth refresh`, the other has to be regenerated where it was made.
    pub token_source: Option<String>,
    pub host: Option<String>,
    pub login: Option<String>,
    /// As `gh` reports them, split on the commas it separates them with. Empty
    /// for a token that carries no scopes at all, which is every fine-grained
    /// personal access token — its permissions are on GitHub, not in here.
    pub scopes: Vec<String>,
    /// **`gh`'s own sentence where it found a credential and was refused**,
    /// which is the state a reader is in when the token is there and wrong.
    pub error: Option<String>,
}

#[tauri::command]
pub async fn source_control_state() -> SourceControlState {
    SourceControlState {
        git: git_version().await,
        gh: gh_account().await,
    }
}

/// `git --version`, or `None` where there is no git to run. Not an error: a
/// machine without git is a machine hz cannot do much on, and the row says so.
async fn git_version() -> Option<String> {
    let out = Command::new("git").arg("--version").output().await.ok()?;
    let text = String::from_utf8_lossy(&out.stdout).trim().to_string();
    out.status.success().then_some(text).filter(|t| !t.is_empty())
}

/// Who `gh` is signed in as, or `None` where the CLI is not installed.
async fn gh_account() -> Option<GhAccount> {
    let bin = binpath::gh().await?;
    let out = Command::new(bin)
        .args(["auth", "status", "--json", "hosts"])
        // The same pair every other `gh` call here sets, for the same reason: a
        // prompt written to a pipe nobody reads is a command that never returns,
        // and the update notifier pollutes what this parses.
        .env("GH_PROMPT_DISABLED", "1")
        .env("GH_NO_UPDATE_NOTIFIER", "1")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .await
        .ok()?;

    // **Read from the document, never from the exit code.** `gh auth status`
    // exits non-zero when it found no credential, and prints the same JSON
    // either way — so a status read off the code would call a signed-out machine
    // broken rather than signed out.
    Some(read_gh_account(&String::from_utf8_lossy(&out.stdout)))
}

/// The active host entry out of `gh auth status --json hosts`.
///
/// Split out so the shapes are pinned without a `gh` on the machine: there are
/// three that matter, and two of them are not the happy one. Logged out is
/// `{"hosts":{}}`; a credential that was refused is a second entry with
/// `state: "error"` and a message; and a machine with both an environment token
/// and a keyring login carries **two entries for one host**, of which only one
/// has `active: true`.
fn read_gh_account(json: &str) -> GhAccount {
    let blank = GhAccount {
        token_source: None,
        host: None,
        login: None,
        scopes: Vec::new(),
        error: None,
    };

    let Ok(payload) = serde_json::from_str::<serde_json::Value>(json) else {
        return GhAccount {
            error: Some("gh answered something this build does not read".to_string()),
            ..blank
        };
    };

    // Every host's entries, flattened. Logged out is `{"hosts":{}}`, which
    // leaves this empty and answers the blank below.
    let entries: Vec<&serde_json::Value> = payload
        .get("hosts")
        .and_then(|hosts| hosts.as_object())
        .map(|hosts| hosts.values().filter_map(|value| value.as_array()).flatten().collect())
        .unwrap_or_default();

    // The active one, or the first — `gh` marks exactly one entry per host
    // active, and a machine carrying both an environment token and a keyring
    // login answers with two entries for one host.
    let Some(entry) = entries
        .iter()
        .find(|entry| entry.get("active").and_then(|active| active.as_bool()) == Some(true))
        .or_else(|| entries.first())
    else {
        return blank;
    };

    let text = |key: &str| {
        entry
            .get(key)
            .and_then(|value| value.as_str())
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(String::from)
    };

    GhAccount {
        token_source: text("tokenSource"),
        host: text("host"),
        login: text("login"),
        scopes: text("scopes")
            .map(|scopes| {
                scopes
                    .split(',')
                    .map(str::trim)
                    .filter(|scope| !scope.is_empty())
                    .map(String::from)
                    .collect()
            })
            .unwrap_or_default(),
        error: text("error"),
    }
}

/// Probes for `gh` again, and answers whether it is there now.
///
/// The panel's recheck button, pressed by a reader who has just installed the
/// CLI on its say-so. The absence is cached for the life of the process, so
/// without this the install they were asked to make appears to change nothing.
#[tauri::command]
pub async fn recheck_gh() -> bool {
    binpath::forget_gh();
    binpath::gh().await.is_some()
}

/// Maps a raw `gh` failure onto the reason the panel branches on. Split out so
/// the classifier can be tested without spawning anything.
fn unavailable(message: String) -> PrUnavailable {
    if message.starts_with(NO_CLI) {
        PrUnavailable::NoCli
    } else {
        PrUnavailable::classify(message)
    }
}

async fn prs_for_branch_inner(cwd: &str, branch: &str) -> Result<Vec<PullRequest>, String> {
    let (owner, repo) = repo_slug(cwd).await?;

    let out = gh(
        cwd,
        &[
            "api",
            "graphql",
            "-f",
            &format!("owner={owner}"),
            "-f",
            &format!("repo={repo}"),
            "-f",
            &format!("branch={branch}"),
            "-f",
            &format!("query={QUERY}"),
        ],
    )
    .await?;

    read_prs(&out)
}

/// Splits parsing off the spawn so the fixture can exercise it.
fn read_prs(out: &str) -> Result<Vec<PullRequest>, String> {
    let response: Response<PrsRepository> =
        serde_json::from_str(out).map_err(|e| format!("could not read GitHub's answer: {e}"))?;

    let mut prs: Vec<PullRequest> = response
        .repository()?
        .map(|r| Nodes::take(r.open).into_iter().chain(Nodes::take(r.settled)))
        .into_iter()
        .flatten()
        .map(RawPr::map)
        .collect();

    // An open PR is the one being worked on whatever its age, so it outranks a
    // newer merged one — otherwise reopening an old branch shows the reader the
    // PR they already landed.
    prs.sort_by(|a, b| {
        let rank = |pr: &PullRequest| u8::from(pr.state != "OPEN");
        rank(a).cmp(&rank(b)).then(b.number.cmp(&a.number))
    });

    Ok(prs)
}

/// Which of the two connections a mark came from.
///
/// Not parsed off the wire: [`QUERY_MARKS`] asks each state in its own aliased
/// connection, so the connection *is* the answer and a `state` field would be a
/// second copy of it free to disagree. Only the two states the sidebar draws —
/// closed-without-merging is not asked for.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[ts(export, export_to = "events.ts")]
#[serde(rename_all = "UPPERCASE")]
pub enum PrMarkState {
    Open,
    Merged,
}

/// One pull request, cut down to what a sidebar row can draw.
///
/// Deliberately not a `PullRequest`: the row says "this branch has a PR, and
/// what became of it" and nothing else, so carrying checks, comments and review
/// threads for every session in the list would be payload nobody reads.
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export, export_to = "events.ts")]
#[serde(rename_all = "camelCase")]
pub struct PrMark {
    pub number: u64,
    /// The branch it was opened from — what the caller matches a session by.
    pub head_ref_name: String,
    pub is_draft: bool,
    pub state: PrMarkState,
    pub checks_state: PrChecksState,
    /// Enough of the panel's merge fields to answer "can this land now", which
    /// the sidebar itself draws nothing from — the notice for a pull request
    /// turning ready does, and this is the only read that runs for a session
    /// nobody is looking at. The panel's query is gated on its own tab being
    /// on screen, which is precisely when there is nothing to announce.
    ///
    /// `None` on the merged half, where they are not asked for. The frontend
    /// reads that as *unknown* rather than as ready — see `mergeVerdict`.
    pub mergeable: Option<String>,
    pub merge_state_status: Option<String>,
}

/// What CI on the tip commit has to say, cut to the two things a row can show.
///
/// Passing is folded in with "no checks at all" on purpose: a row that says
/// nothing is a row with nothing to do, and marking every green branch green a
/// second time makes the mark that *does* need reading harder to find. So this
/// is a three-way, not the rollup's five-way — `SUCCESS` and an absent rollup
/// both reach the reader as [`PrChecksState::Clear`].
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[ts(export, export_to = "events.ts")]
#[serde(rename_all = "UPPERCASE")]
pub enum PrChecksState {
    /// Still going, and going to finish on its own — the one state here worth
    /// an indicator the reader can watch.
    Running,
    /// Settled badly. Drawn by recolouring the pull request's own glyph rather
    /// than by adding a second mark: it is a fact *about* the PR, not another
    /// thing on the row.
    Failing,
    /// Passing, or no CI configured at all. Nothing to say either way.
    Clear,
}

impl PrChecksState {
    /// Reads GitHub's `StatusState` into the three the row draws.
    ///
    /// `EXPECTED` is running, not failing: it means a required check has not
    /// reported yet, which is a wait rather than a verdict. `ERROR` sits with
    /// `FAILURE` — a check that could not run is one that has not passed, and
    /// telling them apart is the panel's job, not a row's.
    ///
    /// Anything unrecognised reads as [`PrChecksState::Clear`], which is the safe
    /// way round: a vocabulary GitHub adds later shows nothing rather than
    /// painting every row red.
    fn from_rollup(state: &str) -> Self {
        match state {
            "PENDING" | "EXPECTED" => Self::Running,
            "FAILURE" | "ERROR" => Self::Failing,
            _ => Self::Clear,
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawPrMark {
    number: u64,
    #[serde(default)]
    head_ref_name: String,
    /// Always false on a merged one — GitHub clears the flag on merge — so this
    /// is only ever read for the open half. One node shape for both keeps the
    /// query symmetrical.
    #[serde(default)]
    is_draft: bool,
    /// Only asked for on the open half, so absent — not empty — on the merged
    /// one. Same nesting the panel's query walks, so the same structs read it.
    #[serde(default)]
    commits: Option<Nodes<RawCommitNode>>,
    /// Asked for on the open half alone, for the same reason `commits` is: a
    /// merged pull request cannot become ready to merge, and `mergeStateStatus`
    /// is the one field here GitHub computes *on being asked* — so putting it
    /// on the merged connection would spend that work a hundred times over to
    /// answer a question nobody asks.
    #[serde(default)]
    mergeable: Option<String>,
    #[serde(default)]
    merge_state_status: Option<String>,
}

/// The tip commit's rollup, read into what the row draws.
///
/// `commits(last:1)` asks for one, so anything else — no commits, no rollup, no
/// CI — is [`PrChecksState::Clear`] rather than an error: a repo without checks is
/// the ordinary case, not a failure to read one.
fn read_checks(commits: Option<Nodes<RawCommitNode>>) -> PrChecksState {
    Nodes::take(commits)
        .into_iter()
        .filter_map(|node| node.commit)
        .filter_map(|commit| commit.status_check_rollup)
        .filter_map(|rollup| rollup.state)
        .map(|state| PrChecksState::from_rollup(&state))
        .next()
        .unwrap_or(PrChecksState::Clear)
}

/// The two-connection answer: `pullRequests` asked twice under two aliases.
#[derive(Deserialize)]
struct MarksRepository {
    open: Option<Nodes<RawPrMark>>,
    merged: Option<Nodes<RawPrMark>>,
}

/// Every pull request in the repo `cwd` sits in that a sidebar row can be
/// marked with — open ones and merged ones.
///
/// One call for a whole sidebar's worth of rows — see [`QUERY_MARKS`]. The
/// caller matches a session to its entry by branch, so this answers a list
/// rather than a map: which branch a session lands on is the frontend's own
/// rule (a worktree session's is rebuilt from its worktree name), and building
/// the map here would be a second copy of it. One branch can carry several, so
/// picking which one a row draws is the caller's too.
#[tauri::command]
pub async fn pr_marks(cwd: String) -> Result<Vec<PrMark>, PrUnavailable> {
    pr_marks_inner(&cwd).await.map_err(unavailable)
}

async fn pr_marks_inner(cwd: &str) -> Result<Vec<PrMark>, String> {
    let (owner, repo) = repo_slug(cwd).await?;

    let out = gh(
        cwd,
        &[
            "api",
            "graphql",
            "-f",
            &format!("owner={owner}"),
            "-f",
            &format!("repo={repo}"),
            "-f",
            &format!("query={QUERY_MARKS}"),
        ],
    )
    .await?;

    read_pr_marks(&out)
}

/// Splits parsing off the spawn, like [`read_prs`].
fn read_pr_marks(out: &str) -> Result<Vec<PrMark>, String> {
    let response: Response<MarksRepository> =
        serde_json::from_str(out).map_err(|e| format!("could not read GitHub's answer: {e}"))?;

    let (open, merged) = match response.repository()? {
        Some(r) => (Nodes::take(r.open), Nodes::take(r.merged)),
        None => (Vec::new(), Vec::new()),
    };

    Ok(open
        .into_iter()
        .map(|pr| (PrMarkState::Open, pr))
        .chain(merged.into_iter().map(|pr| (PrMarkState::Merged, pr)))
        .map(|(state, mut pr)| PrMark {
            number: pr.number,
            checks_state: read_checks(pr.commits.take()),
            head_ref_name: pr.head_ref_name,
            is_draft: pr.is_draft,
            state,
            mergeable: pr.mergeable,
            merge_state_status: pr.merge_state_status,
        })
        .collect())
}

/// Merges the PR. Returns once `gh` has, so the caller can refetch and show
/// the landed state rather than guess at it.
///
/// The branch is deliberately left behind — no `--delete-branch`. A worktree
/// session has its own branch checked out, so `git branch -D` refuses it and
/// the cleanup fails after the merge has already landed; cleaning up worktrees
/// is its own job, not a checkbox on this one.
///
/// A failure is still checked against the PR before being reported: `gh pr
/// merge` can fail with the merge already through (a post-merge step, a lost
/// connection), and reporting the exit code alone tells the reader their merge
/// failed when it is on `main`.
#[tauri::command]
pub async fn merge_pr(cwd: String, number: u64, method: MergeMethod) -> Result<(), String> {
    let arg = number.to_string();

    let Err(e) = gh(&cwd, &["pr", "merge", &arg, method.flag()]).await else {
        crate::analytics::feature_used("pr_merged");
        return Ok(());
    };

    match merged_state(&cwd, number).await {
        // Reported on both paths rather than once around the whole function:
        // the two are the same answer, but only one of them is a call that
        // reported failure and turned out to have worked.
        Some(true) => {
            crate::analytics::feature_used("pr_merged");
            Ok(())
        }
        // Either it genuinely didn't merge, or we couldn't find out — and an
        // unverifiable merge has to read as the failure it was reported as.
        _ => Err(e),
    }
}

/// Whether the PR is merged, or `None` where asking failed too.
async fn merged_state(cwd: &str, number: u64) -> Option<bool> {
    let out = gh(cwd, &["pr", "view", &number.to_string(), "--json", "state"])
        .await
        .ok()?;
    let value: serde_json::Value = serde_json::from_str(&out).ok()?;

    Some(value.get("state")?.as_str()? == "MERGED")
}

/// Which pull requests a listing wants.
///
/// GitHub's three states plus "all", because a page that only ever showed open
/// ones could not answer "did this land?" — the question the panel exists for,
/// asked about work that is not on screen.
#[derive(Debug, Clone, Copy, Deserialize, Serialize, TS)]
#[ts(export, export_to = "events.ts")]
#[serde(rename_all = "snake_case")]
pub enum PrListState {
    All,
    Open,
    Closed,
    Merged,
}

impl PrListState {
    fn flag(self) -> &'static str {
        match self {
            Self::All => "all",
            Self::Open => "open",
            Self::Closed => "closed",
            Self::Merged => "merged",
        }
    }
}

/// One row of the pull-request page: what a *list* needs, and nothing that only
/// a detail read can answer.
///
/// Deliberately not [`PullRequest`]. A page shows fifty rows and a detail pane
/// shows one: asking for the full shape fifty times is fifty comment trees and
/// fifty check lists nobody scrolls. What a row cannot answer — the checks
/// themselves, the conversation, the threads — the detail read answers, and the
/// page uses the same `prs_for_branch` for it that the session's own tab does.
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export, export_to = "events.ts")]
#[serde(rename_all = "camelCase")]
pub struct PrListItem {
    pub number: u64,
    pub title: String,
    pub url: String,
    /// `OPEN`, `CLOSED` or `MERGED`, GitHub's own word.
    pub state: String,
    pub is_draft: bool,
    pub author: String,
    pub avatar: Option<String>,
    pub head_ref_name: String,
    pub base_ref_name: String,
    pub updated_at: String,
    /// When it was opened. The list can be ordered by age, and `updatedAt` cannot
    /// answer that: a year-old pull request touched this morning is the newest by
    /// one and the oldest by the other.
    pub created_at: String,
    pub additions: u32,
    pub deletions: u32,
    pub changed_files: u32,
    pub review_decision: Option<String>,
    pub mergeable: String,
    pub merge_state_status: String,
    /// The tip commit's checks, folded to one word — the same fold the sidebar's
    /// marks use, for the same reason: a row has space for running or failing,
    /// not for fifty contexts.
    pub checks_state: PrChecksState,
    /// Everyone asked to review it — people by login, teams by slug.
    ///
    /// This is what the page's "waiting on you" grouping asks about, and it is
    /// why the grouping is done here rather than with three `gh` calls: one
    /// listing plus the viewer's own login (cached for the process) answers
    /// "mine", "waiting on me" and "everything else" without a spawn per group.
    pub review_requests: Vec<String>,
    /// What the repository has filed it under.
    ///
    /// Carried because the page's own filter menu wants them and a label is the
    /// one narrowing GitHub cannot answer for: `--label` exists on `gh pr list`,
    /// and a filter that re-read the host on every tick would be a spawn per
    /// click against labels the listing already holds.
    pub labels: Vec<PrLabel>,
}

/// One label, as a row draws it: the name, and the colour so the dot beside it
/// is the one GitHub shows rather than a shade this app invented.
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export, export_to = "events.ts")]
#[serde(rename_all = "camelCase")]
pub struct PrLabel {
    pub name: String,
    /// Six hex digits without the `#`, or `None` for a label with no colour set.
    pub color: Option<String>,
}

/// The rows and who is asking.
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export, export_to = "events.ts")]
#[serde(rename_all = "camelCase")]
pub struct PrListPage {
    pub items: Vec<PrListItem>,
    /// The signed-in account, or `None` where `gh` would not say — in which case
    /// nothing is filed under the reader's own name and every row lands under
    /// Others, which is the honest answer rather than a guess.
    pub viewer: Option<String>,
}

/// The fields a page row is built from, as `gh pr list --json` names them.
///
/// `statusCheckRollup` is the one that is not a scalar: `gh` passes the GraphQL
/// connections through, so the contexts carry their own `__typename` and land on
/// the same [`RawCheck`] the panel's query does.
const LIST_FIELDS: &str = "number,title,url,state,isDraft,author,headRefName,baseRefName,updatedAt,additions,deletions,changedFiles,reviewDecision,mergeable,mergeStateStatus,statusCheckRollup,reviewRequests,labels";

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawListItem {
    number: u64,
    #[serde(default)]
    title: String,
    #[serde(default)]
    url: String,
    #[serde(default)]
    state: String,
    #[serde(default)]
    is_draft: bool,
    #[serde(default)]
    author: Option<RawAuthor>,
    #[serde(default)]
    head_ref_name: String,
    #[serde(default)]
    base_ref_name: String,
    #[serde(default)]
    updated_at: String,
    #[serde(default)]
    created_at: String,
    #[serde(default)]
    additions: u32,
    #[serde(default)]
    deletions: u32,
    #[serde(default)]
    changed_files: u32,
    #[serde(default)]
    review_decision: Option<String>,
    #[serde(default)]
    mergeable: String,
    #[serde(default)]
    merge_state_status: String,
    /// The contexts themselves, not a rolled-up verdict — `gh` reports the array
    /// for this field either way, and folding them here is the same code the
    /// panel's own read uses.
    #[serde(default)]
    status_check_rollup: Option<Vec<RawCheck>>,
    #[serde(default)]
    review_requests: Option<Vec<RawReviewRequest>>,
    #[serde(default)]
    labels: Option<Vec<RawLabel>>,
}

#[derive(Deserialize)]
struct RawReviewRequest {
    #[serde(default)]
    login: Option<String>,
    #[serde(default)]
    slug: Option<String>,
}

#[derive(Deserialize)]
struct RawLabel {
    #[serde(default)]
    name: String,
    #[serde(default)]
    color: Option<String>,
}

impl RawListItem {
    fn map(self) -> PrListItem {
        let checks: Vec<PrCheck> = self
            .status_check_rollup
            .unwrap_or_default()
            .into_iter()
            .filter_map(RawCheck::map)
            .collect();

        PrListItem {
            number: self.number,
            title: self.title,
            url: self.url,
            state: self.state,
            is_draft: self.is_draft,
            author: login(&self.author),
            avatar: avatar(&self.author),
            head_ref_name: self.head_ref_name,
            base_ref_name: self.base_ref_name,
            updated_at: self.updated_at,
            created_at: self.created_at,
            additions: self.additions,
            deletions: self.deletions,
            changed_files: self.changed_files,
            review_decision: self.review_decision.filter(|decision| !decision.is_empty()),
            mergeable: self.mergeable,
            merge_state_status: self.merge_state_status,
            checks_state: fold_checks(&checks),
            review_requests: self
                .review_requests
                .unwrap_or_default()
                .into_iter()
                .filter_map(|request| request.login.or(request.slug))
                .filter(|who| !who.is_empty())
                .collect(),
            labels: self
                .labels
                .unwrap_or_default()
                .into_iter()
                // A label with no name is not a label: `gh` reports the colour
                // alone for a repository that has one, and a nameless dot is a
                // row that cannot be told from its neighbour.
                .filter(|label| !label.name.is_empty())
                .map(|label| PrLabel {
                    name: label.name,
                    color: label.color.filter(|color| !color.is_empty()),
                })
                .collect(),
        }
    }
}

/// Fifty contexts folded to the one word a row has room for.
///
/// Failing outranks running, which is the order a reader would pick if they had
/// to: a red row is the one to open, and a check still going says so on the
/// detail pane a second later.
fn fold_checks(checks: &[PrCheck]) -> PrChecksState {
    if checks
        .iter()
        .any(|check| matches!(check.state, CheckState::Failure))
    {
        return PrChecksState::Failing;
    }
    if checks
        .iter()
        .any(|check| matches!(check.state, CheckState::Pending))
    {
        return PrChecksState::Running;
    }
    PrChecksState::Clear
}

/// The signed-in account, for deciding which rows are the reader's own.
///
/// Cached for the process: a login does not change while the app is running, and
/// this is one `gh` spawn on a page that already spends one per listing.
async fn viewer_login(cwd: &str) -> Option<String> {
    static VIEWER: LazyLock<Mutex<HashMap<String, Option<String>>>> =
        LazyLock::new(|| Mutex::new(HashMap::new()));

    if let Some(hit) = VIEWER.lock().await.get(cwd) {
        return hit.clone();
    }

    let login = gh(cwd, &["api", "user", "-q", ".login"])
        .await
        .ok()
        .map(|out| out.trim().to_string())
        .filter(|login| !login.is_empty());

    VIEWER.lock().await.insert(cwd.to_string(), login.clone());
    login
}

/// One workflow run, as the Actions row draws it.
///
/// **A row's worth and no more.** Which step failed, what artifact it left and
/// how long each job took are all one `gh run view` away, and a page that read
/// them for thirty runs would be thirty spawns for facts nobody scrolls past —
/// the same bargain [`PrListItem`] makes against [`PullRequest`].
///
/// `status` and `conclusion` ride GitHub's own words rather than a fold, because
/// there is nothing to fold: one run has one of each, and the mapping to a glyph
/// and a colour is the frontend's — the split [`PrListItem::state`] makes.
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export, export_to = "events.ts")]
#[serde(rename_all = "camelCase")]
pub struct WorkflowRun {
    /// GitHub's own id for the run: what a re-run or a cancel would address, and
    /// what the row is keyed by. Not the number, which is unique only within its
    /// workflow.
    pub id: u64,
    /// The run's number within its workflow — the `#70` GitHub's own page shows.
    pub number: u64,
    /// Which attempt this is. A re-run increments it, so `2` is a run that failed
    /// once and was asked again; drawn only above one.
    pub attempt: u64,
    /// The workflow's name as the repository declares it (`Release`, `Warm
    /// cache`).
    pub workflow: String,
    /// What the run is about: the commit subject it was started for, or the
    /// workflow's own name for a run GitHub starts on its own behalf
    /// (`pages build and deployment`).
    pub title: String,
    pub branch: String,
    pub sha: String,
    /// What asked for it — `push`, `pull_request`, `workflow_dispatch`,
    /// `schedule`, or `dynamic` for GitHub's own.
    pub event: String,
    /// `queued`, `in_progress`, `completed`, as GitHub spells them.
    pub status: String,
    /// `success`, `failure`, `cancelled`, `skipped`, `timed_out`… and `None`
    /// while the run has not finished, which is not the same fact as a
    /// conclusion nobody has given.
    pub conclusion: Option<String>,
    pub created_at: String,
    /// When a runner picked it up. `None` while it is still queued, which is the
    /// whole difference between waiting for a machine and running on one.
    pub started_at: Option<String>,
    /// When it last moved — the end of the run, for one that has finished.
    pub updated_at: String,
    pub url: String,
}

/// Everything `gh run view` knows about one run, which is a row plus its jobs.
///
/// **One extra spawn, and only for the run the reader asked about.** Which step
/// failed is the question a red row raises, and the answer is a job list the
/// listing does not carry: thirty of those would be thirty `gh run view` calls
/// for a pane that shows one.
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export, export_to = "events.ts")]
#[serde(rename_all = "camelCase")]
pub struct WorkflowRunDetail {
    pub run: WorkflowRun,
    pub jobs: Vec<WorkflowJob>,
}

/// One job in a run, and how far it got.
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export, export_to = "events.ts")]
#[serde(rename_all = "camelCase")]
pub struct WorkflowJob {
    pub id: u64,
    /// The job's key in the workflow file, which is also what GitHub's own page
    /// heads the block with (`build`, `release`).
    pub name: String,
    pub status: String,
    pub conclusion: Option<String>,
    /// When a runner picked it up. **Not a proxy for "it ran"** — a job skipped
    /// by its own `if:` carries a stamp here too, and its empty step list is what
    /// says it did nothing.
    pub started_at: Option<String>,
    pub completed_at: Option<String>,
    /// **Empty is a fact, not a gap.** A job skipped by an `if:` has no steps at
    /// all, and a list that drew it as "no steps reported" would be guessing at
    /// which of the two it was.
    pub steps: Vec<WorkflowStep>,
}

/// One step of a job. Steps are not addressable — nothing re-runs or cancels one
/// — so this is the number the run's own page shows, and nothing else.
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export, export_to = "events.ts")]
#[serde(rename_all = "camelCase")]
pub struct WorkflowStep {
    pub number: u64,
    pub name: String,
    pub status: String,
    pub conclusion: Option<String>,
    pub started_at: Option<String>,
    pub completed_at: Option<String>,
}

/// The fields a run's own page is built from, as `gh run view --json` names them.
/// The run's scalars are the listing's own — one shape, two calls.
const RUN_VIEW_FIELDS: &str = "attempt,conclusion,createdAt,databaseId,displayTitle,event,headBranch,headSha,jobs,name,number,startedAt,status,updatedAt,url";

/// The fields an Actions row is built from, as `gh run list --json` names them.
///
/// `name` is the workflow's *display* name, which is what a row shows; the
/// sibling `workflowName` is the file-derived one (`pages-build-deployment`),
/// kept out because the two differ only where the display name is the better of
/// them.
const RUN_FIELDS: &str = "attempt,conclusion,createdAt,databaseId,displayTitle,event,headBranch,headSha,name,number,startedAt,status,updatedAt,url";

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawRun {
    #[serde(default)]
    database_id: u64,
    #[serde(default)]
    number: u64,
    #[serde(default)]
    attempt: u64,
    #[serde(default)]
    name: String,
    #[serde(default)]
    display_title: String,
    #[serde(default)]
    head_branch: String,
    #[serde(default)]
    head_sha: String,
    #[serde(default)]
    event: String,
    #[serde(default)]
    status: String,
    #[serde(default)]
    conclusion: Option<String>,
    #[serde(default)]
    created_at: String,
    #[serde(default)]
    started_at: Option<String>,
    #[serde(default)]
    updated_at: String,
    #[serde(default)]
    url: String,
    /// Only ever present on `gh run view` — the listing asks for no jobs, and
    /// `None` is that absence rather than an empty list.
    #[serde(default)]
    jobs: Option<Vec<RawJob>>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawJob {
    #[serde(default)]
    database_id: u64,
    #[serde(default)]
    name: String,
    #[serde(default)]
    status: String,
    #[serde(default)]
    conclusion: Option<String>,
    #[serde(default)]
    started_at: Option<String>,
    #[serde(default)]
    completed_at: Option<String>,
    #[serde(default)]
    steps: Option<Vec<RawStep>>,
}

impl RawJob {
    fn map(self) -> WorkflowJob {
        WorkflowJob {
            id: self.database_id,
            name: self.name,
            status: self.status,
            conclusion: self.conclusion.filter(|c| !c.is_empty()),
            started_at: self.started_at.filter(|s| !s.is_empty()),
            completed_at: self.completed_at.filter(|s| !s.is_empty()),
            steps: self.steps.unwrap_or_default().into_iter().map(RawStep::map).collect(),
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawStep {
    #[serde(default)]
    number: u64,
    #[serde(default)]
    name: String,
    #[serde(default)]
    status: String,
    #[serde(default)]
    conclusion: Option<String>,
    #[serde(default)]
    started_at: Option<String>,
    #[serde(default)]
    completed_at: Option<String>,
}

impl RawStep {
    fn map(self) -> WorkflowStep {
        WorkflowStep {
            number: self.number,
            name: self.name,
            status: self.status,
            conclusion: self.conclusion.filter(|c| !c.is_empty()),
            started_at: self.started_at.filter(|s| !s.is_empty()),
            completed_at: self.completed_at.filter(|s| !s.is_empty()),
        }
    }
}

impl RawRun {
    fn map(self) -> WorkflowRun {
        // Bound before the literal, which moves both: the fallback title is the
        // workflow's own name, so the name has to outlive being taken.
        let workflow = self.name;
        let title = if self.display_title.is_empty() {
            workflow.clone()
        } else {
            self.display_title
        };

        WorkflowRun {
            id: self.database_id,
            number: self.number,
            // Never zero: the field is absent on an older `gh`, and "attempt 0"
            // is a sentence no run has ever been.
            attempt: self.attempt.max(1),
            workflow,
            // A run whose title `gh` would not give still says which workflow it
            // is, and a nameless row is worse than a repeated one.
            title,
            branch: self.head_branch,
            sha: self.head_sha,
            event: self.event,
            status: self.status,
            // `gh` answers an empty string where GitHub has given no conclusion —
            // a run still going, or one cancelled before it started. Both are the
            // absence of a verdict rather than a verdict of "".
            conclusion: self.conclusion.filter(|c| !c.is_empty()),
            created_at: self.created_at,
            started_at: self.started_at.filter(|s| !s.is_empty()),
            updated_at: self.updated_at,
            url: self.url,
        }
    }
}

/// The recent runs of every repository the page is pointed at.
#[tauri::command]
pub async fn list_workflow_runs(
    cwd: String,
    branch: Option<String>,
) -> Result<Vec<WorkflowRun>, PrUnavailable> {
    list_workflow_runs_inner(&cwd, branch)
        .await
        .map_err(unavailable)
}

/// `branch` narrows at the host, because it is the one question about CI the
/// host can answer for us: `--branch` is server-side, and "did what I just
/// pushed pass" is the question a reader actually arrives with. Every other
/// narrowing the page offers — status, event, workflow — is a filter over rows
/// already in hand, the bargain the pull request list makes with its own filters.
async fn list_workflow_runs_inner(
    cwd: &str,
    branch: Option<String>,
) -> Result<Vec<WorkflowRun>, String> {
    let mut args = vec!["run", "list", "--limit", "40", "--json", RUN_FIELDS];

    let branch = branch.unwrap_or_default();
    let branch = branch.trim();
    if !branch.is_empty() {
        args.extend(["--branch", branch]);
    }

    let out = gh(cwd, &args).await?;
    let raw: Vec<RawRun> = serde_json::from_str(&out)
        .map_err(|e| format!("could not read that run list: {e}"))?;

    Ok(raw.into_iter().map(RawRun::map).collect())
}

/// The pull-request page's listing: every pull request one repository has, in
/// whatever state the filter asks for.
///
/// `gh pr list` rather than the GraphQL query the panel uses, and the difference
/// is the question: the panel asks about *one branch* and wants every comment on
/// it, where a page asks about a repository and wants the rows. `gh`'s own
/// subcommand pages, filters and searches for us, which is a query language on a
/// page that has a search box.
/// One run, with its jobs and their steps.
#[tauri::command]
pub async fn get_workflow_run(cwd: String, id: u64) -> Result<WorkflowRunDetail, PrUnavailable> {
    get_workflow_run_inner(&cwd, id).await.map_err(unavailable)
}

async fn get_workflow_run_inner(cwd: &str, id: u64) -> Result<WorkflowRunDetail, String> {
    let out = gh(cwd, &["run", "view", &id.to_string(), "--json", RUN_VIEW_FIELDS]).await?;
    let mut raw: RawRun = serde_json::from_str(&out)
        .map_err(|e| format!("could not read that run: {e}"))?;

    let jobs = raw.jobs.take().unwrap_or_default();

    Ok(WorkflowRunDetail {
        run: raw.map(),
        jobs: jobs.into_iter().map(RawJob::map).collect(),
    })
}

/// Asks GitHub to run it again.
///
/// **The one write this page has, and it is the reader's own press.** CI is the
/// place a retry is the whole answer — a flake, a runner that died, a transient
/// dependency — and the alternative is a trip to a browser for one button.
///
/// `failed_only` re-runs the jobs that failed rather than the whole workflow,
/// which is what a reader who watched one job go red is asking for: the rest of
/// the run already told them what it had to say, and re-running it spends their
/// minutes and the repository's.
///
/// Answers nothing but `Ok`: `gh` prints its own progress, and the page re-reads
/// the run afterwards, which is where the new state is read.
#[tauri::command]
pub async fn rerun_workflow(cwd: String, id: u64, failed_only: bool) -> Result<(), PrUnavailable> {
    let id = id.to_string();
    let mut args = vec!["run", "rerun", id.as_str()];
    if failed_only {
        args.push("--failed");
    }

    gh(&cwd, &args).await.map(|_| ()).map_err(unavailable)
}

#[tauri::command]
pub async fn list_pull_requests(
    cwd: String,
    state: PrListState,
    search: Option<String>,
) -> Result<PrListPage, PrUnavailable> {
    let listing = list_pull_requests_inner(&cwd, state, search)
        .await
        .map_err(unavailable)?;

    Ok(listing)
}

async fn list_pull_requests_inner(
    cwd: &str,
    state: PrListState,
    search: Option<String>,
) -> Result<PrListPage, String> {
    let mut args = vec![
        "pr",
        "list",
        "--state",
        state.flag(),
        "--limit",
        "50",
        "--json",
        LIST_FIELDS,
    ];

    let query = search.unwrap_or_default();
    let query = query.trim();
    if !query.is_empty() {
        args.extend(["--search", query]);
    }

    let out = gh(cwd, &args).await?;
    let raw: Vec<RawListItem> =
        serde_json::from_str(&out).map_err(|e| format!("could not read that listing: {e}"))?;

    Ok(PrListPage {
        items: raw.into_iter().map(RawListItem::map).collect(),
        viewer: viewer_login(cwd).await,
    })
}

/// Deletes a merged or closed PR's head branch from the remote, and nothing
/// else.
///
/// The local branch and the worktree holding it belong to the settle flow,
/// which already deletes both; the remote ref is the one thing nothing owned.
/// Keeping the halves apart also sidesteps `git branch -D` refusing a branch
/// some worktree still has checked out — the same refusal that keeps
/// [`merge_pr`] from passing `--delete-branch`.
///
/// **Takes the PR, not a branch name, and that is the guard.** A fork's PR
/// reports its head as a bare `feature`, indistinguishable from a branch of
/// ours, so a name from the UI joined to this repo's slug can address a
/// different branch that merely shares it — deleting our `feature` while the
/// fork's survives. The name is therefore read back from the PR here, behind a
/// refusal for anything cross-repository, rather than composed anywhere the
/// two could come apart. Same seam the permission rules keep: the durable,
/// irreversible act is resolved in Rust and the UI only names which PR.
///
/// Unknown counts as a fork. A shape we failed to parse must not reach a
/// delete, so both fields fail closed.
///
/// The REST endpoint rather than `git push --delete`: this takes no working
/// tree, so it deletes the branch of a session whose checkout has already gone.
/// A ref that is already deleted answers 422 rather than success, so the button
/// is gated on `head_ref_exists` instead of this call being safe to repeat.
#[tauri::command]
pub async fn delete_branch(cwd: String, number: u64) -> Result<(), String> {
    let (owner, repo) = repo_slug(&cwd).await?;

    let out = gh(
        &cwd,
        &["pr", "view", &number.to_string(), "--json", "headRefName,isCrossRepository"],
    )
    .await?;

    let branch = head_ref_to_delete(&out)?;

    // `refs/heads/<branch>` is a path here, so a branch name carrying slashes
    // needs no escaping — `fix/thing` addresses the ref it names.
    let path = format!("repos/{owner}/{repo}/git/refs/heads/{branch}");

    gh(&cwd, &["api", "-X", "DELETE", &path]).await.map(|_| ())
}

/// The branch `delete_branch` may delete, or why it may not.
///
/// Split out from the call so the refusal is testable without a network: it is
/// the half that decides whether an irreversible thing happens.
fn head_ref_to_delete(json: &str) -> Result<String, String> {
    let value: serde_json::Value =
        serde_json::from_str(json).map_err(|e| format!("could not read that pull request: {e}"))?;

    if value.get("isCrossRepository").and_then(serde_json::Value::as_bool) != Some(false) {
        return Err("that branch lives in a fork, so it is not this repository's to delete".into());
    }

    value
        .get("headRefName")
        .and_then(serde_json::Value::as_str)
        .filter(|branch| !branch.is_empty())
        .map(str::to_owned)
        .ok_or_else(|| "that pull request reports no head branch".to_string())
}

/// Reopens a PR closed elsewhere. There is no `close_pr` beside it on purpose:
/// this panel exists to get work landed, and abandoning a PR is a decision with
/// a discussion attached to it, which happens on GitHub.
#[tauri::command]
pub async fn reopen_pr(cwd: String, number: u64) -> Result<(), String> {
    gh(&cwd, &["pr", "reopen", &number.to_string()]).await.map(|_| ())
}

/// Takes a draft out of draft. The other direction (`--undo`) isn't offered:
/// the panel's job is getting work landed, and a PR reopened as a draft is a
/// state the reader can set on GitHub in the rare case they want it.
#[tauri::command]
pub async fn mark_pr_ready(cwd: String, number: u64) -> Result<(), String> {
    gh(&cwd, &["pr", "ready", &number.to_string()]).await.map(|_| ())
}

// ── saying something ─────────────────────────────────────────────────────────
//
// Everything below puts words on GitHub rather than reading them, which is the
// line this panel used to draw and no longer does: the reader is already in the
// conversation with the reviewer, and making them open a browser to answer a
// thread they are looking at is a trip for nothing. What each one writes is
// still the *reader's* text, passed through untouched — nothing here composes a
// sentence the reader did not type.

/// Posts a comment on the PR's own conversation.
///
/// The body travels on stdin rather than in argv: it is prose of any length, may
/// hold anything, and argv is a place a long argument and a shell metacharacter
/// both end badly. `gh` reads `--body-file -` for exactly this.
#[tauri::command]
pub async fn comment_on_pr(cwd: String, number: u64, body: String) -> Result<(), String> {
    gh_with_stdin(
        &cwd,
        &["pr", "comment", &number.to_string(), "--body-file", "-"],
        Some(&body),
    )
    .await
    .map(|_| ())
}

/// Answers one inline review thread.
///
/// A GraphQL mutation rather than a `gh` subcommand: `gh pr comment` speaks for
/// the whole pull request and cannot address a thread, and the REST endpoint for
/// a thread reply wants a review id the panel does not have. The thread's node id
/// is the one thing that names it.
///
/// The whole request body goes in on stdin — document and variables together —
/// because that is what `gh api graphql --input -` takes: one JSON value, so a
/// query with braces in it never meets a shell or an argument parser.
#[tauri::command]
pub async fn reply_to_thread(cwd: String, thread_id: String, body: String) -> Result<(), String> {
    graphql(
        &cwd,
        "mutation($id:ID!,$body:String!){addPullRequestReviewThreadReply(input:{pullRequestReviewThreadId:$id,body:$body}){comment{id}}}",
        json!({ "id": thread_id, "body": body }),
    )
    .await
}

/// Settles a thread, or opens it again.
///
/// One function for the pair because GitHub's two mutations differ only in their
/// name, and the panel's button is one toggle: a row that is resolved offers
/// "Unresolve" and a row that is not offers "Resolve".
#[tauri::command]
pub async fn set_thread_resolved(
    cwd: String,
    thread_id: String,
    resolved: bool,
) -> Result<(), String> {
    let mutation = if resolved {
        "resolveReviewThread"
    } else {
        "unresolveReviewThread"
    };
    let query = format!(
        "mutation($id:ID!){{{mutation}(input:{{threadId:$id}}){{thread{{id isResolved}}}}}}"
    );

    graphql(&cwd, &query, json!({ "id": thread_id })).await
}

/// One GraphQL request, document and variables in one body on stdin.
async fn graphql(cwd: &str, query: &str, variables: serde_json::Value) -> Result<(), String> {
    gh_with_stdin(cwd, &["api", "graphql", "--input", "-"], Some(&graphql_body(query, variables)))
        .await
        .map(|_| ())
}

/// The one JSON value `gh api graphql --input -` takes: the document and its
/// variables together.
///
/// Split out because this is the half that fails *silently* when it drifts: a
/// body with the query at the wrong key is a request GitHub answers with a
/// schema error about a variable that was never defined, which reads as our
/// query being wrong rather than as our envelope being wrong.
fn graphql_body(query: &str, variables: serde_json::Value) -> String {
    json!({ "query": query, "variables": variables }).to_string()
}

/// What the reviewer decided.
///
/// GitHub's own three, and they are not interchangeable: approving a PR and
/// leaving a comment on it are different acts in the repo's history, and a
/// "request changes" blocks the merge where a comment does not.
#[derive(Debug, Clone, Copy, Deserialize, Serialize, TS)]
#[ts(export, export_to = "events.ts")]
#[serde(rename_all = "snake_case")]
pub enum ReviewVerdict {
    Approve,
    RequestChanges,
    Comment,
}

impl ReviewVerdict {
    fn flag(self) -> &'static str {
        match self {
            Self::Approve => "--approve",
            Self::RequestChanges => "--request-changes",
            Self::Comment => "--comment",
        }
    }
}

/// Submits a review on the PR, with whatever the reader wrote with it.
///
/// `gh pr review` rather than the GraphQL `addPullRequestReview`: it resolves the
/// head commit itself, and one spawn is the whole operation. A bodyless
/// *comment* is refused by `gh` — that is GitHub's rule, not this panel's, and
/// the error it returns says so in its own words.
#[tauri::command]
pub async fn submit_review(
    cwd: String,
    number: u64,
    verdict: ReviewVerdict,
    body: String,
) -> Result<(), String> {
    let arg = number.to_string();
    let mut args = vec!["pr", "review", &arg, verdict.flag()];

    // Only when there is something to say: `--body-file -` with an empty stdin
    // is an empty review body, which for an approval is a body GitHub records as
    // blank rather than as none.
    if !body.trim().is_empty() {
        args.extend(["--body-file", "-"]);
        return gh_with_stdin(&cwd, &args, Some(&body)).await.map(|_| ());
    }

    gh(&cwd, &args).await.map(|_| ())
}

/// Asks people to review it. Logins, as GitHub spells them.
///
/// `gh pr edit --add-reviewer` takes the list comma-joined, and it is the same
/// call whether the reader names one person or three — a second command for the
/// singular would be a second place for the join to go wrong.
#[tauri::command]
pub async fn request_reviewers(cwd: String, number: u64, logins: Vec<String>) -> Result<(), String> {
    let people = clean_logins(logins);
    if people.is_empty() {
        return Err("Name at least one reviewer.".into());
    }

    gh(
        &cwd,
        &[
            "pr",
            "edit",
            &number.to_string(),
            "--add-reviewer",
            &people.join(","),
        ],
    )
    .await
    .map(|_| ())
}

/// Logins as GitHub spells them: trimmed, without the `@` a reader pastes from
/// a profile, and with the empties a trailing comma leaves behind dropped.
///
/// `gh` takes the list comma-joined and refuses the whole call on one bad name,
/// so a stray space would fail the request rather than be ignored.
fn clean_logins(logins: Vec<String>) -> Vec<String> {
    logins
        .into_iter()
        .map(|login| login.trim().trim_start_matches('@').to_string())
        .filter(|login| !login.is_empty())
        .collect()
}

/// Closes the PR, keeping it open as reopenable rather than deleting a branch.
///
/// **This panel used to refuse to close one**, on the grounds that abandoning a
/// pull request is a decision with a discussion attached to it. What changed is
/// where the discussion is: the reader can now answer it in the panel, so the
/// one thing left that they had to open a browser for was saying no. The branch
/// is deliberately untouched — [`delete_branch`] is its own button, and a close
/// is not a cleanup.
#[tauri::command]
pub async fn close_pr(cwd: String, number: u64) -> Result<(), String> {
    gh(&cwd, &["pr", "close", &number.to_string()]).await.map(|_| ())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A real capture: `gh api graphql` against a PR carrying a Vercel status
    /// context, two app-owned check runs, two bot comments, a review with a
    /// body, two bodyless review envelopes, and four inline threads — one of
    /// them resolved, two hanging on a line GitHub has since forgotten. Every
    /// avatar in it is one no `<login>.png` guess could have produced.
    ///
    /// **Its keys are the query's aliases**, which is the trap it exists to
    /// catch: the checks hang off `tip`, the alias `commits(last:1)` is asked
    /// under, and a reader looking for a `commits` key finds nothing at all.
    /// The capture predates `body`, `labels`, `files` and `history`, so those
    /// arrive as defaults here — which is also what keeps the deserializer's
    /// tolerance of an older answer pinned.
    const FIXTURE: &str = include_str!("fixtures/pr_graphql.json");

    fn parse() -> PullRequest {
        read_prs(FIXTURE).expect("fixture parses").pop().expect("one PR")
    }

    /// The four things the pane shows *about* a change rather than about its
    /// state: what the author wrote, what it is filed under, which files moved,
    /// and the commits that did it.
    ///
    /// Two shapes here are the ones that go wrong quietly. A commit's **name and
    /// account are separate**, and a commit pushed with an address no account
    /// owns carries a name and no user at all — reading `author.user.login`
    /// without the fallback would blank the row. And `files` is a connection
    /// whose rows are nothing but a path and two counts, so a row that arrives
    /// without its path cannot be drawn and must not become an empty line.
    #[test]
    fn a_pull_request_carries_its_body_labels_files_and_commits() {
        // The body is prose and not a heading, deliberately: a JSON string
        // opening with `"##` closes a raw literal, and this one is easier to
        // keep honest than to re-delimit.
        let raw: Vec<RawPr> = serde_json::from_str(
            r#"[{
              "number": 7, "title": "Add the page", "url": "https://x/7",
              "state": "OPEN", "isDraft": false,
              "author": { "login": "alice", "avatarUrl": "https://a/alice.png" },
              "headRefName": "feature", "baseRefName": "main",
              "mergeable": "MERGEABLE", "mergeStateStatus": "BLOCKED",
              "body": "Because the old one was wrong.",
              "labels": { "nodes": [
                { "name": "bug", "color": "d73a4a" },
                { "name": "", "color": "ffffff" }
              ]},
              "files": { "nodes": [
                { "path": "src/a.ts", "additions": 12, "deletions": 3, "changeType": "MODIFIED" },
                { "path": "", "additions": 1, "deletions": 0, "changeType": "ADDED" }
              ]},
              "history": { "nodes": [
                { "commit": { "oid": "abc123", "abbreviatedOid": "abc123",
                  "messageHeadline": "Add the page", "committedDate": "2026-09-18T00:00:00Z",
                  "author": { "name": "Alice", "user": { "login": "alice", "avatarUrl": "https://a/alice.png" } } } },
                { "commit": { "oid": "def456", "abbreviatedOid": "def456",
                  "messageHeadline": "Fix the test", "committedDate": "2026-09-19T00:00:00Z",
                  "author": { "name": "Bob" } } }
              ]}
            }]"#,
        )
        .expect("a documented pull request parses");

        let pr = raw.into_iter().next().expect("one pull request").map();

        assert!(pr.body.contains("old one was wrong"));
        // The nameless label is dropped rather than drawn as a dot with nothing
        // beside it.
        assert_eq!(pr.labels.len(), 1);
        assert_eq!(pr.labels[0].name, "bug");
        assert_eq!(pr.labels[0].color.as_deref(), Some("d73a4a"));

        assert_eq!(pr.files.len(), 1);
        assert_eq!(pr.files[0].path, "src/a.ts");
        assert_eq!(pr.files[0].change_type, "MODIFIED");

        assert_eq!(pr.commits.len(), 2);
        assert_eq!(pr.commits[0].short_oid, "abc123");
        assert_eq!(pr.commits[0].login.as_deref(), Some("alice"));
        assert_eq!(pr.commits[0].avatar.as_deref(), Some("https://a/alice.png"));
        // The unattributed one keeps its name and reports no account, rather
        // than borrowing the name as a login.
        assert_eq!(pr.commits[1].author, "Bob");
        assert_eq!(pr.commits[1].login, None);
        assert_eq!(pr.commits[1].avatar, None);
    }

    /// **Signed in and refused is its own answer**, and the reason it has to be
    /// is the text: GitHub answers one permission failure with one error per
    /// field path, so what reaches this classifier is a list of
    /// `repository.pullRequests.nodes.N.…` strings with the actual reason
    /// nowhere in it. Printed as written it is a screenful of noise that says
    /// nothing; told apart, it is a sentence naming the cure.
    #[test]
    fn a_refused_token_is_not_the_same_as_no_token() {
        let refused = PrUnavailable::classify(
            "GraphQL: Resource not accessible by personal access token \
             (repository.pullRequests.nodes.0.statusCheckRollup.nodes.0.commit.statusCheckRollup.contexts.nodes.0), \
             Resource not accessible by personal access token (repository.pullRequests.nodes.1.…)"
                .to_string(),
        );
        assert!(matches!(refused, PrUnavailable::MissingPermission));

        // An app installation rather than a token — same refusal, same cure.
        assert!(matches!(
            PrUnavailable::classify("Resource not accessible by integration".to_string()),
            PrUnavailable::MissingPermission
        ));

        // The neighbour it must not be mistaken for: a credential that is not
        // there at all is a different screen with a different command on it.
        assert!(matches!(
            PrUnavailable::classify(
                "To get started with GitHub CLI, please run: gh auth login".to_string()
            ),
            PrUnavailable::NotAuthenticated
        ));
        assert!(matches!(
            PrUnavailable::classify("HTTP 401: Bad credentials".to_string()),
            PrUnavailable::Other(_)
        ));
    }

    /// The three shapes `gh auth status --json hosts` answers with, and two of
    /// them are not the happy one.
    #[test]
    fn the_signed_in_account_is_read_off_whichever_entry_is_active() {
        // Signed in through `gh auth login`.
        let account = read_gh_account(
            r#"{"hosts":{"github.com":[
              {"state":"success","active":true,"host":"github.com","login":"Hamertingo",
               "tokenSource":"keyring","scopes":"gist, read:org, repo, workflow","gitProtocol":"https"}
            ]}}"#,
        );
        assert_eq!(account.login.as_deref(), Some("Hamertingo"));
        assert_eq!(account.host.as_deref(), Some("github.com"));
        assert_eq!(account.token_source.as_deref(), Some("keyring"));
        assert_eq!(account.scopes, vec!["gist", "read:org", "repo", "workflow"]);
        assert_eq!(account.error, None);

        // **Two entries for one host, and only one of them is in use.** A token
        // handed in from the environment sits beside a keyring login, and
        // reading the first would name whichever happened to be written first.
        let account = read_gh_account(
            r#"{"hosts":{"github.com":[
              {"state":"error","error":"Bad credentials","active":true,"host":"github.com",
               "login":"","tokenSource":"GH_TOKEN","gitProtocol":"https"},
              {"state":"success","active":false,"host":"github.com","login":"Hamertingo",
               "tokenSource":"keyring","scopes":"repo","gitProtocol":"https"}
            ]}}"#,
        );
        assert_eq!(account.login, None);
        assert_eq!(account.token_source.as_deref(), Some("GH_TOKEN"));
        assert_eq!(account.error.as_deref(), Some("Bad credentials"));
        assert!(account.scopes.is_empty());

        // **The shape a shell exporting `GITHUB_TOKEN` produces**, which is the
        // quietest way to be signed in as the wrong account: two entries, the
        // environment one active and *successful*, and no `scopes` key on it at
        // all — a fine-grained token reports none. Reading only the login would
        // say "signed in as Hamertingo" and stop, which is true of both.
        let account = read_gh_account(
            r#"{"hosts":{"github.com":[
              {"state":"success","active":true,"host":"github.com","login":"Hamertingo",
               "tokenSource":"GITHUB_TOKEN","gitProtocol":"https"},
              {"state":"success","active":false,"host":"github.com","login":"Hamertingo",
               "tokenSource":"keyring","scopes":"gist, read:org, repo, workflow","gitProtocol":"https"}
            ]}}"#,
        );
        assert_eq!(account.login.as_deref(), Some("Hamertingo"));
        assert_eq!(account.token_source.as_deref(), Some("GITHUB_TOKEN"));
        assert!(account.scopes.is_empty(), "a fine-grained token reports no scopes");
        assert_eq!(account.error, None);

        // Logged out: no host at all, which is not an error.
        let account = read_gh_account(r#"{"hosts":{}}"#);
        assert_eq!(account.login, None);
        assert_eq!(account.error, None);
        assert_eq!(account.host, None);

        // A `gh` that answered something else entirely says so, rather than
        // reading as a machine that is merely signed out.
        assert!(read_gh_account("not json").error.is_some());
    }

    #[test]
    fn reads_both_check_shapes() {
        let pr = parse();
        assert_eq!(pr.checks.len(), 3);
        // `StatusContext` carries its name on `context`, `CheckRun` on `name`.
        assert!(pr.checks.iter().any(|c| c.name == "Vercel"));
        assert!(pr.checks.iter().any(|c| c.name == "Vercel Preview Comments"));
        assert!(pr.checks.iter().all(|c| c.state == CheckState::Success));
    }

    /// Both shapes hide the image in a different place — `avatarUrl` on a
    /// status context, `checkSuite.app.logoUrl` on a run — and a check with
    /// neither is what the panel falls back to a glyph for.
    /// The envelope `gh api graphql --input -` takes, pinned because getting it
    /// wrong is a *silent* failure: a body with the document under the wrong key
    /// is answered with a schema error about a variable nobody defined, which
    /// reads as our query being wrong.
    #[test]
    fn the_graphql_body_carries_the_document_and_its_variables() {
        let body = graphql_body("mutation($id:ID!){resolveReviewThread(input:{threadId:$id}){thread{id}}}", json!({ "id": "THREAD_1" }));
        let parsed: serde_json::Value = serde_json::from_str(&body).expect("valid json");

        assert!(parsed["query"].as_str().unwrap().contains("resolveReviewThread"));
        assert_eq!(parsed["variables"]["id"], "THREAD_1");
    }

    /// A login arrives as a reader typed or pasted it. `gh` refuses the whole
    /// call over one bad name, so the cleaning is what decides whether asking
    /// three people works.
    #[test]
    fn logins_are_trimmed_of_the_at_sign_and_the_empties() {
        let cleaned = clean_logins(vec![
            " alice".into(),
            "@bob".into(),
            String::new(),
            "  ".into(),
            "carol,".into(),
        ]);

        assert_eq!(cleaned, vec!["alice", "bob", "carol,"]);
    }

    /// The three verdicts are GitHub's own flags, and a wrong one is a review
    /// that never landed — the button would look like it worked.
    #[test]
    fn each_verdict_is_its_own_flag() {
        assert_eq!(ReviewVerdict::Approve.flag(), "--approve");
        assert_eq!(ReviewVerdict::RequestChanges.flag(), "--request-changes");
        assert_eq!(ReviewVerdict::Comment.flag(), "--comment");
    }

    /// The page's row, from a hand-written listing.
    ///
    /// Hand-written because no capture of `gh pr list --json` exists: what is
    /// pinned here is what `gh` documents, and the three places a row can go
    /// wrong silently — the check fold, an empty `reviewDecision` that means
    /// "no review required" rather than a decision named "", and a team request
    /// that carries a `slug` where a person carries a `login`.
    #[test]
    fn a_listing_row_folds_its_checks_and_its_review_requests() {
        let raw: Vec<RawListItem> = serde_json::from_str(
            r#"[
              {
                "number": 7, "title": "Add the page", "url": "https://x/7",
                "state": "OPEN", "isDraft": false,
                "author": { "login": "alice", "avatarUrl": "https://a/alice.png" },
                "headRefName": "feature", "baseRefName": "main",
                "updatedAt": "2026-09-19T00:00:00Z",
                "additions": 12, "deletions": 3, "changedFiles": 4,
                "reviewDecision": "", "mergeable": "MERGEABLE", "mergeStateStatus": "BLOCKED",
                "statusCheckRollup": [
                  { "__typename": "CheckRun", "name": "build", "status": "COMPLETED", "conclusion": "SUCCESS", "detailsUrl": null,
                    "checkSuite": { "workflowRun": null, "app": null } },
                  { "__typename": "StatusContext", "context": "ci", "state": "PENDING", "targetUrl": null, "avatarUrl": null }
                ],
                "reviewRequests": [ { "login": "bob" }, { "slug": "platform" } ],
                "labels": [ { "name": "bug", "color": "d73a4a" }, { "name": "", "color": "ffffff" } ]
              }
            ]"#,
        )
        .expect("a documented listing parses");

        let item = raw.into_iter().next().expect("one row").map();

        assert_eq!(item.number, 7);
        assert_eq!(item.author, "alice");
        assert_eq!(item.review_requests, vec!["bob", "platform"]);
        // An empty string is `gh` saying the repo requires no review, not a
        // decision whose name is empty.
        assert_eq!(item.review_decision, None);
        // One pending check and one that passed: the row says running.
        assert_eq!(item.checks_state, PrChecksState::Running);
        // The nameless one is dropped rather than drawn as a dot with nothing to
        // read: a label the reader cannot tell from its neighbour is chrome.
        assert_eq!(item.labels.len(), 1);
        assert_eq!(item.labels[0].name, "bug");
        assert_eq!(item.labels[0].color.as_deref(), Some("d73a4a"));
    }

    /// A failure outranks a run still going — the red row is the one to open.
    #[test]
    fn a_failure_outranks_a_pending_check() {
        let check = |state: CheckState| PrCheck {
            name: "c".into(),
            state,
            url: None,
            workflow: None,
            avatar: None,
        };

        assert_eq!(
            fold_checks(&[check(CheckState::Pending), check(CheckState::Failure)]),
            PrChecksState::Failing
        );
        assert_eq!(fold_checks(&[check(CheckState::Pending)]), PrChecksState::Running);
        assert_eq!(fold_checks(&[check(CheckState::Success)]), PrChecksState::Clear);
        // Nothing asked for is not a failure.
        assert_eq!(fold_checks(&[]), PrChecksState::Clear);
    }

    #[test]
    fn every_check_carries_its_reporter_image() {
        let pr = parse();
        assert!(
            pr.checks.iter().all(|c| c.avatar.is_some()),
            "missing avatars: {:?}",
            pr.checks
        );
    }

    #[test]
    fn comment_and_review_authors_carry_images() {
        let pr = parse();
        assert!(pr.comments.iter().all(|c| c.avatar.is_some()));
    }

    #[test]
    fn merges_comments_and_reviews_oldest_first() {
        let pr = parse();
        // Two conversation comments and three reviews. The four inline threads
        // are on none of those rows — they hang off the review that left them.
        assert_eq!(pr.comments.len(), 5);
        assert_eq!(pr.comments[0].author, "vercel");
        assert_eq!(pr.comments[0].kind, CommentKind::Comment);
        assert!(pr.comments.iter().any(|c| c.kind == CommentKind::Reviewed));
        assert!(pr.comments.windows(2).all(|w| w[0].created_at <= w[1].created_at));
        // Nothing on the timeline itself is a file comment.
        assert!(pr.comments.iter().all(|c| c.path.is_none()));
    }

    /// Every inline thread sits under its own review, joined by the id its
    /// first comment carries. Standing on the timeline they read as ordinary
    /// comments and say nothing about which pass over the code produced them.
    #[test]
    fn inline_threads_hang_off_the_review_that_left_them() {
        let pr = parse();
        let threads: Vec<_> = pr.comments.iter().flat_map(|c| &c.replies).collect();

        assert_eq!(threads.len(), 4);
        assert!(threads.iter().all(|t| t.path.is_some()));
        assert_eq!(threads.iter().filter(|t| t.resolved).count(), 1);
        // Devin left two file comments in one pass, so both are on one row.
        let devin = pr
            .comments
            .iter()
            .find(|c| c.author == "devin-ai-integration")
            .expect("devin's review");
        assert_eq!(devin.replies.len(), 2);
        // A line GitHub still knows is appended; one it has forgotten leaves
        // the path standing alone.
        assert!(threads
            .iter()
            .any(|t| t.path.as_deref() == Some("apps/desktop/src/hooks/useRepo.ts:80")));
        assert!(threads.iter().any(|t| {
            t.path.as_deref() == Some("apps/desktop/src/components/changes/ChangesView.tsx")
        }));
    }

    /// A review that is nothing but file comments has an empty body, and it is
    /// the only row that names who left them.
    #[test]
    fn a_bodyless_review_holding_threads_is_kept() {
        let pr = parse();
        let envelopes: Vec<_> = pr
            .comments
            .iter()
            .filter(|c| c.body.trim().is_empty() && !c.replies.is_empty())
            .collect();

        assert_eq!(envelopes.len(), 2);
        assert!(envelopes.iter().all(|e| e.author == "greptile-apps"));
    }

    /// A thread's later comments are replies inside it, not rows of their own.
    /// No capture holds one yet, so this pins the shape.
    #[test]
    fn a_threads_later_comments_are_replies() {
        let out = r#"{"data":{"repository":{"open":{"nodes":[{"number":7,
            "reviews":{"nodes":[{"id":"R1","author":{"login":"bot"},"body":"",
              "state":"COMMENTED","submittedAt":"2026-01-01T00:00:00Z"}]},
            "reviewThreads":{"nodes":[
            {"isResolved":false,"path":"src/main.rs","line":12,"comments":{"nodes":[
              {"author":{"login":"bot"},"body":"this leaks","createdAt":"2026-01-01T00:00:00Z",
               "pullRequestReview":{"id":"R1"}},
              {"author":{"login":"me"},"body":"fixed","createdAt":"2026-01-01T00:05:00Z",
               "pullRequestReview":{"id":"R1"}}]}}]}}]}}}}"#;
        let prs = read_prs(out).expect("thread parses");

        assert_eq!(prs[0].comments.len(), 1);
        let thread = &prs[0].comments[0].replies[0];
        assert_eq!(thread.author, "bot");
        assert_eq!(thread.path.as_deref(), Some("src/main.rs:12"));
        assert_eq!(thread.replies.len(), 1);
        assert_eq!(thread.replies[0].author, "me");
        // The row sorts by what opened the thread, not by its last reply.
        assert_eq!(thread.created_at, "2026-01-01T00:00:00Z");
    }

    /// A thread whose review is out of reach still belongs on the timeline —
    /// it reads as its own note, which is what it is with nothing to hang off.
    #[test]
    fn a_thread_with_no_review_of_its_own_stands_alone() {
        let out = r#"{"data":{"repository":{"open":{"nodes":[{"number":7,"reviewThreads":{"nodes":[
            {"path":"src/main.rs","line":3,"comments":{"nodes":[
              {"author":{"login":"bot"},"body":"look here","createdAt":"2026-01-01T00:00:00Z"}]}}]}}]}}}}"#;
        let prs = read_prs(out).expect("orphan thread parses");

        assert_eq!(prs[0].comments.len(), 1);
        assert_eq!(prs[0].comments[0].path.as_deref(), Some("src/main.rs:3"));
    }

    /// Every comment on a thread can be deleted, and what is left is a file
    /// path rather than anything to draw.
    #[test]
    fn an_empty_thread_draws_no_row() {
        let out = r#"{"data":{"repository":{"open":{"nodes":[{"number":7,"reviewThreads":{"nodes":[
            {"path":"src/main.rs","comments":{"nodes":[]}}]}}]}}}}"#;
        assert!(read_prs(out).expect("empty thread parses")[0].comments.is_empty());
    }

    /// GraphQL sends `null` where the repo requires no review, and an empty
    /// badge is worse than none.
    #[test]
    fn an_absent_review_decision_is_none() {
        assert!(parse().review_decision.is_none());
    }

    /// GraphQL reports a failed query with a 200 and an `errors` array, so a
    /// zero exit proves nothing — read as success this returns no PRs and the
    /// panel says the branch has none.
    #[test]
    fn a_graphql_error_is_an_error() {
        let out = r#"{"data":null,"errors":[{"message":"Could not resolve to a Repository."}]}"#;
        assert_eq!(
            read_prs(out).unwrap_err(),
            "Could not resolve to a Repository."
        );
    }

    /// Null connections are the shape a PR with no checks, no comments and no
    /// threads arrives in, and they must not fail the response.
    #[test]
    fn null_connections_read_as_empty() {
        let out = r#"{"data":{"repository":{"open":{"nodes":[
            {"number":7,"comments":{"nodes":null},"reviews":null,"reviewThreads":{"nodes":null},
             "tip":{"nodes":[]}}]}}}}"#;
        let prs = read_prs(out).expect("nulls parse");
        assert!(prs[0].checks.is_empty() && prs[0].comments.is_empty());
    }

    /// An unmodelled rollup entry costs its own row and nothing else.
    #[test]
    fn an_unknown_check_shape_is_dropped() {
        let out = r#"{"data":{"repository":{"open":{"nodes":[{"number":7,
            "tip":{"nodes":[{"commit":{"statusCheckRollup":{"contexts":{"nodes":[
              {"__typename":"SomethingNew","name":"x"},
              {"__typename":"StatusContext","context":"CI","state":"PENDING"}]}}}}]}}]}}}}"#;
        let prs = read_prs(out).expect("unknown shape parses");
        assert_eq!(prs[0].checks.len(), 1);
        assert_eq!(prs[0].checks[0].state, CheckState::Pending);
    }

    /// A running check has a null conclusion, and reading that as terminal
    /// would draw it as finished.
    #[test]
    fn a_running_check_is_pending() {
        let out = r#"{"data":{"repository":{"open":{"nodes":[{"number":7,
            "tip":{"nodes":[{"commit":{"statusCheckRollup":{"contexts":{"nodes":[
              {"__typename":"CheckRun","name":"build","status":"IN_PROGRESS",
               "conclusion":null}]}}}}]}}]}}}}"#;
        let prs = read_prs(out).expect("running check parses");
        assert_eq!(prs[0].checks[0].state, CheckState::Pending);
    }

    /// The envelope GitHub wraps inline file comments in carries no body.
    #[test]
    fn a_bodyless_review_is_dropped_unless_it_approves() {
        let out = r#"{"data":{"repository":{"open":{"nodes":[{"number":7,"reviews":{"nodes":[
            {"author":{"login":"a"},"body":"","state":"COMMENTED"},
            {"author":{"login":"b"},"body":"","state":"APPROVED"}]}}]}}}}"#;
        let prs = read_prs(out).expect("reviews parse");
        assert_eq!(prs[0].comments.len(), 1);
        assert_eq!(prs[0].comments[0].kind, CommentKind::Approved);
    }

    /// An open PR outranks a newer settled one: reopening an old branch must
    /// not show the reader the PR they already landed.
    #[test]
    fn open_prs_sort_ahead_of_settled_ones() {
        let out = r#"{"data":{"repository":{"open":{"nodes":[
            {"number":9,"state":"MERGED"},{"number":3,"state":"OPEN"},
            {"number":7,"state":"CLOSED"},{"number":5,"state":"OPEN"}]}}}}"#;
        let prs = read_prs(out).expect("list parses");
        assert_eq!(
            prs.iter().map(|p| p.number).collect::<Vec<_>>(),
            vec![5, 3, 9, 7]
        );
    }

    /// `gh`'s own sentences, captured live. A missing CLI is our message, not
    /// `gh`'s, since a binary that does not exist writes no stderr.
    #[test]
    fn gh_failures_classify_by_what_the_reader_has_to_do() {
        assert!(matches!(
            unavailable(format!("{NO_CLI} Install it to see pull requests here.")),
            PrUnavailable::NoCli
        ));
        assert!(matches!(
            unavailable(
                "To get started with GitHub CLI, please run:  gh auth login".to_string()
            ),
            PrUnavailable::NotAuthenticated
        ));
        assert!(matches!(
            unavailable(
                "failed to run git: fatal: not a git repository (or any of the parent \
                 directories): .git"
                    .to_string()
            ),
            PrUnavailable::NoRemote
        ));
    }

    /// A reworded message must still reach the reader rather than being
    /// swallowed as one of the known cases.
    #[test]
    fn an_unrecognised_failure_keeps_its_text() {
        match unavailable("GraphQL: API rate limit exceeded".to_string()) {
            PrUnavailable::Other(m) => assert!(m.contains("rate limit")),
            other => panic!("classified as {other:?}"),
        }
    }

    #[test]
    fn diff_counts_come_through() {
        let pr = parse();
        assert_eq!((pr.additions, pr.deletions, pr.changed_files), (2155, 66, 22));
    }

    /// `headRefName` outlives the branch — a merged PR goes on naming the one
    /// it came from — so only `headRef` going null says the ref is gone.
    /// Verified against the live API: deleting the branch flipped `headRef` to
    /// null and left `headRefName` exactly as it was.
    /// The connections are read together, and the open one is not a filter
    /// on the other: a merged PR and an open one on the same branch both
    /// come back, open first, whichever alias each arrived under.
    #[test]
    fn open_and_settled_connections_are_both_read() {
        let out = r#"{"data":{"repository":{
          "open":{"nodes":[{"number":9,"headRefName":"fix/thing","state":"OPEN"}]},
          "settled":{"nodes":[{"number":7,"headRefName":"fix/thing","state":"MERGED"}]}}}}"#;
        let numbers: Vec<u64> = read_prs(out).unwrap().iter().map(|pr| pr.number).collect();
        assert_eq!(numbers, vec![9, 7]);
    }

    #[test]
    fn head_ref_says_whether_the_branch_is_still_there() {
        let out = |head_ref: &str| {
            format!(
                r#"{{"data":{{"repository":{{"open":{{"nodes":[
                  {{"number":1,"headRefName":"fix/thing","headRef":{head_ref}}}]}}}}}}}}"#
            )
        };

        let live = read_prs(&out(r#"{"name":"fix/thing"}"#)).expect("parses");
        assert!(live[0].head_ref_exists);
        assert_eq!(live[0].head_ref_name, "fix/thing");
        // Absent from this payload, so it reads as a fork and draws no button.
        assert!(live[0].is_cross_repository);

        let deleted = read_prs(&out("null")).expect("parses");
        assert!(!deleted[0].head_ref_exists);
        // The name survives, which is what lets the row go on naming it.
        assert_eq!(deleted[0].head_ref_name, "fix/thing");
    }

    /// A fork's head is reported bare — `feature`, not `alice/hz:feature` —
    /// so joining it to this repo's slug addresses *our* `feature` and deletes
    /// the wrong branch while the fork's survives. Verified against the live
    /// API on a real cross-repo PR (`cli/cli#13807`): `headRefName` came back
    /// as a plain branch name with `headRepository` naming the fork, and
    /// `headRef` non-null, so nothing else here would have stopped it.
    #[test]
    fn a_fork_branch_is_not_ours_to_delete() {
        let out = r#"{"headRefName":"feature","isCrossRepository":true}"#;
        let err = head_ref_to_delete(out).expect_err("a fork branch is refused");
        assert!(err.contains("fork"), "{err}");
    }

    /// Both halves fail closed. An answer we could not parse, or one missing
    /// the flag, must not reach a delete — this is the one irreversible thing
    /// on the pane, and "we could not tell" is not permission.
    #[test]
    fn an_unreadable_answer_is_refused_rather_than_guessed() {
        for out in [
            r#"{"headRefName":"feature"}"#,
            r#"{"headRefName":"feature","isCrossRepository":null}"#,
            r#"{"isCrossRepository":false}"#,
            r#"{"headRefName":"","isCrossRepository":false}"#,
            "not json at all",
        ] {
            assert!(head_ref_to_delete(out).is_err(), "should refuse: {out}");
        }
    }

    /// The name comes back from the PR rather than from the caller, so what is
    /// deleted is what GitHub says the head is.
    #[test]
    fn a_same_repo_branch_resolves_to_its_own_name() {
        let out = r#"{"headRefName":"fix/slash","isCrossRepository":false}"#;
        assert_eq!(head_ref_to_delete(out).unwrap(), "fix/slash");
    }

    /// Absence has to read as *gone*, not as there. The button is the one
    /// destructive thing on this pane, and a shape we failed to get back would
    /// otherwise draw it over a branch that may not exist — a click answered
    /// with a 422. Under-offering costs a trip to GitHub; over-offering costs
    /// an error on work already landed.
    #[test]
    fn a_missing_head_ref_field_reads_as_gone() {
        let out = r#"{"data":{"repository":{"open":{"nodes":[
            {"number":1,"headRefName":"fix/thing"}]}}}}"#;
        let prs = read_prs(out).expect("parses");
        assert!(!prs[0].head_ref_exists);
    }

    /// The sidebar's query carries the branch and the draft flag, and a draft
    /// is an open PR — reading it as anything else leaves the row unmarked for
    /// exactly the PR that has just been opened.
    #[test]
    fn pr_marks_carry_their_branch_and_draft_flag() {
        let out = r#"{"data":{"repository":{
            "open":{"nodes":[
              {"number":9,"headRefName":"worktree-calm-navy-beacon","isDraft":true},
              {"number":8,"headRefName":"fix/thing","isDraft":false}]},
            "merged":{"nodes":[]}}}}"#;
        let prs = read_pr_marks(out).expect("pr marks parse");
        assert_eq!(prs.len(), 2);
        assert_eq!(prs[0].head_ref_name, "worktree-calm-navy-beacon");
        assert!(prs[0].is_draft);
        assert!(!prs[1].is_draft);
    }

    /// The merge fields ride the open half alone, so the merged half answers
    /// `None` for them. The frontend has to read that as *not knowing* rather
    /// than as nothing standing in the way — a merged mark reporting itself
    /// ready to merge would raise a card for work that already landed.
    #[test]
    fn pr_marks_carry_merge_state_on_the_open_half_only() {
        let out = r#"{"data":{"repository":{
            "open":{"nodes":[
              {"number":9,"headRefName":"fix/live","isDraft":false,
               "mergeable":"MERGEABLE","mergeStateStatus":"CLEAN"}]},
            "merged":{"nodes":[{"number":4,"headRefName":"fix/landed","isDraft":false}]}}}}"#;
        let prs = read_pr_marks(out).expect("pr marks parse");
        assert_eq!(prs[0].mergeable.as_deref(), Some("MERGEABLE"));
        assert_eq!(prs[0].merge_state_status.as_deref(), Some("CLEAN"));
        assert_eq!(prs[1].mergeable, None);
        assert_eq!(prs[1].merge_state_status, None);
    }

    /// State comes from which connection answered, not from a field — see
    /// [`PrMarkState`]. Both halves reach the caller in one list.
    #[test]
    fn pr_marks_state_comes_from_the_connection() {
        let out = r#"{"data":{"repository":{
            "open":{"nodes":[{"number":9,"headRefName":"fix/live","isDraft":false}]},
            "merged":{"nodes":[{"number":4,"headRefName":"fix/landed","isDraft":false}]}}}}"#;
        let prs = read_pr_marks(out).expect("pr marks parse");
        assert_eq!(prs.len(), 2);
        assert_eq!(prs[0].state, PrMarkState::Open);
        assert_eq!(prs[1].state, PrMarkState::Merged);
        assert_eq!(prs[1].head_ref_name, "fix/landed");
    }

    /// The row draws three things off five wire values, and each fold is one
    /// somebody could reasonably get backwards: a settled rollup read as
    /// running leaves the row spinning forever, and a running one read as
    /// failing paints it red before CI has said anything.
    #[test]
    fn the_rollup_folds_into_the_three_states_a_row_draws() {
        let mark = |rollup: &str| {
            let out = format!(
                r#"{{"data":{{"repository":{{"open":{{"nodes":[
                  {{"number":9,"headRefName":"b","isDraft":false,
                    "commits":{{"nodes":[{{"commit":{{"statusCheckRollup":{rollup}}}}}]}}}}]}},
                  "merged":{{"nodes":[]}}}}}}}}"#
            );
            read_pr_marks(&out).expect("pr marks parse").remove(0).checks_state
        };

        assert_eq!(mark(r#"{"state":"PENDING"}"#), PrChecksState::Running);
        // A required check that has not reported yet is a wait, not a verdict.
        assert_eq!(mark(r#"{"state":"EXPECTED"}"#), PrChecksState::Running);
        assert_eq!(mark(r#"{"state":"FAILURE"}"#), PrChecksState::Failing);
        // A check that could not run is one that has not passed.
        assert_eq!(mark(r#"{"state":"ERROR"}"#), PrChecksState::Failing);
        // Passing says nothing, and neither does no CI at all — most repos.
        assert_eq!(mark(r#"{"state":"SUCCESS"}"#), PrChecksState::Clear);
        assert_eq!(mark("null"), PrChecksState::Clear);
        // A word GitHub adds later must show nothing, not paint the row red.
        assert_eq!(mark(r#"{"state":"SOMETHING_NEW"}"#), PrChecksState::Clear);
    }

    /// The merged half is asked for no commits, so the field is absent rather
    /// than empty — and absent must not fail the line the open half rode in on.
    #[test]
    fn a_mark_with_no_commits_asked_for_still_parses() {
        let out = r#"{"data":{"repository":{
            "open":{"nodes":[]},
            "merged":{"nodes":[{"number":4,"headRefName":"b","isDraft":false}]}}}}"#;
        let prs = read_pr_marks(out).expect("pr marks parse");
        assert_eq!(prs[0].checks_state, PrChecksState::Clear);
    }

    /// Same 200-with-errors trap the branch query has: a zero exit code proves
    /// nothing, and reading it as success marks every row as PR-less.
    #[test]
    fn a_pr_mark_query_error_is_an_error() {
        let out = r#"{"data":null,"errors":[{"message":"Could not resolve to a Repository"}]}"#;
        assert!(read_pr_marks(out).is_err());
    }

    /// A repo with nothing on one side answers a null connection, not an empty
    /// one — on each half independently.
    #[test]
    fn no_pr_marks_reads_as_empty() {
        let out = r#"{"data":{"repository":{"open":{"nodes":null},"merged":{"nodes":null}}}}"#;
        assert!(read_pr_marks(out).expect("null connections parse").is_empty());
    }

    #[test]
    fn merge_methods_map_to_gh_flags() {
        assert_eq!(MergeMethod::Squash.flag(), "--squash");
        assert_eq!(MergeMethod::Rebase.flag(), "--rebase");
        assert_eq!(MergeMethod::Merge.flag(), "--merge");
    }

    /// A real capture: `gh run list --json` against this repository, ten runs of
    /// three workflows — a push-triggered release, a cache warmer, and the
    /// `dynamic` run GitHub starts for Pages on its own behalf.
    const RUNS: &str = include_str!("fixtures/gh_run_list.json");

    fn runs() -> Vec<WorkflowRun> {
        let raw: Vec<RawRun> = serde_json::from_str(RUNS).expect("fixture parses");
        raw.into_iter().map(RawRun::map).collect()
    }

    #[test]
    fn a_run_carries_what_its_row_draws() {
        let first = runs().into_iter().next().expect("a run");
        assert_eq!(first.number, 70);
        assert_eq!(first.event, "dynamic");
        assert_eq!(first.status, "completed");
        assert_eq!(first.conclusion.as_deref(), Some("success"));
        assert_eq!(first.attempt, 1);
        assert!(first.url.starts_with("https://github.com/"));
        assert!(first.id > 0, "the run's own id, not its number");
    }

    /// **The display name, not the file's.** The Pages workflow declares
    /// `pages-build-deployment` and draws `pages build and deployment`, and the
    /// row shows what the repository's own page shows.
    #[test]
    fn a_workflow_is_named_the_way_github_names_it() {
        assert!(runs().iter().any(|run| run.workflow.contains(' ')));
    }

    /// A real capture of a run that **failed**: `gh run view --json` against a
    /// release that went red, which is the shape worth pinning — two jobs, one
    /// of them with fourteen steps and a failure among them, and one skipped by
    /// its own `if:` with no steps at all.
    const RUN_VIEW: &str = include_str!("fixtures/gh_run_view.json");

    #[test]
    fn a_failed_run_carries_its_jobs_and_their_steps() {
        let mut raw: RawRun = serde_json::from_str(RUN_VIEW).expect("fixture parses");
        let jobs: Vec<WorkflowJob> = raw
            .jobs
            .take()
            .expect("a view carries jobs")
            .into_iter()
            .map(RawJob::map)
            .collect();
        let run = raw.map();

        assert_eq!(run.conclusion.as_deref(), Some("failure"));
        assert_eq!(jobs.len(), 2);

        let build = &jobs[0];
        assert_eq!(build.name, "build");
        assert_eq!(build.conclusion.as_deref(), Some("failure"));
        assert_eq!(build.steps.len(), 14);
        assert!(build.steps.iter().any(|step| step.conclusion.as_deref() == Some("failure")));
        // Numbered from one, and in the order the workflow declares them — the
        // run's own page numbers them the same way.
        assert_eq!(build.steps[0].number, 1);
        assert!(build.started_at.is_some());

        // **Empty is a fact, not a gap.** A skipped job has no steps, and that
        // — not its timestamps — is how you tell it from one that ran: this one
        // carries a start time, which the capture is what settled.
        let skipped = &jobs[1];
        assert_eq!(skipped.conclusion.as_deref(), Some("skipped"));
        assert!(skipped.steps.is_empty());
        assert!(skipped.started_at.is_some());
    }

    /// A run in flight has no verdict and no start time. **Hand-written because
    /// no capture holds one** — nothing was in flight when the fixture was
    /// taken, and the difference between "waiting for a machine" and "running on
    /// one" is exactly the `startedAt` that is absent here.
    #[test]
    fn a_run_that_has_not_finished_carries_no_conclusion() {
        let raw: RawRun = serde_json::from_str(
            r#"{"databaseId":1,"number":2,"name":"CI","displayTitle":"","headBranch":"main",
                "headSha":"abc","event":"push","status":"queued","conclusion":"",
                "startedAt":null,"createdAt":"2026-01-01T00:00:00Z",
                "updatedAt":"2026-01-01T00:00:00Z","url":"https://example.test/1"}"#,
        )
        .expect("a queued run parses");
        let run = raw.map();

        assert_eq!(run.status, "queued");
        // An empty string is GitHub's "not yet", and `Some("")` would be a
        // verdict of nothing.
        assert_eq!(run.conclusion, None);
        assert_eq!(run.started_at, None);
        // An absent `attempt` is the first one, never zero: no run has ever been
        // the zeroth attempt.
        assert_eq!(run.attempt, 1);
        // A run whose title `gh` would not give falls back to the workflow's own
        // name, since a nameless row is worse than a repeated one.
        assert_eq!(run.title, "CI");
    }
}
