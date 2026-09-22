import type { IssueUnavailable, PrUnavailable } from "@/types/events";

/// What a failed read says, in one line.
///
/// The cure is named where there is one — a key Linear has stopped accepting is
/// fixed by disconnecting in Settings and pasting a new one here, and saying so
/// is the difference between a sentence to act on and one to stare at. Anything
/// unrecognised falls back to the tracker's own words rather than a shrug of
/// our own.
///
/// Lives here rather than beside the issues page because the merged inbox reads
/// it too, and the inbox is read at launch — a lib import keeps the page's own
/// module off the startup graph.
export function unavailableText(unavailable: IssueUnavailable): string {
  switch (unavailable.kind) {
    case "unauthorized":
      return "Linear rejected the saved key. Disconnect it in Settings, then paste a new one.";
    case "offline":
      return "Could not reach Linear.";
    case "not_connected":
      return "No issue tracker connected.";
    default:
      return unavailable.detail;
  }
}

/// Why there is no listing, in the words of what to do about it.
///
/// **`no_remote` names the directory**, and that is the whole reason this is not
/// a constant: a project can be a *workspace* whose root is not a repository at
/// all, so "this repository has no GitHub remote" was said about a folder that
/// is not one — with every repository inside it having exactly the remote the
/// sentence denied. Naming the path is what makes the difference visible.
///
/// Same home as `unavailableText`, for the same reason: the inbox's pull request
/// half is this same read, and it starts before any page is open.
export function prUnavailableText(error: PrUnavailable, cwd: string): string {
  switch (error.kind) {
    case "no_cli":
      return "GitHub CLI (gh) is not installed. Run `brew install gh`, then Refresh.";
    case "not_authenticated":
      return "GitHub CLI is not logged in. Run `gh auth login`, then Refresh.";
    case "missing_permission":
      // **Names the repository**, because the page reads several and the whole
      // question is *which* one was refused: a token can be fine everywhere but
      // one organisation, and a sentence without a subject sends the reader to
      // their GitHub settings with nothing to look up.
      return `GitHub refused this read for ${cwd}: the token it is signed in with is missing a permission Hyze Code needs. Settings → Source control shows which account and where its credential comes from.`;
    case "no_remote":
      return `No GitHub repository at ${cwd} — a project that holds repositories has no pull requests of its own. Pick one in the composer, or select a session.`;
    default:
      return error.detail;
  }
}
