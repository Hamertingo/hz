import type { ReactNode } from "react";

import FileIcon from "@/components/FileIcon";
import Tab from "@/components/Tab";
import { tabLabels } from "@/lib/fileTree";
import type { OpenFile } from "@/hooks/useOpenFiles";

/// The open files as an editor's tab strip.
///
/// Overflow scrolls sideways and there is no dropdown: a strip long enough to
/// need one is a strip the reader should be closing tabs out of, and the tree
/// beside it reopens any of them in a click.
///
/// **One row, not two**, the reading the Docs panel's chip strip takes: a
/// filename header under a strip of tabs says the same thing twice.
///
/// **No `title` on a tab.** It carried the full path, and the native tooltip
/// that draws it is the app's own rule broken — chrome here is a real tooltip
/// or nothing — and it read as a directory hanging off the cursor a second
/// after landing on a tab the reader was only passing over. `tabLabels` already
/// appends the parent where a basename stops being unambiguous, which is the
/// only moment the rest of the path was worth saying.
export default function FileTabs({
  files,
  active,
  onSelect,
  onClose,
  actions,
}: {
  files: readonly OpenFile[];
  active: string | null;
  onSelect: (path: string) => void;
  onClose: (path: string) => void;
  /// Drawn at the row's end, past the scrolling strip — what acts on the file
  /// being read rather than on the row.
  actions?: ReactNode;
}) {
  const labels = tabLabels(files.map((file) => file.path));

  return (
    <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border px-2">
      <div className="scrollbar-none flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
        {files.map((file, i) => (
          <Tab
            key={file.path}
            icon={<FileIcon path={file.path} className="size-3.5" />}
            label={labels[i]}
            title={file.path}
            active={file.path === active}
            onSelect={() => onSelect(file.path)}
            onClose={() => onClose(file.path)}
          />
        ))}
      </div>
      {actions}
    </div>
  );
}
