import type { GlobalEventInput } from '@hz/shared/global-events';
import type { SessionStreamWriter } from '../../service/session-system/index.js';

export interface QuestionnaireTurnStreamTarget {
  readonly stream: Pick<SessionStreamWriter, 'write'>;
  readonly activeTurnId: (sessionId: string) => string | undefined;
}

export interface QuestionnaireTurnStreamMirror {
  bind(target: QuestionnaireTurnStreamTarget): void;
  observe(event: GlobalEventInput): void;
}

/**
 * Mirrors `questionnaire.ask` onto the asking Session's Turn stream.
 *
 * The ask reaches a client over the global event stream, but a running prompt
 * only ends blocked when the frame arrives on the Turn stream that prompt is
 * reading: a client that sees the ask globally and nothing on the Turn stream
 * lets the Turn finish as an ordinary `end_turn`, and the answer's continuation
 * Turn is then delivered to nobody.
 */
export function createQuestionnaireTurnStreamMirror(): QuestionnaireTurnStreamMirror {
  let target: QuestionnaireTurnStreamTarget | undefined;
  return {
    bind(next: QuestionnaireTurnStreamTarget): void {
      target = next;
    },
    observe(event: GlobalEventInput): void {
      if (event.type !== 'questionnaire.ask' || !target) return;
      const { requestId, sessionId } = event.payload;
      const turnId = target.activeTurnId(sessionId);
      // An ask with no active Turn (a Goal or channel ask) blocks no prompt, and
      // a frame without a turnId is filtered out of every Run's reservation.
      if (!turnId) return;
      target.stream.write({
        // One frame per request: a replayed ask must not append a second one.
        identity: `questionnaire:${requestId}`,
        sessionId,
        turnId,
        kind: 'action-required',
        data: {
          type: 'runtime.action-required',
          kind: 'questionnaire',
          turnId,
          sessionId,
          requestId,
        },
      });
    },
  };
}
