import type { QuestionnaireItemStatus } from "@shadcn/react/questionnaire";
import { CheckIcon, CircleDotIcon, CircleIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";

import { Button } from "@/components/ui/button";
import {
  Questionnaire,
  QuestionnaireActions,
  QuestionnaireChoice,
  QuestionnaireChoiceDescription,
  QuestionnaireChoices,
  QuestionnaireInput,
  QuestionnaireItem,
  QuestionnaireNext,
  QuestionnairePrevious,
  QuestionnaireProgress,
  QuestionnaireSkip,
  QuestionnaireSubmit,
  QuestionnaireTitle,
} from "@/components/ui/questionnaire";
import {
  buildAnswers,
  type ChipState,
  chipState,
  progressLabel,
  questionLabel,
  type QuestionAnswer,
} from "@/lib/questionnaire";
import { cn } from "@/lib/utils";
import type { Question } from "@/types/events";

/// The agent asking the reader something, rather than asking to run something.
///
/// Sits where the permission card sits and answers the same way — the harness is
/// blocked on it either way — but it carries no allow or deny. The call is never
/// in question; the filled-in form *is* the answer, and submitting an empty one
/// tells the agent it was ignored.
///
/// **One question at a time.** The steps are a wizard the primitive already
/// drives: it keeps the count, hides the inactive items, marks each one answered
/// or skipped, and advances on Enter. What this card adds is the model — the
/// questions as the agent asked them, in its order, with `required` honoured and
/// an answer keyed by the step's own id rather than by its text.
export default function QuestionRequest({
  questions,
  onAnswer,
  onCancel,
  autoFocus = true,
}: {
  questions: Question[];
  /// The filled-in form, keyed by step id. A step the reader left alone is
  /// absent from the list rather than present and empty.
  onAnswer: (answers: QuestionAnswer[]) => void;
  /// The reader taking the question back, which the agent reads as a decline.
  onCancel: () => void;
  /// Whether the card takes focus on mount. False for a split pane that is
  /// not the focused one — see the effect below.
  autoFocus?: boolean;
}) {
  // One-shot, like the permission card: the reply can only be consumed once, so
  // a second submit during the round trip has nothing to answer.
  const [sent, setSent] = useState(false);
  // `Esc` asks first, because the card sits over a transcript the reader is
  // reading and the key is one they reach for constantly.
  const [confirming, setConfirming] = useState(false);
  // Which step is on screen, told by the primitive. The strip needs it and
  // nothing else does — the count is drawn off the primitive's own.
  const [currentId, setCurrentId] = useState(questions[0]?.id ?? "");
  // Each question's own status, for the same strip. The primitive reports it
  // because it is the only thing that knows: a choice is answered by being
  // checked, a text box by holding something.
  const [status, setStatus] = useState<Record<string, QuestionnaireItemStatus>>({});
  const formRef = useRef<HTMLFormElement>(null);

  // `items` is what the primitive drives everything from: the count of steps,
  // which of them refuses a skip, the order the shortcut numbers are handed out
  // in, and the collection the form's own values are checked against. A question
  // missing from here is a question the reader cannot navigate past.
  //
  // `name` is the step id — the key the answer goes back under — and `value` is
  // the option's own `const`, which is what the agent matches on. Neither is the
  // text the reader sees.
  const items = useMemo(
    () =>
      questions.map((question) => ({
        name: question.id,
        required: question.required,
        choices: question.options.map((option) => ({ value: option.value })),
      })),
    [questions],
  );

  const currentIndex = Math.max(
    0,
    questions.findIndex((question) => question.id === currentId),
  );
  const label = progressLabel(
    questions.length,
    questions.filter((question) => status[question.id] === "answered").length,
  );

  // The questionnaire listens on its own form rather than on the window, so
  // nothing is typeable until focus is inside it. Landing on the step's first
  // choice rather than on the form arms every key at once: a number picks,
  // arrows move, and Enter confirms — that last one only fires when the event
  // target is a control the form registered, so focusing the form itself would
  // leave Enter dead.
  //
  // The free-text box is the fallback, and it is not a nicety: a step that is
  // nothing but a box carries no choice at all, so a choice-only query found
  // nothing and left focus in the composer. Typing then edited a prompt while
  // the agent sat blocked behind the card, and Enter sent it.
  //
  // Only the active step is queried: the primitive hides the others, and the
  // step the reader is on is the only one they can answer.
  const focusCard = useCallback(() => {
    const form = formRef.current;
    const target =
      form?.querySelector<HTMLInputElement>(
        "[data-slot=questionnaire-item]:not([hidden]) [data-slot=questionnaire-choice] input",
      ) ??
      form?.querySelector<HTMLElement>(
        "[data-slot=questionnaire-item]:not([hidden]) [data-slot=questionnaire-input]",
      );

    target?.focus();
  }, []);

  // Taking focus is defensible here and nowhere else in the app: the agent is
  // blocked until this is answered, so it is the one thing on screen the reader
  // has to deal with. Once per mount — a re-render must not yank the caret back
  // out of the free-text box.
  //
  // Only for the transcript that has the focus: in a split view every pane
  // draws its own cards, and one in a pane the composer is not serving would
  // pull the caret out of the reader's typing.
  const tookFocus = useRef(false);
  useEffect(() => {
    if (!autoFocus || tookFocus.current) return;
    tookFocus.current = true;
    focusCard();
  }, [autoFocus, focusCard]);

  const cancel = () => {
    if (sent) return;
    setSent(true);
    onCancel();
  };

  // Escape is the reader's way out and Enter is the way through the question
  // they were asked about it. Both are stopped before the primitive sees them:
  // it advances on Enter, and a card the reader is still deciding about must not
  // move under them.
  const onKeyDown = (event: KeyboardEvent<HTMLFormElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      setConfirming((open) => !open);
      if (confirming) focusCard();
      return;
    }
    if (confirming && event.key === "Enter") {
      event.preventDefault();
      event.stopPropagation();
      cancel();
    }
  };

  return (
    // **The card is a surface, not a stretch of text.** It floats over the
    // transcript the way the follow-up strip does, from the same slot and at the
    // same moment — so it takes the same treatment: `bg-composer` and the blur,
    // because a flat veil would let the words behind it read through the rows;
    // `rounded-xl`, the card rung of this app's one radius scale; and the crisp
    // shadow for a surface at the window's edge.
    //
    // **The composer's own width, end to end.** A question is the same kind of
    // thing the composer is — the reader's turn to say something — so a card
    // that stopped short of it read as a scrap left in the corner of the slot
    // rather than as the thing being asked. The form above is `max-w-3xl`, which
    // is the width this inherits.
    <div className="rounded-xl border border-edge-surface bg-composer px-1.5 py-1.5 shadow-(--shadow-surface) backdrop-blur-xl">
      <Questionnaire
        ref={formRef}
        // Numbers rather than letters: an option's label is a word, so a letter
        // badge invites reading it as that word's initial when it isn't.
        shortcuts="numbers"
        items={items}
        onItemChange={setCurrentId}
        onKeyDown={onKeyDown}
        onSubmit={(event) => {
          event.preventDefault();
          if (sent) return;
          setSent(true);
          onAnswer(answersOf(event.currentTarget, questions));
        }}
      >
        {/* The count and the strip, in one row above the question. The count is
            the primitive's own live region, which is why the label is drawn
            *inside* it rather than beside it. */}
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 px-2">
          <QuestionnaireProgress aria-valuetext={label}>{label}</QuestionnaireProgress>
          {questions.length > 1 && (
            <div className="ms-auto flex flex-wrap items-center gap-1">
              {questions.map((question, index) => {
                const state = chipState(
                  index,
                  currentIndex,
                  status[question.id] === "answered",
                );
                return (
                  <span
                    key={question.id}
                    // The chip's own step is the one being read from, and saying
                    // so is what the two colours can only say visually.
                    aria-current={state === "current" ? "step" : undefined}
                    className={cn(
                      "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs whitespace-nowrap",
                      CHIP[state],
                    )}
                  >
                    <ChipMark state={state} />
                    {questionLabel(question, index)}
                  </span>
                );
              })}
            </div>
          )}
        </div>

        {questions.map((question) => (
          <QuestionnaireItem
            key={question.id}
            name={question.id}
            // Both, and they must agree: the primitive reads `required` off
            // `items` to decide whether `Skip` exists at all, and warns when the
            // rendered item disagrees.
            required={question.required}
            multiple={question.multiSelect}
            onStatusChange={(next) =>
              setStatus((known) =>
                known[question.id] === next ? known : { ...known, [question.id]: next },
              )
            }
            className="gap-2"
          >
            {/* `whitespace-pre-line` because that text can be two sentences: a
                `confirm` carries a short question and the detail under it, and
                run together on one line the detail reads as part of the
                question. */}
            <QuestionnaireTitle className="text-chat font-medium whitespace-pre-line">
              {question.question}
            </QuestionnaireTitle>

            <QuestionnaireChoices>
              {question.options.map((option) => (
                <QuestionnaireChoice key={option.value} value={option.value}>
                  <span className="font-medium">{option.label}</span>
                  {option.description && (
                    <QuestionnaireChoiceDescription>
                      {option.description}
                    </QuestionnaireChoiceDescription>
                  )}
                  {option.preview && (
                    <pre className="mt-1.5 overflow-x-auto rounded-md border border-border px-2.5 py-2 font-mono text-xs">
                      {option.preview}
                    </pre>
                  )}
                </QuestionnaireChoice>
              ))}

              {/* Offered wherever the asker can take an answer that isn't on the
                  list, which is a step it allocated a box to — and a step that
                  is nothing but a box. It is the question's own last row, not a
                  step of its own: the agent files the text under the step it
                  belongs to, and a second card for it would file an answer to a
                  question nobody asked.

                  `freeText` is the flag, and it comes from the agent either way,
                  so a closed list draws no box. */}
              {question.freeText && (
                <QuestionnaireInput
                  // A typed answer is prose and can run to a sentence or two, so
                  // the box grows down instead of scrolling one line sideways —
                  // an answer the reader cannot see all of is one they cannot
                  // check before sending. `field-sizing: content` does the
                  // growing natively; the cap stops a pasted essay pushing Send
                  // off the bottom of the transcript.
                  render={<textarea rows={1} />}
                  aria-label="Another answer"
                  // The agent's own words for the box where it wrote any, which
                  // is the sentence it wrote for this step's other answer.
                  placeholder={question.otherPlaceholder ?? "Something else…"}
                  className="field-sizing-content h-auto max-h-40 resize-none"
                  onKeyDown={(event) => {
                    // Enter answers the card — the questionnaire's own handler
                    // sits on the form above and takes it whatever the target —
                    // so a newline needs the other chord, and stopping the
                    // bubble is the only way to leave it to the textarea.
                    if (event.key === "Enter" && event.shiftKey) event.stopPropagation();
                  }}
                />
              )}
            </QuestionnaireChoices>
          </QuestionnaireItem>
        ))}

        {confirming ? (
          <div className="flex flex-wrap items-center gap-1.5 px-2">
            <span className="me-auto text-ui text-muted-foreground">
              The request and its unsent answers are discarded.
            </span>
            {/* Takes the caret so the chord that got here keeps working — the
                handler above is on the form, and the form only hears keys while
                focus is inside it. */}
            <Button autoFocus type="button" size="sm" variant="destructive" onClick={cancel}>
              Cancel question
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setConfirming(false)}>
              Keep answering
            </Button>
          </div>
        ) : (
          // Only ever two of these four are up at once — Back and Previous hide
          // for a single question, Next and Send are mutually exclusive — so the
          // row is sized by what is in it rather than by a grid's fixed tracks.
          <QuestionnaireActions className="mt-0.5">
            <QuestionnairePrevious disabled={sent} />
            <QuestionnaireSkip disabled={sent} />
            <QuestionnaireNext disabled={sent} />
            <QuestionnaireSubmit disabled={sent}>Send</QuestionnaireSubmit>
          </QuestionnaireActions>
        )}
      </Questionnaire>
    </div>
  );
}

/// The three marks the strip draws: the step being read, one already answered,
/// one still to come.
///
/// Glyphs rather than words, because they sit in a row of chips whose text is
/// the question's own name.
function ChipMark({ state }: { state: ChipState }) {
  if (state === "current") return <CircleDotIcon aria-hidden="true" className="size-3" />;
  if (state === "answered") return <CheckIcon aria-hidden="true" className="size-3" />;
  return <CircleIcon aria-hidden="true" className="size-3" />;
}

/// A skipped step is not an answered one: the reader said nothing about it, and
/// the reply carries no answer to show.
const CHIP: Record<ChipState, string> = {
  current: "bg-surface-selected font-medium text-foreground",
  answered: "text-muted-foreground",
  pending: "text-muted-foreground/60",
};

/// Reads the whole form back into the answers the harness takes.
///
/// Every control of a step is named after that step — the primitive does the
/// naming — so one `getAll` per step is the step's whole answer, whatever shape
/// it took. `buildAnswers` is what tells a checked box from a typed sentence.
function answersOf(form: HTMLFormElement, questions: Question[]): QuestionAnswer[] {
  const data = new FormData(form);
  const values: Record<string, string[]> = {};

  for (const question of questions) {
    values[question.id] = data.getAll(question.id).map(String);
  }

  return buildAnswers(questions, values);
}
