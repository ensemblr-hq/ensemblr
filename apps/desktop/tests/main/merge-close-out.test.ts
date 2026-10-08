import { afterEach, describe, expect, it, vi } from 'vitest';

import type {
	LocalCommandRequest,
	LocalCommandResult,
	LocalCommandService,
} from '../../src/main/commands/local-command';
import type { LinearService } from '../../src/main/linear';
import {
	createMergeCloseOutService,
	type MergeCloseOutDeps,
} from '../../src/main/merge-close-out/merge-close-out-service.ts';
import type { WorkspaceLinkedIssue } from '../../src/shared/agent-control.ts';
import type {
	GetLinearMetadataResult,
	LinearIssueWire,
	LinearResourceWire,
} from '../../src/shared/ipc/contracts/linear.ts';
import type { LocalBaseSyncOutcome } from '../../src/shared/workspace-merge.ts';

const ACCOUNT_ID = 'acct-1';
const TEAM_ID = 'team-1';
const MERGE = { pullRequestNumber: 7, workspaceId: 'ws-1' };

const LINEAR_LINK: WorkspaceLinkedIssue = {
	accountId: ACCOUNT_ID,
	identifier: 'THE-42',
	provider: 'linear',
	title: 'Ship it',
	url: 'https://linear.app/the/issue/THE-42',
};

const FAST_FORWARDED: LocalBaseSyncOutcome = {
	branch: 'master',
	from: 'aaa',
	status: 'fast-forwarded',
	to: 'bbb',
};

const GITHUB_LINK: WorkspaceLinkedIssue = {
	accountId: null,
	identifier: '#12',
	provider: 'github',
	title: 'Ship it',
	url: 'https://github.com/acme/app/issues/12',
};

afterEach(() => {
	vi.restoreAllMocks();
});

function linearIssue(
	overrides: Partial<LinearIssueWire> = {},
): LinearIssueWire {
	return {
		accountId: ACCOUNT_ID,
		archivedAt: null,
		assigneeId: null,
		assigneeName: null,
		cycleId: null,
		cycleName: null,
		description: null,
		dueDate: null,
		id: 'issue-uuid',
		identifier: 'THE-42',
		labels: [],
		organizationName: 'The Org',
		priority: null,
		projectId: null,
		projectName: null,
		stateColor: null,
		stateId: 'state-review',
		stateName: 'In Review',
		stateType: 'started',
		syncedAt: null,
		teamId: TEAM_ID,
		teamKey: 'THE',
		teamName: 'The Team',
		title: 'Ship it',
		updatedAt: null,
		url: 'https://linear.app/the/issue/THE-42',
		...overrides,
	};
}

function state(
	id: string,
	name: string,
	type: string,
	teamId = TEAM_ID,
): LinearResourceWire {
	return {
		accountId: ACCOUNT_ID,
		color: null,
		id,
		key: null,
		kind: 'state',
		name,
		organizationName: 'The Org',
		teamId,
		type,
	};
}

function metadata(states: LinearResourceWire[]): GetLinearMetadataResult {
	return {
		accountFailures: [],
		metadata: {
			cycles: [],
			labels: [],
			projects: [],
			states,
			syncedAt: null,
			teams: [],
			users: [],
		},
		status: 'ok',
	};
}

function fakeLinear({
	issue = linearIssue(),
	cachedStates = [state('state-done', 'Done', 'completed')],
	syncedStates = cachedStates,
}: {
	issue?: LinearIssueWire;
	cachedStates?: LinearResourceWire[];
	syncedStates?: LinearResourceWire[];
} = {}) {
	return {
		createComment: vi.fn(),
		createIssue: vi.fn(),
		getIssue: vi.fn(async () => ({
			comments: [],
			issue,
			source: 'remote' as const,
			status: 'ok' as const,
		})),
		getMetadata: vi.fn(async (request?: { refresh?: boolean }) =>
			metadata(request?.refresh ? syncedStates : cachedStates),
		),
		listIssues: vi.fn(),
		updateIssue: vi.fn(async () => ({
			issue: linearIssue({ stateType: 'completed' }),
			status: 'ok' as const,
		})),
	} satisfies LinearService;
}

function commandResult(
	overrides: Partial<LocalCommandResult> = {},
): LocalCommandResult {
	return {
		args: [],
		command: 'gh',
		cwd: '/',
		durationMs: 0,
		endedAt: '2026-10-03T00:00:00.000Z',
		environment: null,
		exitCode: 0,
		logs: { command: 'gh', cwd: '/', env: {}, stderr: '', stdout: '' },
		signal: null,
		startedAt: '2026-10-03T00:00:00.000Z',
		status: 'success',
		stderr: '',
		stderrTruncated: false,
		stdout: '',
		stdoutTruncated: false,
		...overrides,
	};
}

function fakeCommands(result = commandResult()) {
	const run = vi.fn(async (_request: LocalCommandRequest) => result);
	const service: LocalCommandService = {
		getEnvironment: vi.fn(),
		run,
	};
	return { run, service };
}

function closeOutWith({
	linear = fakeLinear(),
	commands = fakeCommands(),
	readLinkedIssue = () => LINEAR_LINK,
	syncLocalBase = vi.fn(async () => FAST_FORWARDED),
}: {
	linear?: ReturnType<typeof fakeLinear>;
	commands?: ReturnType<typeof fakeCommands>;
	readLinkedIssue?: MergeCloseOutDeps['readLinkedIssue'];
	syncLocalBase?: MergeCloseOutDeps['syncLocalBase'];
} = {}) {
	const setBoardStatus = vi.fn();
	const service = createMergeCloseOutService({
		linearService: linear,
		localCommandService: commands.service,
		readLinkedIssue,
		setBoardStatus,
		syncLocalBase,
	});
	return { commands, linear, service, setBoardStatus, syncLocalBase };
}

describe('merge close-out', () => {
	it('moves the board card and the Linear issue to Done', async () => {
		const { linear, service, setBoardStatus } = closeOutWith({
			linear: fakeLinear({
				cachedStates: [
					state('state-released', 'Released', 'completed'),
					state('state-other-done', 'Done', 'completed', 'team-2'),
					state('state-done', 'Done', 'completed'),
				],
			}),
		});

		const report = await service.closeOut(MERGE);

		expect(setBoardStatus).toHaveBeenCalledWith('ws-1', 'done');
		expect(linear.getIssue).toHaveBeenCalledWith({
			fallbackAccountId: ACCOUNT_ID,
			id: 'THE-42',
			refresh: true,
		});
		expect(linear.updateIssue).toHaveBeenCalledWith({
			accountId: ACCOUNT_ID,
			id: 'issue-uuid',
			input: { stateId: 'state-done' },
		});
		expect(report).toEqual({
			...MERGE,
			baseSync: FAST_FORWARDED,
			issue: { status: 'closed' },
		});
	});

	it('falls back to the first completed state when none is named Done', async () => {
		const { linear, service } = closeOutWith({
			linear: fakeLinear({
				cachedStates: [state('state-shipped', 'Shipped', 'completed')],
			}),
		});

		await service.closeOut(MERGE);

		expect(linear.updateIssue).toHaveBeenCalledWith(
			expect.objectContaining({ input: { stateId: 'state-shipped' } }),
		);
	});

	it('leaves a Linear issue that is already completed or canceled alone', async () => {
		const { linear, service } = closeOutWith({
			linear: fakeLinear({ issue: linearIssue({ stateType: 'canceled' }) }),
		});

		const report = await service.closeOut(MERGE);

		expect(linear.updateIssue).not.toHaveBeenCalled();
		expect(report.issue).toEqual({ status: 'already-closed' });
	});

	it('syncs the metadata once when the cache has no completed state for the team', async () => {
		const { linear, service } = closeOutWith({
			linear: fakeLinear({
				cachedStates: [state('state-review', 'In Review', 'started')],
				syncedStates: [state('state-done', 'Done', 'completed')],
			}),
		});

		const report = await service.closeOut(MERGE);

		expect(linear.getMetadata).toHaveBeenCalledTimes(2);
		expect(linear.getMetadata).toHaveBeenLastCalledWith({
			accountId: ACCOUNT_ID,
			refresh: true,
		});
		expect(report.issue).toEqual({ status: 'closed' });
	});

	it('reports a team with no completed state as a failure, without writing', async () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
		const { linear, service } = closeOutWith({
			linear: fakeLinear({ cachedStates: [] }),
		});

		const report = await service.closeOut(MERGE);

		expect(linear.updateIssue).not.toHaveBeenCalled();
		expect(report.issue.status).toBe('failed');
		expect(warn).toHaveBeenCalledOnce();
	});

	it('still moves the board card when Linear cannot be read', async () => {
		vi.spyOn(console, 'warn').mockImplementation(() => undefined);
		const linear = fakeLinear();
		linear.getIssue.mockResolvedValueOnce({
			failure: { code: 'network', message: 'offline', retryAfterSeconds: null },
			status: 'error',
		} as never);
		const { service, setBoardStatus } = closeOutWith({ linear });

		const report = await service.closeOut(MERGE);

		expect(setBoardStatus).toHaveBeenCalledWith('ws-1', 'done');
		expect(report.issue).toEqual({ message: 'offline', status: 'failed' });
	});

	it('closes a linked GitHub issue as completed', async () => {
		const { commands, service } = closeOutWith({
			readLinkedIssue: () => GITHUB_LINK,
		});

		const report = await service.closeOut(MERGE);

		expect(commands.run).toHaveBeenCalledWith(
			expect.objectContaining({
				args: [
					'issue',
					'close',
					'https://github.com/acme/app/issues/12',
					'--reason',
					'completed',
				],
				command: 'gh',
			}),
		);
		expect(report.issue).toEqual({ status: 'closed' });
	});

	it('reports a GitHub issue gh found closed already', async () => {
		const { service } = closeOutWith({
			commands: fakeCommands(
				commandResult({
					stderr: '! Issue acme/app#12 (Ship it) is already closed\n',
				}),
			),
			readLinkedIssue: () => GITHUB_LINK,
		});

		const report = await service.closeOut(MERGE);

		expect(report.issue).toEqual({ status: 'already-closed' });
	});

	it('refuses to hand gh a GitHub issue URL it cannot vouch for', async () => {
		vi.spyOn(console, 'warn').mockImplementation(() => undefined);
		const { commands, service } = closeOutWith({
			readLinkedIssue: () => ({ ...GITHUB_LINK, url: '--repo=evil/repo' }),
		});

		const report = await service.closeOut(MERGE);

		expect(commands.run).not.toHaveBeenCalled();
		expect(report.issue.status).toBe('failed');
	});

	it('moves only the board card when the workspace has no linked issue', async () => {
		const { commands, linear, service, setBoardStatus } = closeOutWith({
			readLinkedIssue: () => null,
		});

		const report = await service.closeOut(MERGE);

		expect(setBoardStatus).toHaveBeenCalledWith('ws-1', 'done');
		expect(linear.getIssue).not.toHaveBeenCalled();
		expect(commands.run).not.toHaveBeenCalled();
		expect(report.issue).toEqual({ status: 'no-linked-issue' });
	});

	it('closes out each merged pull request once, sharing the first report', async () => {
		const { service, setBoardStatus, syncLocalBase } = closeOutWith({
			readLinkedIssue: () => null,
		});

		const first = service.closeOut(MERGE);
		const repeat = service.closeOut(MERGE);
		const successor = await service.closeOut({
			...MERGE,
			pullRequestNumber: 8,
		});

		expect(repeat).toBe(first);
		expect(await repeat).toEqual(await first);
		expect(successor.pullRequestNumber).toBe(8);
		expect(setBoardStatus).toHaveBeenCalledTimes(2);
		expect(syncLocalBase).toHaveBeenCalledTimes(2);
	});

	it('fast-forwards the local base branch of the merged workspace', async () => {
		const { service, syncLocalBase } = closeOutWith({
			readLinkedIssue: () => null,
		});

		const report = await service.closeOut(MERGE);

		expect(syncLocalBase).toHaveBeenCalledWith('ws-1');
		expect(report.baseSync).toEqual(FAST_FORWARDED);
	});

	it('logs a base branch it had to leave alone, without failing the close-out', async () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
		const diverged: LocalBaseSyncOutcome = {
			branch: 'master',
			status: 'diverged',
			upstreamRef: 'origin/master',
		};
		const { service, setBoardStatus } = closeOutWith({
			readLinkedIssue: () => null,
			syncLocalBase: async () => diverged,
		});

		const report = await service.closeOut(MERGE);

		expect(report.baseSync).toEqual(diverged);
		expect(report.issue).toEqual({ status: 'no-linked-issue' });
		expect(setBoardStatus).toHaveBeenCalledWith('ws-1', 'done');
		expect(warn).toHaveBeenCalledOnce();
	});

	it('stays quiet when the setting turned the base sync off', async () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
		const { service } = closeOutWith({
			readLinkedIssue: () => null,
			syncLocalBase: async () => ({ status: 'disabled' }),
		});

		const report = await service.closeOut(MERGE);

		expect(report.baseSync).toEqual({ status: 'disabled' });
		expect(warn).not.toHaveBeenCalled();
	});

	it('turns a base sync that throws into an outcome', async () => {
		vi.spyOn(console, 'warn').mockImplementation(() => undefined);
		const { service } = closeOutWith({
			syncLocalBase: async () => {
				throw new Error('git missing');
			},
		});

		const report = await service.closeOut(MERGE);

		expect(report.baseSync).toEqual({
			detail: 'git missing',
			status: 'unavailable',
		});
		expect(report.issue).toEqual({ status: 'closed' });
	});

	it('never rejects, even when its collaborators throw', async () => {
		vi.spyOn(console, 'warn').mockImplementation(() => undefined);
		const { service, setBoardStatus } = closeOutWith({
			readLinkedIssue: () => {
				throw new Error('database closed');
			},
		});
		setBoardStatus.mockImplementation(() => {
			throw new Error('no window');
		});

		const report = await service.closeOut(MERGE);

		expect(report.issue).toEqual({
			message: 'database closed',
			status: 'failed',
		});
	});
});
