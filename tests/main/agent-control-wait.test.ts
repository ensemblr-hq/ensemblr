import { describe, expect, it, vi } from 'vitest';
import type { WaitScheduler } from '../../src/main/agent-control/agent-control-service.ts';
import {
	type AgentControlPorts,
	createAgentControlService,
	createGuardrails,
	createOriginRegistry,
	type OriginRegistry,
} from '../../src/main/agent-control/index.ts';
import type {
	AgentControlConversationStatus,
	WaitForAgentsResult,
} from '../../src/shared/agent-control.ts';

/**
 * A deterministic scheduler: `sleep` advances a virtual clock so the wait loop's
 * deadline logic is exercised without real timers.
 */
const makeScheduler = (): WaitScheduler => {
	let clock = 0;
	return {
		now: () => clock,
		sleep: async (ms) => {
			clock += ms;
		},
	};
};

/**
 * Stub ports whose only live behavior is `getStatus` (driven by a per-session
 * status map) and `getLastMessage`. Everything else is a resolved no-op.
 */
const makePorts = (
	statuses: Map<string, string>,
	lastMessage: (agentSessionId: string) => string = (id) => `msg:${id}`,
): AgentControlPorts => ({
	workspaces: {
		listProjects: vi.fn().mockResolvedValue([]),
		listWorkspaces: vi.fn().mockResolvedValue([]),
	},
	tabs: {
		spawnChatTab: vi.fn().mockResolvedValue({ chatTabId: 't' }),
		closeTab: vi.fn().mockResolvedValue(undefined),
		openNonChatTab: vi.fn().mockResolvedValue({ chatTabId: 't' }),
		listTabs: vi.fn().mockResolvedValue([]),
		resolveTabWorkspace: vi.fn().mockResolvedValue('ws'),
	},
	conversations: {
		startConversation: vi
			.fn()
			.mockResolvedValue({ chatTabId: 't', agentSessionId: 'p' }),
		sendFollowUp: vi.fn().mockResolvedValue(undefined),
		setName: vi.fn().mockResolvedValue(null),
		waitForIdle: vi.fn().mockResolvedValue('completed'),
		getStatus: vi.fn<
			(
				agentSessionId: string,
			) => Promise<Omit<
				AgentControlConversationStatus,
				'hasFinalMessage'
			> | null>
		>(async (agentSessionId) => {
			const status = statuses.get(agentSessionId);
			return status ? { agentSessionId, status, runtimeOpen: true } : null;
		}),
		hasFinalMessage: vi.fn().mockResolvedValue(false),
		getLastMessage: vi.fn(async (agentSessionId: string) =>
			lastMessage(agentSessionId),
		),
		readTranscript: vi.fn().mockResolvedValue({
			entries: [],
			entryCount: 0,
			firstOrdinal: null,
			lastOrdinal: null,
			nextOrdinal: null,
			agentSessionId: 'p',
			turnCount: 0,
		}),
		isSpawnedSubAgent: vi.fn().mockResolvedValue(false),
		listModels: vi.fn().mockResolvedValue({ defaultModelId: null, models: [] }),
		resolveConversationWorkspace: vi.fn().mockResolvedValue('ws'),
	},
	terminals: {
		startTerminal: vi.fn().mockResolvedValue({ ok: true, terminalId: 't' }),
		stopTerminal: vi.fn().mockResolvedValue(undefined),
		writeTerminal: vi.fn().mockResolvedValue(undefined),
		readOutput: vi.fn().mockResolvedValue(''),
		listTerminals: vi.fn().mockResolvedValue([]),
		listRunScripts: vi.fn().mockResolvedValue({ scripts: [] }),
		resolveTerminalWorkspace: vi.fn().mockResolvedValue('ws'),
	},
	harnesses: {
		launchHarness: vi
			.fn()
			.mockResolvedValue({ chatTabId: 't', terminalId: 't' }),
	},
	focus: {
		focusTab: vi.fn(),
		focusDockTab: vi.fn(),
		focusPanel: vi.fn(),
		focusWorkspace: vi.fn(),
	},
	board: {
		setWorkspaceStatus: vi.fn(),
		getWorkspaceStatus: () => 'backlog',
	},
	diff: { readWorkspaceDiff: vi.fn() },
	review: {
		listComments: vi.fn(),
		addComments: vi.fn(),
		resolveComments: vi.fn(),
	},
	linear: {
		readLinkedIssue: vi.fn().mockReturnValue(null),
		listIssues: vi.fn(),
		getIssue: vi.fn(),
		getMetadata: vi.fn(),
		createComment: vi.fn(),
		createIssue: vi.fn(),
		updateIssue: vi.fn(),
	},
	permissions: { getMode: () => 'workspace-trusted' },
	commitCredit: { isCoAuthorEnabled: () => false },
	language: { getLanguage: () => 'en' },
	confirm: { confirm: vi.fn().mockResolvedValue(true) },
	ask: { ask: vi.fn(), releaseSession: vi.fn() },
	planMode: {
		activateForSpawn: vi.fn(),
		exit: vi.fn(),
		hasSubmittedPlan: vi.fn().mockReturnValue(false),
		isActive: vi.fn().mockReturnValue(false),
		releaseSession: vi.fn(),
	},
	afkMode: {
		activateForSpawn: vi.fn(),
		isActive: vi.fn(() => false),
		releaseSession: vi.fn(),
	},
	sessionNaming: {
		readBrief: vi.fn().mockResolvedValue({
			branch: { current: null, eligible: false },
			diagram: { components: [], stale: false },
			summaryStale: false,
			titleNeeded: false,
		}),
		setBranchName: vi.fn(),
		setSummary: vi.fn(),
	},
});

/**
 * Registers an orchestrator (`master`) plus `childCount` children, minting a
 * predictable token per session (`tok-<session>`).
 */
const setup = (options: {
	statuses: Map<string, string>;
	children: string[];
	guardrails?: Parameters<typeof createGuardrails>[0];
	lastMessage?: (agentSessionId: string) => string;
}) => {
	const registry: OriginRegistry = createOriginRegistry({
		generateToken: () => `tok-${Math.random()}`,
	});
	const master = registry.register({
		sessionId: 'master',
		workspaceId: 'ws',
		workspaceCwd: '/ws',
		species: 'pi',
	});
	const childOrigins = options.children.map((sessionId) =>
		registry.register({
			sessionId,
			workspaceId: 'ws',
			workspaceCwd: '/ws',
			species: 'pi',
			parentSessionId: 'master',
		}),
	);
	const service = createAgentControlService({
		ports: makePorts(options.statuses, options.lastMessage),
		originRegistry: registry,
		guardrails: createGuardrails(options.guardrails),
		scheduler: makeScheduler(),
	});
	return { service, registry, master, childOrigins };
};

describe('agent-control waitForAgents', () => {
	it('returns immediately when a child is already terminal (mode first)', async () => {
		const statuses = new Map([['c1', 'idle']]);
		const { service, master } = setup({ statuses, children: ['c1'] });
		const result = await service.invoke({
			op: 'waitForAgents',
			token: master.token,
			rawArgs: { mode: 'first' },
		});
		expect(result.ok).toBe(true);
		if (result.ok) {
			const data = result.data as WaitForAgentsResult;
			expect(data.timedOut).toBe(false);
			expect(data.completed).toHaveLength(1);
			expect(data.completed[0]).toMatchObject({
				agentSessionId: 'c1',
				status: 'idle',
				lastMessage: 'msg:c1',
			});
		}
	});

	it('defaults its targets to the caller’s children', async () => {
		const statuses = new Map([
			['c1', 'idle'],
			['c2', 'idle'],
		]);
		const { service, master } = setup({ statuses, children: ['c1', 'c2'] });
		const result = await service.invoke({
			op: 'waitForAgents',
			token: master.token,
			rawArgs: { mode: 'all' },
		});
		expect(result.ok).toBe(true);
		if (result.ok) {
			const data = result.data as WaitForAgentsResult;
			expect(data.timedOut).toBe(false);
			expect(data.completed.map((c) => c.agentSessionId).sort()).toEqual([
				'c1',
				'c2',
			]);
		}
	});

	it('times out when a child never settles (mode all)', async () => {
		const statuses = new Map([
			['c1', 'idle'],
			['c2', 'streaming'],
		]);
		const { service, master } = setup({ statuses, children: ['c1', 'c2'] });
		const result = await service.invoke({
			op: 'waitForAgents',
			token: master.token,
			rawArgs: { mode: 'all', timeoutMs: 1000 },
		});
		expect(result.ok).toBe(true);
		if (result.ok) {
			const data = result.data as WaitForAgentsResult;
			expect(data.timedOut).toBe(true);
			expect(data.completed.map((c) => c.agentSessionId)).toEqual(['c1']);
		}
	});

	// A child doing real work outlives the capped wait window routinely, and an
	// orchestrator reading a bare `timedOut: true` treats it as a fault to report
	// or a child to re-spawn. The call that resumes the wait has to travel as
	// prose, naming the ids, the same way a shortened report carries its pointer.
	it('tells a timed-out wait to resume on the pending children', async () => {
		const statuses = new Map([
			['c1', 'idle'],
			['c2', 'streaming'],
		]);
		const { service, master } = setup({ statuses, children: ['c1', 'c2'] });
		const result = await service.invoke({
			op: 'waitForAgents',
			token: master.token,
			rawArgs: { mode: 'all', timeoutMs: 1000 },
		});
		expect(result.ok).toBe(true);
		if (result.ok) {
			const data = result.data as WaitForAgentsResult;
			expect(data.note).toContain('Not a failure');
			expect(data.note).toContain('ensemblr_wait_for_agents');
			expect(data.note).toContain('"c2"');
			expect(data.note).not.toContain('"c1"');
			expect(data.note).toContain('mode: "all"');
		}
	});

	// A caller that chose `first` to react to whichever child lands first did not
	// ask to start blocking on all of them, so the resume note has to echo its own
	// mode rather than hand back the one the note was first written for.
	it('echoes the caller’s own mode in the resume note', async () => {
		const statuses = new Map([['c1', 'streaming']]);
		const { service, master } = setup({ statuses, children: ['c1'] });
		const result = await service.invoke({
			op: 'waitForAgents',
			token: master.token,
			rawArgs: { mode: 'first', timeoutMs: 1000 },
		});
		expect(result.ok).toBe(true);
		if (result.ok) {
			const data = result.data as WaitForAgentsResult;
			expect(data.timedOut).toBe(true);
			expect(data.note).toContain('mode: "first"');
			expect(data.note).not.toContain('mode: "all"');
		}
	});

	// After a restart the lineage registry is empty, so a default wait finds no
	// children and used to return a bare empty result — which reads as "nothing
	// needs me" at exactly the moment a resumed child's signal is parked and
	// unreachable. The recovery has to travel as prose.
	it('tells a default wait with no registered children how to recover them', async () => {
		const { service, master } = setup({ statuses: new Map(), children: [] });
		const result = await service.invoke({
			op: 'waitForAgents',
			token: master.token,
			rawArgs: {},
		});
		expect(result.ok).toBe(true);
		if (result.ok) {
			const data = result.data as WaitForAgentsResult;
			expect(data.completed).toEqual([]);
			expect(data.pending).toEqual([]);
			expect(data.timedOut).toBe(false);
			expect(data.note).toContain('restarted');
			expect(data.note).toContain('targets');
			expect(data.note).toContain('ensemblr_get_last_message');
		}
	});

	// The same empty result is a settled answer when the caller named its targets,
	// so the recovery note would only be noise.
	it('omits the recovery note when the caller named an empty target list', async () => {
		const { service, master } = setup({ statuses: new Map(), children: [] });
		const result = await service.invoke({
			op: 'waitForAgents',
			token: master.token,
			rawArgs: { targets: [] },
		});
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect((result.data as WaitForAgentsResult).note).toBeUndefined();
		}
	});

	it('omits the resume note when every child settled', async () => {
		const statuses = new Map([
			['c1', 'idle'],
			['c2', 'idle'],
		]);
		const { service, master } = setup({ statuses, children: ['c1', 'c2'] });
		const result = await service.invoke({
			op: 'waitForAgents',
			token: master.token,
			rawArgs: { mode: 'all' },
		});
		expect(result.ok).toBe(true);
		if (result.ok) {
			const data = result.data as WaitForAgentsResult;
			expect(data.timedOut).toBe(false);
			expect(data.note).toBeUndefined();
		}
	});

	it('is woken early by a child need_decision signal', async () => {
		const statuses = new Map([
			['c1', 'streaming'],
			['c2', 'streaming'],
		]);
		const { service, master, childOrigins } = setup({
			statuses,
			children: ['c1', 'c2'],
		});
		const notify = await service.invoke({
			op: 'notifyOrchestrator',
			token: childOrigins[1].token,
			rawArgs: { reason: 'need_decision', message: 'which framework?' },
		});
		expect(notify.ok).toBe(true);
		const result = await service.invoke({
			op: 'waitForAgents',
			token: master.token,
			rawArgs: { mode: 'first', timeoutMs: 1000 },
		});
		expect(result.ok).toBe(true);
		if (result.ok) {
			const data = result.data as WaitForAgentsResult;
			expect(data.timedOut).toBe(false);
			expect(data.completed).toHaveLength(1);
			expect(data.completed[0]).toMatchObject({
				agentSessionId: 'c2',
				signal: { reason: 'need_decision', message: 'which framework?' },
			});
		}
	});

	it('reports nothing when the waiting turn ends mid-wait', async () => {
		const statuses = new Map([['c1', 'streaming']]);
		const { service, master } = setup({ statuses, children: ['c1'] });
		const result = await service.invoke({
			op: 'waitForAgents',
			token: master.token,
			rawArgs: { mode: 'first', timeoutMs: 1000 },
			signal: AbortSignal.abort(),
		});
		expect(result.ok).toBe(true);
		if (result.ok) {
			const data = result.data as WaitForAgentsResult;
			expect(data.completed).toEqual([]);
			expect(data.timedOut).toBe(false);
			expect(data.pending).toEqual([
				{ agentSessionId: 'c1', status: 'streaming' },
			]);
		}
	});

	// Reading a report consumes the child's escalation, so an abandoned wait must
	// not take one: the child raised its hand for whoever asks next, not for a turn
	// that has already gone.
	it('leaves a child’s signal for the next wait when its turn ended', async () => {
		const statuses = new Map([['c1', 'streaming']]);
		const { service, master, childOrigins } = setup({
			statuses,
			children: ['c1'],
		});
		await service.invoke({
			op: 'notifyOrchestrator',
			token: childOrigins[0].token,
			rawArgs: { reason: 'need_decision', message: 'which framework?' },
		});
		await service.invoke({
			op: 'waitForAgents',
			token: master.token,
			rawArgs: { mode: 'first', timeoutMs: 1000 },
			signal: AbortSignal.abort(),
		});

		const result = await service.invoke({
			op: 'waitForAgents',
			token: master.token,
			rawArgs: { mode: 'first', timeoutMs: 1000 },
		});
		expect(result.ok).toBe(true);
		if (result.ok) {
			const data = result.data as WaitForAgentsResult;
			expect(data.completed).toHaveLength(1);
			expect(data.completed[0]).toMatchObject({
				agentSessionId: 'c1',
				signal: { reason: 'need_decision', message: 'which framework?' },
			});
		}
	});

	// The playbook promises a `need_decision` wakes the wait immediately, with no
	// mode attached to the promise. Under `all` the child would otherwise sit on
	// its question until the five-minute wait timeout.
	it('is woken by a signal under mode all, while a sibling still runs', async () => {
		const statuses = new Map([
			['c1', 'streaming'],
			['c2', 'streaming'],
		]);
		const { service, master, childOrigins } = setup({
			statuses,
			children: ['c1', 'c2'],
		});
		await service.invoke({
			op: 'notifyOrchestrator',
			token: childOrigins[1].token,
			rawArgs: { reason: 'blocked', message: 'the credentials are missing' },
		});
		const result = await service.invoke({
			op: 'waitForAgents',
			token: master.token,
			rawArgs: { mode: 'all', timeoutMs: 1000 },
		});
		expect(result.ok).toBe(true);
		if (result.ok) {
			const data = result.data as WaitForAgentsResult;
			expect(data.timedOut).toBe(false);
			expect(data.completed.map((agent) => agent.agentSessionId)).toEqual([
				'c2',
			]);
			expect(data.pending).toEqual([
				{ agentSessionId: 'c1', status: 'streaming' },
			]);
		}
	});

	// An informational signal is not a question, so it must not cut a wait short.
	it('keeps waiting through a progress signal under mode all', async () => {
		const statuses = new Map([
			['c1', 'idle'],
			['c2', 'streaming'],
		]);
		const { service, master, childOrigins } = setup({
			statuses,
			children: ['c1', 'c2'],
		});
		await service.invoke({
			op: 'notifyOrchestrator',
			token: childOrigins[1].token,
			rawArgs: { reason: 'progress', message: 'halfway through' },
		});
		const result = await service.invoke({
			op: 'waitForAgents',
			token: master.token,
			rawArgs: { mode: 'all', timeoutMs: 1000 },
		});
		expect(result.ok).toBe(true);
		if (result.ok) {
			const data = result.data as WaitForAgentsResult;
			expect(data.timedOut).toBe(true);
			expect(data.completed.map((agent) => agent.agentSessionId)).toEqual([
				'c1',
			]);
		}
	});

	it('names the children still running so the caller can wait on them again', async () => {
		const statuses = new Map([
			['c1', 'idle'],
			['c2', 'streaming'],
			['c3', 'streaming'],
		]);
		const { service, master } = setup({
			statuses,
			children: ['c1', 'c2', 'c3'],
		});
		const result = await service.invoke({
			op: 'waitForAgents',
			token: master.token,
			rawArgs: { mode: 'first', timeoutMs: 1000 },
		});
		expect(result.ok).toBe(true);
		if (result.ok) {
			const data = result.data as WaitForAgentsResult;
			expect(data.completed.map((agent) => agent.agentSessionId)).toEqual([
				'c1',
			]);
			expect(data.pending).toEqual([
				{ agentSessionId: 'c2', status: 'streaming' },
				{ agentSessionId: 'c3', status: 'streaming' },
			]);
		}
	});

	it('refuses to wait on an ancestor session (deadlock)', async () => {
		const statuses = new Map([['master', 'streaming']]);
		const { service, childOrigins } = setup({
			statuses,
			children: ['c1'],
		});
		const result = await service.invoke({
			op: 'waitForAgents',
			token: childOrigins[0].token,
			rawArgs: { targets: ['master'] },
		});
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.code).toBe('denied-deadlock');
		}
	});

	it('returns an empty result when the caller has no children', async () => {
		const { service, master } = setup({ statuses: new Map(), children: [] });
		const result = await service.invoke({
			op: 'waitForAgents',
			token: master.token,
			rawArgs: {},
		});
		expect(result.ok).toBe(true);
		if (result.ok) {
			const data = result.data as WaitForAgentsResult;
			expect(data.completed).toEqual([]);
			expect(data.pending).toEqual([]);
			expect(data.timedOut).toBe(false);
		}
	});

	it('hands back the whole report by default', async () => {
		const report = `answer\n\n${'evidence\n'.repeat(400)}`;
		const { service, master } = setup({
			statuses: new Map([['c1', 'idle']]),
			children: ['c1'],
			lastMessage: () => report,
		});
		const result = await service.invoke({
			op: 'waitForAgents',
			token: master.token,
			rawArgs: { mode: 'all' },
		});
		expect(result.ok).toBe(true);
		if (result.ok) {
			const data = result.data as WaitForAgentsResult;
			expect(data.completed[0]?.lastMessage).toBe(report);
			expect(data.completed[0]?.reportTruncated).toBe(false);
		}
	});

	it('shortens a long report and points at get_last_message when asked to', async () => {
		const report = `The loader reads settings.toml.\n\n${'evidence\n'.repeat(400)}`;
		const { service, master } = setup({
			statuses: new Map([['c1', 'idle']]),
			children: ['c1'],
			lastMessage: () => report,
		});
		const result = await service.invoke({
			op: 'waitForAgents',
			token: master.token,
			rawArgs: { mode: 'all', reports: 'brief' },
		});
		expect(result.ok).toBe(true);
		if (result.ok) {
			const data = result.data as WaitForAgentsResult;
			const shortened = data.completed[0];
			expect(shortened?.reportTruncated).toBe(true);
			expect(shortened?.lastMessage).toContain(
				'The loader reads settings.toml.',
			);
			expect(shortened?.lastMessage).toContain('ensemblr_get_last_message');
			expect(shortened?.lastMessage).toContain('c1');
			expect((shortened?.lastMessage ?? '').length).toBeLessThan(report.length);
		}
	});

	it('leaves a short report alone even under brief reports', async () => {
		const { service, master } = setup({
			statuses: new Map([['c1', 'idle']]),
			children: ['c1'],
		});
		const result = await service.invoke({
			op: 'waitForAgents',
			token: master.token,
			rawArgs: { mode: 'all', reports: 'brief' },
		});
		expect(result.ok).toBe(true);
		if (result.ok) {
			const data = result.data as WaitForAgentsResult;
			expect(data.completed[0]?.lastMessage).toBe('msg:c1');
			expect(data.completed[0]?.reportTruncated).toBe(false);
		}
	});

	// Reading a report means a synchronous descending scan of a whole final turn on
	// the main thread. A child that settles early would otherwise be re-read on every
	// 250ms tick until its siblings finish, and every read but the last discarded.
	it('reads an early-settling child’s report once, not on every poll tick', async () => {
		const reads: string[] = [];
		const { service, master } = setup({
			statuses: new Map([
				['c1', 'idle'],
				['c2', 'streaming'],
			]),
			children: ['c1', 'c2'],
			lastMessage: (agentSessionId) => {
				reads.push(agentSessionId);
				return `msg:${agentSessionId}`;
			},
		});

		const result = await service.invoke({
			op: 'waitForAgents',
			token: master.token,
			rawArgs: { mode: 'all', timeoutMs: 1000 },
		});

		expect(result.ok).toBe(true);
		if (result.ok) {
			const data = result.data as WaitForAgentsResult;
			expect(data.timedOut).toBe(true);
			expect(data.completed).toEqual([
				{
					agentSessionId: 'c1',
					status: 'idle',
					lastMessage: 'msg:c1',
					reportTruncated: false,
					signal: null,
				},
			]);
			expect(data.pending).toEqual([
				{ agentSessionId: 'c2', status: 'streaming' },
			]);
		}
		expect(reads).toEqual(['c1']);
	});

	it('rejects a report detail it does not offer', async () => {
		const { service, master } = setup({
			statuses: new Map([['c1', 'idle']]),
			children: ['c1'],
		});
		const result = await service.invoke({
			op: 'waitForAgents',
			token: master.token,
			rawArgs: { reports: 'summary' },
		});
		expect(result.ok).toBe(false);
	});
});

describe('agent-control notifyOrchestrator', () => {
	it('fails for a root session with no orchestrator', async () => {
		const { service, master } = setup({ statuses: new Map(), children: [] });
		const result = await service.invoke({
			op: 'notifyOrchestrator',
			token: master.token,
			rawArgs: { reason: 'blocked', message: 'stuck' },
		});
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.code).toBe('not-found');
		}
	});
});
