import {
  FILE_OPERATION_RULES,
  LANGUAGE_RULES,
  SYSTEM_REMINDER_DESCRIPTION,
  TOOL_CALL_PREAMBLE_REMINDER,
  TOOL_USAGE_RULES,
} from '../prompt-blocks.js';

export function addRuntimeRules(
  prompt: string,
  interactiveSurface: boolean,
  rootSessionPrompt = '',
): string {
  const harnessRules = [`- ${SYSTEM_REMINDER_DESCRIPTION}`, FILE_OPERATION_RULES];
  if (process.platform === 'win32') {
    harnessRules.push(
      '- Install system software with winget, scoop, choco, or similar only with explicit user approval.',
      '- Preserve the existing CRLF or LF line endings when editing files.',
    );
  }
  let result = addSectionGuidance(prompt, '# Harness', harnessRules.join('\n'));
  // On every surface, interactive or not: choosing a tool is not a matter of who
  // is watching, and a task child has the narrower tool list of the two — the one
  // whose descriptions most need to be taken as the whole answer.
  result = addSectionGuidance(result, '# Choosing a Tool', TOOL_USAGE_RULES);
  result = addSectionGuidance(
    result,
    '## Response Style',
    LANGUAGE_RULES,
    '# Communication & Delivery',
  );
  if (interactiveSurface) {
    if (rootSessionPrompt.trim()) {
      result = addSectionGuidance(result, '# Core Judgment', rootSessionPrompt.trim());
    }
    result = addSectionGuidance(
      result,
      '## Preamble messages',
      TOOL_CALL_PREAMBLE_REMINDER,
      '# Communication & Delivery',
    );
  }
  return result;
}

/** Insert before range projection; headings inside fenced examples are data. */
function addSectionGuidance(
  prompt: string,
  heading: string,
  guidance: string,
  fallbackHeading = heading,
): string {
  const lines = prompt.split('\n');
  const headings = findPromptHeadings(lines);
  const targetHeading = headings.has(headingTitle(heading)) ? heading : fallbackHeading;
  const target = headings.get(headingTitle(targetHeading));
  if (target === undefined) {
    return [prompt.trim(), `${fallbackHeading}\n${guidance}`].filter(Boolean).join('\n\n');
  }
  // Apollo and custom prompts may retain older levels; follow their existing hierarchy.
  const levelOffset = target.level - targetHeading.indexOf(' ');
  const guidanceLines = alignGuidanceHeadings(guidance, levelOffset);
  const insertionIndex = target.index + 1;
  let contentIndex = insertionIndex;
  while (contentIndex < lines.length && !lines[contentIndex]?.trim()) contentIndex += 1;
  const continuesList =
    /^[-*+] /u.test(guidanceLines.at(-1) ?? '') && /^[-*+] /u.test(lines[contentIndex] ?? '');
  lines.splice(
    insertionIndex,
    contentIndex - insertionIndex,
    ...guidanceLines,
    ...(contentIndex < lines.length && !continuesList ? [''] : []),
  );
  return lines.join('\n');
}

function alignGuidanceHeadings(guidance: string, levelOffset: number): string[] {
  const lines = guidance.split('\n');
  for (const { index, level } of findPromptHeadings(lines).values()) {
    lines[index] =
      `${'#'.repeat(Math.min(6, Math.max(1, level + levelOffset)))} ${headingTitle(lines[index] ?? '')}`;
  }
  return lines;
}

function headingTitle(heading: string): string {
  return heading.replace(/^#{1,6} /u, '').trim();
}

function findPromptHeadings(
  lines: readonly string[],
): ReadonlyMap<string, { readonly index: number; readonly level: number }> {
  const headings = new Map<string, { index: number; level: number }>();
  let fence = '';
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    const marker = /^ {0,3}(`{3,}|~{3,})/u.exec(line)?.[1];
    if (marker) {
      if (!fence) fence = marker;
      else if (marker[0] === fence[0] && marker.length >= fence.length) fence = '';
      continue;
    }
    const heading = !fence && /^(#{1,6}) /u.exec(line);
    if (heading && !headings.has(headingTitle(line))) {
      headings.set(headingTitle(line), { index, level: heading[1]!.length });
    }
  }
  return headings;
}
