import PermissionRequest from "@/components/chat/PermissionRequest";
import QuestionRequest from "@/components/chat/QuestionRequest";
import type { QuestionAnswer } from "@/lib/questionnaire";
import { toolArgument } from "@/lib/tools";
import type { PendingAsk } from "@/lib/transcript";

/// What the agent is blocked on, drawn where the reader is typing.
///
/// It used to be drawn inside the transcript, at the bottom of the turn stack —
/// which is right when the reader is reading, and wrong in the case that
/// actually happens: the agent stops mid-turn, the transcript is scrolled
/// somewhere else entirely, and the one thing on screen that needs an answer is
/// off it. The cards land here instead, in the pane that owns the composer, and
/// a pane without a composer keeps the transcript's own copy — see `Chat`.
///
/// **All of them, not just the newest.** Two requests can be open at once (a
/// main-thread call and a subagent's, or two calls that each asked), and the
/// transcript's copy is not drawn for this pane — so drawing one here would hide
/// the other with nothing on screen to say it exists.
///
/// The options are the agent's own (`PermissionRequest` renders them untouched),
/// and the words are the tool's own: nothing here composes a decision the agent
/// did not offer.
export default function PendingAskPanel({
  asks,
  sessionId,
  onRespond,
  onAnswer,
  onCancelQuestion,
  autoFocus,
}: {
  asks: PendingAsk[];
  sessionId: string;
  onRespond: (sessionId: string, requestId: string, optionId: string) => void;
  onAnswer: (sessionId: string, requestId: string, answers: QuestionAnswer[]) => void;
  /// The reader taking a question back, which the agent reads as a decline.
  onCancelQuestion: (sessionId: string, requestId: string) => void;
  /// The composer's own pane, which is the one whose card may take the caret.
  autoFocus: boolean;
}) {
  if (!asks.length) return null;

  return (
    // The gap is the panel's own, so the composer only has to place it: a card
    // that sits flush against the composer below it reads as part of the box.
    <div className="mb-2 flex flex-col gap-2">
      {asks.map((ask) =>
        ask.type === "questions_asked" ? (
          <QuestionRequest
            key={ask.requestId}
            questions={ask.questions}
            onAnswer={(answers) => onAnswer(sessionId, ask.requestId, answers)}
            onCancel={() => onCancelQuestion(sessionId, ask.requestId)}
            autoFocus={autoFocus}
          />
        ) : (
          <PermissionRequest
            key={ask.requestId}
            // The agent writes a description for nearly every call; the tool's
            // own name is the floor, so the card always has a subject.
            description={ask.description ?? ask.title ?? ask.displayName ?? ask.toolName}
            argument={toolArgument(ask.input)}
            options={ask.options}
            onRespond={(optionId) => onRespond(sessionId, ask.requestId, optionId)}
          />
        ),
      )}
    </div>
  );
}
