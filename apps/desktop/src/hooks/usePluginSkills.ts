import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useRef, useState } from "react";

import { withSkillEnabled } from "@/lib/skills";

import type { PluginSkill, SkillRoster, SkillToggle } from "@/types/events";

/// How long a read is worth keeping between visits.
///
/// The answer is a fact about the machine rather than about a session, and the
/// read costs the agent child's first boot when none is up — so leaving the screen
/// and coming back inside this window paints what the last visit read. Longer than
/// the PR panel's 30s and much shorter than the model list's 10 minutes: a Skill
/// can be switched from the agent's own terminal, and that is the one way this
/// copy goes stale while somebody is watching.
const FRESH_MS = 60_000;

/// The last roster read, kept across mounts.
///
/// Module-level for the reason every other cache here is: the screen is free to be
/// rebuilt, and a read that can spawn a child should not ride a remount.
let cached: { roster: SkillRoster; at: number } | null = null;

/// The agent's Skill roster, and the two things a reader does to it.
///
/// **Reading and switching are one hook because they are one conversation.** The
/// agent answers both on the same child — the one [`plugins`](crate::plugins)
/// keeps — so splitting them across two hooks would be two places deciding when
/// that child is worth keeping warm.
export function usePluginSkills(active: boolean) {
  const [roster, setRoster] = useState<SkillRoster | null>(() => cached?.roster ?? null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  /// The Skill whose switch is in flight, by name, so its own row can say so.
  const [switching, setSwitching] = useState<string | null>(null);

  /// Bumped by every read, so one that lands after a newer one is dropped. The
  /// screen can be left and re-entered while a child is still booting.
  const reads = useRef(0);

  const load = useCallback(async (force = false) => {
    if (!force && cached && Date.now() - cached.at < FRESH_MS) {
      setRoster(cached.roster);
      return;
    }

    const read = ++reads.current;
    setLoading(true);
    try {
      const answer = await invoke<SkillRoster>("list_plugin_skills");
      if (read !== reads.current) return;
      cached = { roster: answer, at: Date.now() };
      setRoster(answer);
      setError(null);
    } catch (cause) {
      if (read !== reads.current) return;
      setError(String(cause));
    } finally {
      if (read === reads.current) setLoading(false);
    }
  }, []);

  // Read on arriving, which is the only moment this screen can be missing an
  // answer. A cached roster is already on the first frame, and this re-reads it
  // behind that rather than holding the screen blank.
  useEffect(() => {
    if (active) void load();
  }, [active, load]);

  const refresh = useCallback(() => {
    void load(true);
  }, [load]);

  /// Switches one Skill, and answers whether the registry took it.
  const setEnabled = useCallback(
    async (skill: PluginSkill, enabled: boolean): Promise<boolean> => {
      setSwitching(skill.name);
      try {
        const answer = await invoke<SkillToggle>("set_plugin_skill_enabled", {
          name: skill.name,
          enabled,
          locationUri: skill.locationUri,
        });

        if (!answer.applied) {
          // The registry did not recognise the row — it was deleted or renamed
          // since it was drawn — so the *list* is stale rather than the switch
          // having failed. Re-read and let the answer say what is true, instead
          // of moving a control over a Skill nobody changed.
          await load(true);
          return false;
        }

        // Written to the state and the cache together: the state so the row moves
        // now, the cache so a remount inside the window does not undo it.
        setRoster((current) => {
          if (!current) return current;
          const moved = withSkillEnabled(current, answer.name, answer.enabled);
          cached = { roster: moved, at: Date.now() };
          return moved;
        });
        setError(null);
        return true;
      } catch (cause) {
        setError(String(cause));
        return false;
      } finally {
        setSwitching(null);
      }
    },
    [load],
  );

  return { roster, error, loading, switching, refresh, setEnabled };
}

/// One Skill's own text, read when it becomes the one being looked at.
///
/// **Read here rather than with the roster.** A roster row is a sentence; a body
/// is a whole document, and fetching every one of them so a list nobody has
/// opened can be drawn is the read this screen exists to avoid. Nothing is kept
/// across selections: the text is the agent's own file, and a cached copy would
/// be the one thing on this screen able to disagree with it.
export function useSkillText(skill: PluginSkill | null) {
  const [text, setText] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /// Whether the agent answered that there is no such Skill any more.
  const [missing, setMissing] = useState(false);

  /// Bumped by every read, so one that lands after a newer selection is dropped —
  /// clicking down a list is faster than a document is read.
  const reads = useRef(0);

  const name = skill?.name ?? null;
  const locationUri = skill?.locationUri ?? null;

  useEffect(() => {
    if (!name) {
      setText(null);
      setMissing(false);
      setError(null);
      return;
    }

    const read = ++reads.current;
    setLoading(true);
    setMissing(false);

    invoke<string | null>("read_plugin_skill", { name, locationUri })
      .then((answer) => {
        if (read !== reads.current) return;
        setText(answer);
        // `null` is the agent's word for a Skill that is gone, which is a
        // sentence to draw rather than a failure: the row may have been deleted
        // since this list was read.
        setMissing(answer === null);
        setError(null);
      })
      .catch((cause) => {
        if (read !== reads.current) return;
        setError(String(cause));
      })
      .finally(() => {
        if (read === reads.current) setLoading(false);
      });
  }, [name, locationUri]);

  return { text, loading, error, missing };
}
