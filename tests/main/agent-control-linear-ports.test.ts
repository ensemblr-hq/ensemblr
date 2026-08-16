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

const metadataOk = (
	states: readonly LinearResourceWire[] = [stateWire()],
	overrides: Partial<GetLinearMetadataResult & { status: 'ok' }> = {},
): GetLinearMetadataResult => ({
	accountFailures: [],
	metadata: {
		cycles: [],
		labels: [],
		projects: [],
		states: [...states],
		syncedAt: '2026-08-08T00:00:00.000Z',
		teams: [],
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
		createIssue: vi.fn(),
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
			{ accountId: 'acct-1', organization: 'Example Org', user: 'Ada' },
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
		expect(result.message).toContain('Retry in 30s');
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
				{ accountId: 'acct-1', organization: 'Example Org', user: 'Ada' },
				{ accountId: 'acct-2', organization: 'Client Co', user: 'Ada' },
			],
		});

		const result = await port.getIssue({ issueId: 'ENG-1' });

		expect(result.status).toBe('failed');
		expect(result.accounts).toEqual([
			{ accountId: 'acct-1', organization: 'Example Org', user: 'Ada' },
			{ accountId: 'acct-2', organization: 'Client Co', user: 'Ada' },
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
