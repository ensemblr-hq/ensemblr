import { describe, expect, it, vi } from 'vitest';

import {
	type AgentControlPorts,
	createAgentControlService,
	createGuardrails,
	createOriginRegistry,
} from '../../src/main/agent-control/index.ts';
import type { AgentSpecies } from '../../src/main/agent-control/ports.ts';
import { BranchSlugRejected } from '../../src/main/agent-runtime/naming/apply-branch-slug.ts';
import {
	buildLanguageDirective,
	SESSION_BRIEF_NUDGE_HEADER,
} from '../../src/shared/agent-control.ts';
import type { AppLanguage } from '../../src/shared/i18n.ts';

const CALLER = 'caller';

const idleBrief = {
	branch: { current: null, eligible: false },
	summaryStale: false,
	titleNeeded: false,
};

function setup(
	overrides: {
		readBrief?: unknown;
		setBranchName?: unknown;
		setName?: unknown;
		setSummary?: unknown;
		species?: AgentSpecies;
		language?: AppLanguage;
	} = {},
) {
	const registry = createOriginRegistry({ generateToken: () => 'tok' });
	registry.register({
		sessionId: CALLER,
		species: overrides.species ?? 'pi',
		workspaceCwd: '/ws',
		workspaceId: 'ws',
	});
	const ports = {
		ask: { ask: vi.fn(), releaseSession: vi.fn() },
		board: {
			getWorkspaceStatus: vi.fn().mockReturnValue('backlog'),
			setWorkspaceStatus: vi.fn(),
		},
		confirm: { confirm: vi.fn().mockResolvedValue(true) },
		conversations: {
			isSpawnedSubAgent: vi.fn().mockResolvedValue(false),
			setName:
				overrides.setName ??
				vi.fn().mockResolvedValue({
					applied: true,
					chatTabId: 't',
					title: 'Named',
				}),
		},
		focus: { focusDockTab: vi.fn(), focusPanel: vi.fn(), focusTab: vi.fn() },
		harnesses: { launchHarness: vi.fn() },
		language: { getLanguage: () => overrides.language ?? 'en' },
		permissions: { getMode: () => 'workspace-trusted' },
		planMode: { exit: vi.fn(), isActive: () => false, releaseSession: vi.fn() },
		sessionNaming: {
			readBrief: overrides.readBrief ?? vi.fn().mockResolvedValue(idleBrief),
			setBranchName: overrides.setBranchName ?? vi.fn(),
			setSummary: overrides.setSummary ?? vi.fn(),
		},
		tabs: { listTabs: vi.fn(), resolveTabWorkspace: vi.fn() },
		terminals: { listTerminals: vi.fn() },
		workspaces: { listWorkspaces: vi.fn() },
	} as unknown as AgentControlPorts;
	const service = createAgentControlService({
		guardrails: createGuardrails(),
		originRegistry: registry,
		ports,
	});
	const invoke = (
		op: Parameters<typeof service.invoke>[0]['op'],
		rawArgs: Record<string, unknown> = {},
	) => service.invoke({ op, rawArgs, token: 'tok' });
	return { invoke, ports, service };
}

describe('setBranchName', () => {
	it('reports an already-named workspace as a success the agent should not retry', async () => {
		const { invoke } = setup({
			setBranchName: vi.fn().mockResolvedValue({
				applied: false,
				branchName: 'octocat/add-dark-mode',
				message: 'already named; do not call this tool again in this session.',
				name: 'add-dark-mode',
			}),
		});

		const result = await invoke('setBranchName', { name: 'something-else' });

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.data).toMatchObject({ applied: false });
		}
	});

	it('surfaces a rejected slug as invalid-args so the agent can pick another', async () => {
		const { invoke } = setup({
			setBranchName: vi
				.fn()
				.mockRejectedValue(
					new BranchSlugRejected('collision', 'branch already exists'),
				),
		});

		const result = await invoke('setBranchName', { name: 'add-dark-mode' });

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.code).toBe('invalid-args');
			expect(result.error).toContain('branch already exists');
		}
	});

	it('rejects an empty slug before it reaches the port', async () => {
		const setBranchName = vi.fn();
		const { invoke } = setup({ setBranchName });

		const result = await invoke('setBranchName', { name: '   ' });

		expect(result.ok).toBe(false);
		expect(setBranchName).not.toHaveBeenCalled();
	});
});

describe('setSummary', () => {
	it('records the summary for a Pi caller', async () => {
		const setSummary = vi
			.fn()
			.mockResolvedValue({ capturedAtOrdinal: 7, message: 'Recorded.' });
		const { invoke } = setup({ setSummary });

		const result = await invoke('setSummary', {
			summary: '- Fixed the guard',
			title: 'Login redirect fix',
		});

		expect(result.ok).toBe(true);
		expect(setSummary).toHaveBeenCalledWith(
			expect.objectContaining({
				summary: '- Fixed the guard',
				title: 'Login redirect fix',
			}),
		);
	});

	it('denies a harness caller, which owns no chat tab', async () => {
		const setSummary = vi.fn();
		const { invoke } = setup({ setSummary, species: 'harness' });

		const result = await invoke('setSummary', {
			summary: 'Body.',
			title: 'Topic',
		});

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.code).toBe('denied-scope');
		}
		expect(setSummary).not.toHaveBeenCalled();
	});

	// The gate is the chat tab, not the runtime: a first-class Claude conversation
	// owns one, so its summary lands in the same place a Pi conversation's does.
	it('records the summary for a first-class Claude caller', async () => {
		const setSummary = vi.fn();
		const { invoke } = setup({ setSummary, species: 'claude' });

		const result = await invoke('setSummary', {
			summary: 'Body.',
			title: 'Topic',
		});

		expect(result.ok).toBe(true);
		expect(setSummary).toHaveBeenCalledWith(
			expect.objectContaining({ summary: 'Body.', title: 'Topic' }),
		);
	});
});

describe('setName', () => {
	it('reports a user-owned title as settled rather than failed', async () => {
		const { invoke } = setup({
			setName: vi.fn().mockResolvedValue({
				applied: false,
				chatTabId: 't',
				title: 'Chosen by hand',
			}),
		});

		const result = await invoke('setName', { title: 'Agent guess' });

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.data).toMatchObject({
				applied: false,
				title: 'Chosen by hand',
			});
		}
	});

	it('fails when the conversation is not active', async () => {
		const { invoke } = setup({ setName: vi.fn().mockResolvedValue(null) });

		const result = await invoke('setName', { title: 'Whatever' });

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.code).toBe('not-found');
		}
	});
});

describe('getSessionBrief', () => {
	it('renders no upkeep block when nothing is outstanding', async () => {
		const { invoke } = setup();

		const result = await invoke('getSessionBrief');

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.data).toMatchObject({ nudge: null, planMode: false });
		}
	});

	it('renders the upkeep block from the naming state', async () => {
		const { invoke } = setup({
			readBrief: vi.fn().mockResolvedValue({
				branch: { current: 'octocat/bach', eligible: true },
				summaryStale: true,
				titleNeeded: true,
			}),
		});

		const result = await invoke('getSessionBrief');

		expect(result.ok).toBe(true);
		if (result.ok) {
			const { nudge } = result.data as { nudge: string | null };
			expect(nudge).toContain(SESSION_BRIEF_NUDGE_HEADER);
			expect(nudge).toContain('ensemblr_set_name');
			expect(nudge).toContain('octocat/bach');
			expect(nudge).toContain('ensemblr_set_summary');
		}
	});

	it('never prompts for approval, whatever the permission mode', async () => {
		const { invoke } = setup();

		expect((await invoke('getSessionBrief')).ok).toBe(true);
	});

	it('carries the language directive for a translated app', async () => {
		const { invoke } = setup({ language: 'ru' });

		const result = await invoke('getSessionBrief');

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.data).toMatchObject({
				languageDirective: buildLanguageDirective('ru'),
			});
		}
	});

	it('carries no language directive for an English app', async () => {
		const { invoke } = setup();

		const result = await invoke('getSessionBrief');

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.data).toMatchObject({ languageDirective: null });
		}
	});
});

describe('readTurnPreamble', () => {
	it('appends the language directive to the upkeep block', async () => {
		const { service } = setup({
			language: 'el',
			readBrief: vi.fn().mockResolvedValue({
				branch: { current: null, eligible: false },
				summaryStale: true,
				titleNeeded: false,
			}),
		});

		const preamble = await service.readTurnPreamble(CALLER);

		expect(preamble).toContain(SESSION_BRIEF_NUDGE_HEADER);
		expect(preamble).toContain(buildLanguageDirective('el') ?? '');
	});

	it('returns the directive alone when no upkeep is outstanding', async () => {
		const { service } = setup({ language: 'ru' });

		expect(await service.readTurnPreamble(CALLER)).toBe(
			buildLanguageDirective('ru'),
		);
	});

	it('returns nothing when the app is English and nothing is outstanding', async () => {
		const { service } = setup();

		expect(await service.readTurnPreamble(CALLER)).toBeNull();
	});

	it('reports nothing for a session with no resolvable origin', async () => {
		const { service } = setup({ language: 'ru' });

		expect(await service.readTurnPreamble('unknown')).toBeNull();
	});
});
