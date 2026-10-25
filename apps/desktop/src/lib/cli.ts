
/// What each CLI is called, and the brand mark that stands for it. OpenCode has
/// no mark among the vendored ones, which the header answers with a generic glyph.
export const CLI: Record<string, { label: string; brand: string | null }> = {
  "claude-acp": { label: "Claude Code", brand: "claude" },
  "codex-acp": { label: "Codex", brand: "openai" },
  opencode: { label: "OpenCode", brand: null },
};

