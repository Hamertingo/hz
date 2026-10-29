import { useCallback, useEffect, useRef, useState } from "react";

import { toast } from "@/components/ui/toast";
import { kit } from "@/lib/kit";

/// `checking` until the backend answers. `preview` is a backend that cannot answer yet: the screen is drawn
/// but nothing is connected, and the controls only change what this window shows.
export type ComputerLink = "checking" | "preview" | "absent" | "off" | "starting" | "on";

const SHOT_EVERY_MS = 2500;

/// The agents' computer as one agent sees it: whether it is running, a fresh screenshot while it is, and
/// whether the reader is driving. Every call can reject until `kit_cmds.rs` has it; a rejection
/// means "not ready" and never an error on screen.
export function useComputer(agentId: string, active: boolean) {
  const [link, setLink] = useState<ComputerLink>("checking");
  const [shot, setShot] = useState<string | null>(null);
  const [live, setLive] = useState<string | null>(null);
  const [control, setControl] = useState(false);
  const screenNo = useRef<number | null>(null);

  useEffect(() => {
    if (!active) return;
    let live = true;
    setLink("checking");
    setShot(null);
    setLive(null);
    kit
      .vmState(agentId)
      .then((s) => {
        if (!live) return;
        if (s === "absent") {
          // No computer yet (an agent made before they existed): make one, asleep, and show it resting.
          setLink("absent");
          kit
            .vmEnsure(agentId)
            .then(() => live && setLink("off"))
            .catch(() => live && setLink("off"));
          return;
        }
        setLink(s === "running" ? "on" : s === "starting" ? "starting" : "off");
      })
      .catch(() => live && setLink("preview"));
    kit
      .screenFor(agentId)
      .then((n) => {
        screenNo.current = n;
        return kit.takeoverState(n);
      })
      .then((on) => live && setControl(on))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [agentId, active]);

  // The agent wakes its computer by itself (any computer tool resumes it) and it goes back to sleep when idle, so
  // the tab keeps asking: a computer that woke shows its screen, one that fell asleep shows the mascot resting.
  useEffect(() => {
    if (!active || (link !== "on" && link !== "off")) return;
    const timer = window.setInterval(() => {
      kit
        .vmState(agentId)
        .then((s) => {
          if (s === "running" && link === "off") setLink("on");
          else if (s !== "running" && link === "on") {
            setLink("off");
            setLive(null);
          }
        })
        .catch(() => {});
    }, 3000);
    return () => window.clearInterval(timer);
  }, [agentId, active, link]);

  // The live view of the screen, while the computer is on: a real desktop the reader can watch and, once they take
  // over, drive. If it cannot start, the screenshots below stand in for it.
  const [liveError, setLiveError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const liveFailed = liveError !== null;
  useEffect(() => {
    if (!active || link !== "on") return;
    let alive = true;
    setLiveError(null);
    kit
      .screenUrl(agentId)
      .then((u) => alive && setLive(u))
      .catch((e) => alive && setLiveError(String(e)));
    return () => {
      alive = false;
    };
  }, [agentId, active, link, attempt]);
  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  // A real screenshot, while the computer is on. One failure stops the polling and the drawing stays.
  useEffect(() => {
    if (!active || link !== "on" || !liveFailed) return;
    let live = true;
    let timer = 0;
    const tick = () =>
      kit
        .screenshot(agentId)
        .then((s) => {
          if (!live) return;
          setShot(s.startsWith("data:") ? s : `data:image/png;base64,${s}`);
          timer = window.setTimeout(tick, SHOT_EVERY_MS);
        })
        .catch(() => {});
    tick();
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [agentId, active, link, liveFailed]);

  const start = useCallback(async () => {
    setLink("starting");
    try {
      await kit.vmStart(agentId);
      setLink("on");
      toast("The computer is on");
    } catch (e) {
      setLink("off");
      toast(`Could not turn the computer on: ${String(e)}`);
    }
  }, [agentId]);

  /// Takes the screen or hands it back. In a preview there is nothing to take, so only the window changes.
  const drive = useCallback(
    async (on: boolean) => {
      if (link === "preview") {
        setControl(on);
        return;
      }
      try {
        let n = screenNo.current;
        if (n === null) {
          n = await kit.screenFor(agentId);
          screenNo.current = n;
        }
        await kit.takeover(n, on);
        setControl(on);
        toast(on ? "You're driving. The agent waits." : "Control handed back", { ms: 1500 });
      } catch (e) {
        toast(String(e));
      }
    },
    [agentId, link],
  );

  return { link, shot, live, liveError, retry, control, start, drive };
}

export type Computer = ReturnType<typeof useComputer>;
