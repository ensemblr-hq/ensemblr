import { expect, test } from 'bun:test';
import type { SlashCommandDescriptor } from '../../src/renderer/components/workbench-shell/conversation-panel/composer/slash-commands';
import { sortSlashCommands } from '../../src/renderer/hooks/workbench-shell/composer/use-slash-commands';

const COMMANDS: SlashCommandDescriptor[] = [
	{
		autoSubmit: false,
		command: 'z-extension',
		description: 'Extension command',
		source: 'extension',
		sourceScope: 'user',
	},
	{
		autoSubmit: false,
		command: 'global-skill',
		description: 'Global skill command',
		source: 'skill',
		sourceScope: 'user',
	},
	{
		autoSubmit: false,
		command: 'temporary-global-skill',
		description: 'Global skill command from temporary scope',
		source: 'skill',
		sourceScope: 'temporary',
	},
	{
		autoSubmit: false,
		command: 'repo-skill',
		description: 'Repo skill command',
		source: 'skill',
		sourceScope: 'project',
	},
	{
		autoSubmit: false,
		command: 'prompt-template',
		description: 'Prompt template',
		source: 'prompt',
		sourceScope: 'user',
	},
	{
		autoSubmit: false,
		command: 'builtin-command',
		description: 'Built in command',
		source: 'builtin',
	},
];

test('slash commands default to repo skills, global skills, extensions', () => {
	const commands = sortSlashCommands(COMMANDS).map(
		(command) => command.command,
	);

	expect(commands).toEqual([
		'repo-skill',
		'global-skill',
		'temporary-global-skill',
		'z-extension',
		'prompt-template',
		'builtin-command',
	]);
});
