import type { PrUnavailable } from "@/types/events";

/// Why there is no listing, in the words of what to do about it.
///
/// **`no_remote` names the directory**, and that is the whole reason this is not
/// a constant: a project can be a *workspace* whose root is not a repository at
/// all, so "this repository has no GitHub remote" was said about a folder that
/// is not one — with every repository inside it having exactly the remote the
/// sentence denied. Naming the path is what makes the difference visible.
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
