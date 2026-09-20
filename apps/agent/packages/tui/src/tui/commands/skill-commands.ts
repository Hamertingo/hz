/**
 * The Skills a reader has, as composer commands.
 *
 * **One builder, two clients, and it used to be one.** The TUI put these in its
 * own `/` menu and the ACP advertisement published a static table of the
 * built-in commands — so an ACP client, which draws exactly what the agent
 * advertises, saw no Skills at all while the terminal saw seventeen. A Skill the
 * composer offers and the wire omits is a Skill half the readers cannot reach.
 *
 * **A Skill is a command, and the name is the whole invocation.** Typing
 * `/code-review` sends that word; the catalog this runtime contributes to the
 * system prompt is what tells the model which Skill the word names, and the
 * `skill` tool is what loads the SKILL.md. Nothing expands anything client-side,
 * which is why publishing the name is all a client needs to offer the Skill.
 */
import type { TuiSkillList } from '../../types/runtime-models.js';
import { sanitizeTerminalText } from '../rendering/terminal-text.js';
import {
  MINIMAX_CODE_ACTIVE_RUN_COMMANDS,
  MINIMAX_CODE_COMMANDS,
  type TuiCommand,
} from './catalog.js';

export function buildTuiSkillCommands(result: TuiSkillList): TuiCommand[] {
  const builtinNames = new Set(
    [...MINIMAX_CODE_COMMANDS, ...MINIMAX_CODE_ACTIVE_RUN_COMMANDS].flatMap((command) =>
      [command.name, ...(command.aliases ?? [])].map((name) => name.toLocaleLowerCase()),
    ),
  );
  const seen = new Set<string>();
  return (result.skills ?? [])
    .flatMap((skill): TuiCommand[] => {
      const name = skill.name.trim().toLocaleLowerCase();
      if (
        skill.enabled === false ||
        builtinNames.has(name) ||
        seen.has(name) ||
        !name ||
        name.length > 128 ||
        name !== sanitizeTerminalText(name) ||
        /[\s/]/u.test(name)
      ) {
        return [];
      }
      seen.add(name);
      return [
        {
          name,
          description: formatSkillCommandDescription(skill.displayDescription ?? skill.description),
          category: 'Capability',
          invocationKind: 'skill',
          argumentHint: '[instructions]',
          usage: `/${name} [instructions]`,
          composerTemplate: `/${name} `,
        },
      ];
    })
    .sort((left, right) => left.name.localeCompare(right.name));
}

function formatSkillCommandDescription(description: string | undefined): string {
  const value = description ? sanitizeTerminalText(description).trim() : '';
  return value ? `[Skill] ${value}` : '[Skill]';
}
