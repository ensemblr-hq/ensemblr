import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import type {
	AgentProviderExecutableService,
	AgentProviderReadinessProbe,
} from '../../src/main/agent-providers/agent-provider-types.ts';
import type { OpenTargetService } from '../../src/main/open-target/index.ts';
import type { AgentProviderReadinessWire } from '../../src/shared/ipc/contracts/agent-provider.ts';

const handle = vi.fn();
const showOpenDialog = vi.fn();

vi.mock('electron', () => ({
	BrowserWindow: { fromWebContents: () => null },
	dialog: { showOpenDialog },
	ipcMain: { handle },
}));

const { createAgentProviderService } = await import(
	'../../src/main/agent-providers/agent-provider-service.ts'
);
const { registerAgentProviderHandlers } = await import(
	'../../src/main/ipc/handlers/agent-provider.ts'
);

let homeDirectory: string;
let openedTargets: { targetId: string; workspacePath: string }[];
let saved: { path: string; provider: string }[];
let probed: string[];
let rosterCalls: { cwd: string; provider: string }[];
let slashCommandCalls: { cwd: string; provider: string }[];

/** Builds an executable-service stub that records writes for one provider. */
function createExecutableService(
	provider: string,
	resolvedPath: string,
): AgentProviderExecutableService {
	let override: string | null = null;

	return {
		clearOverride: () => {
			override = null;
			saved.push({ path: '', provider });
			return { canceled: false };
		},
		getSnapshot: async () => ({
			path: override ?? resolvedPath,
			setting: override
				? {
						candidates: [],
						key: `${provider}.executablePath`,
						locked: false,
						source: 'sqlite' as const,
						value: override,
					}
				: null,
			source: override ? 'sqlite' : 'path',
			status: 'ok' as const,
		}),
		saveOverride: (executablePath) => {
			override = executablePath;
			saved.push({ path: executablePath, provider });
			return { canceled: false, selectedPath: executablePath };
		},
	};
}

/** Builds a readiness probe stub that records that it ran. */
function createProbe(provider: 'claude' | 'pi'): AgentProviderReadinessProbe {
	return {
		probe: async () => {
			probed.push(provider);
			return {
				account: null,
				checks: [],
				executablePath: null,
				executableSource: 'missing',
				provider,
				status: 'success',
				updatedAt: '2026-08-07T00:00:00.000Z',
				usage: null,
				version: null,
			} satisfies AgentProviderReadinessWire;
		},
		provider,
	};
}

/** Finds a registered handler by channel and invokes it with a payload. */
function invoke(channel: string, request: unknown): Promise<unknown> {
	const registration = handle.mock.calls.find(([name]) => name === channel);

	if (!registration) {
		throw new Error(`${channel} handler was not registered`);
	}

	return registration[1]({}, request);
}

beforeEach(() => {
	handle.mockClear();
	showOpenDialog.mockReset();
	homeDirectory = mkdtempSync(path.join(tmpdir(), 'ensemblr-provider-ipc-'));
	openedTargets = [];
	saved = [];
	probed = [];
	rosterCalls = [];
	slashCommandCalls = [];

	const openTargetService = {
		listTargets: async () => [],
		openTarget: async (input: { targetId: string; workspacePath: string }) => {
			openedTargets.push({
				targetId: input.targetId,
				workspacePath: input.workspacePath,
			});
			return { ok: true as const };
		},
	} as unknown as OpenTargetService;

	registerAgentProviderHandlers({
		agentProviderService: createAgentProviderService({
			executables: {
				claude: createExecutableService('claude', '/opt/homebrew/bin/claude'),
				pi: createExecutableService('pi', '/opt/homebrew/bin/pi'),
			},
			homeDirectory,
			mcpRosters: {
				claude: async (cwd) => {
					rosterCalls.push({ cwd, provider: 'claude' });
					return {
						error: null,
						servers: [{ error: null, name: 'linear', status: 'needs-auth' }],
					};
				},
			},
			probes: { claude: createProbe('claude'), pi: createProbe('pi') },
			slashCommandCatalogs: {
				claude: async (cwd) => {
					slashCommandCalls.push({ cwd, provider: 'claude' });
					return {
						commands: [
							{ autoSubmit: false, command: 'review', description: 'Review' },
						],
						error: null,
						source: 'runtime',
					};
				},
				pi: async (cwd) => {
					slashCommandCalls.push({ cwd, provider: 'pi' });
					return {
						commands: [
							{
								autoSubmit: true,
								command: 'compact',
								description: 'Compact',
								source: 'builtin',
							},
						],
						error: null,
						source: 'static',
					};
				},
			},
		}),
		openTargetService,
	});
});

afterEach(() => {
	rmSync(homeDirectory, { force: true, recursive: true });
});

test('registers exactly the eight parameterized provider channels', () => {
	expect(handle.mock.calls.map(([channel]) => channel)).toEqual([
		'ensemblr:get-agent-provider-readiness',
		'ensemblr:list-agent-provider-mcp-servers',
		'ensemblr:list-agent-provider-slash-commands',
		'ensemblr:get-agent-provider-executable-path',
		'ensemblr:set-agent-provider-executable-path',
		'ensemblr:clear-agent-provider-executable-path',
		'ensemblr:select-agent-provider-executable',
		'ensemblr:open-agent-provider-settings-file',
	]);
});

test('readiness routes pi to the Pi-backed probe', async () => {
	const readiness = await invoke('ensemblr:get-agent-provider-readiness', {
		provider: 'pi',
	});

	expect(probed).toEqual(['pi']);
	expect(readiness).toMatchObject({ provider: 'pi' });
});

test('readiness routes claude to the Claude-backed probe', async () => {
	await invoke('ensemblr:get-agent-provider-readiness', {
		provider: 'claude',
	});

	expect(probed).toEqual(['claude']);
});

test('the MCP roster routes to the runtime registered for that provider', async () => {
	const claude = await invoke('ensemblr:list-agent-provider-mcp-servers', {
		cwd: '/workspaces/demo',
		provider: 'claude',
	});
	const pi = await invoke('ensemblr:list-agent-provider-mcp-servers', {
		cwd: '/workspaces/demo',
		provider: 'pi',
	});

	expect(rosterCalls).toEqual([
		{ cwd: '/workspaces/demo', provider: 'claude' },
	]);
	expect(claude).toEqual({
		error: null,
		servers: [{ error: null, name: 'linear', status: 'needs-auth' }],
	});
	// Pi registers no roster, so it reads as empty rather than as a failure.
	expect(pi).toEqual({ error: null, servers: [] });
});

test('slash commands route to the runtime registered for that provider', async () => {
	const claude = await invoke('ensemblr:list-agent-provider-slash-commands', {
		cwd: '/workspaces/demo',
		provider: 'claude',
	});
	const pi = await invoke('ensemblr:list-agent-provider-slash-commands', {
		cwd: '/workspaces/demo',
		provider: 'pi',
	});

	expect(slashCommandCalls).toEqual([
		{ cwd: '/workspaces/demo', provider: 'claude' },
		{ cwd: '/workspaces/demo', provider: 'pi' },
	]);
	expect(claude).toEqual({
		commands: [{ autoSubmit: false, command: 'review', description: 'Review' }],
		error: null,
		source: 'runtime',
	});
	expect(pi).toEqual({
		commands: [
			{
				autoSubmit: true,
				command: 'compact',
				description: 'Compact',
				source: 'builtin',
			},
		],
		error: null,
		source: 'static',
	});
});

test('slash commands reject a request with no workspace directory', async () => {
	await expect(
		invoke('ensemblr:list-agent-provider-slash-commands', {
			cwd: '',
			provider: 'claude',
		}),
	).rejects.toThrow();
	expect(slashCommandCalls).toEqual([]);
});

test('the MCP roster rejects a request with no workspace directory', async () => {
	await expect(
		invoke('ensemblr:list-agent-provider-mcp-servers', {
			cwd: '',
			provider: 'claude',
		}),
	).rejects.toThrow();
	expect(rosterCalls).toEqual([]);
});

test('every channel rejects an unknown provider id', async () => {
	const channels = [
		'ensemblr:get-agent-provider-readiness',
		'ensemblr:get-agent-provider-executable-path',
		'ensemblr:clear-agent-provider-executable-path',
		'ensemblr:select-agent-provider-executable',
	];

	await expect(
		invoke('ensemblr:list-agent-provider-mcp-servers', {
			cwd: '/workspaces/demo',
			provider: 'codex',
		}),
	).rejects.toThrow();
	await expect(
		invoke('ensemblr:list-agent-provider-slash-commands', {
			cwd: '/workspaces/demo',
			provider: 'codex',
		}),
	).rejects.toThrow();

	for (const channel of channels) {
		await expect(invoke(channel, { provider: 'codex' })).rejects.toThrow();
	}

	await expect(
		invoke('ensemblr:set-agent-provider-executable-path', {
			path: '/usr/bin/codex',
			provider: 'codex',
		}),
	).rejects.toThrow();
	await expect(
		invoke('ensemblr:open-agent-provider-settings-file', {
			provider: 'codex',
			target: 'finder',
		}),
	).rejects.toThrow();
	expect(probed).toEqual([]);
	expect(saved).toEqual([]);
});

test('a missing provider is rejected rather than defaulted to Pi', async () => {
	await expect(
		invoke('ensemblr:get-agent-provider-readiness', {}),
	).rejects.toThrow();
	await expect(
		invoke('ensemblr:get-agent-provider-readiness', undefined),
	).rejects.toThrow();
	expect(probed).toEqual([]);
});

test('setting an override writes to the addressed provider and returns the snapshot', async () => {
	const snapshot = await invoke('ensemblr:set-agent-provider-executable-path', {
		path: '/custom/pi',
		provider: 'pi',
	});

	expect(saved).toEqual([{ path: '/custom/pi', provider: 'pi' }]);
	expect(snapshot).toEqual({
		error: null,
		overridePath: '/custom/pi',
		provider: 'pi',
		resolvedPath: '/custom/pi',
		source: 'sqlite',
		status: 'ok',
	});
});

test('clearing an override reverts the snapshot to discovery', async () => {
	await invoke('ensemblr:set-agent-provider-executable-path', {
		path: '/custom/claude',
		provider: 'claude',
	});

	const snapshot = await invoke(
		'ensemblr:clear-agent-provider-executable-path',
		{ provider: 'claude' },
	);

	expect(snapshot).toMatchObject({
		overridePath: null,
		provider: 'claude',
		resolvedPath: '/opt/homebrew/bin/claude',
		source: 'path',
	});
});

test('an empty path is rejected before it reaches the executable service', async () => {
	await expect(
		invoke('ensemblr:set-agent-provider-executable-path', {
			path: '',
			provider: 'pi',
		}),
	).rejects.toThrow();
	expect(saved).toEqual([]);
});

test('selecting an executable saves the picked path', async () => {
	showOpenDialog.mockResolvedValue({
		canceled: false,
		filePaths: ['/picked/claude'],
	});

	const result = await invoke('ensemblr:select-agent-provider-executable', {
		provider: 'claude',
	});

	expect(result).toEqual({
		canceled: false,
		selectedPath: '/picked/claude',
	});
	expect(saved).toEqual([{ path: '/picked/claude', provider: 'claude' }]);
});

test('a canceled picker saves nothing', async () => {
	showOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] });

	const result = await invoke('ensemblr:select-agent-provider-executable', {
		provider: 'claude',
	});

	expect(result).toEqual({ canceled: true });
	expect(saved).toEqual([]);
});

test('opening the Claude settings file resolves ~ against the home directory', async () => {
	const result = await invoke('ensemblr:open-agent-provider-settings-file', {
		provider: 'claude',
		target: 'finder',
	});
	const settingsPath = path.join(homeDirectory, '.claude', 'settings.json');

	expect(result).toEqual({ opened: true });
	expect(existsSync(settingsPath)).toBe(true);
	expect(readFileSync(settingsPath, 'utf8')).toBe('{}\n');
	expect(openedTargets).toEqual([
		{ targetId: 'finder', workspacePath: path.dirname(settingsPath) },
	]);
});

test('opening a settings file for a provider that has none reports it', async () => {
	const result = await invoke('ensemblr:open-agent-provider-settings-file', {
		provider: 'pi',
		target: 'finder',
	});

	expect(result).toMatchObject({ opened: false });
	expect(openedTargets).toEqual([]);
});
