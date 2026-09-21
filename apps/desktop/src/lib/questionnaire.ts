import type { Question } from "@/types/events";

/// One answer as the harness reads it: the step's own id, the `const` of every
/// option picked, and whatever was typed into the step's box.
///
/// **Two fields, not one string.** The agent distinguishes the option a step
/// was answered with from the prose it was answered with, and files them under
/// two different properties — so a reader that joined them into one value would
/// answer a step the agent cannot read.
export type QuestionAnswer = {
  /// The step id. Not the question's text: two steps worded the same are still
  /// two steps, and the agent matches on this.
  id: string;
  /// The picked options' own `value`s — the `const` off the wire. One entry for
  /// a single-select step, empty for a step answered only in its box.
  selected: string[];
  /// What was typed, or null. A null rather than a missing key because the wire
  /// field is optional and one spelling of "nothing typed" is enough.
  other: string | null;
};

/// Reads the form back into the answer shape the harness takes.
///
/// `values` is `Record<questionId, string[]>` off the `FormData` — every
/// control of a step is named after that step, so a step's checked boxes and
/// its typed box land in one bucket and only their values tell them apart. An
/// entry equal to one of the step's option values is a pick; anything else is
/// what the reader typed. A blank box never gets a name, so it never arrives.
///
/// A question with an empty bucket is left out of the list entirely. That
/// omission *is* "skipped" — the reply carries no property for it, which is
/// what the agent reads as an unanswered step.
export function buildAnswers(
  questions: Question[],
  values: Record<string, string[] | undefined>,
): QuestionAnswer[] {
  const answers: QuestionAnswer[] = [];

  for (const question of questions) {
    const entries = (values[question.id] ?? [])
      .map((value) => value.trim())
      .filter((value) => value.length > 0);

    const selected: string[] = [];
    let other: string | null = null;

    for (const entry of entries) {
      // `find` and not a Set: the picked values come back in the option order
      // the reader saw them in, which is the order the agent's own picker sends
      // them in.
      const option = question.options.find((candidate) => candidate.value === entry);
      if (option) {
        if (!selected.includes(option.value)) selected.push(option.value);
      } else {
        other = entry;
      }
    }

    if (selected.length === 0 && other === null) continue;

    answers.push({ id: question.id, selected, other });
  }

  return answers;
}

/// The count over the chips, in the two shapes the agent's own picker uses.
///
/// A single question gets `1 of 1` rather than `0/1 answered` — a fraction of
/// one reads as a form that has barely been started, where there is only ever
/// one step to be on.
export function progressLabel(questionCount: number, answeredCount: number): string {
  if (questionCount <= 1) return `${questionCount} of ${questionCount}`;
  return `${answeredCount}/${questionCount} answered`;
}

/// What the strip names a step by.
///
/// No ACP elicitation carries a per-step header — the agent's own `header`
/// never reaches this wire — so the ordinal is the rule and a header, when
/// some future harness ships one, is simply drawn instead.
export function questionLabel(question: Question, index: number): string {
  return question.header ?? `Question ${index + 1}`;
}

export type ChipState = "current" | "answered" | "pending";

/// A chip's mark. `current` wins over `answered`: the step being looked at is
/// the one fact the strip exists to carry, and a reader standing on a step they
/// already filled should still see where they are.
export function chipState(index: number, currentIndex: number, answered: boolean): ChipState {
  if (index === currentIndex) return "current";
  return answered ? "answered" : "pending";
}
