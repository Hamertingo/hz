/// Saving a session out — the one part of an export that touches the disk.
///
/// **Apart from `export.ts` on purpose, which is pure by design.** That module's
/// whole value is that one session produces one set of bytes, and a file dialog
/// inside it would make that untestable for nothing. So the part that cannot be
/// pure is the part that is thin.

import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";

import {
  exportFileName,
  sessionExportMeta,
  sessionToJson,
  sessionToMarkdown,
} from "@/lib/export";
import type { AgentEvent, SessionIndexItem } from "@/types/events";

/// What an export can be written as.
///
/// The two the plan names, and no third: markdown is the document, JSON is the
/// event log — and a rendered HTML export would be a second renderer to keep in
/// step with the first for a case nobody has asked for.
export type ExportFormat = "md" | "json";

/// Writes a session out, and answers where it landed.
///
/// **`null` is the reader closing the dialog, which is not a failure.** The caller
/// must not report it: an app that raises an error for a thing somebody decided
/// not to do is an app that argues with them.
///
/// Throws only for a real refusal — the write itself — so the caller has one thing
/// to catch and one thing to say.
export async function exportSession(
  item: SessionIndexItem,
  events: readonly AgentEvent[],
  format: ExportFormat,
): Promise<string | null> {
  const contents =
    format === "json"
      ? sessionToJson(events)
      : sessionToMarkdown(events, sessionExportMeta(item));

  const path = await save({
    defaultPath: exportFileName(item.title || item.sessionId, format),
    filters: [
      format === "json"
        ? { name: "JSON", extensions: ["json"] }
        : { name: "Markdown", extensions: ["md"] },
    ],
  });
  if (path === null) return null;

  await invoke("write_text_file", { path, contents });
  return path;
}
