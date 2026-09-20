import type { ProcessLocalContext } from "@hz/conversation-contract";

/** Transport-neutral context accepted by local-runtime-v2 Application use cases. */
export interface ApplicationContext extends ProcessLocalContext {}
