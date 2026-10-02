import { expect, test } from 'vitest';
import { normalizeSlashCommands } from '../../src/renderer/lib/workbench/slash-command-order';
import type { SlashCommandDescriptor } from '../../src/renderer/types/workbench';

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
	const commands = normalizeSlashCommands(COMMANDS).map(
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

// Claude Code reports a skill once per discovery root it resolved through, so
// one `/code-review` arrives four times and every copy renders as its own row.
test('collapses a command reported more than once into a single entry', () => {
	const repeated: SlashCommandDescriptor[] = [
		{ autoSubmit: false, command: 'code-review', description: 'Deep review' },
		{ autoSubmit: false, command: 'code-review', description: 'Deep review' },
		{ autoSubmit: false, command: 'code-review', description: 'Deep review' },
		{ autoSubmit: false, command: 'react-doctor', description: 'Diagnostics' },
		{ autoSubmit: false, command: 'react-doctor', description: 'Diagnostics' },
	];

	expect(normalizeSlashCommands(repeated)).toEqual([
		{ autoSubmit: false, command: 'code-review', description: 'Deep review' },
		{ autoSubmit: false, command: 'react-doctor', description: 'Diagnostics' },
	]);
});

test('keeps the best-ranked copy of a repeated command name', () => {
	const repeated: SlashCommandDescriptor[] = [
		{
			autoSubmit: false,
			command: 'review',
			description: '',
			source: 'prompt',
			sourceScope: 'user',
		},
		{
			autoSubmit: true,
			command: 'review',
			description: 'Project review skill',
			source: 'skill',
			sourceScope: 'project',
		},
	];

	expect(normalizeSlashCommands(repeated)).toEqual([
		{
			autoSubmit: true,
			command: 'review',
			description: 'Project review skill',
			source: 'skill',
			sourceScope: 'project',
		},
	]);
});

test('prefers the described copy when two repeats rank the same', () => {
	const repeated: SlashCommandDescriptor[] = [
		{ autoSubmit: false, command: 'ship', description: '   ' },
		{ autoSubmit: false, command: 'ship', description: 'Ship the release' },
	];

	expect(normalizeSlashCommands(repeated)[0]?.description).toBe(
		'Ship the release',
	);
});
