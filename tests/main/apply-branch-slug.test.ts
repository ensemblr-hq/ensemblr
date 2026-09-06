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
		branchName: 'octocat/bach',
		metadataJson: JSON.stringify({ placeholderName: true }),
		name: 'bach',
		...overrides,
	};
}

function renameResult(name: string, branchName: string, changed = true) {
	return {
		changed,
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
				renameResult('add-dark-mode', 'octocat/add-dark-mode'),
			);

		const result = await applyBranchSlug({
			database,
			name: 'Add Dark Mode',
			namingEnabled: true,
			renameWorkspace,
			workspaceId: 'ws-1',
		});

		expect(renameWorkspace).toHaveBeenCalledWith({
			branchName: 'octocat/add-dark-mode',
			name: 'Add Dark Mode',
			provisional: false,
			requirePlaceholderName: true,
			workspaceId: 'ws-1',
		});
		expect(result).toMatchObject({
			applied: true,
			branchName: 'octocat/add-dark-mode',
			name: 'add-dark-mode',
		});
	});

	// The workspace used to be titled with its own branch name minus the
	// `prefix/`, so the board read `add-dark-mode` over `octocat/add-dark-mode`.
	test('titles the workspace readably while the branch takes the slug', async () => {
		selectWorkspace.mockReturnValue(workspaceRow());
		const renameWorkspace = vi
			.fn()
			.mockResolvedValue(
				renameResult('Fix IPC handler', 'octocat/fix-ipc-handler'),
			);

		await applyBranchSlug({
			database,
			name: 'fix-ipc-handler',
			namingEnabled: true,
			renameWorkspace,
			workspaceId: 'ws-1',
		});

		expect(renameWorkspace).toHaveBeenCalledWith(
			expect.objectContaining({
				branchName: 'octocat/fix-ipc-handler',
				name: 'Fix IPC handler',
			}),
		);
	});

	test('reports an already-named workspace as settled without renaming it', async () => {
		selectWorkspace.mockReturnValue(
			workspaceRow({
				branchName: 'octocat/add-dark-mode',
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
			branchName: 'octocat/bach',
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

	// The service reports a blocked write as a success carrying the untouched
	// workspace, so only `changed` separates it from a rename that landed.
	test('reports settled when the rename service blocks on its own placeholder re-check', async () => {
		selectWorkspace.mockReturnValue(workspaceRow());
		const renameWorkspace = vi
			.fn()
			.mockResolvedValue(renameResult('bach', 'octocat/bach', false));

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
				renameResult(name, `octocat/${name}`),
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

	// An agent told only "no" reaches for `git branch -m`, which moves the branch
	// behind the app and leaves the workspace row pointing at one git no longer
	// has. Every refusal has to close that door explicitly.
	test('warns every refusal off renaming the branch with git', async () => {
		selectWorkspace.mockReturnValue(
			workspaceRow({
				metadataJson: JSON.stringify({ branchNamed: true }),
			}),
		);

		const settled = await applyBranchSlug({
			database,
			name: 'something-else',
			namingEnabled: true,
			renameWorkspace: vi.fn(),
			workspaceId: 'ws-1',
		});
		const turnedOff = await applyBranchSlug({
			database,
			name: 'something-else',
			namingEnabled: false,
			renameWorkspace: vi.fn(),
			workspaceId: 'ws-1',
		});

		expect(settled.message).toContain('git branch -m');
		expect(turnedOff.message).toContain('git branch -m');
	});
});

describe('applyBranchSlug: a branch the user asked to rename', () => {
	test('renames a named branch when the user asked for it', async () => {
		selectWorkspace.mockReturnValue(
			workspaceRow({
				branchName: 'octocat/add-dark-mode',
				metadataJson: JSON.stringify({ branchNamed: true }),
				name: 'add-dark-mode',
			}),
		);
		const renameWorkspace = vi
			.fn()
			.mockResolvedValue(renameResult('add-dark-mode', 'octocat/dark-theme'));

		const result = await applyBranchSlug({
			database,
			name: 'dark-theme',
			namingEnabled: true,
			renameWorkspace,
			userRequested: true,
			workspaceId: 'ws-1',
		});

		expect(renameWorkspace).toHaveBeenCalledWith({
			branchName: 'octocat/dark-theme',
			name: 'add-dark-mode',
			provisional: false,
			requirePlaceholderName: false,
			workspaceId: 'ws-1',
		});
		expect(result).toMatchObject({
			applied: true,
			branchName: 'octocat/dark-theme',
		});
	});

	// The setting is the user saying they never wanted the app touching this, so
	// an agent asserting the user asked cannot talk its way past it.
	test('still refuses when the user turned naming off', async () => {
		selectWorkspace.mockReturnValue(workspaceRow());
		const renameWorkspace = vi.fn();

		const result = await applyBranchSlug({
			database,
			name: 'dark-theme',
			namingEnabled: false,
			renameWorkspace,
			userRequested: true,
			workspaceId: 'ws-1',
		});

		expect(renameWorkspace).not.toHaveBeenCalled();
		expect(result.applied).toBe(false);
	});

	test('refuses an adopted branch, which may already back a pull request', async () => {
		selectWorkspace.mockReturnValue(
			workspaceRow({
				metadataJson: JSON.stringify({ adoptedBranch: true }),
			}),
		);
		const renameWorkspace = vi.fn();

		const result = await applyBranchSlug({
			database,
			name: 'dark-theme',
			namingEnabled: true,
			renameWorkspace,
			userRequested: true,
			workspaceId: 'ws-1',
		});

		expect(renameWorkspace).not.toHaveBeenCalled();
		expect(result.applied).toBe(false);
		expect(result.message).toContain('pull request');
	});
});

describe('applyBranchSlug: a workspace the user has already titled', () => {
	// The rename dialog retitles a workspace without moving its branch, which
	// used to retire the agent's one-shot for a branch nobody had named.
	test('moves the branch and leaves the chosen title alone', async () => {
		selectWorkspace.mockReturnValue(
			workspaceRow({
				metadataJson: JSON.stringify({
					branchNamed: false,
					placeholderName: true,
					renamedAt: '2026-06-16T00:00:00Z',
				}),
				name: 'My Feature',
			}),
		);
		const renameWorkspace = vi
			.fn()
			.mockResolvedValue(renameResult('My Feature', 'octocat/add-dark-mode'));

		const result = await applyBranchSlug({
			database,
			name: 'add-dark-mode',
			namingEnabled: true,
			renameWorkspace,
			workspaceId: 'ws-1',
		});

		expect(renameWorkspace).toHaveBeenCalledWith({
			branchName: 'octocat/add-dark-mode',
			name: 'My Feature',
			provisional: false,
			requirePlaceholderName: true,
			workspaceId: 'ws-1',
		});
		expect(result).toMatchObject({
			applied: true,
			branchName: 'octocat/add-dark-mode',
			name: 'My Feature',
		});
		expect(result.message).toContain('keeps the name "My Feature"');
	});

	// The pre-flight read said the name was the app's to set, so the request asked
	// for the slug; the service's own re-check saw the user's title land in between
	// and narrowed the write to the branch. The report has to follow the row.
	test('describes what was written when the service narrows to the branch', async () => {
		selectWorkspace.mockReturnValue(workspaceRow());
		const renameWorkspace = vi
			.fn()
			.mockResolvedValue(renameResult('bach', 'octocat/add-dark-mode'));

		const result = await applyBranchSlug({
			database,
			name: 'add-dark-mode',
			namingEnabled: true,
			renameWorkspace,
			workspaceId: 'ws-1',
		});

		expect(renameWorkspace).toHaveBeenCalledWith({
			branchName: 'octocat/add-dark-mode',
			name: 'Add dark mode',
			provisional: false,
			requirePlaceholderName: true,
			workspaceId: 'ws-1',
		});
		expect(result).toMatchObject({ applied: true, name: 'bach' });
		expect(result.message).toContain('keeps the name "bach"');
	});

	test('marks the rename provisional when the app is the one guessing', async () => {
		selectWorkspace.mockReturnValue(workspaceRow());
		const renameWorkspace = vi
			.fn()
			.mockResolvedValue(
				renameResult('add-dark-mode', 'octocat/add-dark-mode'),
			);

		await applyBranchSlug({
			database,
			name: 'add-dark-mode',
			namingEnabled: true,
			provisional: true,
			renameWorkspace,
			workspaceId: 'ws-1',
		});

		expect(renameWorkspace).toHaveBeenCalledWith({
			branchName: 'octocat/add-dark-mode',
			name: 'Add dark mode',
			provisional: true,
			requirePlaceholderName: true,
			workspaceId: 'ws-1',
		});
	});

	// Without this the branch would move again on every prompt of a planning
	// session, since each one derives its own slug.
	test('refuses a second provisional guess over the app’s own first one', async () => {
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
		const renameWorkspace = vi.fn();

		const result = await applyBranchSlug({
			database,
			name: 'something-else',
			namingEnabled: true,
			provisional: true,
			renameWorkspace,
			workspaceId: 'ws-1',
		});

		expect(renameWorkspace).not.toHaveBeenCalled();
		expect(result.applied).toBe(false);
	});

	// Guessing is scoped to placeholders. The branch of a workspace the user only
	// retitled is still nameable, but moving it onto a slug derived from one
	// prompt is a rename nobody asked for.
	test('refuses to guess over a workspace the user has already titled', async () => {
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
		const renameWorkspace = vi.fn();

		const result = await applyBranchSlug({
			database,
			name: 'add-dark-mode',
			namingEnabled: true,
			provisional: true,
			renameWorkspace,
			workspaceId: 'ws-1',
		});

		expect(renameWorkspace).not.toHaveBeenCalled();
		expect(result.applied).toBe(false);
	});

	// The regression that makes provisional naming safe: guessing a name must not
	// spend the agent's one call, or the whole point of naming early is lost.
	test('still lets the agent name a workspace the app named provisionally', async () => {
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
		const renameWorkspace = vi
			.fn()
			.mockResolvedValue(
				renameResult('theme-switcher', 'octocat/theme-switcher'),
			);

		const result = await applyBranchSlug({
			database,
			name: 'theme-switcher',
			namingEnabled: true,
			renameWorkspace,
			workspaceId: 'ws-1',
		});

		expect(renameWorkspace).toHaveBeenCalledWith({
			branchName: 'octocat/theme-switcher',
			name: 'Theme switcher',
			provisional: false,
			requirePlaceholderName: true,
			workspaceId: 'ws-1',
		});
		expect(result).toMatchObject({ applied: true, name: 'theme-switcher' });
	});
});
