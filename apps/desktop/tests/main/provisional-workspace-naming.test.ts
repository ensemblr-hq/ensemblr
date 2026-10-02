import { setTimeout as delay } from 'node:timers/promises';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import { createProvisionalWorkspaceNaming } from '../../src/main/agent-runtime/naming/provisional-workspace-naming';

const selectWorkspace = vi.hoisted(() => vi.fn());
const getChatTabByAgentSessionId = vi.hoisted(() => vi.fn());

vi.mock('../../src/main/storage/repositories/workspace-repository.ts', () => ({
	selectWorkspaceWithRepositoryById: selectWorkspace,
}));

vi.mock('../../src/main/storage/repositories/chat-tab-repository.ts', () => ({
	getChatTabByAgentSessionId,
}));

const database = {} as never;

function workspaceRow(overrides: Record<string, unknown> = {}) {
	return {
		branchName: 'octocat/poulenc',
		metadataJson: JSON.stringify({ placeholderName: true }),
		name: 'poulenc',
		...overrides,
	};
}

function renameResult(name: string, branchName: string) {
	return {
		changed: true,
		diagnostics: [],
		status: 'success' as const,
		workspace: { branchName, name },
	};
}

function harness({
	namingEnabled = true,
	renameWorkspace = vi
		.fn()
		.mockResolvedValue(renameResult('add-dark-mode', 'octocat/add-dark-mode')),
	connected = true,
}: {
	connected?: boolean;
	namingEnabled?: boolean;
	renameWorkspace?: ReturnType<typeof vi.fn>;
} = {}) {
	const onRenamed = vi.fn();
	const queue = createProvisionalWorkspaceNaming({
		databaseService: {
			getConnection: () => (connected ? { database } : undefined),
		} as never,
		namingEnabled: () => namingEnabled,
		onRenamed,
		renameWorkspace: renameWorkspace as never,
	});
	return { onRenamed, queue, renameWorkspace };
}

/** Lets the fire-and-forget queue settle before the assertions run. */
async function settle(): Promise<void> {
	await delay(0);
	await delay(0);
}

beforeEach(() => {
	selectWorkspace.mockReset();
	getChatTabByAgentSessionId.mockReset();
});

describe('createProvisionalWorkspaceNaming', () => {
	test('names a placeholder workspace from the prompt', async () => {
		selectWorkspace.mockReturnValue(workspaceRow());
		const { onRenamed, queue, renameWorkspace } = harness();

		queue({
			prompt: "I'd like to add dark mode",
			sessionId: 'session-1',
			workspaceId: 'ws-1',
		});
		await settle();

		expect(renameWorkspace).toHaveBeenCalledWith({
			branchName: 'octocat/add-dark-mode',
			name: 'Add dark mode',
			provisional: true,
			requirePlaceholderName: true,
			workspaceId: 'ws-1',
		});
		expect(onRenamed).toHaveBeenCalledWith({
			sessionId: 'session-1',
			workspaceId: 'ws-1',
		});
	});

	test('resolves the workspace from the session when the caller has none', async () => {
		selectWorkspace.mockReturnValue(workspaceRow());
		getChatTabByAgentSessionId.mockReturnValue({ workspaceId: 'ws-9' });
		const { queue, renameWorkspace } = harness();

		queue({
			prompt: 'add dark mode',
			sessionId: 'session-1',
			workspaceId: null,
		});
		await settle();

		expect(renameWorkspace).toHaveBeenCalledWith(
			expect.objectContaining({ workspaceId: 'ws-9' }),
		);
	});

	test('does nothing when the user turned workspace naming off', async () => {
		selectWorkspace.mockReturnValue(workspaceRow());
		const { onRenamed, queue, renameWorkspace } = harness({
			namingEnabled: false,
		});

		queue({
			prompt: 'add dark mode',
			sessionId: 'session-1',
			workspaceId: 'ws-1',
		});
		await settle();

		expect(renameWorkspace).not.toHaveBeenCalled();
		expect(onRenamed).not.toHaveBeenCalled();
	});

	test('does nothing when the branch was adopted rather than cut', async () => {
		selectWorkspace.mockReturnValue(
			workspaceRow({
				metadataJson: JSON.stringify({
					adoptedBranch: true,
					placeholderName: true,
				}),
			}),
		);
		const { onRenamed, queue, renameWorkspace } = harness();

		queue({
			prompt: 'add dark mode',
			sessionId: 'session-1',
			workspaceId: 'ws-1',
		});
		await settle();

		expect(renameWorkspace).not.toHaveBeenCalled();
		expect(onRenamed).not.toHaveBeenCalled();
	});

	test('does nothing once somebody has named the workspace', async () => {
		selectWorkspace.mockReturnValue(
			workspaceRow({
				metadataJson: JSON.stringify({
					branchNamed: true,
					placeholderName: true,
				}),
			}),
		);
		const { queue, renameWorkspace } = harness();

		queue({
			prompt: 'add dark mode',
			sessionId: 'session-1',
			workspaceId: 'ws-1',
		});
		await settle();

		expect(renameWorkspace).not.toHaveBeenCalled();
	});

	// Every prompt of a planning session fires the queue, and each derives its own
	// slug — without the provisional marker the branch would move on all of them.
	test('does not guess a second time over its own first guess', async () => {
		selectWorkspace.mockReturnValue(
			workspaceRow({
				branchName: 'octocat/add-dark-mode',
				metadataJson: JSON.stringify({
					branchProvisional: true,
					placeholderName: true,
				}),
				name: 'add-dark-mode',
			}),
		);
		const { queue, renameWorkspace } = harness();

		queue({
			prompt: 'now also add a theme switcher',
			sessionId: 'session-1',
			workspaceId: 'ws-1',
		});
		await settle();

		expect(renameWorkspace).not.toHaveBeenCalled();
	});

	// A guess only ever improves on a generated placeholder. Once the user has
	// titled the workspace the branch is still nameable, but moving it onto a slug
	// derived from one prompt is a rename nobody asked for.
	test('does not guess over a workspace the user has already titled', async () => {
		selectWorkspace.mockReturnValue(
			workspaceRow({
				metadataJson: JSON.stringify({
					branchNamed: false,
					placeholderName: true,
					renamedAt: '2026-08-14T00:00:00.000Z',
				}),
				name: 'My Feature',
			}),
		);
		const { onRenamed, queue, renameWorkspace } = harness();

		queue({
			prompt: 'add dark mode',
			sessionId: 'session-1',
			workspaceId: 'ws-1',
		});
		await settle();

		expect(renameWorkspace).not.toHaveBeenCalled();
		expect(onRenamed).not.toHaveBeenCalled();
	});

	// The open-time fire and the first submit overlap by design; without the guard
	// both would read the same unguessed row and move the branch twice.
	test('drops a second fire for a session whose first is still running', async () => {
		selectWorkspace.mockReturnValue(workspaceRow());
		let release = (): void => undefined;
		const renameWorkspace = vi.fn().mockReturnValue(
			new Promise((resolve) => {
				release = () => {
					resolve(renameResult('add-dark-mode', 'octocat/add-dark-mode'));
				};
			}),
		);
		const { queue } = harness({ renameWorkspace });

		queue({
			prompt: 'add dark mode',
			sessionId: 'session-1',
			workspaceId: 'ws-1',
		});
		await settle();
		queue({
			prompt: 'add a theme switcher',
			sessionId: 'session-1',
			workspaceId: 'ws-1',
		});
		await settle();

		expect(renameWorkspace).toHaveBeenCalledTimes(1);
		release();
	});

	test('does nothing when the prompt yields no usable slug', async () => {
		selectWorkspace.mockReturnValue(workspaceRow());
		const { queue, renameWorkspace } = harness();

		queue({ prompt: '!!! ???', sessionId: 'session-1', workspaceId: 'ws-1' });
		await settle();

		expect(renameWorkspace).not.toHaveBeenCalled();
	});

	test('does nothing when storage is unavailable', async () => {
		const { queue, renameWorkspace } = harness({ connected: false });

		queue({
			prompt: 'add dark mode',
			sessionId: 'session-1',
			workspaceId: 'ws-1',
		});
		await settle();

		expect(renameWorkspace).not.toHaveBeenCalled();
	});

	// Naming is bookkeeping: a rename that throws must be swallowed, never
	// surfaced into the turn that triggered it.
	test('swallows a rename failure rather than rejecting', async () => {
		selectWorkspace.mockReturnValue(workspaceRow());
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
		const { onRenamed, queue } = harness({
			renameWorkspace: vi.fn().mockRejectedValue(new Error('git exploded')),
		});

		queue({
			prompt: 'add dark mode',
			sessionId: 'session-1',
			workspaceId: 'ws-1',
		});
		await settle();

		expect(onRenamed).not.toHaveBeenCalled();
		expect(warn).toHaveBeenCalled();
		warn.mockRestore();
	});
});
