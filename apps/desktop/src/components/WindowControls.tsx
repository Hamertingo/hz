import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useState } from "react";

// **Windows gets no window from the system, so the app draws one.**
//
// `decorations: false` (tauri.windows.conf.json) is what removes the system title
// bar — the macOS build has the system's traffic lights and this one has nothing
// — so these three buttons are not decoration, they are the only way to minimise,
// maximise or close the window. Every drag region reserves their width
// (`App.css`), or the far end of a titlebar row sits under them.
export function WindowControls() {
  const [maximized, setMaximized] = useState(false);
  // Only Windows: the attribute is set before first paint by `index.html`, and
  // everywhere else the system draws the window and these would be three
  // buttons over a titlebar that already has its own.
  const wanted =
    typeof document !== "undefined" && document.documentElement.dataset.platform === "windows";
  const win = (() => {
    if (!wanted) return null;
    try {
      return getCurrentWindow();
    } catch {
      // A demo page, or any mount outside Tauri, where this is simply not shown.
      return null;
    }
  })();

  useEffect(() => {
    if (!win) return;
    void win.isMaximized().then(setMaximized);
    const unlisten = win.onResized(() => void win.isMaximized().then(setMaximized));
    return () => void unlisten.then((off) => off());
  }, [win]);

  if (!win) return null;

  const button =
    "flex h-(--titlebar-h) w-[46px] items-center justify-center text-muted-foreground transition-colors";

  return (
    <div className="window-controls fixed top-0 right-0 z-60 flex" aria-label="Window">
      <button type="button" className={`${button} hover:bg-accent hover:text-foreground`}
              onClick={() => void win.minimize()} aria-label="Minimize">
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
          <path d="M0 5h10" stroke="currentColor" strokeWidth="1" />
        </svg>
      </button>
      <button type="button" className={`${button} hover:bg-accent hover:text-foreground`}
              onClick={() => void win.toggleMaximize()}
              aria-label={maximized ? "Restore" : "Maximize"}>
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
          {maximized ? (
            <>
              <rect x="0.5" y="2.5" width="7" height="7" stroke="currentColor" strokeWidth="1" />
              <path d="M2.5 2.5V0.5h7v7h-2" stroke="currentColor" strokeWidth="1" />
            </>
          ) : (
            <rect x="0.5" y="0.5" width="9" height="9" stroke="currentColor" strokeWidth="1" />
          )}
        </svg>
      </button>
      <button type="button" className={`${button} hover:bg-destructive hover:text-white`}
              onClick={() => void win.close()} aria-label="Close">
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
          <path d="M0 0l10 10M10 0L0 10" stroke="currentColor" strokeWidth="1" />
        </svg>
      </button>
    </div>
  );
}
