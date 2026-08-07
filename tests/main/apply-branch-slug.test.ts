import { beforeEach, describe, expect, test, vi } from 'vitest';

import {
	applyBranchSlug,
	BranchSlugRejected,
} from '../../src/main/agent-runtime/naming/apply-branch-slug';

const selectWorkspace = vi.hoisted(() => vi.fn());

vi.mock('../../src/main/storage/repositories/workspace-repository.ts', () => ({
	selectWorkspaceWithRepositoryById: selectWorkspace,
}));

const database = {} as never;

function workspaceRow(overrides: Record<string, unknown> = {}) {
	return {
		branchName: 'psoldunov/bach',
		metadataJson: JSON.stringify({ placeholderName: true }),
		name: 'bach',
		...overrides,
	};
}

function renameResult(name: string, branchName: string) {
	return {
		diagnostics: [],
		status: 'success' as const,
		workspace: { branchName, name },
	};
}

beforeEach(() => {
	selectWorkspace.mockReset();
});

describe('applyBranchSlug', () => {
	test('names the workspace and branch, keeping the branch prefix', async () => {
		selectWorkspace.mockReturnValue(workspaceRow());
		const renameWorkspace = vi
			.fn()
			.mockResolvedValue(
				renameResult('add-dark-mode', 'psoldunov/add-dark-mode'),
			);

		const result = await applyBranchSlug({
			database,
			name: 'Add Dark Mode',
			namingEnabled: true,
			renameWorkspace,
			workspaceId: 'ws-1',
		});

		expect(renameWorkspace).toHaveBeenCalledWith({
			branchName: 'psoldunov/add-dark-mode',
			name: 'add-dark-mode',
			requirePlaceholderName: true,
			workspaceId: 'ws-1',
		});
		expect(result).toMatchObject({
			applied: true,
			branchName: 'psoldunov/add-dark-mode',
			name: 'add-dark-mode',
		});
	});

	test('reports an already-named workspace as settled without renaming it', async () => {
		selectWorkspace.mockReturnValue(
			workspaceRow({
				branchName: 'psoldunov/add-dark-mode',
				metadataJson: JSON.stringify({
					placeholderName: true,
					renamedAt: '2026-06-16T00:00:00Z',
				}),
				name: 'add-dark-mode',
			}),
		);
		const renameWorkspace = vi.fn();

		const result = await applyBranchSlug({
			database,
			name: 'something-else',
			namingEnabled: true,
			renameWorkspace,
			workspaceId: 'ws-1',
		});

		expect(renameWorkspace).not.toHaveBeenCalled();
		expect(result.applied).toBe(false);
		expect(result.name).toBe('add-dark-mode');
		expect(result.message).toContain('do not call this tool again');
	});

	test('leaves a placeholder workspace alone when the user turned naming off', async () => {
		selectWorkspace.mockReturnValue(workspaceRow());
		const renameWorkspace = vi.fn();

		const result = await applyBranchSlug({
			database,
			name: 'add-dark-mode',
			namingEnabled: false,
			renameWorkspace,
			workspaceId: 'ws-1',
		});

		expect(renameWorkspace).not.toHaveBeenCalled();
		expect(result).toMatchObject({
			applied: false,
			branchName: 'psoldunov/bach',
			name: 'bach',
		});
		expect(result.message).toContain('turned off');
		expect(result.message).toContain('do not call this tool again');
	});

	test('refuses a turned-off rename even when the slug is unusable', async () => {
		selectWorkspace.mockReturnValue(workspaceRow());

		const result = await applyBranchSlug({
			database,
			name: '///',
			namingEnabled: false,
			renameWorkspace: vi.fn(),
			workspaceId: 'ws-1',
		});

		expect(result.applied).toBe(false);
	});

	test('reports settled when the rename service blocks on its own placeholder re-check', async () => {
		selectWorkspace.mockReturnValue(workspaceRow());
		const renameWorkspace = vi
			.fn()
			.mockResolvedValue(renameResult('bach', 'psoldunov/bach'));

		const result = await applyBranchSlug({
			database,
			name: 'add-dark-mode',
			namingEnabled: true,
			renameWorkspace,
			workspaceId: 'ws-1',
		});

		expect(result.applied).toBe(false);
	});

	test('rejects a slug with no usable characters', async () => {
		selectWorkspace.mockReturnValue(workspaceRow());

		await expect(
			applyBranchSlug({
				database,
				name: '///',
				namingEnabled: true,
				renameWorkspace: vi.fn(),
				workspaceId: 'ws-1',
			}),
		).rejects.toBeInstanceOf(BranchSlugRejected);
	});

	test('sanitizes hostile input before it reaches the rename service', async () => {
		selectWorkspace.mockReturnValue(workspaceRow());
		const renameWorkspace = vi
			.fn()
			.mockImplementation(async ({ name }: { name: string }) =>
				renameResult(name, `psoldunov/${name}`),
			);

		await applyBranchSlug({
			database,
			name: '../../etc/passwd',
			namingEnabled: true,
			renameWorkspace,
			workspaceId: 'ws-1',
		});

		const applied = renameWorkspace.mock.calls[0]?.[0] as { name: string };
		expect(applied.name).not.toContain('..');
		expect(applied.name).not.toContain('/');
	});

	test('surfaces a branch collision as a rejection the agent can retry differently', async () => {
		selectWorkspace.mockReturnValue(workspaceRow());
		const renameWorkspace = vi.fn().mockResolvedValue({
			diagnostics: [
				{ code: 'branch-already-exists', message: 'branch already exists' },
			],
			status: 'failure',
		});

		await expect(
			applyBranchSlug({
				database,
				name: 'add-dark-mode',
				namingEnabled: true,
				renameWorkspace,
				workspaceId: 'ws-1',
			}),
		).rejects.toThrow(/branch already exists/);
	});

	test('rejects a workspace that cannot be resolved', async () => {
		selectWorkspace.mockReturnValue(undefined);

		await expect(
			applyBranchSlug({
				database,
				name: 'add-dark-mode',
				namingEnabled: true,
				renameWorkspace: vi.fn(),
				workspaceId: 'gone',
			}),
		).rejects.toBeInstanceOf(BranchSlugRejected);
	});
});
