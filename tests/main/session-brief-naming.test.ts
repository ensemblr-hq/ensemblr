import { beforeEach, describe, expect, test, vi } from 'vitest';

import { readSessionBriefNaming } from '../../src/main/pi-agent/naming/session-brief-naming.ts';

const getChatTabByPiSessionId = vi.hoisted(() => vi.fn());
const getMainBranchForSession = vi.hoisted(() => vi.fn());
const getMaxOrdinalForBranch = vi.hoisted(() => vi.fn());
const selectWorkspaceWithRepositoryById = vi.hoisted(() => vi.fn());

vi.mock('../../src/main/storage/repositories/chat-tab-repository.ts', () => ({
	getChatTabByPiSessionId,
}));
vi.mock('../../src/main/storage/repositories/pi-session-repository.ts', () => ({
	getMainBranchForSession,
}));
vi.mock('../../src/main/storage/repositories/pi-event-repository.ts', () => ({
	getMaxOrdinalForBranch,
}));
vi.mock('../../src/main/storage/repositories/workspace-repository.ts', () => ({
	selectWorkspaceWithRepositoryById,
}));

const database = {} as never;

const piCaller = {
	isSubAgent: false,
	sessionId: 'sess-1',
	species: 'pi' as const,
	workspaceId: 'ws-1',
};

function workspaceRow(overrides: Record<string, unknown> = {}) {
	return {
		branchName: 'psoldunov/bach',
		metadataJson: JSON.stringify({ placeholderName: true }),
		...overrides,
	};
}

function summaryMarker(overrides: Record<string, unknown> = {}) {
	return {
		body: '- did the thing',
		branchId: 'branch-1',
		capturedAtOrdinal: 12,
		title: 'The thing',
		updatedAt: '2026-07-01T00:00:00.000Z',
		...overrides,
	};
}

function tab(metadata: Record<string, unknown>) {
	return { id: 'tab-1', metadata };
}

function read(
	overrides: {
		caller?:
			| typeof piCaller
			| {
					isSubAgent: boolean;
					sessionId: string;
					species: 'harness';
					workspaceId: string;
			  };
		database?: unknown;
		namingEnabled?: boolean;
	} = {},
) {
	return readSessionBriefNaming({
		caller: overrides.caller ?? piCaller,
		database: ('database' in overrides
			? overrides.database
			: database) as never,
		namingEnabled: () => overrides.namingEnabled ?? true,
	});
}

beforeEach(() => {
	getChatTabByPiSessionId.mockReset();
	getMainBranchForSession.mockReset();
	getMaxOrdinalForBranch.mockReset();
	selectWorkspaceWithRepositoryById.mockReset();
	selectWorkspaceWithRepositoryById.mockReturnValue(workspaceRow());
	getMainBranchForSession.mockReturnValue({ id: 'branch-1', kind: 'main' });
	getMaxOrdinalForBranch.mockReturnValue(12);
	getChatTabByPiSessionId.mockReturnValue(tab({}));
});

describe('readSessionBriefNaming: title provenance', () => {
	test('asks for a title while the tab carries the app-derived one', () => {
		getChatTabByPiSessionId.mockReturnValue(tab({ titleProvenance: 'auto' }));

		expect(read().titleNeeded).toBe(true);
	});

	test('asks for a title when the tab has no provenance at all', () => {
		expect(read().titleNeeded).toBe(true);
	});

	test('stops asking once the agent owns the title', () => {
		getChatTabByPiSessionId.mockReturnValue(tab({ titleProvenance: 'agent' }));

		expect(read().titleNeeded).toBe(false);
	});

	test('stops asking once the user owns the title', () => {
		getChatTabByPiSessionId.mockReturnValue(tab({ titleProvenance: 'user' }));

		expect(read().titleNeeded).toBe(false);
	});
});

describe('readSessionBriefNaming: summary staleness', () => {
	test('treats a tab with no recorded summary as stale', () => {
		expect(read().summaryStale).toBe(true);
	});

	test('treats a summary recorded on another branch as stale', () => {
		getChatTabByPiSessionId.mockReturnValue(
			tab({ agentSummary: summaryMarker({ branchId: 'branch-other' }) }),
		);

		expect(read().summaryStale).toBe(true);
	});

	test('treats a summary older than the branch tip as stale', () => {
		getChatTabByPiSessionId.mockReturnValue(
			tab({ agentSummary: summaryMarker({ capturedAtOrdinal: 11 }) }),
		);
		getMaxOrdinalForBranch.mockReturnValue(12);

		expect(read().summaryStale).toBe(true);
	});

	test('treats a summary at the branch tip as current', () => {
		getChatTabByPiSessionId.mockReturnValue(
			tab({ agentSummary: summaryMarker({ capturedAtOrdinal: 12 }) }),
		);

		expect(read().summaryStale).toBe(false);
	});

	test('treats a summary ahead of the branch tip as current', () => {
		getChatTabByPiSessionId.mockReturnValue(
			tab({ agentSummary: summaryMarker({ capturedAtOrdinal: 20 }) }),
		);

		expect(read().summaryStale).toBe(false);
	});
});

describe('readSessionBriefNaming: workspace naming eligibility', () => {
	test('reports the branch as nameable while the placeholder name stands', () => {
		expect(read().branch).toEqual({
			current: 'psoldunov/bach',
			eligible: true,
		});
	});

	// `setBranchName` refuses a spawned child, so the upkeep block must not ask one
	// for it — an agent handed a reminder for a call that fails has no way to
	// satisfy the reminder and will keep retrying it.
	test('withholds the branch bullet from a spawned sub-agent', () => {
		const brief = read({ caller: { ...piCaller, isSubAgent: true } });

		expect(brief.branch).toEqual({
			current: 'psoldunov/bach',
			eligible: false,
		});
	});

	test('reports a renamed workspace as no longer nameable', () => {
		selectWorkspaceWithRepositoryById.mockReturnValue(
			workspaceRow({
				branchName: 'psoldunov/add-dark-mode',
				metadataJson: JSON.stringify({
					placeholderName: true,
					renamedAt: '2026-06-16T00:00:00Z',
				}),
			}),
		);

		expect(read().branch).toEqual({
			current: 'psoldunov/add-dark-mode',
			eligible: false,
		});
	});

	test('reports a workspace the user named themselves as no longer nameable', () => {
		selectWorkspaceWithRepositoryById.mockReturnValue(
			workspaceRow({ metadataJson: JSON.stringify({}) }),
		);

		expect(read().branch.eligible).toBe(false);
	});

	test('reports nothing nameable when the user turned naming off', () => {
		expect(read({ namingEnabled: false }).branch).toEqual({
			current: 'psoldunov/bach',
			eligible: false,
		});
	});

	test('reports a missing workspace as nothing nameable', () => {
		selectWorkspaceWithRepositoryById.mockReturnValue(undefined);

		expect(read().branch).toEqual({ current: null, eligible: false });
	});
});

describe('readSessionBriefNaming: callers without a chat tab', () => {
	test('reports only branch upkeep for a harness caller', () => {
		const brief = read({
			caller: {
				isSubAgent: false,
				sessionId: 'harness-1',
				species: 'harness',
				workspaceId: 'ws-1',
			},
		});

		expect(brief).toEqual({
			branch: { current: 'psoldunov/bach', eligible: true },
			summaryStale: false,
			titleNeeded: false,
		});
		expect(getChatTabByPiSessionId).not.toHaveBeenCalled();
	});

	test('reports only branch upkeep when the caller has no tab', () => {
		getChatTabByPiSessionId.mockReturnValue(null);

		expect(read()).toEqual({
			branch: { current: 'psoldunov/bach', eligible: true },
			summaryStale: false,
			titleNeeded: false,
		});
	});

	test('reports only branch upkeep when the caller has no branch', () => {
		getMainBranchForSession.mockReturnValue(null);

		expect(read().summaryStale).toBe(false);
	});
});

describe('readSessionBriefNaming: degradation', () => {
	test('reports nothing outstanding without a database', () => {
		expect(read({ database: null })).toEqual({
			branch: { current: null, eligible: false },
			summaryStale: false,
			titleNeeded: false,
		});
		expect(selectWorkspaceWithRepositoryById).not.toHaveBeenCalled();
	});

	test('logs and reports nothing outstanding when a lookup throws', () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		selectWorkspaceWithRepositoryById.mockImplementation(() => {
			throw new Error('database is locked');
		});

		expect(read()).toEqual({
			branch: { current: null, eligible: false },
			summaryStale: false,
			titleNeeded: false,
		});
		expect(warn).toHaveBeenCalledWith(
			expect.stringContaining('session brief naming read failed'),
			expect.objectContaining({ cause: 'database is locked' }),
		);
		warn.mockRestore();
	});

	test('does not share one brief object across calls', () => {
		selectWorkspaceWithRepositoryById.mockReturnValue(undefined);
		getChatTabByPiSessionId.mockReturnValue(null);

		const first = read();
		first.titleNeeded = true;

		expect(read().titleNeeded).toBe(false);
	});
});
