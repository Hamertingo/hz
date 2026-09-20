import React from "react";
import ReactDOM from "react-dom/client";
import "streamdown/styles.css";
import App from "./App";
import RenderErrorBoundary from "@/components/RenderErrorBoundary";
import { adoptPreviousStorageKeys } from "@/hooks/useLocalStorage";
import { trackActiveDay } from "@/lib/analytics";
import { onFocusChange } from "@/lib/focus";
import { adoptDurablePreferences, loadPreferences } from "@/lib/prefs";
import { startSurveys } from "@/lib/surveys";

// Before the first render, since every render below reads one of these keys —
// and before the effects, which write them. See the function for what it moves.
adoptPreviousStorageKeys();

// And the durable half, still before the first render and in that order: one
// command answers every preference that lives in `~/.hz/settings.json`, and then
// anything a build before that move left in the webview is carried over. Both
// have to have happened before a picker draws, or the first frame shows defaults
// to a reader who has picked — and both are best-effort, so a launch that can
// read neither still renders. See `src/lib/prefs.ts`.
void (async () => {
  await loadPreferences();
  await adoptDurablePreferences();

  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      {/* The floor: a throw anywhere the inner boundary does not cover would
          unmount the whole tree and leave a blank window with no message. This
          one has no `resetKey` — nothing above it changes to clear it, which is
          what Reload is for. */}
      <RenderErrorBoundary>
        <App />
      </RenderErrorBoundary>
    </React.StrictMode>,
  );
})();

// Coming back to check on a session an agent is running sends no prompt and
// starts nothing, so it is the one kind of use the backend's own call sites
// cannot see. Subscribed here rather than from an effect: it lives for the
// process, and StrictMode double-invokes a mount.
onFocusChange((focused) => {
  if (focused) trackActiveDay();
});

// Here for the same reason, and not in an effect for the same reason: the SDK
// lives for the process, and a mount that runs twice would initialise it twice.
// It refuses itself where the install has opted out, so this is unconditional.
void startSurveys();
