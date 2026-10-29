import VncView from "@/components/computer/VncView";
import { ArrowLeft, ArrowRight, Globe, Lock, MoreHorizontal, Maximize2, RotateCw, Volume2 } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { formatClock } from "@/lib/clock";
import { cn } from "@/lib/utils";

/// The size the desktop is drawn at before it is scaled to its box.
const W = 960;
const H = 600;

export type VmPage = "docs" | "review" | "post" | "sheet" | "search";

/// What the agent's browser is showing. The pages are drawings, not the web: `kit.screenshot`
/// replaces the whole picture with the real screen once the backend serves it.
export type VmScreenDesc = { page: VmPage; url?: string; title?: string };

const DEFAULT: Record<VmPage, { url: string; title: string }> = {
  docs: { url: "docs.example.com/billing/usage", title: "Usage-based billing" },
  review: { url: "git.example.com/api/pull/482", title: "Add usage-based billing endpoint" },
  post: { url: "social.example.com/compose", title: "Compose post" },
  sheet: { url: "sheets.example.com/d/pricing", title: "Pricing sheet" },
  search: { url: "search.example.com/?q=sandbox+vm+pricing", title: "sandbox vm pricing" },
};

const bars = (n: number, w = [90, 70, 82, 60, 76]) =>
  Array.from({ length: n }, (_, i) => <i key={i} style={{ width: `${w[i % w.length]}%` }} />);

const PAGES: Record<VmPage, () => ReactNode> = {
  docs: () => (
    <div className="vmx-docs">
      <aside>
        {["Overview", "Products", "Prices", "Usage-based billing", "Meters", "Invoices", "Taxes"].map((t, i) => (
          <b key={t} className={i === 3 ? "on" : ""}>
            {t}
          </b>
        ))}
      </aside>
      <main>
        <h1>Usage-based billing</h1>
        <p className="lead">Charge for what customers use: API calls, minutes, gigabytes.</p>
        <div className="vmx-ln">{bars(4)}</div>
        <h2>Report usage</h2>
        <div className="vmx-ln">{bars(3)}</div>
        <pre>{'meter_events.create(\n  event_name="vm_minutes",\n  payload={"value": 42}\n)'}</pre>
        <div className="vmx-ln">{bars(3)}</div>
      </main>
    </div>
  ),
  review: () => (
    <div className="vmx-review">
      <h1>
        Add usage-based billing endpoint <span>#482</span>
      </h1>
      <div className="meta">
        <em>Open</em> wants to merge 7 commits into <code>main</code>
      </div>
      <div className="tb">
        <b className="on">Conversation</b>
        <b>Commits 7</b>
        <b>Files changed 7</b>
      </div>
      <div className="vmx-diff">
        <div className="fh">src/billing/usage.rs</div>
        {[
          ["", "pub async fn report(usage: Usage) -> Result<()> {"],
          ["-", "    let delay = 1000;"],
          ["+", "    let delay = base * 2u64.pow(attempt);"],
          ["+", "    let delay = delay.min(60_000);"],
          ["", "    meter.send(usage).await?;"],
          ["", "}"],
        ].map(([k, l], i) => (
          <div key={i} className={cn("dl", k === "+" && "add", k === "-" && "del")}>
            <span>{k}</span>
            {l}
          </div>
        ))}
      </div>
    </div>
  ),
  post: () => (
    <div className="vmx-post">
      <div className="cmp">
        <span className="av" style={{ background: "#ee73b2" }} />
        <div>
          <p>Sandbox VMs by the hour, built for agents.</p>
          <p>
            The Pro plan opens Oct 30. Spin up a VM, let your agent work, pay for the minutes it ran.
            <i className="vmx-caret" />
          </p>
          <div className="img" />
        </div>
      </div>
      <div className="pbar">
        <span>1/7</span>
        <b>Post</b>
      </div>
    </div>
  ),
  sheet: () => (
    <div className="vmx-sheet">
      <table>
        <tbody>
          {[
            ["", "Provider", "Unit", "Price", "Per hour"],
            ["1", "Provider A", "second", "$0.000014", "$0.05"],
            ["2", "Provider B", "second", "$0.000016", "$0.06"],
            ["3", "Provider C", "second", "$0.0000022", "$0.008"],
            ["4", "Ours", "minute", "$0.0012", "$0.072"],
            ["5", "", "", "", ""],
            ["6", "", "", "", ""],
          ].map((r, i) => (
            <tr key={i}>
              {r.map((c, k) =>
                i === 0 || k === 0 ? (
                  <th key={k}>{c}</th>
                ) : (
                  <td key={k} className={i === 4 && k === 4 ? "sel" : ""}>
                    {c}
                  </td>
                ),
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  ),
  search: () => (
    <div className="vmx-search">
      <div className="wm">find</div>
      <div className="box">
        sandbox vm pricing
        <i className="vmx-caret" />
      </div>
      <div className="sug">
        {["sandbox vm pricing per hour", "sandbox vm pricing comparison", "sandbox vm for ai agents"].map((s) => (
          <span key={s}>{s}</span>
        ))}
      </div>
    </div>
  ),
};

/// The agents' computer as a picture: a small Linux desktop with the agent's browser open and its named cursor
/// moving. Drawn at 960x600 and scaled to the box it sits in, so the thumbnail and the viewer are one picture.
/// With `shot` (a real screenshot as a data URL) the desktop is that image instead and the drawing is not used.
/// `control` is the amber outline and the "You" cursor while the reader drives.
export default function VmScreen({
  name,
  color,
  screen = { page: "search" },
  shot,
  live,
  status,
  control = false,
  big = false,
  onOpen,
  className,
}: {
  name: string;
  color: string;
  screen?: VmScreenDesc;
  shot?: string | null;
  /// The address of the machine's live view. Drawn in place of everything else; the reader's pointer and keys reach it only while `control` is on.
  live?: string | null;
  /// Said in place of the drawing while the real screen is not there yet or could not start: the drawing is a
  /// preview, and showing it as if it were the machine reads as a lie.
  status?: { text: string; retry?: () => void } | null;
  control?: boolean;
  big?: boolean;
  onOpen?: () => void;
  className?: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const fit = () => setScale(el.clientWidth / W);
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const def = DEFAULT[screen.page];
  const url = screen.url ?? def.url;
  const title = screen.title ?? def.title;
  const clickable = !big && !!onOpen;

  return (
    <div
      ref={box}
      role={clickable ? "button" : undefined}
      tabIndex={clickable ? 0 : undefined}
      aria-label={clickable ? `Open ${name}'s computer` : `${name}'s computer`}
      onClick={clickable ? onOpen : undefined}
      onKeyDown={clickable ? (e) => (e.key === "Enter" || e.key === " ") && onOpen?.() : undefined}
      className={cn("vmx", control && "ctl", clickable && "thumb outline-none focus-visible:ring-2 focus-visible:ring-ring/50", className)}
    >
      {status && !live && !shot ? (
        <div className="absolute inset-0 grid place-items-center bg-[#0f1219] px-6 text-center text-[13px] text-ink3">
          <div>
            <p>{status.text}</p>
            {status.retry && (
              <button type="button" onClick={status.retry} className="mt-3 cursor-pointer rounded-full px-3 py-1 text-xs font-medium text-ink2 shadow-[inset_0_0_0_1px_var(--line2)] hover:bg-s2 hover:text-ink">
                Try again
              </button>
            )}
          </div>
        </div>
      ) : live ? (
        <>
          <VncView base={live} driving={control} className="vmx-live" />
          {/* The canvas takes every pointer event for itself, so a press on a thumbnail never reached `onOpen`. Looking is not driving: this sheet keeps the clicks until the reader takes over. */}
          {!control && <div className="absolute inset-0 z-[1]" />}
        </>
      ) : shot ? (
        <img src={shot} alt="" draggable={false} className="vmx-shot" />
      ) : (
        <div className="vmx-in" style={{ width: W, height: H, transform: `scale(${scale})`, visibility: scale ? "visible" : "hidden" }}>
          <div className="vmx-top">
            <span>Chromium</span>
            <span className="r">
              <Globe /> <Volume2 /> {formatClock(new Date())}
            </span>
          </div>
          <div className="vmx-win">
            <div className="vmx-tabs">
              <span className="vmx-tab on">
                <i style={{ background: color }} />
                {title}
                <em>×</em>
              </span>
              <span className="vmx-tab">New tab</span>
              <span className="vmx-add">+</span>
            </div>
            <div className="vmx-bar">
              <ArrowLeft />
              <ArrowRight />
              <RotateCw />
              <span className="vmx-url">
                <Lock />
                {url}
              </span>
              <MoreHorizontal />
            </div>
            <div className="vmx-page">{PAGES[screen.page]()}</div>
          </div>
          <span className={cn("vmx-cur", control && "you")} style={{ ["--c" as string]: control ? "#f2f2f0" : color }}>
            <svg viewBox="0 0 16 16">
              <path d="M2 1l11 6.5-5 1-2.5 5z" />
            </svg>
            <b>{control ? "You" : name}</b>
          </span>
        </div>
      )}
      {clickable && (
        <span className="vmx-open">
          <Maximize2 />
          Open
        </span>
      )}
    </div>
  );
}
