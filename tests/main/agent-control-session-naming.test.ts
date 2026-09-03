import { describe, expect, it, vi } from 'vitest';

import {
	type AgentControlPorts,
	createAgentControlService,
	createGuardrails,
	createOriginRegistry,
} from '../../src/main/agent-control/index.ts';
import type { AgentSpecies } from '../../src/main/agent-control/ports.ts';
import { BranchSlugRejected } from '../../src/main/agent-runtime/naming/apply-branch-slug.ts';
import type { SubagentMechanism } from '../../src/shared/agent-control.ts';
import {
	buildLanguageDirective,
	buildLinkedIssueDirective,
	buildPlanModeDelegationDirective,
	LINKED_ISSUE_DIRECTIVE_HEADER,
	PLAN_MODE_DELEGATION_HEADER,
	PLAN_REFINEMENT_DIRECTIVE,
	PLAN_REFINEMENT_HEADER,
	SESSION_BRIEF_NUDGE_HEADER,
	type WorkspaceLinkedIssue,
} from '../../src/shared/agent-control.ts';
import type { AppLanguage } from '../../src/shared/i18n.ts';

const CALLER = 'caller';

const idleBrief = {
	branch: { current: null, eligible: false },
	summaryStale: false,
	titleNeeded: false,
};

const LINKED_ISSUE: WorkspaceLinkedIssue = {
	accountId: 'acct-1',
	identifier: 'ENG-106',
	provider: 'linear',
	title: 'Expose Linear to agents',
	url: 'https://linear.app/the/issue/ENG-106',
};

function setup(
	overrides: {
		planMode?: boolean;
		planSubmitted?: boolean;
		readBrief?: unknown;
		setBranchName?: unknown;
		setName?: unknown;
		setSummary?: unknown;
		species?: AgentSpecies;
		language?: AppLanguage;
		linkedIssue?: WorkspaceLinkedIssue;
		subAgent?: boolean;
		delegation?: SubagentMechanism;
	} = {},
) {
	const registry = createOriginRegistry({ generateToken: () => 'tok' });
	registry.register({
		delegation: overrides.delegation ?? 'ensemblr',
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
			isSpawnedSubAgent: vi.fn().mockResolvedValue(overrides.subAgent ?? false),
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
		linear: {
			readLinkedIssue: vi.fn().mockReturnValue(overrides.linkedIssue ?? null),
		},
		permissions: { getMode: () => 'workspace-trusted' },
		planMode: {
			exit: vi.fn(),
			hasSubmittedPlan: () => overrides.planSubmitted ?? false,
			isActive: () => overrides.planMode ?? false,
			releaseSession: vi.fn(),
		},
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

	// The Pi extension appends whatever this field holds, so a brief that omits it
	// reaches Pi as nothing at all however good the directive is.
	it('carries the linked-issue directive for a workspace with an issue', async () => {
		const { invoke } = setup({ linkedIssue: LINKED_ISSUE });

		const result = await invoke('getSessionBrief');

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.data).toMatchObject({
				issueDirective: buildLinkedIssueDirective(LINKED_ISSUE),
			});
		}
	});

	it('carries no linked-issue directive for a workspace with none', async () => {
		const { invoke } = setup();

		const result = await invoke('getSessionBrief');

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.data).toMatchObject({ issueDirective: null });
		}
	});

	// The role decides which triggers the block names, and a sub-agent is refused
	// both tracker writes. Hardcoding `'orchestrator'` here would still satisfy
	// every other case, and would send a spawned child at an op it cannot call.
	it('cuts the linked-issue directive to a sub-agent role', async () => {
		const { invoke } = setup({ linkedIssue: LINKED_ISSUE, subAgent: true });

		const result = await invoke('getSessionBrief');

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.data).toMatchObject({
				issueDirective: buildLinkedIssueDirective(LINKED_ISSUE, 'subagent'),
			});
			expect(result.data).toMatchObject({
				issueDirective: expect.stringContaining(
					'refused to a spawned sub-agent',
				),
			});
			expect(result.data).not.toMatchObject({
				issueDirective: expect.stringContaining(
					"move the issue to your team's In Review state",
				),
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

	it('tells a refinement turn to close on another plan submission', async () => {
		const { service } = setup({ planMode: true, planSubmitted: true });

		expect(await service.readTurnPreamble(CALLER)).toContain(
			PLAN_REFINEMENT_DIRECTIVE,
		);
	});

	it('leaves the refinement directive off a planning turn with no plan under review', async () => {
		const { service } = setup({ planMode: true });

		expect(await service.readTurnPreamble(CALLER)).not.toContain(
			PLAN_REFINEMENT_HEADER,
		);
	});

	it('answers the harness plan workflow on every planning turn', async () => {
		const { service } = setup({ planMode: true });

		expect(await service.readTurnPreamble(CALLER)).toBe(
			buildPlanModeDelegationDirective({
				delegation: 'ensemblr',
				role: 'orchestrator',
			}),
		);
	});

	it('leaves the delegation directive off a turn that is not planning', async () => {
		const { service } = setup({ language: 'ru' });

		expect(await service.readTurnPreamble(CALLER)).not.toContain(
			PLAN_MODE_DELEGATION_HEADER,
		);
	});

	it('renders the native variant for a session pinned to the runtime tool', async () => {
		const { service } = setup({ delegation: 'native', planMode: true });

		expect(await service.readTurnPreamble(CALLER)).toBe(
			buildPlanModeDelegationDirective({
				delegation: 'native',
				role: 'orchestrator',
			}),
		);
	});

	it('renders the investigator variant for a planning sub-agent', async () => {
		const { service } = setup({ planMode: true, subAgent: true });

		expect(await service.readTurnPreamble(CALLER)).toBe(
			buildPlanModeDelegationDirective({
				delegation: 'ensemblr',
				role: 'subagent',
			}),
		);
	});

	it('orders the delegation directive after the upkeep block and before the refinement one', async () => {
		const { service } = setup({
			planMode: true,
			planSubmitted: true,
			readBrief: vi.fn().mockResolvedValue({
				branch: { current: null, eligible: false },
				summaryStale: true,
				titleNeeded: false,
			}),
		});

		const preamble = (await service.readTurnPreamble(CALLER)) ?? '';

		expect(preamble.indexOf(SESSION_BRIEF_NUDGE_HEADER)).toBeLessThan(
			preamble.indexOf(PLAN_MODE_DELEGATION_HEADER),
		);
		expect(preamble.indexOf(PLAN_MODE_DELEGATION_HEADER)).toBeLessThan(
			preamble.indexOf(PLAN_REFINEMENT_HEADER),
		);
	});

	// Two blocks are cut from the same role, and resolving one reads the tab
	// marker out of the database. A preamble that resolved it per block would pay
	// that query twice on every turn of every Claude session.
	it('resolves the caller’s role once, however many blocks are cut from it', async () => {
		const { ports, service } = setup({
			linkedIssue: {
				accountId: null,
				identifier: 'ENS-1',
				provider: 'linear',
				title: 'Ship it',
				url: null,
			},
			planMode: true,
		});

		await service.readTurnPreamble(CALLER);

		expect(ports.conversations.isSpawnedSubAgent).toHaveBeenCalledTimes(1);
	});

	it('orders the refinement directive after the upkeep block and before the language one', async () => {
		const { service } = setup({
			language: 'ru',
			planMode: true,
			planSubmitted: true,
			readBrief: vi.fn().mockResolvedValue({
				branch: { current: null, eligible: false },
				summaryStale: true,
				titleNeeded: false,
			}),
		});

		const preamble = (await service.readTurnPreamble(CALLER)) ?? '';

		expect(preamble.indexOf(SESSION_BRIEF_NUDGE_HEADER)).toBeGreaterThanOrEqual(
			0,
		);
		expect(preamble.indexOf(PLAN_REFINEMENT_HEADER)).toBeGreaterThan(
			preamble.indexOf(SESSION_BRIEF_NUDGE_HEADER),
		);
		expect(
			preamble.indexOf(buildLanguageDirective('ru') ?? ''),
		).toBeGreaterThan(preamble.indexOf(PLAN_REFINEMENT_HEADER));
	});

	// The directive is what makes an agent move a ticket unprompted, and a static
	// playbook cannot carry it: it names an issue only this workspace has.
	it('names the workspace linked issue on every turn', async () => {
		const { service } = setup({ linkedIssue: LINKED_ISSUE });

		const preamble = (await service.readTurnPreamble(CALLER)) ?? '';

		expect(preamble).toContain(LINKED_ISSUE_DIRECTIVE_HEADER);
		expect(preamble).toContain('ENG-106');
	});

	it('leaves the issue block off a workspace with no linked issue', async () => {
		const { service } = setup();

		expect(await service.readTurnPreamble(CALLER)).toBeNull();
	});

	// `linearUpdateIssue` is denied while planning, so the block a planning turn
	// receives must not be the one that tells it to move the ticket.
	it('cuts the issue block to what a planning turn may actually do', async () => {
		const { service } = setup({ linkedIssue: LINKED_ISSUE, planMode: true });

		const preamble = (await service.readTurnPreamble(CALLER)) ?? '';

		expect(preamble).toContain(
			buildLinkedIssueDirective(LINKED_ISSUE, 'orchestrator', true) ?? '',
		);
		expect(preamble).toContain('refused while you are planning');
	});

	// This is the only channel a directly-prompted runtime has. Claude Code sees
	// Plan Mode as the SDK's `permissionMode: 'plan'` and never receives the
	// Pi-only plan-mode playbook, so without the carve-out here it reads its own
	// "MUST NOT run any non-readonly tools" and defers every naming call until
	// after the plan is approved.
	it('carries the plan-mode carve-out while the session is planning', async () => {
		const { service } = setup({
			planMode: true,
			readBrief: vi.fn().mockResolvedValue({
				branch: { current: 'octocat/bach', eligible: true },
				summaryStale: true,
				titleNeeded: true,
			}),
		});

		const preamble = (await service.readTurnPreamble(CALLER)) ?? '';

		expect(preamble).toContain(
			'You are planning, and every item below is still',
		);
		expect(preamble).toContain('A restriction on non-read-only tools does not');
		expect(preamble).toContain('before `ensemblr_exit_plan_mode`');
	});

	it('keeps the standard wording when the session is not planning', async () => {
		const { service } = setup({
			readBrief: vi.fn().mockResolvedValue({
				branch: { current: 'octocat/bach', eligible: true },
				summaryStale: true,
				titleNeeded: true,
			}),
		});

		const preamble = (await service.readTurnPreamble(CALLER)) ?? '';

		expect(preamble).not.toContain('You are planning');
		expect(preamble).toContain('BEFORE you write your closing answer');
	});
});
