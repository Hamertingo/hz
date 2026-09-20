# bloub — vendored

An SVG bot avatar by Jérémy Perret, taken whole from
<https://github.com/jeremy-prt/bloub> at revision
`b4bb3c1b5f93c7b87a2e8d620f667c4093d97749`, MIT. See [LICENSE](./LICENSE) and
`THIRD-PARTY-LICENSES.md` at the repo root.

**This is third-party code and it is kept verbatim.** Comments and identifiers are
in French, which is not how anything else here is written — that is deliberate:
the point of vendoring rather than reimplementing is that the next upstream
commit can be diffed against this directory and carried over. Renaming
`decalageDesYeux` or translating a paragraph would cost that for no gain.

What came across is `src/bot/` and nothing else — the engine. The Vue component,
the customiser, the timeline editor and the export encoders were left behind,
because hz draws its own UI and `src/bot/` is framework-free: importing it needs
no Vue and no build step.

| file | what it is |
|---|---|
| `engine.ts` | `BotEngine.sample(t)` — a pure function of time, so pausing, resuming and jumping to any date all give the same image |
| `states.ts` | the 14 states, measured off the reference video |
| `shape.ts`, `profiles.ts` | radial-profile morphing — the silhouettes that *are* the animation |
| `skins.ts` | the 8 base shapes and 12 colours the reader picks from |
| `face.ts`, `expressions.ts`, `eyefit.ts` | the eyes: capsule fitting, blink, gaze drift, per-shape eye offsets |
| `decor.ts` | the orbit rings, the comet and the burst particles |
| `cycles.ts`, `math.ts`, `repere.ts` | montage arithmetic, easings and the viewBox definition |
| `*.test.ts` | upstream's own suite. It runs under hz's vitest untouched — 94 tests — and is the reason a vendored engine can be trusted here at all |

`UPSTREAM-MEASUREMENTS.md` is upstream's `docs/measurements.md`: what was measured
off the video, and how. Worth reading before "fixing" a constant that looks
arbitrary — most of them are measurements, and rounding one breaks the
resemblance, which is the only thing the engine is trying to get right.
