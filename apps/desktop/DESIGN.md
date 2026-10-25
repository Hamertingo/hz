# Design notes

Why hz's surfaces are shaped the way they are. [CLAUDE.md](../../CLAUDE.md) holds the
operating manual — protocol, git mechanics, conventions, traps; this file holds the
reasoning behind the visual and interaction design.

**Read this before restyling anything, changing window chrome, or reworking a panel,
card, row or button.** Most entries record an alternative that was tried and rejected,
so changing one back is usually redoing work rather than improving it. Nothing here is
load-bearing for correctness — the traps that break the app silently live in CLAUDE.md.

Same writing rules as CLAUDE.md: why, not what. Cut any word doing no work.

## The Studio language

The mockup ([design/studio/](design/studio/)) is the spec; this section is what of it is law. It replaces the older pixel-label look: **pixel lives in identity only** (faces, banners, tiles), and labels, icons, buttons and type are plain Geist in sentence case. Silkscreen and caps went on purpose.

**Tokens derive from the theme, never from a second palette.** `--ink..ink4`, `--s1..s3`, `--line..line3`, `--hover`, `--active` are mixes of `--foreground` into `--background` in [App.css](src/App.css), so a ported theme, light mode and vibrancy follow with no block of their own, and the shadcn names stay the source of truth for screens not yet rebuilt. Tailwind sees them as `text-ink2`, `bg-s2`, `border-line`. The one rule is that no component writes a hex. What is fixed: `--amber --green --red --blue` (a state keeps its meaning across themes, light mode gets darker values), the radii, and `--paper` under a brand mark.

**Four radii.** `--r1` 6 for rows and small controls, `--r2` 9 for buttons and fields, `--r3` 12 for menus and cards, `--r4` 16 for sheets. A confirm dialog is 18, the one step above, since it floats over a sheet. Use `rounded-(--r2)`. `Button`'s `size` variants still carry the old `--radius` rungs until a screen is rebuilt on them, and an icon button needs no radius class.

**One panel, two homes** ([ui/sheet.tsx](src/components/ui/sheet.tsx)). `docked` hangs off the right edge for something read beside the chat. `centered` is wider, with a full-screen toggle, for something configured. `bare` drops the header for a body that brings its own banner, leaving the close and expand buttons floating over it (dark glass chips, since the banner is arbitrary colour). Rejected: two components, because the mockup moves one panel between homes and the behaviour (Escape, scroll, footer) must not drift.

**Layers close one at a time.** Sheet, confirm and menus are Radix, so Escape closes the topmost only and there is no stack of our own to keep in step. z: sheet 60, confirm 70, menus 80, toasts 130. **A toast is outside a sheet to Radix**, so clicking Undo would dismiss the sheet behind it; both panels ignore any target inside `[data-toaster]`.

**Toasts are a pill at the bottom centre**, with an optional action (Undo, Open). `toast()` is imperative on purpose: the thing that wants Undo is a handler, not a render. It dismisses itself after 3.4s.

**Menus** (`ui/dropdown-menu`): sections are `DropdownMenuLabel` in ink4, a check sits at the right edge, a hint (`DropdownMenuHint`) pushes to it, and destructive is red text with a red wash. Icons inherit ink3.

**Confirm with type-to-confirm** ([ui/confirm-dialog.tsx](src/components/ui/confirm-dialog.tsx)) for what cannot be undone and takes more than itself with it (a workspace, an agent with its memory). The button is disabled, not hidden, until the text matches exactly.

**Faces are one canvas helper.** [lib/dither.ts](src/lib/dither.ts) is the mockup's ordered dither; `AgentTile`, `PixelBanner` and `Dither` draw on it, and `AgentAvatar` is the old name for `AgentTile`. Cells are canvas pixels scaled with `image-rendering: pixelated`, so the cell count is the resolution. Seeded from the id, so an agent looks the same every time.

**Default dark is the mockup's greys, written out, not derived.** `--bg #121213`, side `#0e0e0f`, surfaces white at 2.5 / 4.5 / 7%, lines at 6 / 9 / 14%, ink `#ececea / #a3a3a0 / #71716e / #4b4b49` sit in the `default`/dark block of App.css. The derived ramp landed within a few percent and a side-by-side check cannot forgive "within". Every other theme still derives.

**Default light is the same bargain, on warm paper.** The page is `--paper`, panels are pure white, and the card's step above the page is the whole of what separates them. The values sit in the `default`/light block, written out like the dark ones:

| Token | Light | Why |
|---|---|---|
| `--background`, `--paper` | `#f4f3ef` | the page, and the paper under a brand mark |
| `--surface-card` | `#ffffff` | panels, composer, menus |
| `--surface-raised` | `#ebeae5` | inset `<pre>` wells; sits *below* the page, since a light page can only be cut down into |
| `--muted`, `--surface-selected` | `#e9e8e3`, `#e6e5e0` | secondary fills; the selected row |
| `--side` | `#e6e5e0` | the sidebar, a step darker than the page |
| `--foreground`, `--ink` | `#1b1b1a` | body text, 15:1 on the page |
| `--ink2` | `#5c5c58` | secondary text, 6.1:1 |
| `--ink3` | `#66665f` | meta text the reader reads (a role, a count, a hint), 4.8:1. The mockup's `#8a8a85` measures 3.1:1 |
| `--ink4` | `#8f8f89` | tertiary: timestamps and group labels, about 3:1. Short of AA on purpose, since the mockup's `#b4b4ae` was 1.9:1. Placeholders and disabled controls are exempt |
| `--line`, `--line2`, `--line3` | black 7 / 10 / 16% | hairlines |
| `--s1`, `--s2`, `--s3` | black 2.5 / 4.5 / 7% | fills |
| `--amber`, `--green`, `--red`, `--blue` | `#a8741a`, `#2f8a58`, `#c0494c`, `#4a67d0` | darker than dark mode, so each is legible on white |
| `--on-signal` | `#ffffff` | ink on a signal fill (dark mode: `#111111`) |
| `--code-well` | black 4.5% | the well behind code and terminal output (dark: black 30%) |

Two rules came out of checking it on screen. Agent-coloured text goes through `inkTint`, which mixes toward `--foreground`, because `mixHex` toward white is a washout on paper. Pixel banners keep the agent's colour down to a dark tone (`bannerTones(color, "light")`), and their faces are drawn in ink, since a white face vanishes on a pale sky. `--side` is its own token (a darker step than the page) and the sidebar paints it at `--vibrancy-alpha`, so glass still shows through.

**Button, Switch, Segmented follow `.btn`, `.tog`, `.seg`.** `outline` is the plain `.btn` (faint fill, hairline inside); `solid` is the ink fill for the one action a screen is about; `ghost` is ink2 text that lights on hover; `bad` (and `destructive`) is red words on a red wash, never a red fill. Default size is 30 tall and `sm` 26. A Switch is a 30x18 pill that goes **green** when on, the signal colour for "running". `ui/segmented` is a radio group, arrows move the choice, one Tab stop. `fieldClassName` is `.fld` for the new screens; the older `Input` box stays where it is.

**The sidebar is the mockup's, in this order.** Workspace switcher (logo, name, "N agents · M working"), Jump to (opens ⌘K), Inbox with a count, Routines, Pull requests, Plugins, Channels, Agents, then you. An agent row is face, name, role, and one right-hand mark by priority: **Working** chip in its colour, **Needs you** in amber, a blue unread dot, else the time. The second line shimmers while it works. The status menu hangs off your card (Available, Focus, Away, then Profile, Settings) and opens upward. Usage left the nav, since the mockup puts it in settings.

**Workspace logo and your face are the same two choices**: a generated dither tile or an uploaded image. Picking a face clears a photo; picking *Generate* clears a logo. Delete is a typed confirm and is disabled, with its reason in the row, when it is the only workspace.

[demo-studio.html](demo-studio.html) renders every primitive in both sheet homes.

## Window, chrome and the radius scale

**Older surfaces keep the `--radius` scale until they are rebuilt.** One scale from `--radius: 0.625rem` in [App.css](src/App.css): composer card + drop overlay `rounded-2xl`, dialogs + cards `rounded-xl`, menus + buttons `rounded-lg`, menu items + small tiles `rounded-md`. `Button`'s `size` variants already carry right rung — `icon-sm` = `rounded-[min(var(--radius-md),12px)]` — so **icon button need no radius class at all**, and `rounded-full` on one make it single circle in row of squares.

**Filled button carry shadow; chrome don't.** `--shadow-button` = `0 1px 4px` straight down, no spread, on `default` variant only — on dark palette filled button and its background = two flat fields, so without it only thing saying "button" is fill. x offset zero deliberately: horizontal offset read as light source rest of app don't have. `ghost` and `outline` stay flat.

**Shortcut belong in real tooltip, not on `title`.** System tooltip can't hold keycap and look like OS not app. Use `Tooltip`/`TooltipContent` with `Kbd`/`KbdGroup` (see `ModelSelector`, `ComposerToolbar`), put plain name on `aria-label`. Reserve `title` for text app is _truncating_ — shortened path, clipped name — where tooltip restore information layout removed, not add information reader already have.

**Window is glass, and body's fill = only hole in it.** Vibrancy set in [tauri.conf.json](src-tauri/tauri.conf.json), not Rust: `windowEffects.effects: ["sidebar"]` put NSVisualEffectView behind webview, `transparent: true` let webview show it. Second flag drag `macOSPrivateApi: true` and `macos-private-api` Cargo feature with it, costing App Store eligibility hz never wanted. Effect whole-window, so material picked for blur amount only; tint = ours.

Feature arrive late, so **first `pnpm tauri dev` after turning this on need manual restart** — CLI patch `Cargo.toml` when it read new config, but already-spawned app predate relinked binary, and `transparent` compile out entirely without feature. Read as "vibrancy don't work", not as stale build.

Only body punch through, and that work because nothing else paint edge to edge: sidebar carry no fill of own, and right panel's `--sidebar` = `--background` under another name, so it must go **transparent** rather than tint same pixels twice (two 62% layers = 86% one). Alpha on `--vibrancy-alpha` = whole dial.

Two placement facts, both failure looking like taste. Attribute stamped on `<html>` in [index.html](index.html)'s pre-paint script, not on mount — React land frame or two in, long enough to watch app open opaque and turn to glass — and gated on macOS. Rule itself live on **`body`**: palette blocks (`[data-theme][data-mode]`) out-specify any `html[data-vibrancy]` selector, so `--sidebar` override on `:root` silently lose.

**Fullscreen drop it, in CSS alone.** Nothing behind fullscreen window but space's own black, so material go flat grey and read as theme washing out. [useGlass](src/hooks/useGlass.ts) take `fullscreen` off `useFullscreen` and remove attribute. Native effect left applied: invisible under body's own fill, and clearing it need Rust round trip on every resize to buy nothing. What dropping it now cost = only *what* surfaces layer over, see below.

**Window drag need permission _and_ `deep`, and both fail silently.** `titleBarStyle: "Overlay"` mean app draw own titlebar, so `h-(--titlebar-h)` row in `App`, `Sidebar` and `RightPanel` = whole of what user can drag by.

Permission first: `core:default` grant `allow-internal-toggle-maximize` but **not** `core:window:allow-start-dragging`, so it named explicitly in [capabilities/default.json](src-tauri/capabilities/default.json). Without it ACL reject every `start_dragging` call and report nothing — drag do nothing while double-click-to-maximize keep working, reading as "drag region wrong" not "permission missing". Capability compiled into binary, so change need Rust rebuild; frontend HMR show old behaviour.

Then value: bare `data-tauri-drag-region` = **self only**, drag start only where pointer hit that exact element ([drag.js](https://github.com/tauri-apps/tauri) walk composed path), so every label inside row = dead strip in titlebar that look uniform. Use `"deep"` on row and put attribute nowhere else — Tauri stop walk at any clickable element (`A`, `BUTTON`, `INPUT`, `role`, `tabindex`) carrying no attribute of own, so toggles and tabs block on their own and need no opt-out. `="false"` = hard block, for element that must not drag though nothing clickable in it.

## Transparency, and what surfaces sit on

**Vibrancy = macOS flavour of transparency, not second one.** Everything above describe one way of answering "what is behind these surfaces", and it only ever had one answer: the desktop. That answer die in fullscreen, and outside macOS never existed — so app went flat in both, which read as theme washing out rather than as effect.

Second answer = **colour theme own**. `--backdrop-top`/`--backdrop-bottom` what body paint edge to edge. Windowed on macOS they tint real desktop (`color-mix` at `--vibrancy-alpha`), everywhere else they *are* what surfaces sit on. Same layered look, no OS involved.

**Windowed always translucent, and fullscreen answered by theme not by reader.** Windowed there a desktop behind window and nothing to decide. Fullscreen have nothing behind it, so whether surfaces still worth layering depend entirely on whether *that theme's backdrop* worth layering over — fact about palette, not taste about window. So `flatInFullscreen` sit on theme and setting went away. It shipped as switch for about an hour: it ask reader question belonging to theme, in dialog, about state they not in.

**Light always flat in fullscreen, and mode outrank theme there.** Light palette's veil = *black*, and windowed that read as depth because desktop genuinely showing through it. Fullscreen nothing behind, so same veil = grey smudge on light page — and light palette have far less room below its page colour than dark one have above its own, so smudge is all it can be. `keepsGlassInFullscreen` therefore take mode and theme, weighed in that order, and it one function so rule testable in one place. Still not setting: this fact about palette, same as `flatInFullscreen`.

Field = **opt-out**, and shape is rule: theme keep layering by saying nothing, so forgetting give theme that look right rather than one going flat with no clue why. **Every shipped theme now opt out**, so default it opt out of currently used by nothing — reasoning that started as Default's alone hold for all of them, since with nothing behind fullscreen window veils sit on theme's own backdrop and cost contrast without buying depth. Field kept rather than folded into predicate: backdrop worth layering over = fact about palette, and future one may have it.

**Two stops, never one colour, and flat theme = gradient whose end agree.** One code path for both, so `body` never ask which kind of backdrop it hold. Every shipped theme flat today — both stop fall back to `--background` — so machinery currently carry no gradient. Kept anyway, because rule for one that want gradient already established and hard-won: stops must share **exactly** one lightness and differ in hue alone. Gradient carrying lightness ramp read as top of window being lit, not as depth, and that true whatever the hues.

**Vibrancy selector carry `[data-transparency]`, and that where two-veils question get answered.** Token set = *same declarations* vibrancy block already carried, so both on set each token once rather than veil a veil. Gate cannot fail today — `useGlass` only add vibrancy while windowed, where transparency unconditional — and written down anyway: rule holding because of a hook = one edit from not holding.

**Third one for surface cut *into* another: `--surface-well`, black scrim in both mode.** Segmented control's track, and anything else reading as recess. Not `--surface-raised`: that go white veil on glass, so track built from it come out *lighter* than menu round it and recess read as raised strip. Nothing above floating surface can be described by adding light to it. Thumb riding in it take `--surface-well`'s companion `--surface-thumb` plus `--shadow-button` — it have to come up *past* surface menu drawn at, since thumb at menu's own colour only as visible as scrim under it deep, and deepening scrim to fix that darken whole control instead. `--accent` there = few percent of light over scrim, which read as nothing. Mixed off `--surface-card` not named outright, so ported palette get one without declaring it; light mode take card itself, having nowhere lighter to go.

**Two kind of veil, and which one a surface take = whether it sit *in* page or float *over* it.** `--card` take `--veil-card`, 5.5% white — page plus a little light, which is what raised mean for surface in page. `--popover` and `--composer` take `--veil-float`, wash of own colour: white veil on floating surface composite onto backdrop and leave page with their text on top. Both were opaque fill once, each for own reason (composer hide handoff row, alert land on unfilled sidebar), and **both reason fixed at source** rather than worked round — handoff row clip itself now, and blur make alert readable. Nothing excluded from veil today.

**Float veil have to go low, and blur = what pay for it.** Card transmit ~95% of what behind it; menu sit over backdrop already at 80%, so wash at 86% put ~3% of desktop through and read as slab. 62% (74% light) put ~8% through, which look like glass — and only readable because every floating frame carry `backdrop-blur-xl`. Blur cost nothing where surface opaque: no backdrop left to sample. Drop blur and transcript show between menu's own words.

**Background belong to theme, and separate axis for it was tried and removed.** Picker choosing backdrop apart from palette cannot reach `--composer` — that one must stay opaque fill — so neutral palette on tinted backdrop put grey slab along bottom edge of window, permanently. Reaching it mean backdrop axis overriding palette token, at which point two axes not independent and only thing justifying split gone. Tell was that Slate didn't have bug: it declare own `--composer`.

**Two ways to write theme, one place they meet.** Derived one = `--hue` + `--chroma`: fixed lightness per rung times per-step multiplier, so theme that is one hue cost two numbers. `--chroma: 0` collapse every `calc()`, which is why Default stay exactly greys it always was (verified: identical pixels before and after). Multipliers taper at both end — chroma reading as colour at `--card` read as *fault* on near-white foreground. **Ported theme not one hue**, so it name its rungs outright instead. Both route end at same alias, and alias = what keep either honest: `--card`, `--popover` and `--composer` all `var(--surface-card)`, so theme cannot set one and forget another. Not hypothetical — earlier pass put grey composer on tinted page exactly that way.

**Ported theme take surfaces and text accents, and stop there.** Catppuccin, Gruvbox, One Dark Pro and Cobalt2 name their own background, card, muted, foreground, ring, and the three accents that mark words in prose (`--accent-command`, `--accent-mention`, `--accent-thinking`) plus their own red. `--accent-merge` **not** among them: that button act on GitHub, and matching colour it have there = most of what make it recognisable as same button, so colour is the meaning and theme don't get to repaint it. Border likewise stay mode ramp's — `oklch(1 0 0 / 10%)` and its black twin work over any palette, where ported hex would have to be re-picked per theme to say same thing. Credit live in root [README](../../README.md), and test fail if ported theme ship without one.

**Third-party widget taking its own `theme` need telling too.** `thinking-orbs` resolve `auto` off `data-theme="dark|light"`, and this app stamp *palette* name there with mode on `data-mode` — so `auto` never work here and every orb was pinned `theme="dark"`, true right up until light mode. [Orb](src/components/Orb.tsx) = wrapper feeding it `resolvedMode`, and it exist so reason live once: six call site had copied pin along with element, and seventh would have too.

**No hardcoded `oklch(1 0 0 / N%)` in a component, ever again.** Composer card, picker frame, attachment tile and picker highlight all carried white inline, written back when dark was only mode — and every one vanished in light, silently. Highlight worst: row arrow key sat on simply stopped being marked. Cure = token that flip with mode. `--veil-*` for fill, `--hairline`/`--hairline-strong` for edge (6%/8%), `--border` for 10%. Reach for one of those; inline alpha = same bug again.

**Light veil not same percentage as dark one.** Same alpha move fewer perceptual step over near-white page than over near-black. Measured on picker's own highlight: 8% black gave 19 level of separation where dark's 11.5% white give 28, so light `--veil-strong` = 10%. Pair tuned, never mirrored.

**Light mode = second palette, never filter.** Rungs *reorder*, not flip. Catppuccin show it plainest — Latte's `base` = its lightest token while Mocha's = near its darkest. `--surface-raised` reorder hardest: its job = read as cut *into* page, every use being `<pre>` of tool argument or output, and only direction reading as inset on near-white page = down — so dark put it between background and card, light put it **below background**, far side of it from card. Accents move long way down in lightness too, since 0.82 yellow on white page = highlighter mark not word.

**Filled button take `--button-primary`, not `--primary`, and Default light = only palette where two differ.** Every other palette alias one to other, so nothing there change. That one make `--primary` a real blue, and blue read as app's *mark* on Send and as noise under every other filled button — Confirm on a row, Merge, notice's Answer, none of them the loudest thing on their row. So button take light ramp's own primary (L 0.28, page's near-black, carrying palette tint), and **Send alone override back to `bg-primary`**. Split live in token not in per-button class: one class per filled button = same colour re-decided at each call site, and next one get it wrong.

**Veil direction = what surface *mean*, not what mode it in.** Veil saying "raised" go white in both mode; one saying "inset or highlighted" go black in both. `--surface-well` already worked that way and this = same reading applied to rest: `--veil-card` white (5.5% dark, **60% light**), `--veil-raised` and `--veil-strong` black in light.

Black card was tried first, on reasoning that white veil over light page is invisible. True of dark's 5.5%, wrong conclusion: light page want not *different colour* of veil but far more of same one. At 4% black card came out darker than page it sit on, which read as well not card — and it disagree with app's own flat drawing of itself, since light always go flat in fullscreen and card there = `--surface-card`, pure white. Windowed and fullscreen looked like two product. 60% white = card white with backdrop faintly through it, same sentence dark's veil say.

**Theme without light palette say so, and row stay drawn.** `darkOnly` = opt-out like `flatInFullscreen`, so ported theme arrive with both by saying nothing. **Nothing set it today** — Default was last, and its light side built. Machinery stay because case it cover real and silent: palette with no light block match nothing, so app fall through to light ramp's own neutrals — legible, not theme anyone picked, nothing on screen saying why. Settings row therefore **disabled with reason**, not hidden — vanishing row read as setting app forgot, and sentence under it = only place reason can be said.

**Green = token, and it pair with `--destructive`.** `--accent-add` carry added line, open pull request, unread session; `--accent-merged` carry merged one. Both were Tailwind literal — `emerald-400` in transcript, `emerald-500` in panel and on sidebar rail, `purple-500` on merged glyph — and literal cannot flip with mode, so every green went from readable to invisible on light page (1.6:1 and 2.3:1 measured, against 4.5 coloured word want). Lightness matched to `--destructive` not to Tailwind step it replace: pair read side by side in diff, and one lighter than other read as emphasis nobody meant. Light green sit 0.02 *under* red, since WCAG weight green far above red and equal OKLCh lightness leave green the one falling short.

**Selected row = own token, and windowed must agree with fullscreen.** `--sidebar-accent` aliased `--muted` once, and that = bug worth naming: transparency block swap it for veil, flat one — every light window in fullscreen — keep falling back to `--muted`, so two drawing of app disagree about how hard a row is marked and every tune move one of them only. Now `--surface-selected` (mix toward `--foreground`) and `--veil-selected` (alpha) per ramp, chosen to composite to **same** colour — L 0.891 light, 0.271 dark. One token feed session row, both tab row, every list row in Changes/History/Files/PR/Issues, and the sidebar's subagent row; hover = `/50` of it, which is real case to size for.

**Shadow = light mode's only depth, and there two of them.** Dark carry `none` for both: surface there read as raised by being lighter than page, and shadow under it fall on something darker still. Light have no room left above near-white, so shadow = what say "above". `--shadow-surface` = **crisp**, blur no wider than offset it ride on, for surface floating at window edge (composer, secondary button); `--shadow-card` = lighter and softer, for one sitting *in* page (user bubble). Split read same way `--veil-card` and `--veil-float` split. Blur running 3–4× offset — what `shadow-md` and every elevation scale build from — spread into halo surface look *lit by* rather than edge it cast.

**`--secondary` reorder in light, like `--surface-raised` do.** Dark build second action by adding light to page; light have none left to add, so fill go other way and become **card colour** — palette's lightest surface, `--shadow-surface` under it doing separating. Grey fill on near-white page = what `disabled` already look like, and two thing saying one thing = whole reason it moved. `var(--surface-card)` not literal white, so Latte get its `base` and Gruvbox its `bg0_h`.

**Vibrancy alpha per mode, and macOS = why.** Material behind window follow **system** appearance, not `data-mode` — so light palette on Mac set to Dark composite over dark blur, and at dark's 80% the missing fifth dull whole page into grey no token name. Light take **92%**. Short of 100 deliberately: some desktop must survive or window stop being glass and veil have nothing to sit on.

**No `bg-clip-padding` on filled button.** Every button carry transparent 1px border so focus can colour it without moving anything; clipping fill to padding box let **page** show through that border as 1px rim of backdrop. Dark = near-black on near-black, invisible. Light = white, and split merge button show it worst — two transparent border meet between halves, so seam read as 2px white gap cut through green. Stay on `outline` alone, one variant drawing translucent border over fill and needing two kept apart.

**Opacity cannot hold a keycap back in both mode.** `opacity` fade group toward **page**, and cap's fill = veil running page's opposite way: dark move white toward black and box soften, light move black toward white and box survive every step down. Measured: fill-to-page contrast **1.12 in both** at `opacity-50`, so lowering number never close gap. Right-panel chord hint therefore `dark:opacity-50` — light take none, its cap already quieter than dark twin. Sidebar's own jump hint take other route, fading each cap against its **own** token (`bg-muted/40`), which reduce equally on both side.

**Mode = three segment, not switch.** System/Light/Dark. Switch can only ask light-or-dark, leaving `system` reachable from nowhere — and it the one that keep following OS after being set. Drawn off `mode` as *chosen*, never `resolvedMode`, since whole point of System = it read Dark today and Light tonight. Dark-only theme disable **whole group** rather than drop its light segment: two segment where there were three read as broken control, and `system` unofferable there anyway.

**`--sidebar` = `transparent` unconditionally now, not `--background` under another name.** Sidebar read as part of page, and honest way to say that = let page show through. Old way held only while every backdrop flat: against gradient, flat sidebar draw visible seam down window at x where two furthest apart.

## Transcript, cards and the right pane

`header` never drawn as a heading — chip-sized label model write alongside each question ("Indentation" over "Tabs or spaces?"), which read as heading for section that isn't there. It name the question's chip in the strip instead, where a label that short belong; no ACP elicitation carry one, so the strip read `Question 1`, `Question 2`. Card carry no border or fill either: choices have own.

**Settled `AskUserQuestion` row show only answer.** Its arguments = questions and options reader just answered on card, so `ToolCall` drop input body for it entirely. Its result keep no code box and lose mono font other results carry — it one tool result harness write as sentence not program output.

**Right pane = one frame with tabs, not one panel per view.** [RightPanel](src/components/RightPanel.tsx) own `<aside>`, border, tab row; `ChangesView`, `FilesView`, `BrowserPane` and `SubagentPanel` = bodies rendering inside it, carry no chrome. `AppShell` have single `panel` slot, so two self-framing panels could only ever be mutually exclusive with two booleans deciding it. Tab row `h-(--titlebar-h)` and carry drag region itself. No close button: `PanelToggle` and ⌘E both close it, matching ⌘B for sidebar. Toggle exported from `RightPanel` but rendered by `App`, because pane not exist before session do and button have to outlive it.

**Pane have two size, and the wide one = how a two-pane view fit in 512px.** Wide (⌘⌥E, or the button leading the row's far end) it take the column and the transcript go behind it; narrow it sit beside the transcript. Diff's file list and Files' tree want room a half-width pane not have, and the frame give it by taking the column rather than by squeezing the view — no second tab row in the titlebar, and the tabs stay put so Diff→Files need no trip through the chat. Wide, the pane drop its left border: nothing beside it to part from but the sidebar, which carry its own. Cost: the window header go with the column, so the session name off screen while wide — the pane's own row the only one left, and it carry the drag region.

**No z-index scale, and that a measurement rather than an oversight.** The app spends two values: `z-50` for what floats (dialogs, menus, tooltips, toasts, the notice stack) and `z-10` for what sits over its own surface (resize handles, in-card overlays). MonoCode names a ladder per layer, which pays for itself across fourteen of them; here it would be a module wrapping two classes at twenty-four call sites. The layering this app actually has to get right is the CEF view, which sits above the *whole* DOM — no `z-index` reaches it, which is why `judgeOcclusion` measures instead.

**Changes glyph = plain foreground, not command yellow.** Yellow = app's "this is for you", colour of session standing still behind question. Turn having touched file neither warning nor thing to answer. PR glyph keep its emerald: that one say state of work.

**Toggle double as changes indicator.** With pane closed and last turn having changed tree, it draw git glyph instead of panel one and its click open _diff_ tab not whichever tab last used — glyph opening something else = lie. ⌘E stay plain toggle: show nothing, so promise nothing. Signal = `turnChangedTree`, cost no git call — both sides of range content-addressed tree ids, so ids that differ _are_ changed tree. Reading panel's own file list instead not work: `useChanges` pause while hidden, exactly when indicator have to be right.

## Trace rows

**Four surfaces, one primitive.** [AgentTrace](src/components/chat/AgentTrace.tsx) draw the header and the body frame; live thinking ([WorkingIndicator](src/components/chat/WorkingIndicator.tsx)), committed reasoning ([Reasoning](src/components/chat/Reasoning.tsx)), a run of web lookups and a run of tool calls ([ToolGroupRow](src/components/chat/ToolGroupRow.tsx)) and a finished turn's steps ([TurnBlock](src/components/chat/TurnBlock.tsx)) are its call sites. Work the agent did on its way to an answer fold, settle and re-open the same way, so a reader who learn one have learn all four.

**Header carry the tense, body carry the work.** Same row say `Thinking` shimmering while it run and `Thought` once it land — no spinner-then-tick, no second line of chrome saying what the first one already said. Sparkle head it; the one exception is a run of web lookups, which take a globe because it the one trace that not work on the repository.

**It open itself while it the live edge, and close when it land.** Running step = only thing on screen saying what agent doing, so make reader click for it = ask them to know it there. Settled = scrollback, and scrollback that unfold itself push the answer they waiting for off bottom. Reader's own click win over both permanently — `manual` = tri-state, so `null` mean "following the work".

**Body rule = the trace, not decoration.** Rows sit behind a left border, which what make them read as one piece of work rather than an indented list; and they arrive staggered 60ms apart, capped at eight, so a trace read as work happening in order rather than as a block that appeared whole.

**Nothing behind the header = no chevron.** A trace with no rows draw as one plain line. Chevron pointing at empty box = control that answer nothing.

**And a caller that owns the folding owns the header.** `TurnBlock` withholds a collapsed stretch's rows rather than mounting them behind a clip, so `rows` arrive empty for a body that is very much there — and reading that as "nothing to reveal" drew a settled turn's summary as plain text with no control on it. A summary nothing can open: the only control was the button that branch declined to draw. An `onToggle` is the caller saying it has the rows.

**The rows sit `gap-0.5` apart, tight enough to read as one run.** They are single lines of work listed one after another, so every pixel of gap is a pixel the run stops reading as a run; the transcript's own leading is what keeps them apart. Six pixels measured as 25px rows and a 31px pitch, which read as a list of separate things.

**The answer is never inside the trace.** `finalText` is drawn under the summary, so `groupTurns` takes the row it stands for out of the work — one message, one place, collapsible or not. Kept in, opening a finished turn's summary swallowed the answer into the trace and left the turn with no ending on screen; and the summary line promised a message the collapse was not hiding. The row is named only where it can be: it must be the turn's trailing *rendered* row **and** its words must be the copy — either alone picks the wrong one, since a message the agent narrated an error in merely *contains* the sentence, and a matching message it went back to work after is its own statement.

## The band above the composer

**One thing lives there at a time.** While a turn is in flight the band is the **follow-up strip** — this turn's subagent runs and its plan. The moment the turn closes it is the **handoff peek** (Commit, Create PR) again. They never both draw, and that is not tidiness: they want the same 4px, and the peek only reads as *tucked behind* the composer when the composer is what it tucks behind. A slice of button top sitting above a strip is neither, and read as debris glued to the strip's corner.

**The strip = this turn, never background work.** A dev server outlive every turn by design, so holding the band for it would keep the peek away for the whole session. Background work already have a home: the transcript's own notice, which say how many outstanding wherever reader scrolled.

**The strip carry a surface**, `bg-composer` + the same blur every floating thing takes — it hover over transcript that scroll under it, where a card's flat veil would let the text read through the rows. Rows name three runs at most and fold the rest into one that open the panel: past three the list stop being a status line and start being the panel.

**Plan ring, not count alone.** `2/4` answer "how much left" only to somebody who remember total, and this line read at glance or not at all. Green once it close, muted while moving — same pair the sidebar rail use, same reason.

## PR panel

**Tab called `PR`, and it lead when PR is open.** Short form what anyone working on one call it. `tabOrder` put it first when session have **open** PR (draft count, being `OPEN` with `isDraft` set) — at that point session's work about landing, not about this turn. Merged or closed PR don't promote: it record, not something to act on.

Last turn changing tree **don't** enter into it. Changes describe one turn and superseded by next; PR = state of work. Toggle's own click still set tab to match glyph it drew, and that now only thing `handleTogglePanel` do.

**⌘⇧[ / ⌘⇧] step tab, and legend drawn not hidden.** Step over `tabs` (what `tabOrder` return) not `PANEL_TABS`, so session with no PR tab cycle two and never land on undrawn one. Keycaps sit **right after tabs**, no label, and refresh button take `ml-auto`. Three cap not four — `[ ]` = one key with two end. Deliberate exception to app's tooltip rule: chord for row of two or three tab = one nobody go looking for.

**Panel own no header strip.** PR count ride tab's own badge — same place subagent count sit — and refresh button belong to frame.

**Badge count leave merged PR out** (`prBadgeCount`). Every other state have something reader can still do — open one merge, draft go ready, **closed one reopen** — and merged one have nothing, so counting it inflate badge that exist to say how much still live. It stay in list either way: list = record, badge = workload.

**Single PR not collapsible, and draw no chevron.** Disclosure arrow that can only ever point down = affordance for nothing. Header become plain label rather than button, and lose hover fill with it.

**One refresh button, in tab row, owned by frame.** It mean same thing on every tab, so it sit in same place rather than once per panel; active tab decide what it re-read. Diff get none — it own its reads, and button that do nothing worse than no button. Both panel bodies therefore presentational and **their hooks live in `App`**: `useChanges` moved up beside `usePullRequest` for exactly this.

**Panel = list of collapsible row, same shape as changes panel.** Row zero open by default, and backend's sort what make that free: it already the open one. Each row carry `+A −D` from PR's own `additions`/`deletions`, same figures and colours changes panel use. Selector-chip version tried first and dropped: it made single-PR case carry control that couldn't be used, and hid every other PR's size behind a click.

**Comments and reviews = one timeline, oldest first.** Two lists on wire, but bot's reply to review only make sense next to it. Reviews carry node id not URL, so thread they belong to = closest honest link.

**Nesting drawn with rule, and nothing inside collapse.** Indent alone not enough — anything at body's own margin read as another comment — so nested column hang off `border-l` one indent in, avatar smaller and name muted. Second disclosure inside first = click to find out there was nothing to find. File comment lead with **file**, which what make one worth opening at all.

**Verdict, base and action = one row.** Verdict two words, base two more, button belong beside verdict it depend on rather than under it. `detail` only part still wrapping to own line, because it sentence and only appear when something wrong.

**Head branch not shown.** It session's own branch, named in window header two inches away. Base = half not on screen anywhere else, so `into main` alone — and it also what tell two PRs from one branch apart.

**Sections separated by space, not by rules.** Three horizontal lines across 32rem pane read as table of contents for page holding three short lists.

**Merge button green, and it GitHub's green not app's emerald.** `--accent-merge` = only place app use it. Primary fill on this palette near-white, which made **least reversible control on pane also brightest thing on it**; green what same button is on GitHub, so it recognisable before it read. No icon on it either — label already say "merge".

**Seam light, not dark, and blurred.** `--accent-merge-seam` = `inset 1px 0 1px oklch(1 0 0 / 10%)` — whole shadow in token rather than colour alone, so blur travel with it. Dark line on green fill read as gap **cut through** button where light one belong to it. 1px blur soften it from drawn rule into edge catching light.

**Split button = one rectangle with seam, not two buttons pushed together.** Radius and shadow belong to *pair*, so they sit on wrapper and each half drop its own (`shadow-none` in `MERGE_FILL`, wrapper carry `--shadow-button`). Seam itself = `inset 1px 0 0` on right half: border there would be line of third colour across single fill.

**Merge button never `disabled`.** Disabled button explain nothing and cannot be hovered for reason. It stay clickable at reduced strength and readiness line beside it = answer. Dim apply to *wrapper*, so both halves fade together.

**Check row take no hover fill.** It fact with link on it, not list item to pick from. Cursor still `pointer` where row have destination, and comment row carry one too — collapsed row give no other sign it open.

**Every comment collapsed, avatar in place of icon.** List where some row open and some closed read as accident not rule, so all start closed and first line of body (heading marks stripped) stand in for rest. Verdict carried by **coloured word** in closed row — `approved`, `requested changes` — so one thing worth knowing already there. Author's picture replace icon that used to sit there: it say *who* in same space, where column of identical speech bubbles said nothing. Comment rows sit in `gap-2` column where check rows don't: checks = dense column of one-line facts, comments = separate things people said. Check row keep state glyph **and** take avatar second — state why anyone look at list, so it keep left edge. Avatar fall back to initial and cover it on load, so slow or missing image never leave hole.

Glyph sit **beside rail, ahead of title**, and take **no room when absent** — unlike rail next to it, which hold its slot. Two differ because rail come and go on *same* row as agent work, where branch either have PR or don't: row that never get one would otherwise pay for mark forever. Rail keep outer edge, since it "over to you" and clear when reader deal with it, where this standing fact about branch. Emerald for open, muted `GitPullRequestDraft` for draft, since draft = work not asking to land yet. `title` attribute rather than tooltip: decoration on row that itself a control, and tooltip open every time cursor cross list.

**Toggle's PR glyph count draft, and draw draft's own shape.** `hasOpenPr` = any `state === "OPEN"`, which draft satisfy. `draft` prop true only where **every** open PR is one — session carrying draft beside real PR have something asking to land. Glyph keep emerald either way: shape carry distinction, colour carry "there is something here".

**Panel toggle draw PR over changes.** Two indicators = same promise, so only one can be drawn and PR win: it tab that open first, it state of *work* rather than of last turn, and it survive next prompt landing where changes mark don't. Glyph = **`text-emerald-500`, not `--accent-merge`**: that token is button *fill*, dark enough to carry white text, and at 1.5px stroke on dark background it all but disappeared.

**Collapsed preview = plain text, so markup come off first.** `firstLine` strip heading marks, emphasis, and link syntax keeping only its text — `(https://…)` half usually longer than words around it and not clickable in truncating span anyway.

**The pane reads what it is, then what it changed, then what was said.** Checks sit where they always did — directly under readiness — because they are the thing that changes on its own. Below them: the description, the files, the commits, the conversation. The description is drawn now, having been deliberately left out when this pane was a list of *states*: it is the longest thing on a pull request and it pushed the checks below the fold, but read against the files and the commits it is the only part that says *why* any of them changed, and it has somewhere to sit that is not in the way of the checks.

**A commit's name and its account are two fields.** A commit always carries the name git was configured with and only sometimes resolves to a GitHub account, so a row draws the name where it has no account and the face where it has one — the fallback is not decoration, it is the difference between a blank row and a named one. **The files keep the whole path in one truncating span**, which is the right panel's rule rather than the repo view's: this list is read for which directory a change landed in as much as for the file, so the filename does not win the truncation here.

**A bot comment is rendered as markdown, and its markers come off first.** A Vercel comment carry a table of deploy links, and flattened to text it wall of pipe characters. `stripBotMarkers` drop the `[vc]: #<base64>` line and HTML comments before that — both addressed to GitHub rather than to reader. The body used to be left out for the reason the entry above records and no longer holds.

**Table cell wrap `anywhere`, and that fix belong to [Markdown](src/components/chat/Markdown.tsx) not to panel.** Streamdown table = `w-full` under `overflow-x-auto` wrapper, so cell that can't break set table's width: one file path in bot's "Files Changed" table pushed every other column off pane. `anywhere` not `break-word` — only `anywhere` shrink cell's *min-content* width, which what auto layout measure. Header cell need its `whitespace-nowrap` lifted first, or rule dead there. Cell also `align-top`. Wrapper keep own scroll for table genuinely wide.

## The inbox

**A reading pane, one decision at a time**, from the mockup's `inbox.js`. Left, a 340px list: faces with a 15px kind glyph on the corner (amber shield, blue question, grey at, green check once settled), a two-line row, time at the right edge, a settled row dimmed to 60% on its face. Right, a 640px reader that is a column and not a card: who and what they want, a kind pill tinted at 12%, a 24px title, a quiet sub line, the context (a command in mono on `--s1`, post cards, choices as full-width rows with a numbered key chip, a quote), the *why* line with a lock, and a collapsed **How it got here** on a hairline rule. The action bar under it is the one place a decision is made: the solid button is the yes, a red wash is the no and sits far right, and the letter each answers to is drawn on it.

**The motion is the feedback.** The reader slides up on arrival (`read-in`), fades up and out when decided (`read-out`), and a 52px check in the verdict's colour pops in its place (`settle`) for a beat before the next item comes up. No spinner, no modal. Undo that cannot happen is drawn disabled with "Already sent", not hidden.

**Zero is a state with the team in it**: five overlapping faces, "You're all caught up", the day's count and a pill per agent.

## The pull-requests list

**Two lines, and the split is the sort.** Title on the first, with the three facts about the *change* beside it — the verdict on it, whether CI is still going, its size — because those are what the reader is choosing between. Who wrote it, which branch it came from and when it moved drop to the second: context for a row already chosen, and on the first line they compete with the titles.

**A card, not a bordered row.** The list is the whole column here, so a rule between every pair turns fifty rows into a table. The pick and the hover are `--surface-selected`, the one token every other list marks a row with.

**A running check is the sidebar's own arc, and a failing one draws nothing new.** `PrStateIcon` already recolours the state glyph for a failure, so a second mark would say one fact twice; the dashed arc at the same 3s turn says the other. Passing draws nothing in both places.

**A conflict is a word in the meta line.** Red-green is the difference this palette can least afford to make load-bearing, and a row that cannot land should say so where the eye already is. One word rather than the base branch: the meta line has four other things to hold, and which branch is the detail pane's answer.

**Approval is a glyph and a change request is a word.** "Review required" is the *absence* of a verdict, so a row saying it spends the scarce end of the line on nothing. The glyph is the one somebody actually gave; the word is the one the reader has to act on.

**The external link is revealed by the row's hover and its box is reserved either way** — the bargain the list rows made, or a control appearing under the cursor moves the line that revealed it.

**A read with nothing behind it draws the rows, not a spinner.** Bars built from the real row's own boxes, in `em` against `text-ui`, the same pairing the providers list makes: a lone arc over an empty pane reads as the page having failed to draw.

**The header is a search box and three buttons, and no segment groups.** It used to carry six words of pills for state and involvement — the widest chrome on the page for two choices, spending the row the search is typed into. A narrowing is a menu, and the two that change most are the first two items in it.

**A submenu names the value it is set to, on the trigger.** That is the whole reason the menu is built from submenus rather than a flat column: a short list whose reason is one popup deep is a list that looks broken, and `Open ‹` on the closed Filters row says what happened without opening anything.

**The trigger counts what is off its default, and the count has a cure.** The badge is a promise about why the list is short; a number with no way to reset it is the reader unticking four submenus, so `Clear filters` is the last item in that menu whenever the count is above zero.

**Sort says `Sort`, not the order it is on.** The button sits in a row of four and the one thing the reader needs from it is what pressing it does. Which order is live is one press away, drawn with a tick.

**Refresh is a glyph, and it spins rather than going disabled.** It means the same thing every time it is pressed, so a word would take width the search is not getting; and a read that lands in under a frame otherwise looks like a press that missed.

## Repo view and diffs

**History open in place, and nothing open on arrival.** Not drill-in, not third column: column leave diff narrowest of three, drill-in hide history behind whichever commit open. Row expand under itself instead. Follow from that: **no default selection** — first commit touching thirty file would push rest of history off screen. Click open, click again close. **No chevron**: row = control, highlight say which open, second click prove it. Commit's *first file* selected on open, which is different question and safe, since file list already bounded by commit reader chose.

**Commit message live above diff, not in list.** History row hold subject alone, so commit whose reasoning in its body read as headline. Body drawn once, on diff's side: list = for *finding* commit, message = for reading one already found. Clamped to two line, or message push diff below fold; expanded it simply grow — scrollbox inside pane make reader ask twice for rest. "Show more" appear only when two line genuinely don't hold body — **measured** (`scrollHeight` vs `clientHeight`, `ResizeObserver`), since that depend on pane width. Measure only while collapsed: expanded element its own full height, report no overflow, and would retire button that collapse it back. Short sha ride subject's row — only fact about commit nowhere else in window. Card keyed on sha, so next commit arrive collapsed.

**Filename win the truncation.** One `truncate` span holding `dir + name` clip from *end*, which = filename — exact opposite of intent. So name draw first and `shrink-0`, directory after it and truncating. Right panel's rows keep old order for now.

**Toggle draw both option, not one glyph that swap.** Swapping glyph read as *picture of current state* — nothing about it say it can be pressed, and split/unified not convention reader arrive expecting.

**Channel between split halves = reserved scrollbar gutter, not gap.** Each column own horizontally-scrolling box carrying `scrollbar-gutter: stable`, so WebKit reserve classic scrollbar's width at its **inline end** — even though library zero that scrollbar (`::-webkit-scrollbar { width: 0 }`) and only ever *measure* horizontal one. Leave strip of dead background down right of each column, and make two look lopsided: left inset = library's own spacing, right = this. No variable expose it, so `unsafeCSS` (library's own escape hatch, inject into `@layer unsafe` = last in its layer order, so no `!important` needed) carry `[data-code] { scrollbar-gutter: auto; }`. Nothing lost: gutter only ever reserve room for scrollbar drawn at zero width. **Don't reach for `--diffs-gap-inline` here** — that inset "N unmodified lines" bar only, so tightening it shrink bar and leave channel.

**Library spacing dialled down from outside, through its shadow root.** `--diffs-gap-block` (8px padding above/below code) and `--diffs-gap-style` (2px rule between gutter and code, which in split view draw channel down middle wide enough to read as two halve drifting apart) both read *inside* shadow DOM with those name — and custom property cross that boundary, so setting them on any ancestor = whole override. `DIFF_SPACING` in [DiffPane](src/components/changes/DiffPane.tsx). Pane itself carry no padding either: its border = frame.

**History drill in, not third column.** Window can't hold commit list, file list *and* split diff without diff becoming narrowest of three. Selecting commit replace list with its files under back-header; selection kept on step back, so long history don't lose reader's place.

## Worktree notice and confirm dialog

**Two ways in, and shape follow who asked.** Settle raise **notice**, settled bar's button raise **dialog**. Settling, reader doing something else and being *offered* something, so safe answer must cost zero click: card expire into "keep it" after 15s and therefore carry no Keep button, since doing nothing already is keeping. Pressing "Delete worktree" = reader asking, and they owed confirm naming cost. Both read copy from [worktree.ts](src/lib/worktree.ts), so two route cannot drift into describing same deletion differently.

Notice = first `NoticeKind` raised by reader's own click rather than by something off screen, and first whose button **destroy** rather than navigate. Three thing follow.

**Action lead, subject ride beside it.** Card arrive unasked-for while reader doing something else, so first thing read = what it *want*, not what happened. `label` = `Delete worktree?`, `subject` = task's title muted **on same line**, `detail` = what survive and what don't. Leading with `Settled <task>` read as receipt, and receipt = thing you look away from; task on own third line made two heading-weight line read as two thing to deal with.

Task named by own **title** not by generated worktree name — `calm-navy-beacon` name directory reader never chose. Action `shrink-0` and title = half that give way; `title` attribute restore what clip took.

It only card with **two** button. Skip = answer card give itself when bar run out, so it there to be *said* rather than waited for — answer you can only give by waiting is one you cannot give.

**Tooltip holding only keycap need own left padding.** `TooltipContent` tighten `pr-1.5` when kbd present but leave `pl-3`, so tooltip that *only* cap sit visibly off-centre. Fixed in component not at call site: `has-[>[data-slot=kbd]:first-child]:pl-1.5` (and same for `kbd-group`).

**Accelerator in tooltip here, not in button.** Rest of stack draw keycap inline, which read fine on card holding one button and badly on this one holding two: row grow wider than sentence above it. So `WithShortcut` wrap each button in tooltip carrying cap. Empty `keys` render **no tooltip at all** rather than empty one: only top card answer to keys, and elsewhere tooltip would repeat button's own visible label back.

Dialog get **no** such confirmation: it close, and enough else on screen already say so.

**Neither route wait on git.** Unlock, remove, `branch -D` = three command over directory that can be large, and both surface used to sit through them — dialog unchanged, card spinning "Deleting…". Press now start work and answer straight away: dialog close, card go to its **Deleted** state. Reversal deliberate. Spinner said "still going" and nothing else, and dialog holding still through it read as click that missed.

**"Deleted" therefore optimistic, and card exist to take it back.** `worktree-failed`, raised whatever window doing (like `pr`, opposite reason — reader already seen wrong answer). Detail = backend's own sentence, only thing saying which step stopped.

**Label name operation, never outcome** — `Worktree cleanup failed`, not "not deleted". Removal = run of step and any can answer: git refusing leave directory, but index write come **last**, so failure there = tree already gone and session simply never moved off it. Which step reached not reported, so copy claiming state of disk wrong roughly half the time.

Button = `View`, and it lead somewhere real for same reason: last step = one clearing index entry, so cleanup that stop anywhere leave settled bar still carrying its Delete worktree button. Reason on card, rest of run at end of button. Bar take destructive colour offer wore — same deletion, only place reader learn it stopped part way.

**Card follow who asked, not what happened.** Worktree already gone skip question either way — nothing left to weigh — but settle's own pass raise nothing on failure (nothing drawn, nothing promised, session pointed at missing directory before it ran) where **button press still report**: reader watched that dialog close, so silence there = click with nothing to show for it, which whole thing this section exist to remove.

Error banner cannot carry any of this and that not preference: banner draw above **composer**, settled session draw settled bar instead, so one state this reachable from = one state banner not on screen in.

Failure inside session **delete** stay quiet, deliberately: card keyed to session about to stop existing, whose button lead nowhere. Naming orphaned path with no session behind it = channel of its own.

Card name its subject — it and `worktree-failed` the only two that do — breaking `NoticeStack`'s own "verb and nothing else" rule on purpose — several card can stack, and "Settled" alone say nothing about which settle it answer for. Detail line say "its worktree", which reach directory through thing that own it. Title run to 60 char and card `w-fit`, so it capped and truncated with `title` attribute restoring rest. Dialog keep worktree name instead: it open from settled bar, where title already two inches away in header.

**Counts _are_ warning, so dialog one step not two.** Sidebar's delete and PR panel's merge take second confirm precisely because they carry no such detail; adding one here make reader confirm sentence they already read. Destructive fill only where something actually lost — on clean tree this tidying up, and red make safe answer look like dangerous one.

**Alert = `--popover`, not `--card`, and that vibrancy fix not taste.** Two token same colour with opaque page under them, so swap change nothing until glass on. There `--card` become 5.5% white veil — right for surface sitting *in* page, wrong for one floating over it. Alert land on sidebar, which have no fill under vibrancy, so white veil composite straight onto window material and leave text washed out. Was opaque fill for that reason until frame gained `backdrop-blur`; float veil plus blur read as surface where veil alone did not. Applies to `Alert` in general, not just worktree one.

**Destructive confirm sit rightmost and take solid red.** `AlertDialogFooter` = `sm:flex-row sm:justify-end`, so source order = screen order — confirm must come **after** `AlertDialogCancel` in markup or it land on left. `destructive` prop on `AlertDialogAction` carry solid fill, not button's own `destructive` variant: that one a tint, for control sitting among others, where this the one thing in dialog that do something. Prop caller's to set — both dialog today destructive, but red default quietly colour first one that isn't.

## Settings

**Full window, and it stays a dialog underneath.** The shell is `DialogContent` with every half of the frame turned off — no centring, radius, border, fill, blur or shadow — and that is deliberate rather than lazy: a settings *page* still has to trap focus, block the app behind it, close on Escape and, the load-bearing one, put a `[data-slot$="-overlay"]` over the native browser view. `judgeOcclusion` measures that overlay to decide whether the browser tab has to be hidden, so a full-window surface built any other way is a surface the CEF view draws straight over.

**Setting owns the window because the card ran out of room.** Six groups in a 34rem dialog were already wrapping their tab row to a second line, and the tallest ones — Shortcuts, the model list — scrolled inside a fixed 32rem box. What the card was buying (the app visible behind, so the reader keeps their place) is worth less than what it cost, and ⌘, is a toggle now for exactly that reason: the chord that opened this is the first one somebody presses to get back, and Escape is a hint nobody sees until they try it.

**Overlay goes transparent, and it is a prop on the primitive.** A dim behind a surface that fills the window dims the surface: the rail's own region is the window's left edge, and `bg-black/50` under a page that paints over it leaks at the edges and darkens the whole left column. The element stays either way — it is the occlusion signal — so only its colour changes.

**It arrives on one frame — no fade, no zoom — and that is a fix, not taste.** A card can afford to fade: the reader keeps the app behind it, dimmed, and the card lands over it. A surface that replaces the window cannot. A fade from zero opacity *is* the app showing through it, so the settings page came up as a ghost of the transcript with the window's own header over it for about a hundred milliseconds, and closing faded it back the same way. Measured, not guessed: opacity 0.11 → 1.0 across ~100ms, every frame wrong. So `DialogContent` gained **`animated`** (default true) and this passes `false`.

**Overriding motion with a later class does not work, and that is why it is a prop.** `data-closed:animate-none` beside the primitive's `data-closed:animate-out` leaves both declarations in the stylesheet, and the winner is whichever Tailwind emits last — which is *not* the same answer for both states: measured, `animate-none` beats `animate-in` and `animate-out` beats `animate-none`. Leaving the class off at the source is the only version of it that cannot drift.

**The surface paints everything it covers — rail, drag row and pane alike — and the first pass did not.** It left the rail see-through so the window kept its glass down that edge, which is right for the app's own sidebar and wrong here: behind a full-window surface is the app, so the session sidebar came up through the rail and the window's own "New session" header came up through the drag row. **Hiding the sidebar only fixed the steady state.** On the frame it opened, the reader still caught both lists drawn over each other for a moment: a subtree hidden with `visibility` keeps its boxes and layers, so an engine may paint it one frame late, and `display` — which cannot be painted late — costs the column's scroll position on every trip into settings. An opaque surface has nothing behind it to paint late, whichever engine and whenever the commit lands. What it costs is the glass: while settings is up the window is one flat page, which is what a settings window is on this platform anyway.

**Rail down the left, pane beside it, and the rail is the app's sidebar in another dress.** Icons per group because a word list the reader scans for one thing gives every entry the same weight; the selected row takes `--surface-selected`, the same token as a lit session or a lit file. **The rail is transparent and the pane paints `--background`** — the app's own split, so the window keeps its glass down one edge instead of going flat the moment settings opens. A drag row of `h-(--titlebar-h)` with `data-tauri-drag-region="deep"` sits above both, and it is not optional: this surface covers the app's own strip, and a window with nothing to drag by cannot be moved.

**The section's name lives in the pane, inside the capped column, beside the rows it names.** Not only in the rail: a pane that starts mid-sentence makes the reader check the rail to know where they are. Not at the pane's edge either — heading and rows starting at two different places read as two blocks, which is what the first pass did with a centred `max-w-2xl` under a left-pinned `<h2>`. The cap is the transcript's own measure, because a row is a label and a control that want an edge to sit against, and the same row spread across a 1400px window leaves the control a page away from the sentence explaining it. The pane's scroll box is **keyed on the section**, or a reader who scrolled Shortcuts lands in About past its heading.

**Vertical tab list, so the keyboard promise is the vertical one** — Up/Down, Home/End, one Tab stop, `aria-orientation` telling a screen reader which. Same `useRovingGroup` the swatches and the mode segments use; a horizontal strip here would promise keys that do nothing.

**Gear in sidebar's titlebar strip, and it move in fullscreen.** Strip `justify-end` normally to clear traffic lights, `justify-start` in fullscreen where they gone. Sidebar toggle **also** drawn in app header when sidebar collapsed, so it must hold strip's outer edge in both layout and never change which end it at; gear have no second home, so gear = the one that move. Settings sit in that strip rather than filter row below, because every control in that row scope list under it and these app-wide.

**Row = label and reason left, control right** (`SettingRow`), **except where control wider than a switch — then it go under label, full width** (`stacked`). Beside-the-label take its width out of description, which then wrap to three ragged line and leave orphan, and dialog read as set of row that don't fit rather than list of setting. Under = also where picker want to be: option ranged along one edge, not pushed against far one. Description **not optional except where control show answer instead of telling it** — see theme row below; everywhere else it where "why is this off by default" live, and row with bare label make reader guess.

**Once wider than `Dialog`'s own default for prose; now the window.** The line that mattered was never the number — it was that the default is sized for a question and two buttons, and this holds sentences. Setting that cannot apply on this platform **disabled, not hidden**: row that vanish read as setting app forgot, and sentence under it = only place reason can be said.

**Switch one rung up from composer's own toggle** — `h-4 w-7` against its `h-3 w-5`. There track sit inside toolbar button among other 12px chrome; here it thing being pressed and have to take click on own.

**Copy say what it for and what it never touch, and stop.** Analytics row = two sentence, no itemised field list. Naming every field read as something to be wary of; "analytics" alone read as behavioural tracking. Second sentence — conversation and activity never collected — carry row.

**Group heading arrive with second group, not before.** One heading over only group there was = label for surface, which the rail's own heading already is. Separated by **space, not rules**, for reason PR panel's own sections are.

**Theme picked by looking at it, not by reading label.** Swatch draw theme's own backdrop — gradient and all — because each swatch carry `data-theme`/`data-mode` itself, so palette blocks match it exactly as they match `<html>`. Follow that swatch cannot drift from theme it stand for, which table of colours in TSX could and eventually would. Square, so it read as sample of colour rather than as picture of window.

**Name drawn beside swatch, never hovered for.** Colour say what theme *look* like, name say which one it is, and both wanted at once — hiding either behind tooltip make reader work for half answer. Name live **inside** button too, so accessible name = visible one rather than `aria-label` free to drift from it. Toggle of two word labels was first version and told reader nothing about what either look like; swatch alone was second and told them nothing about which was which.

**Theme row = only row with no description**, and rule it break is deliberate: control *is* explanation. Sentence saying "the palette everything uses" beside two visible palettes spend words on thing reader already seen. Switch keep its description, always — switch = word and a state, and sentence under it only place "why is this off by default" can live.

**Radio group = one Tab stop with arrows inside it.** `role="radiogroup"` without that = promise to screen reader that keyboard then break. Roving `tabIndex` other half, or tabbing through the surface walk palettes one at a time. Selection follow focus, right for group whose option cheap to try — here trying one *is* seeing it.

**Feedback block send people out, not into a form, and it deliberately not a `SettingRow`.** Nothing there a setting — no state to read back — so label a row demand ("Get in touch") sit under heading already saying Feedback and earn nothing but third line. Sentence plus two button = whole block. Most feedback = one sentence and form more than sentence worth, so button open DM; GitHub beside it for half who would rather send fix than describe it. Both go through `openUrl`, same route PR panel and transcript links take, so link land in reader's own browser rather than turning app window into one.

**`SettingRow` grew `asGroup`, and it about `htmlFor` reaching nothing.** Label only bind to labelable element, so theme's radio group have to be pointed other way — label carry id, group carry `aria-labelledby`. Switch rows unchanged.

## Settings pages

**Rows are the mockup's `.prow`**: the label and its reason at 210px on the left, the control filling the rest, a hairline under each. Groups start with a quiet `h5`-sized heading ([StudioRow.tsx](apps/desktop/src/components/settings/StudioRow.tsx)), separated by space, not rules. The older `SettingRow` stays for the rows that moved in from the old pages, so a page can hold both until they are redrawn.

**The rail has three headings**, the middle one being the workspace's own name, so Workspace, Agent defaults and Usage & limits read as that team's and the two outside it as yours and the app's.

**The theme is chosen by looking**: three 120px previews (a sidebar and a canvas in each mode's greys, System split down the middle), with the five palettes below as swatches. Light and System are disabled, with a tooltip, on a palette that has no light block.

**A limit is thirty cells, not a gauge.** The bars are the same hard-edged cells as the spend bars and the dither, amber from 80%. A measured figure is plain (`62%`); one hz sized itself is `~62%` and the card says "estimated"; a window with no number is a dash. **Never a bar that reads zero because nothing was read.** A CLI with no limit says so in the header and draws no bars.

**A CLI row is one card with a fixed meta grid** (Version, Path, Account, Talks over, in monospace), the primary action at the right and **one** primary at a time: Set up adapter, else Update, else Check. A run in flight draws its last line of output under a rule, in red if it failed. The two CLIs hz cannot drive are dimmed with a disabled Install and the words "Not available yet", not hidden.

**Jump to is the mockup's palette**: 620px, the field over the list with an ESC cap, group headings in `ink4`, a 22px mark on every row (an agent's own face, a hash, a note, a clock, the plugin's brand), subtitle in `ink3`, a footer with the keys and the workspace's name. Four rows per group until the reader types. Nothing found says what was typed and offers to make an agent called that.

## Sidebar drag, and skeletons

**The sidebar is a set of handles, not a fixed list.** A row, a channel or a section header lifts after a 150 ms hold; the ghost is the row itself on `popover` with `shadow-lg`, nudged down-right so the row it hovers stays readable. A reorder shows a 2px blue line before or after the target, a drop onto a channel highlights the whole row. Rejected: a grip icon on every row (a column of dots for a gesture most readers never need), and HTML5 drag (never fires under Tauri's file-drop handler). Order is never only a gesture: every row's menu has Move up / Move down.

**A skeleton mirrors the final layout.** Card outlines, a 30-cell track, avatar circles with two lines, a lane with its cards. Same boxes, same gaps, so nothing moves when the data lands. One `.skeleton` sweep, no per-site pulse. A spinner on its own is only for an action in flight; a re-read with data on screen keeps the data and puts a 12px spinner in the card header. Rejected: a centred "Loading…" (reads as a page that failed to draw) and one full-page skeleton for pages whose cards arrive separately.

## Asks beside the composer

**The card sits where the typing is, not where the transcript happens to be scrolled.** The agent stopping mid-turn is the one moment the reader has to act, and the transcript may be anywhere — so the pane that owns the composer draws the cards above it, and a pane that has no composer keeps the transcript's own copy. Never both: an answered card at one surface would leave buttons at the other that can no longer answer anything.

**All of them, not just the newest.** Two requests can be open at once, and the transcript's copy is not drawn for that pane — drawing one card would hide the other with nothing on screen to say it exists.

## What a palette row promises

**A row that looks like it worked did something.** Every action in `⌘K` calls the same function its own chord calls rather than replaying the keystroke, and a row that cannot apply is not built — a chord that is disabled in the current pane fires nothing, so a replayed one would be a row that does nothing and says nothing. The chord is drawn from the registry, so a rebinding moves the caps.

**`>` narrows to actions**, an empty box draws everything in the order the app already draws it, and a query matching the *start* of a label outranks one matching the middle. The list is never focused: the arrows and Enter belong to the field, for the reason the composer's pickers are built that way.

## When a pane fails

**A throw costs a view, not the window.** A boundary around the main column keeps the sidebar, the header and the composer alive; one around the whole app is the floor. It is keyed on what the pane is showing, because a boundary latches on the error it caught — unkeyed, one bad turn would leave every later session blank. The panel shows the error's own message, a Reload and a copy, and nothing about it is reported anywhere: an error message is arbitrary text that routinely carries a path.

**A slow read draws one line, after four seconds, and only the oldest.** A spinner for every read is a screen that always looks busy; a line per read is a wall. The line is bottom-left, over the sidebar — the cheapest thing on screen to cover — and it clears itself a beat after the read lands, or on a failure, since the composer's error slot is then saying what actually went wrong. No spinner glyph: this is a sentence about waiting, not a control.

## Update row

**Update row drawn only when there something to say.** Sidebar have no permanent footer; row reading "up to date" = chrome for fact nobody asked about. Show nothing while sidebar collapsed, deliberate — next check keep offer alive.

## Notice cards

Sidebar glow was third channel, cut. Landed in same corner as card, so it could not reach eye card wasn't already reaching, and invisible whenever sidebar collapsed. Animation shelved unimported in [attention-glow.css](src/styles/attention-glow.css) with own notes on how to rewire — worth several passes to get right, so next thing wanting pulse don't redo them.

**Card carry verb and nothing else** ([NoticeStack](src/components/NoticeStack.tsx)) — "Needs permission", "Task finished" — top-left, over sidebar it talk about and below traffic lights, where nothing else in app draw. No session title, no project, no icon: rail already mark row, so card repeating name spend its width saying what next glance say anyway. That leave one fact not on screen anywhere else, which is *what* is wanted. Desktop banner do opposite and have to: it land in stack beside every other app's notifications, so it name session and project or it say nothing. One `announce` build both from same label.

**Button = the control, and only one.** Earlier pass made whole card clickable with chevron for hint, not obvious enough to be trusted — card you not sure you can click = card you read and leave alone. Label name action rather than say "Open" twice: `View` for finished turn, `Answer` for waiting one, also fastest way to tell two otherwise identical cards apart. Take **primary** fill not secondary: card itself raised surface, and secondary button on top = one shade off thing it sit on — exactly "am I allowed to click this" chevron pass already failed. No dismiss button: card already leaving on own, so X to make it leave sooner = second target competing with one that matter.

## Images in the transcript, and the picker

**Tray stay inside card**, above text and on same edges. Outside it — way picker or toolbar sit — it fight `@` mention list for same strip of window, and two open at exactly same moment. Tile carry no size and no `title`: both describe file reader chose seconds ago.

**Sent image drawn outside bubble.** Bubble = container for speech; picture given fill and padding read as speech with frame drawn round it. They sit **above** text, matching composer's own tray. Thumbnails square and laid out as wrapping row not stack: two screenshots usually two views of one thing, and square keep row of mixed aspect ratios grid not ragged strip. They 80px against tray's 56px — transcript = where picture have to be recognized rather than merely counted, and still small because reader already know contents. Past **three** row stop counting and draw `+N` tile, which open viewer on first picture it standing in for.

**[ImageLightbox](src/components/chat/ImageLightbox.tsx) take whole set and index, not one image.** Bubble cap at 85% of column, so transcript can never show screenshot at readable size. It hold set because message carrying three screenshots = _one thing to look at_. Index = whole state, so opening at picture and stepping to next = same operation, and ← / → handled on `Dialog.Content` not window — dialog own focus while open, so keys scope themselves. Escape = Radix's own. **Click on backdrop close too, and Radix's outside-press cannot do it** — `Content` = `fixed inset-0`, so every click land inside it and `onPointerDownOutside` never fire. Test = `e.target === e.currentTarget`, which tell dark surround from things drawn on it. Two box carry it — padded frame, and column picture centred in. No `stopPropagation` anywhere. Both shortcuts stated on screen as `Kbd` caps rather than left to be guessed — dialog covering window owe reader its controls without hover to find them. Arrow caps sit **below** filmstrip as sentence — "Arrow keys ← → to switch" — since bare caps on strip's own row read as two more buttons.

Two details looking incidental. Image capped against own flex box not viewport, so filmstrip can never be pushed off bottom. And last index held in state across close, because Radix keep `Content` mounted while it fade and `index` already `null` by then — without it picture swap to first one on way out.

**Picture drawn without being opened**, unlike diff next to it. Row have nothing else — no text, no range, disabled expander.

**And drawn uncropped at reading size, where reader's own attachment stay 80px square.** `ImageRow` carry both as `variant`, and split turn on *who have seen picture already*. `sent` = receipt: reader picked it seconds ago. `returned` = opposite — screenshot agent took and read = one reader have **not** seen, and 80px crop of it say nothing. So `max-h-80 max-w-full`, both dimension left `auto` so cap scale picture rather than trim it: which part to throw away cannot be guessed. Border on it = only thing separating pale screenshot from page behind. Overflow past three go to line of text under row rather than `+N` tile, since tile have no size to match. Late-loading image shift layout and that already handled: `Chat`'s `ResizeObserver` re-pin bottom while following.

Component shared with `UserMessage` for `Avatar`'s reason: index meaning one picture in row and another in lightbox, and overflow control opening on first picture it stand for, = parts second copy drift on. `UserMessage` keep own "file is gone" row, since tool row already name path it read.

- **Picker have two modes, and mixing them what make list feel random.** With nothing typed it _browsing_: grouped, recents first under only heading in list, then harness commands, then everything installed — separated by gap not rules. Moment query exist it _searching_, and ranked list drawn flat: headers while filtering hide matches behind section chrome. `groupCommands` and `filterCommands` = two orderings and nothing blend them, so match quality always win search and habit only ever order browse.
