import { describe, expect, it, vi } from 'vitest';

import {
	type LinearPortDeps,
	makeLinearPort,
} from '../../src/main/agent-control/linear-ports.ts';
import type { LinearService } from '../../src/main/linear';
import {
	LINEAR_AGENT_LIMITS,
	MAX_AGENT_PAYLOAD_CHARS,
} from '../../src/shared/agent-control.ts';
import type {
	CreateLinearCommentResult,
	GetLinearIssueResult,
	GetLinearMetadataResult,
	LinearCommentWire,
	LinearIssueWire,
	LinearResourceWire,
	LinearServiceFailure,
	ListLinearIssuesResult,
	MutateLinearIssueResult,
} from '../../src/shared/ipc/contracts/linear.ts';

const WORKSPACE_ID = 'ws-1';

const issueWire = (
	overrides: Partial<LinearIssueWire> = {},
): LinearIssueWire => ({
	accountId: 'acct-1',
	archivedAt: null,
	assigneeId: 'u-1',
	assigneeName: 'Ada',
	cycleId: null,
	cycleName: null,
	description: 'Wire Linear into agent-control.',
	dueDate: null,
	id: 'i-1',
	identifier: 'ENG-106',
	labels: [{ color: null, id: 'l-1', name: 'agent' }],
	organizationName: 'Example Org',
	priority: 2,
	projectId: 'p-1',
	projectName: 'Ensemble',
	stateColor: null,
	stateId: 's-started',
	stateName: 'In Progress',
	stateType: 'started',
	syncedAt: '2026-08-08T00:00:00.000Z',
	teamId: 't-1',
	teamKey: 'THE',
	teamName: 'Example Org',
	title: 'Expose Linear to agents',
	updatedAt: '2026-08-08T00:00:00.000Z',
	url: 'https://linear.app/the/issue/ENG-106',
	...overrides,
});

const commentWire = (
	overrides: Partial<LinearCommentWire> = {},
): LinearCommentWire => ({
	authorName: 'Ada',
	body: 'looks good',
	createdAt: '2026-08-08T00:00:00.000Z',
	id: 'c-1',
	...overrides,
});

const stateWire = (
	overrides: Partial<LinearResourceWire> = {},
): LinearResourceWire => ({
	accountId: 'acct-1',
	color: null,
	id: 's-started',
	key: null,
	kind: 'state',
	name: 'In Progress',
	organizationName: 'Example Org',
	teamId: 't-1',
	type: 'started',
	...overrides,
});

const failure = (
	overrides: Partial<LinearServiceFailure> = {},
): LinearServiceFailure => ({
	code: 'network',
	message: 'Linear did not answer.',
	retryAfterSeconds: null,
	...overrides,
});

const teamWire = (
	overrides: Partial<LinearResourceWire> = {},
): LinearResourceWire => ({
	accountId: 'acct-1',
	color: null,
	id: 't-1',
	key: 'THE',
	kind: 'team',
	name: 'Example Team',
	organizationName: 'Example Org',
	teamId: null,
	type: null,
	...overrides,
});

const metadataOk = (
	states: readonly LinearResourceWire[] = [stateWire()],
	overrides: Partial<GetLinearMetadataResult & { status: 'ok' }> = {},
	teams: readonly LinearResourceWire[] = [teamWire()],
): GetLinearMetadataResult => ({
	accountFailures: [],
	metadata: {
		cycles: [],
		labels: [],
		projects: [],
		states: [...states],
		syncedAt: '2026-08-08T00:00:00.000Z',
		teams: [...teams],
		users: [],
	},
	status: 'ok',
	...overrides,
});

/**
 * Builds a Linear service stub. Every method resolves to a success by default so
 * a test states only the answer it is about; `linearService: null` covers the
 * app composed without the integration at all.
 */
const makeDeps = (
	overrides: {
		listIssues?: ListLinearIssuesResult;
		getIssue?: GetLinearIssueResult;
		getMetadata?: GetLinearMetadataResult;
		createComment?: CreateLinearCommentResult;
		createIssue?: MutateLinearIssueResult;
		updateIssue?: MutateLinearIssueResult;
	} = {},
) => {
	const service = {
		createComment: vi.fn().mockResolvedValue(
			overrides.createComment ?? {
				comment: commentWire({ id: 'c-new' }),
				status: 'ok',
			},
		),
		createIssue: vi
			.fn()
			.mockResolvedValue(
				overrides.createIssue ?? { issue: issueWire(), status: 'ok' },
			),
		getIssue: vi.fn().mockResolvedValue(
			overrides.getIssue ?? {
				comments: [commentWire()],
				issue: issueWire(),
				source: 'cache',
				status: 'ok',
			},
		),
		getMetadata: vi
			.fn()
			.mockResolvedValue(overrides.getMetadata ?? metadataOk()),
		listIssues: vi.fn().mockResolvedValue(
			overrides.listIssues ?? {
				accountFailures: [],
				issues: [issueWire()],
				source: 'cache',
				status: 'ok',
			},
		),
		updateIssue: vi
			.fn()
			.mockResolvedValue(
				overrides.updateIssue ?? { issue: issueWire(), status: 'ok' },
			),
	} satisfies Record<keyof LinearService, unknown>;
	const deps: LinearPortDeps = {
		databaseService: stubDatabaseService(),
		linearService: service as unknown as LinearService,
		listLinearAccounts: async () => [
			{
				accountId: 'acct-1',
				organization: 'Example Org',
				user: 'Ada',
				userId: 'u-1',
			},
		],
	};
	return { deps, service };
};

/**
 * A database service with no open connection. The port's workspace lookup reads
 * the linked issue's account through it, and every test here passes the account
 * explicitly or relies on the service resolving it, so an absent connection is
 * the honest stub rather than a gap.
 */
const stubDatabaseService = (): LinearPortDeps['databaseService'] =>
	({
		getConnection: () => null,
	}) as unknown as LinearPortDeps['databaseService'];

/** Port deps with Linear absent entirely, for the not-composed path. */
const nullDeps = (): LinearPortDeps => ({
	databaseService: stubDatabaseService(),
	linearService: null,
	listLinearAccounts: async () => [],
});

/**
 * Wraps the port so each call carries the calling workspace the ops take for
 * account resolution, keeping the tests about Linear rather than about plumbing.
 * @param deps - Port collaborators under test.
 * @returns The port with `workspaceId` supplied on every call.
 */
const portFor = (deps: LinearPortDeps) => {
	const port = makeLinearPort(deps);

	return {
		createComment: (
			args: Omit<Parameters<typeof port.createComment>[0], 'workspaceId'>,
		) => port.createComment({ ...args, workspaceId: WORKSPACE_ID }),
		createIssue: (
			args: Omit<Parameters<typeof port.createIssue>[0], 'workspaceId'>,
		) => port.createIssue({ ...args, workspaceId: WORKSPACE_ID }),
		getIssue: (
			args: Omit<Parameters<typeof port.getIssue>[0], 'workspaceId'>,
		) => port.getIssue({ ...args, workspaceId: WORKSPACE_ID }),
		getMetadata: (
			args: Omit<Parameters<typeof port.getMetadata>[0], 'workspaceId'>,
		) => port.getMetadata({ ...args, workspaceId: WORKSPACE_ID }),
		listIssues: (
			args: Omit<Parameters<typeof port.listIssues>[0], 'workspaceId'>,
		) => port.listIssues({ ...args, workspaceId: WORKSPACE_ID }),
		updateIssue: (
			args: Omit<Parameters<typeof port.updateIssue>[0], 'workspaceId'>,
		) => port.updateIssue({ ...args, workspaceId: WORKSPACE_ID }),
	};
};

// Linear is unconnected in most workspaces. An op that threw, or that answered
// the same way it answers a bad id, would leave an agent unable to tell "no
// tracker here" from "your id is wrong" — and it would go on retrying one of them
// forever.
describe('linear port: availability', () => {
	it('answers every op without Linear composed at all', async () => {
		const port = portFor(nullDeps());

		const results = await Promise.all([
			port.listIssues({}),
			port.getIssue({ issueId: 'ENG-1' }),
			port.getMetadata({}),
			port.createComment({ commentBody: 'hi', issueId: 'ENG-1' }),
			port.updateIssue({ issueId: 'ENG-1', priority: 1 }),
		]);

		for (const result of results) {
			expect(result.status).toBe('not-connected');
			expect(result.message).toContain('Settings');
		}
	});

	it('reports a disconnected account as not-connected, not as a failure', async () => {
		const { deps } = makeDeps({
			listIssues: {
				accountFailures: [],
				failure: failure({ code: 'not-connected', message: 'No token.' }),
				issues: [],
				status: 'error',
			},
		});

		const result = await portFor(deps).listIssues({});

		expect(result.status).toBe('not-connected');
		expect(result.issues).toEqual([]);
	});

	// The user's recovery is identical — reauthorize — so a second word for it
	// would only invite a model to handle one branch and not the other.
	it('folds a stale authorization into the same not-connected answer', async () => {
		const { deps } = makeDeps({
			getMetadata: {
				accountFailures: [],
				failure: failure({ code: 'reconnect-required', message: 'Expired.' }),
				metadata: metadataOk().metadata,
				status: 'error',
			},
		});

		const result = await portFor(deps).getMetadata({});

		expect(result.status).toBe('not-connected');
	});

	it('separates a bad id from an unreachable Linear', async () => {
		const { deps } = makeDeps({
			getIssue: {
				failure: failure({ code: 'not-found', message: 'No such issue.' }),
				status: 'error',
			},
		});

		const result = await portFor(deps).getIssue({ issueId: 'ENG-999' });

		expect(result.status).toBe('not-found');
		expect(result.issue).toBeNull();
	});

	it('names the retry window when Linear rate-limits the call', async () => {
		const { deps } = makeDeps({
			createComment: {
				failure: failure({
					code: 'rate-limited',
					message: 'Slow down.',
					retryAfterSeconds: 30,
				}),
				status: 'error',
			},
		});

		const result = await portFor(deps).createComment({
			commentBody: 'note',
			issueId: 'ENG-106',
		});

		expect(result.status).toBe('failed');
		expect(result.message).toContain('Wait 30s before trying again');
		expect(result.commentId).toBeNull();
	});

	// The service degrades to the cache when a refresh fails. Dropping those rows
	// would make a transient network blip look like an empty backlog.
	it('still hands back the cached rows a failed refresh left behind', async () => {
		const { deps } = makeDeps({
			listIssues: {
				accountFailures: [],
				failure: failure(),
				issues: [issueWire()],
				status: 'error',
			},
		});

		const result = await portFor(deps).listIssues({ refresh: true });

		expect(result.status).toBe('failed');
		expect(result.issues).toHaveLength(1);
		expect(result.message).toContain('local cache');
	});
});

// `AGENTS.md` reserves closing a ticket for a human. Leaving that to the playbook
// makes it advice; this is the enforcement, and it is the one behaviour here that
// has to hold even when a model is actively trying to report itself finished.
describe('linear port: the Done guard', () => {
	it('refuses a move into a completed state and never reaches Linear', async () => {
		const { deps, service } = makeDeps({
			getMetadata: metadataOk([
				stateWire({ id: 's-done', name: 'Done', type: 'completed' }),
			]),
		});

		const result = await portFor(deps).updateIssue({
			issueId: 'ENG-106',
			stateId: 's-done',
		});

		expect(result.status).toBe('refused');
		expect(result.message).toContain('In Review');
		expect(result.issue).toBeNull();
		expect(service.updateIssue).not.toHaveBeenCalled();
	});

	// Closing a ticket as canceled is the same act under a different label, so a
	// guard that caught only `completed` would be one rename away from useless.
	it('refuses a move into a canceled state on the same grounds', async () => {
		const { deps, service } = makeDeps({
			getMetadata: metadataOk([
				stateWire({ id: 's-cancelled', name: 'Canceled', type: 'canceled' }),
			]),
		});

		const result = await portFor(deps).updateIssue({
			issueId: 'ENG-106',
			stateId: 's-cancelled',
		});

		expect(result.status).toBe('refused');
		expect(result.message).toContain('canceled');
		expect(service.updateIssue).not.toHaveBeenCalled();
	});

	it('lets a non-terminal state through with the fields the agent set', async () => {
		const { deps, service } = makeDeps({
			getMetadata: metadataOk([
				stateWire({ id: 's-review', name: 'In Review', type: 'started' }),
			]),
		});

		const result = await portFor(deps).updateIssue({
			assigneeId: 'u-2',
			issueId: 'ENG-106',
			stateId: 's-review',
		});

		expect(result.status).toBe('ok');
		expect(service.updateIssue).toHaveBeenCalledWith({
			id: 'ENG-106',
			input: {
				assigneeId: 'u-2',
				description: undefined,
				priority: undefined,
				stateId: 's-review',
				title: undefined,
			},
		});
	});

	// A state the cache cannot classify might be a Done column. Passing it through
	// on the assumption it is harmless is exactly the failure the guard exists for.
	it('refuses a state id it cannot classify and names the call that resolves it', async () => {
		const { deps, service } = makeDeps({
			getMetadata: metadataOk([stateWire()]),
		});

		const result = await portFor(deps).updateIssue({
			issueId: 'ENG-106',
			stateId: 's-unknown',
		});

		expect(result.status).toBe('refused');
		expect(result.message).toContain('ensemblr_linear_get_metadata');
		expect(service.updateIssue).not.toHaveBeenCalled();
	});

	// A cached row that carries no workflow type is as unclassifiable as an id that
	// matched nothing — it might be a Done column — so the guard has to refuse it on
	// the same grounds rather than read a missing type as "not terminal".
	it('refuses a state row whose cached type is missing', async () => {
		const { deps, service } = makeDeps({
			getMetadata: metadataOk([
				stateWire({ id: 's-untyped', name: 'Shipped', type: null }),
			]),
		});

		const result = await portFor(deps).updateIssue({
			issueId: 'ENG-106',
			stateId: 's-untyped',
		});

		expect(result.status).toBe('refused');
		expect(result.message).toContain('carries no workflow type');
		expect(result.message).toContain('ensemblr_linear_get_metadata');
		expect(service.updateIssue).not.toHaveBeenCalled();
	});

	it('refuses when the states cannot be read at all', async () => {
		const { deps, service } = makeDeps({
			getMetadata: {
				accountFailures: [],
				failure: failure({ message: 'Linear is down.' }),
				metadata: metadataOk([]).metadata,
				status: 'error',
			},
		});

		const result = await portFor(deps).updateIssue({
			issueId: 'ENG-106',
			stateId: 's-started',
		});

		expect(result.status).toBe('refused');
		expect(result.message).toContain('Linear is down.');
		expect(service.updateIssue).not.toHaveBeenCalled();
	});

	// An update that changes nothing about the state never needs the states read,
	// and paying a metadata sync for it would make every retitle a network call.
	it('skips the state lookup when no state is being set', async () => {
		const { deps, service } = makeDeps();

		const result = await portFor(deps).updateIssue({
			issueId: 'ENG-106',
			title: 'Expose Linear to agents, gated',
		});

		expect(result.status).toBe('ok');
		expect(service.getMetadata).not.toHaveBeenCalled();
	});
});

// Silent truncation reads as completeness: an agent that receives 40 of 200
// issues with no note will tell the user the backlog holds 40.
describe('linear port: payload budget', () => {
	it('cuts a long issue list to the budget and says how to narrow it', async () => {
		const issues = Array.from({ length: 60 }, (_, index) =>
			issueWire({
				id: `i-${index}`,
				identifier: `ENG-${index}`,
				title: 'x'.repeat(1_000),
			}),
		);
		const { deps } = makeDeps({
			listIssues: {
				accountFailures: [],
				issues,
				source: 'remote',
				status: 'ok',
			},
		});

		const result = await portFor(deps).listIssues({});

		expect(result.truncated).toBe(true);
		expect(result.omittedIssues).toBeGreaterThan(0);
		expect(result.issues.length + result.omittedIssues).toBe(60);
		expect(JSON.stringify(result.issues).length).toBeLessThanOrEqual(
			MAX_AGENT_PAYLOAD_CHARS,
		);
		expect(result.message).toContain('teamId');
	});

	it('reports an untruncated list as complete', async () => {
		const { deps } = makeDeps();

		const result = await portFor(deps).listIssues({});

		expect(result.truncated).toBe(false);
		expect(result.omittedIssues).toBe(0);
		expect(result.issues[0]).toMatchObject({
			assignee: 'Ada',
			identifier: 'ENG-106',
			state: 'In Progress',
			stateType: 'started',
			team: 'Example Org',
		});
	});

	it('clamps a long issue description and marks the cut', async () => {
		const { deps } = makeDeps({
			getIssue: {
				comments: [],
				issue: issueWire({ description: 'd'.repeat(20_000) }),
				source: 'remote',
				status: 'ok',
			},
		});

		const result = await portFor(deps).getIssue({ issueId: 'ENG-106' });

		expect(result.truncated).toBe(true);
		expect(result.issue?.description).toContain('shortened');
		expect(result.issue?.description?.length).toBeLessThan(
			LINEAR_AGENT_LIMITS.maxReturnedDescriptionChars + 200,
		);
	});

	// A body cut to the per-comment cap is a cut payload even when every comment
	// survived, and a result that reports itself complete is what an agent quotes
	// back as the whole thread.
	it('marks a clamped comment body as truncated with nothing dropped', async () => {
		const { deps } = makeDeps({
			getIssue: {
				comments: [
					commentWire({
						body: 'z'.repeat(LINEAR_AGENT_LIMITS.maxReturnedCommentChars + 500),
					}),
				],
				issue: issueWire(),
				source: 'cache',
				status: 'ok',
			},
		});

		const result = await portFor(deps).getIssue({ issueId: 'ENG-106' });

		expect(result.omittedComments).toBe(0);
		expect(result.comments.at(0)?.body).toContain('shortened');
		expect(result.truncated).toBe(true);
	});

	// The mirror failure: a description that is present but empty is not a cut, and
	// flagging it leaves an agent hunting for content nothing removed.
	it('reports an empty description as complete, not truncated', async () => {
		const { deps } = makeDeps({
			getIssue: {
				comments: [],
				issue: issueWire({ description: '' }),
				source: 'cache',
				status: 'ok',
			},
		});

		const result = await portFor(deps).getIssue({ issueId: 'ENG-106' });

		expect(result.truncated).toBe(false);
		expect(result.omittedComments).toBe(0);
	});

	// The recent exchange is what an agent needs, but a thread handed back out of
	// sequence reads as a conversation that never happened.
	it('keeps the newest comments and returns them in order', async () => {
		const comments = Array.from({ length: 45 }, (_, index) =>
			commentWire({ body: `comment ${index}`, id: `c-${index}` }),
		);
		const { deps } = makeDeps({
			getIssue: {
				comments,
				issue: issueWire(),
				source: 'cache',
				status: 'ok',
			},
		});

		const result = await portFor(deps).getIssue({ issueId: 'ENG-106' });

		expect(result.comments).toHaveLength(
			LINEAR_AGENT_LIMITS.maxReturnedComments,
		);
		expect(result.omittedComments).toBe(
			45 - LINEAR_AGENT_LIMITS.maxReturnedComments,
		);
		expect(result.comments.at(0)?.body).toBe('comment 5');
		expect(result.comments.at(-1)?.body).toBe('comment 44');
		expect(result.message).toContain('older comment(s) were dropped');
	});

	it('drops comments the char budget cannot carry, not just the count cap', async () => {
		const comments = Array.from({ length: 40 }, (_, index) =>
			commentWire({ body: 'y'.repeat(3_000), id: `c-${index}` }),
		);
		const { deps } = makeDeps({
			getIssue: {
				comments,
				issue: issueWire(),
				source: 'cache',
				status: 'ok',
			},
		});

		const result = await portFor(deps).getIssue({ issueId: 'ENG-106' });

		expect(result.comments.length).toBeLessThan(40);
		expect(result.omittedComments).toBe(40 - result.comments.length);
		expect(JSON.stringify(result.comments).length).toBeLessThanOrEqual(
			MAX_AGENT_PAYLOAD_CHARS,
		);
	});

	// States and teams are what an update cannot be written without, so a
	// workspace with hundreds of labels must not be able to crowd them out.
	it('spends the metadata budget on states and teams before labels', async () => {
		const bulk = (kind: LinearResourceWire['kind'], count: number) =>
			Array.from({ length: count }, (_, index) =>
				stateWire({
					id: `${kind}-${index}`,
					kind,
					name: 'n'.repeat(500),
					type: kind === 'state' ? 'started' : null,
				}),
			);
		const { deps } = makeDeps({
			getMetadata: {
				accountFailures: [],
				metadata: {
					cycles: [],
					labels: bulk('label', 60),
					projects: bulk('project', 60),
					states: bulk('state', 10),
					syncedAt: '2026-08-08T00:00:00.000Z',
					teams: bulk('team', 5),
					users: bulk('user', 60),
				},
				status: 'ok',
			},
		});

		const result = await portFor(deps).getMetadata({});

		expect(result.states).toHaveLength(10);
		expect(result.teams).toHaveLength(5);
		expect(result.truncated).toBe(true);
		expect(result.omittedResources).toBeGreaterThan(0);
		expect(result.labels.length).toBeLessThan(60);
	});
});

describe('linear port: writes', () => {
	it('posts the comment body under the key the service expects', async () => {
		const { deps, service } = makeDeps();

		const result = await portFor(deps).createComment({
			commentBody: 'Verified on the branch.',
			issueId: 'ENG-106',
		});

		expect(result.status).toBe('ok');
		expect(result.commentId).toBe('c-new');
		expect(service.createComment).toHaveBeenCalledWith({
			body: 'Verified on the branch.',
			issueId: 'ENG-106',
		});
	});
});

// Nothing on this surface deletes a Linear issue, so every one of these refusals
// is the last chance to stop a row the team reads from being wrong. Each has to
// land before the service is reached, and each has to say that nothing was
// filed — an agent that reads "refused" and assumes a half-made issue exists
// goes looking for an identifier that was never minted.
describe('linear port: filing an issue', () => {
	it('files with the fields the agent set and reports the identifier back', async () => {
		const { deps, service } = makeDeps();

		const result = await portFor(deps).createIssue({
			description: 'Repro in src/main/main.ts.',
			labelIds: ['l-1'],
			priority: 3,
			teamId: 't-1',
			title: 'Terminal drops the last line',
		});

		expect(result.status).toBe('ok');
		expect(result.issue?.identifier).toBe('ENG-106');
		expect(result.message).toContain('ENG-106');
		expect(service.createIssue).toHaveBeenCalledWith({
			description: 'Repro in src/main/main.ts.',
			labelIds: ['l-1'],
			priority: 3,
			teamId: 't-1',
			title: 'Terminal drops the last line',
		});
	});

	it('omits an unset state so the team default applies', async () => {
		const { deps, service } = makeDeps();

		await portFor(deps).createIssue({ teamId: 't-1', title: 'A follow-up' });

		expect(service.createIssue).toHaveBeenCalledWith({
			teamId: 't-1',
			title: 'A follow-up',
		});
	});

	it('refuses a team the cache does not know and never reaches Linear', async () => {
		const { deps, service } = makeDeps();

		const result = await portFor(deps).createIssue({
			teamId: 't-missing',
			title: 'A follow-up',
		});

		expect(result.status).toBe('refused');
		expect(result.issue).toBeNull();
		expect(result.message).toContain('t-missing');
		expect(result.message).toContain('refresh: true');
		expect(result.message).toContain('Nothing was filed');
		expect(service.createIssue).not.toHaveBeenCalled();
	});

	it('refuses an accountId that names a different account than the team', async () => {
		const { deps, service } = makeDeps();

		const result = await portFor(deps).createIssue({
			accountId: 'acct-2',
			teamId: 't-1',
			title: 'A follow-up',
		});

		expect(result.status).toBe('refused');
		expect(result.message).toContain('acct-1');
		expect(result.message).toContain('acct-2');
		expect(service.createIssue).not.toHaveBeenCalled();
	});

	it('refuses a started state and names the ones it may open in', async () => {
		const { deps, service } = makeDeps({
			getMetadata: metadataOk([
				stateWire(),
				stateWire({ id: 's-backlog', name: 'Backlog', type: 'backlog' }),
			]),
		});

		const result = await portFor(deps).createIssue({
			stateId: 's-started',
			teamId: 't-1',
			title: 'A follow-up',
		});

		expect(result.status).toBe('refused');
		expect(result.message).toContain('started state');
		expect(result.message).toContain('"Backlog" (s-backlog)');
		expect(service.createIssue).not.toHaveBeenCalled();
	});

	it('refuses a completed state on the same grounds', async () => {
		const { deps, service } = makeDeps({
			getMetadata: metadataOk([
				stateWire({ id: 's-done', name: 'Done', type: 'completed' }),
			]),
		});

		const result = await portFor(deps).createIssue({
			stateId: 's-done',
			teamId: 't-1',
			title: 'A follow-up',
		});

		expect(result.status).toBe('refused');
		expect(service.createIssue).not.toHaveBeenCalled();
	});

	it('refuses a state belonging to another team', async () => {
		const { deps, service } = makeDeps({
			getMetadata: metadataOk([
				stateWire({
					id: 's-other',
					name: 'Backlog',
					teamId: 't-2',
					type: 'backlog',
				}),
			]),
		});

		const result = await portFor(deps).createIssue({
			stateId: 's-other',
			teamId: 't-1',
			title: 'A follow-up',
		});

		expect(result.status).toBe('refused');
		expect(result.message).toContain('another team');
		expect(service.createIssue).not.toHaveBeenCalled();
	});

	it('opens in a backlog state the cache classifies', async () => {
		const { deps, service } = makeDeps({
			getMetadata: metadataOk([
				stateWire({ id: 's-backlog', name: 'Backlog', type: 'backlog' }),
			]),
		});

		const result = await portFor(deps).createIssue({
			stateId: 's-backlog',
			teamId: 't-1',
			title: 'A follow-up',
		});

		expect(result.status).toBe('ok');
		expect(service.createIssue).toHaveBeenCalledWith({
			stateId: 's-backlog',
			teamId: 't-1',
			title: 'A follow-up',
		});
	});

	it('answers not-connected when Linear is not composed at all', async () => {
		const result = await makeLinearPort(nullDeps()).createIssue({
			teamId: 't-1',
			title: 'A follow-up',
			workspaceId: WORKSPACE_ID,
		});

		expect(result.status).toBe('not-connected');
		expect(result.issue).toBeNull();
	});
});

/**
 * A database service whose workspace row carries a linked Linear issue, so the
 * port's fallback lookup resolves an account. The stub above returns no
 * connection, which makes every fallback path unreachable.
 */
const linkedWorkspaceDatabaseService = (
	accountId: string | null,
): LinearPortDeps['databaseService'] =>
	({
		getConnection: () => ({
			database: {
				prepare: () => ({
					get: () => ({
						metadataJson: JSON.stringify({
							linkedIssue:
								accountId === null
									? { identifier: 'ENG-1', provider: 'linear' }
									: { accountId, identifier: 'ENG-1', provider: 'linear' },
						}),
					}),
				}),
			},
		}),
	}) as unknown as LinearPortDeps['databaseService'];

describe('multi-account resolution', () => {
	// ADR 0052 resolves the entity before the workspace. Passing the workspace's
	// account as `accountId` would let it win over the issue the agent named, and
	// would make the ambiguity refusal unreachable for any linked workspace.
	it('offers the workspace account as a fallback, never as a scope', async () => {
		const { deps, service } = makeDeps();
		const port = portFor({
			...deps,
			databaseService: linkedWorkspaceDatabaseService('acct-2'),
		});

		await port.getIssue({ issueId: 'ENG-106' });

		expect(service.getIssue).toHaveBeenCalledWith(
			expect.objectContaining({
				fallbackAccountId: 'acct-2',
				id: 'ENG-106',
			}),
		);
		expect(service.getIssue).toHaveBeenCalledWith(
			expect.not.objectContaining({ accountId: expect.anything() }),
		);
	});

	it('passes an explicit accountId through and still offers the fallback', async () => {
		const { deps, service } = makeDeps();
		const port = portFor({
			...deps,
			databaseService: linkedWorkspaceDatabaseService('acct-2'),
		});

		await port.updateIssue({ accountId: 'acct-9', issueId: 'ENG-106' });

		expect(service.updateIssue).toHaveBeenCalledWith(
			expect.objectContaining({ accountId: 'acct-9' }),
		);
	});

	it('omits the fallback when the workspace has no linked account', async () => {
		const { deps, service } = makeDeps();
		const port = portFor({
			...deps,
			databaseService: linkedWorkspaceDatabaseService(null),
		});

		await port.createComment({ commentBody: 'hi', issueId: 'ENG-106' });

		expect(service.createComment).toHaveBeenCalledWith(
			expect.not.objectContaining({ fallbackAccountId: expect.anything() }),
		);
	});

	it('names the accounts on a failure so the agent can retry informed', async () => {
		const { deps } = makeDeps({
			getIssue: {
				failure: {
					code: 'invalid-request',
					message: '"ENG-1" matches an issue in 2 connected Linear accounts.',
					retryAfterSeconds: null,
				},
				status: 'error',
			} satisfies GetLinearIssueResult,
		});
		const port = portFor({
			...deps,
			listLinearAccounts: async () => [
				{
					accountId: 'acct-1',
					organization: 'Example Org',
					user: 'Ada',
					userId: 'u-1',
				},
				{
					accountId: 'acct-2',
					organization: 'Client Co',
					user: 'Ada',
					userId: 'u-2',
				},
			],
		});

		const result = await port.getIssue({ issueId: 'ENG-1' });

		expect(result.status).toBe('failed');
		expect(result.accounts).toEqual([
			{
				accountId: 'acct-1',
				organization: 'Example Org',
				user: 'Ada',
				userId: 'u-1',
			},
			{
				accountId: 'acct-2',
				organization: 'Client Co',
				user: 'Ada',
				userId: 'u-2',
			},
		]);
	});

	// A read that is already failing must not fail differently because the
	// account lookup threw too — that loses the recovery prose the agent needs.
	it('survives listLinearAccounts throwing on a failure path', async () => {
		const { deps } = makeDeps({
			getIssue: {
				failure: {
					code: 'network',
					message: 'Linear is unreachable.',
					retryAfterSeconds: null,
				},
				status: 'error',
			} satisfies GetLinearIssueResult,
		});
		const port = portFor({
			...deps,
			listLinearAccounts: async () => {
				throw new Error('The Ensemblr database is not open.');
			},
		});

		const result = await port.getIssue({ issueId: 'ENG-1' });

		expect(result.status).toBe('failed');
		expect(result.message).toContain('Linear is unreachable.');
		expect(result.accounts).toBeUndefined();
	});

	it('names the account it searched instead of claiming it read them all', async () => {
		const { deps } = makeDeps();
		const port = portFor(deps);

		const scoped = await port.listIssues({ accountId: 'acct-1' });
		const merged = await port.listIssues({});

		expect(scoped.message).toContain('in Linear account "acct-1"');
		expect(merged.message).toContain('across every connected Linear account');
	});

	// `truncated` tells the agent to narrow its query. An account that failed is
	// reported in the message instead, so flagging it here sends the agent
	// chasing a payload budget that was never the problem.
	it('does not report truncation when only an account failed', async () => {
		const { deps } = makeDeps({
			listIssues: {
				accountFailures: [
					{
						accountId: 'acct-2',
						failure: {
							code: 'rate-limited',
							message: 'Slow down.',
							retryAfterSeconds: 30,
						},
						organizationName: 'Client Co',
					},
				],
				issues: [issueWire()],
				source: 'cache',
				status: 'ok',
			} satisfies ListLinearIssuesResult,
		});
		const port = portFor(deps);

		const result = await port.listIssues({});

		expect(result.truncated).toBe(false);
		expect(result.omittedIssues).toBe(0);
		expect(result.message).toContain('Client Co');
	});
});

// An agent has no Linear identity of its own, so "take this ticket" resolves to
// the human whose account the app acts through. Without a userId on the result
// the only route left is matching a display name against the users table, which
// two people sharing a first name break silently.
describe('linear port: naming the connected user', () => {
	it('reports the viewer for every account a metadata read covered', async () => {
		const { deps } = makeDeps();

		const result = await portFor(deps).getMetadata({});

		expect(result.viewer).toEqual([
			{ accountId: 'acct-1', name: 'Ada', userId: 'u-1' },
		]);
		expect(result.message).toContain('viewer');
	});

	it('narrows the viewer rows to the account the read was scoped to', async () => {
		const { deps } = makeDeps();
		const port = portFor({
			...deps,
			listLinearAccounts: async () => [
				{
					accountId: 'acct-1',
					organization: 'Example Org',
					user: 'Ada',
					userId: 'u-1',
				},
				{
					accountId: 'acct-2',
					organization: 'Client Co',
					user: 'Grace',
					userId: 'u-2',
				},
			],
		});

		const result = await port.getMetadata({ accountId: 'acct-2' });

		expect(result.viewer).toEqual([
			{ accountId: 'acct-2', name: 'Grace', userId: 'u-2' },
		]);
	});

	// A metadata read that already degraded to the cache still has to answer the
	// assignee question: the account list comes from the local store, not Linear.
	it('still reports the viewer when the metadata read itself failed', async () => {
		const { deps } = makeDeps({
			getMetadata: {
				accountFailures: [],
				failure: failure(),
				metadata: metadataOk().metadata,
				status: 'error',
			},
		});

		const result = await portFor(deps).getMetadata({});

		expect(result.status).toBe('failed');
		expect(result.viewer).toHaveLength(1);
	});

	// The account lookup is context on an answer already being produced, so it may
	// never change how the op ends.
	it('degrades to no viewer rather than failing when accounts cannot be read', async () => {
		const { deps } = makeDeps();
		const port = portFor({
			...deps,
			listLinearAccounts: async () => {
				throw new Error('keychain locked');
			},
		});

		const result = await port.getMetadata({});

		expect(result.status).toBe('ok');
		expect(result.viewer).toEqual([]);
	});
});

describe('linear port: the fields a single issue read adds', () => {
	it('carries the cycle and the assignee id a list view omits', async () => {
		const { deps } = makeDeps({
			getIssue: {
				comments: [],
				issue: issueWire({ cycleName: 'Cycle 12' }),
				source: 'cache',
				status: 'ok',
			},
		});

		const result = await portFor(deps).getIssue({ issueId: 'ENG-106' });

		expect(result.issue?.cycle).toBe('Cycle 12');
		expect(result.issue?.assigneeId).toBe('u-1');
	});

	it('reports no cycle for a team that runs none', async () => {
		const result = await portFor(makeDeps().deps).getIssue({
			issueId: 'ENG-106',
		});

		expect(result.issue?.cycle).toBeNull();
	});
});

// Every one of these codes means something different about whether to try again,
// and a message that only names the fault leaves a model to guess — which it
// resolves by retrying the identical call.
describe('linear port: what a failure tells the agent to do', () => {
	const messageFor = async (
		override: Partial<LinearServiceFailure>,
	): Promise<string> => {
		const { deps } = makeDeps({
			updateIssue: { failure: failure(override), status: 'error' },
		});
		const result = await portFor(deps).updateIssue({
			issueId: 'ENG-106',
			priority: 2,
		});
		return result.message;
	};

	it('tells a rate-limited caller how long to wait', async () => {
		expect(
			await messageFor({ code: 'rate-limited', retryAfterSeconds: 45 }),
		).toContain('Wait 45s before trying again');
	});

	it('tells a rate-limited caller with no window to get on with other work', async () => {
		const message = await messageFor({
			code: 'rate-limited',
			retryAfterSeconds: null,
		});

		expect(message).toContain('rather than retrying in a loop');
	});

	it('tells a permission failure not to retry at all', async () => {
		expect(await messageFor({ code: 'permission-denied' })).toContain(
			'do not retry',
		);
	});

	it('sends a rejected argument back through the metadata read', async () => {
		expect(await messageFor({ code: 'invalid-request' })).toContain(
			'ensemblr_linear_get_metadata',
		);
	});

	it('allows a network failure exactly one retry', async () => {
		expect(await messageFor({ code: 'network' })).toContain(
			'One retry is reasonable',
		);
	});

	// `not-found` reaches this op from a bad stateId or assigneeId as often as from
	// a bad issue id, so a message naming only the issue misdirects the fix.
	it('names every id a not-found could have come from', async () => {
		const message = await messageFor({ code: 'not-found' });

		expect(message).toContain('stateId');
		expect(message).toContain('assigneeId');
	});
});

describe('linear port: the terminal-state refusal', () => {
	const doneState = stateWire({
		id: 's-done',
		name: 'Done',
		type: 'completed',
	});

	it('names the states the issue could have moved into instead', async () => {
		const { deps } = makeDeps({
			getMetadata: metadataOk([
				doneState,
				stateWire({ id: 's-review', name: 'In Review', type: 'started' }),
			]),
		});

		const result = await portFor(deps).updateIssue({
			issueId: 'ENG-106',
			stateId: 's-done',
		});

		expect(result.status).toBe('refused');
		expect(result.message).toContain('"In Review" (s-review)');
	});

	// A refused update applies nothing, including the title that rode along with
	// the state. An agent that assumes otherwise never re-sends it.
	it('says that no other field in the call was applied either', async () => {
		const { deps, service } = makeDeps({
			getMetadata: metadataOk([doneState]),
		});

		const result = await portFor(deps).updateIssue({
			issueId: 'ENG-106',
			stateId: 's-done',
			title: 'Renamed',
		});

		expect(result.message).toContain('Nothing in this call was applied');
		expect(service.updateIssue).not.toHaveBeenCalled();
	});

	// States belong to a team, so offering another team's columns would send the
	// agent at an id Linear rejects.
	it('offers no alternative from another team', async () => {
		const { deps } = makeDeps({
			getMetadata: metadataOk([
				doneState,
				stateWire({
					id: 's-other',
					name: 'Triage',
					teamId: 't-2',
					type: 'unstarted',
				}),
			]),
		});

		const result = await portFor(deps).updateIssue({
			issueId: 'ENG-106',
			stateId: 's-done',
		});

		expect(result.message).not.toContain('Triage');
	});
});
