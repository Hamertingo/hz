/** Prefixes the global/project instruction layers so the model treats them as overriding defaults. */
export const INSTRUCTIONS_CONTEXT_PREAMBLE = [
  "As you answer the user's questions, you can use the following context:",
  'Codebase and user instructions are shown below. Be sure to adhere to these instructions. IMPORTANT: These instructions OVERRIDE any default behavior and you MUST follow them exactly as written.',
].join('\n');

export const SYSTEM_REMINDER_DESCRIPTION =
  '`<system-reminder>` tags in messages and tool results are injected by the harness, not the user. ' +
  'Treat these reminders separately from the surrounding user input or tool output.';

export const TOOL_CALL_PREAMBLE_REMINDER =
  'For any non-trivial tool-call step, you MUST first send a non-empty, user-visible assistant text block. ' +
  'Thinking or reasoning content does not count as the preamble.';

export const LANGUAGE_RULES =
  'Follow explicit user language instructions. Otherwise, match the current conversation language; ' +
  'use appLocale when no language preference is established.';

export const ENVIRONMENT_RULES = [
  'Use the working directory unless the user specifies another path.',
  'Resolve runtime-owned files (config, MCP configuration, agents, skills, memory, logs) from activeDataDir; older paths in context may belong to an inactive profile. This does not override workspace files, external skill paths, or explicit user paths.',
].join('\n');

export const FILE_OPERATION_RULES = [
  '- Do not choose Desktop, Downloads, home, or temp directories for outputs unless the user explicitly asks for that location.',
  '- When searching across directories, search the workspace first. If not found, ask the user before expanding scope — do not silently widen the search.',
  "- Verify a concrete file's current state before reporting it as existing or delivering it. Reuse conclusive tool results; check the filesystem when the state is uncertain.",
].join('\n');

/**
 * How to *choose* a tool, which is the half the tool schemas cannot state.
 *
 * The base prompt's `# Tool Usage` section covers the style of the preamble that
 * accompanies a call; it says nothing about which tool to reach for. This says
 * that, once, for every surface — including custom and task-child prompts, which
 * is why it is injected rather than written into a base prompt file.
 *
 * **It names no tools on purpose.** A policy that lists `grep`/`glob`/`read` ages
 * badly the moment a tool is added or renamed, and the tool list it must agree
 * with is built per turn from that turn's facts. What is durable is the shape of
 * the decision — known target versus unknown, specialized versus generic, act
 * versus delegate — so that is what is written down here.
 *
 * The first sentence is the load-bearing one: it makes the tool list itself the
 * answer, which is what stops an agent from spending calls investigating how to
 * do something a tool already does.
 */
export const TOOL_USAGE_RULES = [
  'The available tool list and each tool description are authoritative. Do not search the workspace, the web, or documentation to find out how an available tool works, and do not call a tool merely to discover whether another one exists.',
  '- Choose the tool that most directly matches the operation, and prefer a specialized tool over a generic shell command that would do the same thing.',
  '- Reach for search and discovery when you do not know where something is, and for read or lookup when you do.',
  '- Use the file-editing tools to change files, and the execution tools for commands, tests, builds, and other runtime work.',
  '- Use an external-service tool for the service it belongs to, and a delegation tool when the work is independent enough to run on its own.',
  '- Do not do by hand what an available tool does directly.',
  '- When a call fails, read the error and change the next action rather than repeating the same call.',
].join('\n');

export interface MemoryPromptBlockOptions {
  /** Hidden task children and legacy read-through blocks are read-only. */
  readonly includeWriteGuidance?: boolean;
  /** Exact retired owner that supplied a compatibility block. */
  readonly sourceAgent?: string;
  readonly legacy?: boolean;
}

export interface MemoryPromptSource {
  readonly agentName: string;
  readonly canonical: boolean;
}

function includeMemoryWriteGuidance(options?: MemoryPromptBlockOptions): boolean {
  return options?.includeWriteGuidance !== false && options?.legacy !== true;
}

function memoryProvenanceAttributes(options?: MemoryPromptBlockOptions): string {
  if (!options?.legacy || !options.sourceAgent) return '';
  return ` sourceAgent="${escapeXml(options.sourceAgent)}" legacy="true"`;
}

export function buildUserProfileBlock(
  content: string,
  capNote = '',
  options?: MemoryPromptBlockOptions,
): string {
  const writeGuidance = includeMemoryWriteGuidance(options);
  return [
    '<user_profile>',
    'What you know about the user so far:',
    '',
    content + capNote,
    '',
    '---',
    'The profile is durable context, not an activity log.',
    ...(writeGuidance
      ? [
          'Use the native `memory` tool for updates; do not edit this injected block directly.',
          'Do NOT store: sensitive guesses, psychological labels, one-off moods, raw logs, transient task status, or routine recaps.',
        ]
      : []),
    '</user_profile>',
  ].join('\n');
}

export function buildMemorySummaryBlock(
  summary: string,
  memoryPath: string,
  options?: MemoryPromptBlockOptions,
): string {
  return [
    `<agent_memory_summary${memoryProvenanceAttributes(options)}>`,
    `This is the INDEX of your MEMORY.md (full file: ${memoryPath}).`,
    'The <agent_memory_tail> below only shows the most recent slice — older entries are NOT in the tail.',
    'Use the source: line ranges below to Read the full file directly when you need older content.',
    'Topic files are listed separately in <available_memory_topics>; this index does NOT cover them.',
    '',
    summary,
    '</agent_memory_summary>',
  ].join('\n');
}

export function buildMemoryTailBlock(
  tail: string,
  memoryPath: string,
  options?: MemoryPromptBlockOptions,
): string {
  const writeGuidance = includeMemoryWriteGuidance(options);
  return [
    `<agent_memory_tail path="${memoryPath}"${memoryProvenanceAttributes(options)}>`,
    ...(writeGuidance
      ? [
          'Recent entries from your memory. If anything below needs updating, use the `memory` tool (target=main, operation=edit) — do NOT append.',
        ]
      : ['Recent entries from your memory.']),
    '',
    tail,
    '</agent_memory_tail>',
  ].join('\n');
}

export function buildMemoryNoteBlock(memoryPath: string): string {
  return [
    '<agent_memory_note>',
    'Memory exceeded the injection budget — older entries are not shown above.',
    `For older entries, read ${memoryPath}; for topic files, see <available_memory_topics>.`,
    '</agent_memory_note>',
  ].join('\n');
}

export function buildAvailableMemoryTopicsBlock(
  topics: readonly {
    readonly name: string;
    readonly description: string;
    readonly path: string;
  }[],
  options?: MemoryPromptBlockOptions,
): string {
  const writeGuidance = includeMemoryWriteGuidance(options);
  return [
    `<available_memory_topics${memoryProvenanceAttributes(options)}>`,
    'Topic bodies are NOT injected — only metadata below.',
    ...(writeGuidance
      ? [
          'To READ a topic: use Read tool with `path`. To UPDATE a topic: use the `memory` tool (target=topic).',
        ]
      : ['To READ a topic: use Read tool with `path`.']),
    '',
    ...topics.flatMap((topic) => [
      '  <topic>',
      `    name: ${escapeXml(topic.name)}`,
      `    desc: ${escapeXml(topic.description)}`,
      `    path: ${topic.path}`,
      '  </topic>',
    ]),
    '</available_memory_topics>',
  ].join('\n');
}

export function buildDailyMemoryBlock(content: string): string {
  return [
    '<daily_digest>',
    'Recent daily summaries — what happened in the past few days.',
    '',
    content,
    '</daily_digest>',
  ].join('\n');
}

function escapeXml(value: string): string {
  return value.replace(/&/gu, '&amp;').replace(/</gu, '&lt;').replace(/>/gu, '&gt;');
}
