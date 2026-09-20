import { getCurrentWebview } from "@tauri-apps/api/webview";

/// One press, and the range the reader can walk.
///
/// Tenths from 0.5 to 2 is what every browser offers, which is the point: the
/// chords below are the ones a reader already knows from ⌘+ in Safari, so they
/// arrive expecting the same ladder.
export const UI_SCALE_STEP = 0.1;
export const UI_SCALE_MIN = 0.5;
export const UI_SCALE_MAX = 2;
export const UI_SCALE_KEY = "hz.uiScale";

/// The stored value, forced onto the ladder.
///
/// **Every** write goes through this, the chords' arithmetic included: 1.1 + 0.1
/// is `1.2000000000000002` in binary floating point, and a value off the ladder
/// reads as 120% in one place and 120.00000000000001% in another.
export function coerceUiScale(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 1;
  const stepped = Math.round(value * 10) / 10;
  return Math.min(UI_SCALE_MAX, Math.max(UI_SCALE_MIN, stepped));
}

/// The scale one step from here, clamped rather than wrapped: ⌘= at the top
/// stays at the top, where wrapping would silently take the reader from 200%
/// down to 50%.
export function nextUiScale(current: number, delta: number): number {
  return coerceUiScale(current + delta);
}

/// Applies the scale to the webview itself.
///
/// **The webview's own zoom, never CSS `zoom`.** Every drag in this app works
/// off `clientX` and every pane's width off `getBoundingClientRect`, and the
/// CEF view's rect is reported to Rust from those same numbers — CSS `zoom`
/// leaves the DOM and the native view in two coordinate spaces, so a resize
/// handle would move a pane by the wrong amount and a page would land off its
/// stage.
///
/// `getCurrentWebview()` **throws** rather than rejecting outside a webview,
/// which is `pnpm dev` in a plain browser and every unit test — hence the
/// synchronous `try` around the call and not only the one on the promise.
export function applyUiScale(scale: number): void {
  let view: ReturnType<typeof getCurrentWebview>;
  try {
    view = getCurrentWebview();
  } catch {
    return;
  }
  void view.setZoom(scale).catch(() => {});
}
