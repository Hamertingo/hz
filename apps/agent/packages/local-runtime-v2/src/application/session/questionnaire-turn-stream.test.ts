import { describe, expect, it, vi } from "vitest";

import { createQuestionnaireTurnStreamMirror } from "./questionnaire-turn-stream.js";

function askEvent(sessionId: string, requestId = "ask_1") {
  return {
    type: "questionnaire.ask" as const,
    payload: { requestId, sessionId, request: { id: requestId } },
  } as unknown as Parameters<
    ReturnType<typeof createQuestionnaireTurnStreamMirror>["observe"]
  >[0];
}

function harness(activeTurnId: (sessionId: string) => string | undefined) {
  const write = vi.fn();
  const mirror = createQuestionnaireTurnStreamMirror();
  mirror.bind({ stream: { write }, activeTurnId });
  return { mirror, write };
}

describe("questionnaire turn stream mirror", () => {
  it("writes the ask onto the asking Session's active Turn", () => {
    const { mirror, write } = harness((sessionId) =>
      sessionId === "session-1" ? "turn-1" : undefined,
    );

    mirror.observe(askEvent("session-1"));

    expect(write).toHaveBeenCalledTimes(1);
    expect(write.mock.calls[0]?.[0]).toMatchObject({
      identity: "questionnaire:ask_1",
      sessionId: "session-1",
      turnId: "turn-1",
      kind: "action-required",
      data: {
        type: "runtime.action-required",
        kind: "questionnaire",
        turnId: "turn-1",
        sessionId: "session-1",
        requestId: "ask_1",
      },
    });
  });

  it("keeps the frame off a Turn stream when no Turn is active", () => {
    const { mirror, write } = harness(() => undefined);

    mirror.observe(askEvent("session-1"));

    expect(write).not.toHaveBeenCalled();
  });

  it("ignores every other global event", () => {
    const { mirror, write } = harness(() => "turn-1");

    mirror.observe({
      type: "session.finish",
      payload: { sessionId: "session-1", turnId: "turn-1", agentName: "mcode" },
    } as never);

    expect(write).not.toHaveBeenCalled();
  });

  it("ignores an ask observed before its target is bound", () => {
    const mirror = createQuestionnaireTurnStreamMirror();

    expect(() => mirror.observe(askEvent("session-1"))).not.toThrow();
  });
});
