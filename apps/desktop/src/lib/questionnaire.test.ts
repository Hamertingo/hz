import { describe, expect, it } from "vitest";

import { buildAnswers, chipState, progressLabel, questionLabel } from "@/lib/questionnaire";
import type { Question, QuestionOption } from "@/types/events";

function option(value: string, label = value): QuestionOption {
  return { value, label, description: null, preview: null };
}

function question(overrides: Partial<Question> = {}): Question {
  return {
    id: "q1",
    question: "Which indentation?",
    header: null,
    required: false,
    multiSelect: false,
    options: [option("tabs", "Tabs"), option("spaces", "Spaces")],
    freeText: false,
    otherPlaceholder: null,
    ...overrides,
  };
}

describe("buildAnswers", () => {
  it("files a picked option under its value, not its label", () => {
    const answers = buildAnswers([question()], { q1: ["spaces"] });

    expect(answers).toEqual([{ id: "q1", selected: ["spaces"], other: null }]);
  });

  it("separates the typed answer from the picked one", () => {
    const answers = buildAnswers([question({ freeText: true })], { q1: ["tabs", "two, per level"] });

    expect(answers).toEqual([
      { id: "q1", selected: ["tabs"], other: "two, per level" },
    ]);
  });

  it("keeps a multi-select whole, in option order", () => {
    const answers = buildAnswers([question({ multiSelect: true })], {
      q1: ["spaces", "tabs"],
    });

    expect(answers).toEqual([{ id: "q1", selected: ["spaces", "tabs"], other: null }]);
  });

  it("counts a repeated entry once", () => {
    const answers = buildAnswers([question({ multiSelect: true })], { q1: ["tabs", "tabs"] });

    expect(answers).toEqual([{ id: "q1", selected: ["tabs"], other: null }]);
  });

  it("sends a typed answer for a question that has no options", () => {
    const asked = question({ id: "name", options: [], freeText: true });

    expect(buildAnswers([asked], { name: ["  hz  "] })).toEqual([
      { id: "name", selected: [], other: "hz" },
    ]);
  });

  it("drops an untouched question rather than sending it empty", () => {
    const answers = buildAnswers([question(), question({ id: "q2" })], { q1: ["tabs"] });

    expect(answers).toEqual([{ id: "q1", selected: ["tabs"], other: null }]);
  });

  it("ignores a blank entry", () => {
    expect(buildAnswers([question({ freeText: true })], { q1: ["   "] })).toEqual([]);
    expect(buildAnswers([question({ freeText: true })], {})).toEqual([]);
  });
});

describe("progressLabel", () => {
  it("counts a lone question as one of one", () => {
    expect(progressLabel(1, 0)).toBe("1 of 1");
    expect(progressLabel(1, 1)).toBe("1 of 1");
  });

  it("counts answered steps when there are several", () => {
    expect(progressLabel(3, 0)).toBe("0/3 answered");
    expect(progressLabel(3, 2)).toBe("2/3 answered");
  });
});

describe("questionLabel", () => {
  it("falls back to the ordinal, since no elicitation carries a header", () => {
    expect(questionLabel(question(), 0)).toBe("Question 1");
    expect(questionLabel(question(), 2)).toBe("Question 3");
  });

  it("drops the ordinal for a question that does carry one", () => {
    expect(questionLabel(question({ header: "Indentation" }), 1)).toBe("Indentation");
  });
});

describe("chipState", () => {
  it("marks the step being looked at even once it is answered", () => {
    expect(chipState(1, 1, true)).toBe("current");
    expect(chipState(0, 1, true)).toBe("answered");
  });

  it("marks the rest by whether they hold an answer", () => {
    expect(chipState(0, 1, false)).toBe("pending");
  });
});
