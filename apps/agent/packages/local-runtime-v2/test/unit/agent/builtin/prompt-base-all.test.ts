import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/// The base prompt as the runtime reads it: `readBasePrompt` opens
/// `prompt-base-all.md` by exact name, and never the `.md.hbs` beside it.
const basePrompt = await readFile(
  fileURLToPath(new URL('../../../../assets/agents/_default/prompt-base-all.md', import.meta.url)),
  'utf8',
);

describe('the shipped base prompt', () => {
  it('teaches the todo list, because the roster ships the tool', () => {
    // The `.hbs` beside this file gates the section on `tools.todowrite`, so the
    // guidance only reaches the model if the *file the runtime reads* carries it.
    // It did not: the tool was in `AGENT_BUILTIN_TOOL_IDS`, implemented as
    // `LocalTodoWriteTool`, and never mentioned — which is why the agent did not
    // know it had one.
    expect(basePrompt).toContain('## Task Management');
    expect(basePrompt).toContain('in_progress');
  });

  it('carries the sections the template beside it has', () => {
    // `prompt-base-all.md` is a frozen render of `prompt-base-all.md.hbs` and
    // nothing in the build regenerates it, so a section the template gained after
    // that render is a section the agent never reads — which is how the todo
    // guidance, and everything about long-running commands, went missing.
    //
    // Deliberately not required: the template's own `## TEST Gray Verification`
    // (a vendor QA gate), and the two sections that advertise tools this build
    // has not confirmed on the roster (`web_search`, the `cron` family).
    for (const heading of [
      '## Parallel Calls',
      '## Avoid Redundant Reads',
      '# Shell Constraints',
      '## Run it yourself',
      '## Non-interactive shell',
      '## Bash timeout',
    ]) {
      expect(basePrompt).toContain(heading);
    }
  });
});
