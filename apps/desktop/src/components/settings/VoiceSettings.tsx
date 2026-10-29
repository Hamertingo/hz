import { Play } from "lucide-react";
import type { ReactNode } from "react";

import { SetHeading } from "@/components/settings/StudioRow";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import { cn } from "@/lib/utils";

/// The six voices an agent can have, each a pitch and pace on the system's own speech engine.
/// There is no network voice here: a card's listen button speaks through the webview.
const VOICES: { name: string; line: string; pitch: number; rate: number }[] = [
  { name: "Sol", line: "Warm, unhurried", pitch: 0.9, rate: 0.9 },
  { name: "Ravi", line: "Clear and quick", pitch: 1, rate: 1.15 },
  { name: "Iris", line: "Bright, friendly", pitch: 1.25, rate: 1.05 },
  { name: "Theo", line: "Low and calm", pitch: 0.7, rate: 0.9 },
  { name: "Noa", line: "Soft, close", pitch: 1.1, rate: 0.85 },
  { name: "Kit", line: "Plain, neutral", pitch: 1, rate: 1 },
];

function listen(v: (typeof VOICES)[number]) {
  if (typeof speechSynthesis === "undefined") return;
  speechSynthesis.cancel();
  const say = new SpeechSynthesisUtterance(`Hi, I'm ${v.name}. I'm on it.`);
  say.pitch = v.pitch;
  say.rate = v.rate;
  speechSynthesis.speak(say);
}

/// Settings → Voice: the voice agents speak with, and (as `children`) dictation, which is the
/// other half of talking to them.
export default function VoiceSettings({ children }: { children?: ReactNode }) {
  const [picked, setPicked] = useLocalStorage("hz.voice", "Sol");

  return (
    <>
      <SetHeading>The voice your agents speak with</SetHeading>
      <div role="radiogroup" aria-label="Voice" className="grid grid-cols-2 gap-2">
        {VOICES.map((v, i) => {
          const on = picked === v.name;
          return (
            <div
              key={v.name}
              role="radio"
              aria-checked={on}
              tabIndex={0}
              onClick={() => setPicked(v.name)}
              onKeyDown={(e) => {
                if (e.key === " " || e.key === "Enter") {
                  e.preventDefault();
                  setPicked(v.name);
                }
              }}
              className={cn(
                "flex cursor-pointer items-center gap-2.5 rounded-(--r3) px-3 py-[11px] outline-none transition-colors hover:bg-s1 focus-visible:ring-2 focus-visible:ring-ring/50",
                on ? "bg-s1 shadow-[inset_0_0_0_1.5px_var(--ink2)]" : "shadow-[inset_0_0_0_1px_var(--line)]",
              )}
            >
              <span className="flex h-[18px] items-center gap-0.5" aria-hidden>
                {Array.from({ length: 7 }, (_, k) => (
                  <i key={k} className="block w-0.5 rounded-[2px] bg-ink3" style={{ height: 5 + (((i + 2) * (k + 3)) % 13) }} />
                ))}
              </span>
              <span className="min-w-0 flex-1">
                <b className="block text-[13px] font-medium">{v.name}</b>
                <span className="mt-[3px] block text-xs leading-[1.25] text-ink3">{v.line}</span>
              </span>
              <button
                type="button"
                aria-label={`Listen to ${v.name}`}
                onClick={(e) => {
                  e.stopPropagation();
                  listen(v);
                }}
                className="grid size-[26px] cursor-pointer place-items-center rounded-md text-ink3 transition-colors hover:bg-s3 hover:text-ink"
              >
                <Play className="size-[15px]" />
              </button>
            </div>
          );
        })}
      </div>

      {children}
    </>
  );
}
