import RFB from "@novnc/novnc";
import { useEffect, useRef, useState } from "react";

/// The agents' desktop, drawn by noVNC's own client in a plain canvas: no side bar, no page around it, nothing
/// that is not the screen. Looking and driving share one connection, so taking over flips `viewOnly` and the
/// picture never reloads. `base` is the web address of the screen's bridge; the socket lives beside it.
export default function VncView({ base, driving, className }: { base: string; driving: boolean; className?: string }) {
  const host = useRef<HTMLDivElement>(null);
  const rfb = useRef<RFB | null>(null);
  const [up, setUp] = useState(false);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let alive = true;
    let timer = 0;
    let tries = 0;

    const connect = () => {
      el.replaceChildren();
      const conn = new RFB(el, `${base.replace(/^http/, "ws")}/websockify`, { shared: true });
      conn.scaleViewport = true;
      conn.resizeSession = false;
      conn.clipViewport = false;
      conn.showDotCursor = true;
      conn.background = "#000";
      conn.qualityLevel = 8;
      conn.compressionLevel = 2;
      conn.viewOnly = true;
      conn.addEventListener("connect", () => {
        tries = 0;
        setUp(true);
      });
      conn.addEventListener("disconnect", () => {
        setUp(false);
        if (!alive) return;
        // The screen may still be coming up, or restarted: keep asking, a little slower each time.
        tries += 1;
        timer = window.setTimeout(connect, Math.min(1000 * tries, 5000));
      });
      rfb.current = conn;
    };
    connect();

    return () => {
      alive = false;
      window.clearTimeout(timer);
      rfb.current?.disconnect();
      rfb.current = null;
    };
  }, [base]);

  useEffect(() => {
    const conn = rfb.current;
    if (!conn) return;
    conn.viewOnly = !driving;
    if (driving) conn.focus();
    else conn.blur();
  }, [driving, up]);

  return (
    <div
      ref={host}
      className={className}
      // The canvas is the whole of it: a pointer over the screen is the agent's cursor, not the reader's arrow.
      style={{ cursor: driving ? "none" : "default" }}
    />
  );
}
