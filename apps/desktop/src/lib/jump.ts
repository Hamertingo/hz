import { seqSelector } from "@/lib/reply";

/// The event `Chat` listens for to mount every turn, so a jump to a message far
/// above the window can find it.
export const MOUNT_ALL = "hz:mount-all";

const FLASH_MS = 1600;

function flash(el: Element) {
  el.classList.remove("msg-flash");
  // Reading the layout between the two writes restarts the animation.
  void (el as HTMLElement).offsetWidth;
  el.classList.add("msg-flash");
  window.setTimeout(() => el.classList.remove("msg-flash"), FLASH_MS);
}

/// Scrolls to the message with `seq` and flashes it. A message above the part of
/// the transcript that is mounted asks `Chat` to mount the rest and looks again
/// once it has drawn.
export function jumpToSeq(seq: number, retry = true): boolean {
  const el = document.querySelector(seqSelector(seq));
  if (el) {
    el.scrollIntoView({ block: "center", behavior: "smooth" });
    flash(el);
    return true;
  }
  if (retry) {
    window.dispatchEvent(new Event(MOUNT_ALL));
    requestAnimationFrame(() => requestAnimationFrame(() => jumpToSeq(seq, false)));
  }
  return false;
}
