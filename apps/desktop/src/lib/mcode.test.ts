import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import type {
  AgentEvent,
  ApprovalPolicy,
  Effort,
  Harness,
  Model,
  ModelId,
} from "@/types/events";

import { fastFor, fastNotice, FAST_MODE_BY_HARNESS, offersFast } from "./fastMode";
import type { FastModeSupport } from "./fastMode";
import { DEFAULT_MODEL_FOR, modelLabel, usableEffort, usableModel } from "./model";
import { honoursMode, stanceFor } from "./permission";
import {
  byBase,
  byProvider,
  cycledModels,
  discoveredList,
  hiddenSet,
  matchingRows,
  matchesQuery,
  rowModel,
  rowOf,
  visibleRows,
} from "./modelVisibility";

/// The one harness this build has, named once so a second one added later is a
/// compile error in every case below rather than a silently passing test.
const MCODE: Harness = "mcode";

/// The stances mcode runs, and the route to its fast mode: one table for both
/// suites — `Capabilities::fast_mode` and `permission_value_for`/`acp_mode_for`
/// read these same rows in Rust — so the picker cannot offer what the send
/// refuses, and a switch cannot be drawn on a harness with no wire for one.
const SHARED_RULES = new URL(
  "../../src-tauri/src/harness/mcode/fixtures/shared_rules.json",
  import.meta.url,
);

type StanceRow = {
  stance: ApprovalPolicy;
  honoured: boolean;
  /// mcode's own `permissionMode` value. Rust's half of the row: this side hands
  /// over an `ApprovalPolicy` and never names one of these strings.
  permissionValue: string | null;
  acpMode: string | null;
};

type FastModeRow = { harness: Harness; support: FastModeSupport; offered: boolean };

type SharedRules = { stance: StanceRow[]; fastMode: FastModeRow[] };

/// The cast is the boundary a parsed file needs: this is a fixture in this repo
/// rather than anything off a wire, and a row of the wrong shape fails the
/// assertions below rather than passing quietly.
const shared = JSON.parse(readFileSync(SHARED_RULES, "utf8")) as SharedRules;

function model(id: string, overrides: Partial<Model> = {}): Model {
  return {
    id: id as ModelId,
    label: id,
    /// Empty for everything hand-written here: only the one harness on this
    /// build states a base, and a case that needs one says so in its own
    /// fixture — see [`glm`].
    baseId: "",
    variant: "",
    efforts: [],
    defaultEffort: null,
    arg: id,
    provider: "minimax",
    acceptsImages: false,
    secondary: false,
    supportsFast: false,
    ...overrides,
  };
}

/// The one model this build's agent serves **two ways**, spelled as the wire
/// spells it: one base, two variants — an empty one and `thinking` — with the
/// row's own name stripped of the variant by the Rust side before it arrives.
///
/// A fixture rather than a slice of the live list, because the live one has no
/// such model left: the account's two-variant `MiniMax-M3` is dropped as an
/// account model, so every row that reaches this app today is some model's only
/// variant. The shape is what the picker's grouping is for, so it is stated.
const GLM_BASE = "m:custom_provider%3Aopencode-go:glm-5.3";

function glm(variant: string): Model {
  return model(`${GLM_BASE}:v:${variant}`, {
    baseId: GLM_BASE,
    variant,
    label: "glm-5.3",
    provider: "custom_provider:opencode-go",
  });
}

/// A model served one way, which is 37 of the 41 choices mcode answers with:
/// its id still carries a variant, and the row has no second one to offer.
function omen(): Model {
  return model("m:custom_provider%3Aopencode-go:omen-alpha:v:", {
    baseId: "m:custom_provider%3Aopencode-go:omen-alpha",
    variant: "",
    label: "omen-alpha",
    provider: "custom_provider:opencode-go",
  });
}

function event(payload: AgentEvent["payload"], harness: Harness = MCODE): AgentEvent {
  return {
    id: "e",
    sessionId: "s",
    harness,
    seq: 0,
    ts: "",
    turnId: null,
    subagent: null,
    payload,
    raw: null,
  };
}

describe("the model a session opens on", () => {
  /// The list is the agent's answer and the pick is the reader's, so a pick the
  /// agent still offers is kept — including across a reopen, where the list may
  /// have been read before the reader touched anything.
  it("keeps a pick the list still carries", () => {
    const list = [model("m:minimax:MiniMax-M3:v:"), model("m:minimax:MiniMax-M2.7-highspeed:v:")];
    expect(usableModel(list, "m:minimax:MiniMax-M3:v:" as ModelId, MCODE)).toBe(
      "m:minimax:MiniMax-M3:v:",
    );
  });

  /// mcode names no default of its own, so a pick the list cannot run falls to
  /// the sentinel — the spawn then omits `--model` and the CLI uses whatever its
  /// own settings say. **Not** to the head of the list: that is a picker-ordering
  /// decision, and treating it as an answer is what put sessions on a model
  /// nobody chose.
  it("falls to the unset sentinel rather than the head of the list", () => {
    const list = [model("m:minimax:MiniMax-M3:v:"), model("m:minimax:MiniMax-M2.7-highspeed:v:")];
    // A model recorded by a build that ran a different harness, or one whose
    // provider has since been logged out.
    expect(usableModel(list, "opus" as ModelId, MCODE)).toBe(DEFAULT_MODEL_FOR[MCODE]);
    expect(DEFAULT_MODEL_FOR[MCODE]).toBe("");
  });

  /// An unread list is not an empty answer: the read that fills it repairs the
  /// pick a beat later, and clearing it in the meantime would lose the reader's
  /// choice to a race with the fetch.
  it("stands while the list has not landed", () => {
    expect(usableModel([], "m:minimax:MiniMax-M3:v:" as ModelId, MCODE)).toBe(
      "m:minimax:MiniMax-M3:v:",
    );
  });
});

describe("the effort a model runs at", () => {
  /// mcode states the active model's ladder on the session, and a model that
  /// does not reason states none — which is `null`, the answer that hides the
  /// control rather than drawing an empty one.
  it("is null where the model offers nothing", () => {
    expect(usableEffort(model("m"), "high", "high")).toBeNull();
  });

  it("keeps a remembered level the model still offers", () => {
    const m = model("m", { efforts: ["low", "medium" as Effort, "high"], defaultEffort: "low" });
    expect(usableEffort(m, "high", "medium")).toBe("high");
  });

  /// A pick from another model's ladder is not sent on trust: the model's own
  /// default is preferred, then the app's.
  it("prefers the model's own default over a level it does not offer", () => {
    const m = model("m", { efforts: ["low", "medium" as Effort], defaultEffort: "medium" });
    expect(usableEffort(m, "xhigh", "low")).toBe("medium");
  });

  /// A ladder carrying none of the three falls to its **top** rung, not its
  /// floor: the app default sits near the top, so a ladder short of it is a low
  /// one, and the rung nearest what was asked for is the last.
  it("falls to the top rung of a ladder with none of the three", () => {
    const m = model("m", { efforts: ["low", "medium" as Effort] });
    expect(usableEffort(m, null, "xhigh")).toBe("medium");
  });
});

describe("the models the picker draws", () => {
  /// A discovered list — every model the reader's providers serve, 41 choices
  /// over 37 models here — which is what makes it searched rather than scanned,
  /// and what makes the reader's own stars worth an editor.
  it("is a discovered list, and it is this one", () => {
    expect(discoveredList(MCODE)).toBe(true);
  });

  /// **The reader's unit is the model.** mcode answers a variant as a choice of
  /// its own, so a model served two ways arrives as two rows; the picker draws
  /// it as one, with the variant as a control beside the name.
  it("draws a model the wire lists twice as one row", () => {
    const rows = byBase([glm(""), glm("thinking"), omen()]);

    expect(rows).toHaveLength(2);
    expect(rows[0].key).toBe(GLM_BASE);
    expect(rows[0].variants.map((m) => m.variant)).toEqual(["", "thinking"]);
    expect(rows[1].variants.map((m) => m.variant)).toEqual([""]);
  });

  /// An id that is not a wire ref has no base to share, so it is its own row and
  /// nothing is grouped — the other kind of harness draws exactly as it did.
  it("keys a row by the id where the harness states no base", () => {
    const rows = byBase([model("opus"), model("sonnet"), model("haiku")]);

    expect(rows.map((row) => row.key)).toEqual(["opus", "sonnet", "haiku"]);
    expect(rows.every((row) => row.variants.length === 1)).toBe(true);
  });

  /// **Every model the harness serves, unless the reader switched it off** — and
  /// in the order the agent answered with, since nothing is reordered any more.
  /// A switch that is on is a model the picker has to offer, and the one thing
  /// that takes a row out of the menu entirely.
  it("draws every model the harness serves, minus the ones switched off", () => {
    const models = [model("opus"), omen(), glm(""), glm("thinking")];

    expect(visibleRows(models, hiddenSet(null), MCODE).map((row) => row.key)).toEqual([
      "opus",
      "m:custom_provider%3Aopencode-go:omen-alpha",
      GLM_BASE,
    ]);

    // One model switched off takes both its variants with it, and leaves the
    // order of everything else alone.
    const rows = visibleRows(models, hiddenSet([`${GLM_BASE}:v:thinking` as ModelId]), MCODE);
    expect(rows.map((row) => row.key)).toEqual([
      "opus",
      "m:custom_provider%3Aopencode-go:omen-alpha",
    ]);
    // Four wire rows, three models — and a model served two ways draws whole.
    expect(byBase(models)[2].variants).toHaveLength(2);
  });

  /// Picking a row as it stands must not undo the variant the session is on: a
  /// click says "run this model", not "change how".
  it("keeps the variant a row is standing on when it is picked", () => {
    const row = byBase([glm(""), glm("thinking")])[0];

    expect(rowModel(row, `${GLM_BASE}:v:thinking` as ModelId).variant).toBe("thinking");
    expect(rowModel(row, "somewhere-else" as ModelId).variant).toBe("");
    // And the row is found for a model the reader never kept, which is the
    // trigger's own question about the model on screen.
    expect(rowOf([glm(""), glm("thinking")], `${GLM_BASE}:v:` as ModelId)?.key).toBe(GLM_BASE);
  });

  /// **One stop per model, not per variant.** A chord that stopped on `glm-5.3`
  /// and then on `glm-5.3 · thinking` is two presses for one idea; a session on
  /// either draws the same single row.
  ///
  /// Nothing stored is nothing switched off, so the cycle here is the whole list —
  /// which is the price of a fresh install having every model on, and what the
  /// switches buy back.
  it("makes one step of a model, however many variants it is served in", () => {
    const models = [glm(""), glm("thinking"), omen()];
    const cycle = cycledModels(models, MCODE, `${GLM_BASE}:v:thinking` as ModelId);

    expect(cycle).toHaveLength(2);
    expect(cycle.map((row) => row.key)).toEqual([GLM_BASE, "m:custom_provider%3Aopencode-go:omen-alpha"]);
  });

  /// Grouped under the provider each row came from, in the order the agent
  /// answered with — insertion order rather than alphabetical, since that order
  /// already groups them.
  it("groups the rows under the provider each one came from", () => {
    const rows = byBase([
      model("a", { provider: "minimax" }),
      model("b", { provider: "custom_provider:opencode-go" }),
      model("c", { provider: "minimax" }),
    ]);
    const groups = byProvider(rows);

    expect(groups.map((g) => g.provider)).toEqual(["minimax", "custom_provider:opencode-go"]);
    expect(groups[0].rows.map((row) => row.key)).toEqual(["a", "c"]);
  });

  /// A query is asked of the model, so a row it finds is drawn whole — both
  /// variants, not the one whose name happened to contain the match.
  it("keeps a model whole when the search finds it", () => {
    const rows = matchingRows(byBase([glm(""), glm("thinking"), omen()]), "glm");

    expect(rows).toHaveLength(1);
    expect(rows[0].variants).toHaveLength(2);
  });

  /// The search reads the name the row is *drawn* with as well as the label
  /// under it, since the two differ by exactly the separators a reader types as
  /// spaces.
  it("finds a row by the name it is drawn with", () => {
    const row = model("m:custom_provider%3Aopencode-go:minimax-m3:v:", { label: "minimax-m3" });

    expect(matchesQuery(row, "minimax m3")).toBe(true);
    expect(matchesQuery(row, "opencode")).toBe(true);
    expect(matchesQuery(row, "gpt")).toBe(false);
  });
});

describe("the stances mcode has", () => {
  /// Row by row out of `shared_rules.json`: measured against a live
  /// `session/new`, mcode has three permission modes plus the `plan` session
  /// mode, and `dontAsk` names a stance none of the three is. The `honoured`
  /// column is the backend's own answer too — `permission_value_for` refuses
  /// exactly the stances this does not offer — which is what makes one table
  /// worth two readers: the picker cannot offer what the send would refuse.
  ///
  /// The `permissionValue` and `acpMode` columns on those rows are Rust's half,
  /// read by its stance test: this side hands over an `ApprovalPolicy` and never
  /// names mcode's own permission strings.
  it("offers exactly the stances the backend can send", () => {
    for (const row of shared.stance) {
      expect(honoursMode(MCODE, row.stance), row.stance).toBe(row.honoured);
    }
  });

  /// A session can *arrive* on a stance its harness does not honour — the `hz`
  /// CLI's own flag, a role, a fork — and what is written into the index has to
  /// be what is actually happening. `auto` is the widest mcode runs without a
  /// bypass, and recording a narrower one would be a lie in the alarming
  /// direction.
  ///
  /// Hand-written rather than shared, because Rust has no counterpart: a stance
  /// mcode does not honour is *refused* at the send there (`permission_value_for`
  /// errors), where this side has to write something into the index. There is no
  /// row for "what gets recorded" to read.
  it("records what will happen for a stance it does not honour", () => {
    expect(stanceFor(MCODE, "auto")).toBe("auto");
    expect(stanceFor(MCODE, "plan")).toBe("plan");
    expect(stanceFor(MCODE, "dontAsk")).toBe("auto");
  });
});

describe("fast mode", () => {
  /// Every harness's route to fast mode, out of `shared_rules.json` — the same
  /// rows `Harness::caps().fast_mode` answers in Rust, so the backend's word and
  /// the switch the composer draws are one fact.
  ///
  /// **None at all on this harness**: `serviceTier` is not a thing on mcode's
  /// wire and ACP carries no field for a tier, so no model claiming
  /// `supportsFast` can put a switch on the row.
  it("has the route the backend names, and draws no switch without one", () => {
    for (const row of shared.fastMode) {
      expect(FAST_MODE_BY_HARNESS[row.harness], row.harness).toBe(row.support);
      expect(
        offersFast(row.harness, model("m", { supportsFast: true }), true),
        `${row.harness} offered`,
      ).toBe(row.offered);
      expect(
        fastFor(true, row.harness, [model("m", { supportsFast: true })], "m" as ModelId),
        `${row.harness} sending`,
      ).toBe(row.offered);

      if (!row.offered) {
        // Nothing picked at all, which is the ordinary state of a session
        // whose model list has not landed — and with no route it cannot be the
        // thing that draws the switch.
        expect(offersFast(row.harness, null, true), `${row.harness} unset`).toBe(false);
      }
    }
  });

  /// Read back out of the session's log rather than tracked, the same bargain
  /// the context ring makes — and scoped to the newest turn, since the CLI says
  /// it once per turn it refuses. A turn that runs says nothing and clears it.
  ///
  /// No shared row: the columns `fastMode` carries are a harness's *route* to a
  /// fast mode, which is a fact about the CLI, where this is the CLI's own
  /// sentence arriving in a log line.
  it("reads the notice off the log, scoped to the newest turn", () => {
    expect(fastNotice([])).toBeNull();
    expect(
      fastNotice([
        event({ type: "fast_mode_notice", text: "Fast mode disabled · usage credits exhausted" }),
      ]),
    ).toBe("Fast mode disabled · usage credits exhausted");

    expect(
      fastNotice([
        event({ type: "fast_mode_notice", text: "Fast mode disabled" }),
        event({ type: "turn_started" } as never),
      ]),
    ).toBeNull();
  });
});

describe("the name a model is drawn by", () => {
  /// **A wire ref is not a name.** The agent states a row it has no name for as
  /// its own value, and the composer's trigger falls back to the id while the
  /// model list is still being read — so this exact string reaches the screen on
  /// the ordinary path of a slow probe, and it is addressing rather than a name.
  it("reads the model out of a wire ref", () => {
    expect(modelLabel("m:custom_provider%3Aopencode-go:deepseek-v4.1-flash:v:thinking")).toBe(
      "Deepseek V4.1 Flash",
    );
  });

  /// The provider is the heading the picker groups by and the variant is a
  /// control beside the name, so neither is part of what the model is called.
  it("leaves the provider and the variant out of it", () => {
    expect(modelLabel("m:minimax:MiniMax-M3:v:")).toBe("MiniMax M3");
    expect(modelLabel(`${GLM_BASE}:v:thinking`)).toBe("Glm 5.3");
    // A ref with a provider and no variant at all, which is what a model the
    // harness serves one way would look like without the tail.
    expect(modelLabel("m:custom_provider%3Aopencode-go:omen-alpha")).toBe("Omen Alpha");
  });

  it("capitalises the words of a name spelled for a parser", () => {
    expect(modelLabel("omen-alpha")).toBe("Omen Alpha");
    expect(modelLabel("MiniMax-M2.7-highspeed")).toBe("MiniMax M2.7 Highspeed");
  });

  /// Never lowercased on the way through: a name that already reads as prose is
  /// the maker's spelling of it, and `minimax` is not a word this app invented.
  it("leaves a name that already reads as prose alone", () => {
    expect(modelLabel("Sonnet")).toBe("Sonnet");
    expect(modelLabel("MiniMax M2.7 highspeed")).toBe("MiniMax M2.7 Highspeed");
  });
});
