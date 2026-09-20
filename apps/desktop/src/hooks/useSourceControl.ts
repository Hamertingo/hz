import { useCallback, useEffect, useState } from "react";

import { invoke } from "@tauri-apps/api/core";
import type { SourceControlState } from "@/types/events";

/// What this machine can do with git and GitHub.
///
/// Read fresh whenever Settings opens rather than cached for the process: the
/// reader lands here *because* something about it is wrong, and a cached answer
/// would be the answer they already know. The read is one `git --version` and
/// one `gh auth status`, both local.
export function useSourceControl() {
  const [state, setState] = useState<SourceControlState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const read = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setState(await invoke<SourceControlState>("source_control_state"));
    } catch (e) {
      // A bridge that will not answer is not an answer about git, so the last
      // reading is kept rather than replaced by a blank one.
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  // On mount, and the mount *is* the visit: the settings bodies are switched
  // rather than hidden, so this section is built fresh each time it is opened
  // and torn down when the reader moves to another one.
  useEffect(() => {
    void read();
  }, [read]);

  /// Asks whether `gh` is there now. The absence of the binary is cached for
  /// the life of the process ([`recheck_gh`] is what throws that away), so
  /// without this an install made on this row's say-so appears to change
  /// nothing until the app restarts.
  const recheck = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      await invoke<boolean>("recheck_gh");
    } catch {
      // A rejection here is still no answer about the credential, and the read
      // below is what says so.
    }
    setLoading(false);
    await read();
  }, [read]);

  return { state, error, loading, read, recheck };
}
