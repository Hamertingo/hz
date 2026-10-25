import { convertFileSrc } from "@tauri-apps/api/core";

import Dither from "@/components/Dither";
import { mixHex } from "@/lib/mascots";
import { cn } from "@/lib/utils";

/// A workspace's mark: the uploaded image when there is one, otherwise a dither
/// of its colour with its letter on it. Takes only the fields it draws, so the
/// create dialog can preview a workspace that does not exist yet.
export default function WorkspaceLogo({
  name,
  mark,
  color,
  logo,
  size = 30,
  className,
}: {
  name: string;
  mark: string;
  color: string;
  logo?: string | null;
  size?: number;
  className?: string;
}) {
  const radius = Math.round(size * 0.26);

  if (logo) {
    return (
      <img
        src={convertFileSrc(logo)}
        alt=""
        draggable={false}
        className={cn("shrink-0 object-cover", className)}
        style={{ width: size, height: size, borderRadius: radius }}
      />
    );
  }

  return (
    <span
      aria-hidden
      className={cn("relative inline-flex shrink-0 items-center justify-center overflow-hidden", className)}
      style={{ width: size, height: size, borderRadius: radius }}
    >
      <Dither
        color={color}
        seed={name || "workspace"}
        cols={10}
        rows={10}
        light={1.1}
        tones={[mixHex(color, "#000000", 0.55), mixHex(color, "#000000", 0.3), color, mixHex(color, "#ffffff", 0.3)]}
      />
      <span
        className="relative font-semibold text-white [text-shadow:0_1px_0_rgb(0_0_0/40%)]"
        style={{ fontSize: Math.round(size * (mark.length > 1 ? 0.32 : 0.46)) }}
      >
        {mark}
      </span>
    </span>
  );
}
