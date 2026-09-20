import type { ApprovalPolicy, Harness } from "@/types/events";

/// The stances a harness can actually honour, for one that cannot honour them
/// all. Absent means every stance in the picker applies.
///
/// Codex has no plan mode: its own three are ask / approve-for-me / full
/// access, and `plan` maps onto read-only-and-ask — close, but a stance Codex
/// never names, so offering it would promise a mode it does not have.
///
/// pi honours **none of them**, so it draws no picker at all. It has no
/// permission system of its own — it runs what the model asks for, and the gate
/// belongs to an extension the reader installs and configures themselves. Both
/// popular ones are configured by a `config.json` on disk, at global and
/// project scope, with no flag, env var or runtime setter to hand them a stance
/// through; so a picker here could only ever have set something they do not
/// read. Once one is installed its own asks arrive on the ask channel and are
/// drawn like any other, which is the whole of the reader-facing surface.
///
/// `plan` was offered and withdrawn. It was the one stance pi could enforce —
/// Which stances a harness actually has.
///
/// Not every mode the app can record is one a CLI can run, and the two disagree
/// per harness rather than in general — which is why this is stated rather than
/// derived from one enum.
const HONOURED: Partial<Record<Harness, ApprovalPolicy[]>> = {
  // mcode's own list, off a live `session/new`: `default` ("Ask"), `auto` and
  // `bypassPermissions` ("Full access") as a session setting, plus `plan` as a
  // session *mode* — see `mcode::set_mode`, which decides between the two.
  //
  // `acceptEdits` and `dontAsk` are **not** here: they are Claude Code's words
  // and mcode has nothing between Ask and Auto to put them on.
  // `permission_value_for` in `harness/mcode/mcode.rs` refuses them outright, so
  // offering one from this picker would be a stance that fails at the send.
  mcode: ["manual", "plan", "auto", "bypassPermissions"],
  // Empty for this slice, and it is a "not yet" rather than a "cannot" — omp
  // *does* have a native gate (`--approval-mode always-ask|write|yolo`) and
  // raises its own approval card, which hz already draws. What is missing is
};

/// The stance a harness actually runs when handed one it does not honour.
///
/// mcode: whatever a session arrives on that it does not honour — the `hz`
/// CLI's flag, a role, a fork from a build with other harnesses — lands on
/// `auto`, the widest stance it can run without a bypass.
const FALLBACK: Record<Harness, (mode: ApprovalPolicy) => ApprovalPolicy> = {
  // A stance arriving from somewhere else — the `hz` CLI's own flag, a role, a
  // session forked from a build that had other harnesses — lands on `auto`,
  // which is the widest mcode can run without a bypass.
  mcode: () => "auto",
};

/// Whether this harness honours this stance.
export function honoursMode(harness: Harness, mode: ApprovalPolicy): boolean {
  const honoured = HONOURED[harness];
  return !honoured || honoured.includes(mode);
}

/// The stance to record for a session, given the one the composer holds.
///
/// A session can arrive on a stance its harness does not honour — a spawned one
/// takes its parent's, and a parent on another harness had four to choose
/// from — so this is not merely the picker's own filter restated. Written into
/// the index, so it has to be what is *actually happening*: recording `auto`
/// for a pi session running ungated is a lie a later build could read back and
/// believe.
///
/// Falls to the harness's most permissive stance rather than its most
/// restrictive, because that is the one describing what the CLI will do. A
/// session recorded `plan` that is not passed `--tools` would be the same lie
/// pointed the other way, and the more alarming direction to be wrong in.
export function stanceFor(harness: Harness, mode: ApprovalPolicy): ApprovalPolicy {
  if (honoursMode(harness, mode)) return mode;
  return FALLBACK[harness](mode);
}
