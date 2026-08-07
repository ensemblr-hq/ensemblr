import type {
	Options,
	Query,
	SlashCommand,
} from '@anthropic-ai/claude-agent-sdk';
import { describe, expect, it } from 'vitest';

import { createClaudeSlashCommands } from '../../src/main/claude-agent/claude-slash-commands.ts';

const EXECUTABLE = '/opt/homebrew/bin/claude';

/** One SDK command with only the fields the projection reads. */
function command(
	name: string,
	description: string,
	argumentHint = '',
): SlashCommand {
	return { argumentHint, description, name };
}

/** Builds a catalogue reader over a scripted `supportedCommands()` result. */
function createCatalogue(
	respond: () => Promise<readonly SlashCommand[]>,
	resolveExecutablePath: () => string | null = () => EXECUTABLE,
): {
	capturedOptions: Options[];
	closed: () => boolean;
	list: (
		cwd: string,
	) => ReturnType<ReturnType<typeof createClaudeSlashCommands>>;
} {
	const capturedOptions: Options[] = [];
	let closed = false;

	const list = createClaudeSlashCommands({
		queryFn: ({ options }) => {
			if (options) {
				capturedOptions.push(options);
			}
			return {
				close: () => {
					closed = true;
				},
				supportedCommands: async () => [...(await respond())],
			} as unknown as Query;
		},
		resolveBaseEnv: () => ({ PATH: '/usr/bin' }),
		resolveExecutablePath,
	});

	return { capturedOptions, closed: () => closed, list };
}

describe('Claude Code slash commands are read against the workspace', () => {
	it('points the discovery session at the workspace so project commands resolve', async () => {
		const catalogue = createCatalogue(async () => [
			command('review', 'Review a pull request'),
		]);

		await catalogue.list('/workspaces/demo');

		expect(catalogue.capturedOptions[0]).toMatchObject({
			cwd: '/workspaces/demo',
			pathToClaudeCodeExecutable: EXECUTABLE,
			permissionMode: 'plan',
		});
	});

	it('projects every reported command onto the wire', async () => {
		const catalogue = createCatalogue(async () => [
			command('review', 'Review a pull request', '<pr>'),
			command('context-mode:ctx-stats', 'Show context savings'),
		]);

		const result = await catalogue.list('/workspaces/demo');

		expect(result).toEqual({
			commands: [
				{
					autoSubmit: false,
					command: 'review',
					description: 'Review a pull request',
				},
				{
					autoSubmit: false,
					command: 'context-mode:ctx-stats',
					description: 'Show context savings',
				},
			],
			error: null,
			source: 'runtime',
		});
	});

	it('closes the discovery session once the commands are read', async () => {
		const catalogue = createCatalogue(async () => [
			command('review', 'Review'),
		]);

		await catalogue.list('/workspaces/demo');

		expect(catalogue.closed()).toBe(true);
	});

	it('reports the failure instead of an empty catalogue when the read throws', async () => {
		const catalogue = createCatalogue(async () => {
			throw new Error('claude exited before initializing');
		});

		const result = await catalogue.list('/workspaces/demo');

		expect(result).toEqual({
			commands: [],
			error: 'claude exited before initializing',
			source: 'runtime',
		});
		expect(catalogue.closed()).toBe(true);
	});

	it('never starts a session when no claude executable resolved', async () => {
		const catalogue = createCatalogue(
			async () => [command('review', 'Review')],
			() => null,
		);

		const result = await catalogue.list('/workspaces/demo');

		expect(result.commands).toEqual([]);
		expect(result.error).toMatch(/claude executable/);
		expect(catalogue.capturedOptions).toEqual([]);
	});
});
