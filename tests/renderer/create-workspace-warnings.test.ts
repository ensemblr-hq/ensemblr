import { beforeEach, describe, expect, test, vi } from 'vitest';

import { reportCreateWorkspaceWarnings } from '../../src/renderer/lib/workbench/create-workspace-warnings';
import type {
	CreateWorkspaceDiagnostic,
	CreateWorkspaceResult,
} from '../../src/shared/ipc/contracts/workspace';

const { toastWarning } = vi.hoisted(() => ({ toastWarning: vi.fn() }));

vi.mock('sonner', () => ({ toast: { warning: toastWarning } }));

function resultWith(
	diagnostics: CreateWorkspaceDiagnostic[],
): CreateWorkspaceResult {
	return {
		diagnostics,
		filesToCopy: null,
		reusedExisting: false,
		status: 'success',
		workspace: null,
	};
}

describe('reportCreateWorkspaceWarnings', () => {
	beforeEach(() => {
		toastWarning.mockClear();
	});

	test('shows the translated headline with main’s message beneath it', () => {
		reportCreateWorkspaceWarnings(
			resultWith([
				{
					code: 'configured-base-unresolvable',
					message:
						'Could not resolve "origin/staging" in this repository, even after fetching. The workspace took "main" as its base instead.',
					severity: 'warning',
				},
			]),
		);

		expect(toastWarning).toHaveBeenCalledTimes(1);
		expect(toastWarning).toHaveBeenCalledWith(
			'The branch new workspaces fork from could not be resolved, so this workspace took the repository default as its base instead.',
			{
				description:
					'Could not resolve "origin/staging" in this repository, even after fetching. The workspace took "main" as its base instead.',
			},
		);
	});

	test('translates the invalid-base code apart from the unresolvable one', () => {
		reportCreateWorkspaceWarnings(
			resultWith([
				{
					code: 'configured-base-invalid',
					message:
						'Cannot use "origin/+main:refs/heads/pwned" as the branch new workspaces fork from. Branch name contains invalid characters. The workspace took "main" as its base instead.',
					severity: 'warning',
				},
			]),
		);

		expect(toastWarning).toHaveBeenCalledWith(
			'The branch new workspaces fork from is not a usable branch name, so this workspace took the repository default as its base instead.',
			expect.objectContaining({
				description: expect.stringContaining('origin/+main:refs/heads/pwned'),
			}),
		);
	});

	test('leaves errors to the caller’s own failure toast', () => {
		reportCreateWorkspaceWarnings(
			resultWith([
				{
					code: 'destination-exists',
					message: 'A file or directory already exists at /tmp/ws.',
					severity: 'error',
				},
			]),
		);

		expect(toastWarning).not.toHaveBeenCalled();
	});

	test('warns once per warning and not at all without one', () => {
		reportCreateWorkspaceWarnings(resultWith([]));
		expect(toastWarning).not.toHaveBeenCalled();

		reportCreateWorkspaceWarnings(
			resultWith([
				{
					code: 'configured-base-invalid',
					message: 'Cannot use "a:b" as the branch new workspaces fork from.',
					severity: 'warning',
				},
				{
					code: 'configured-base-unresolvable',
					message: 'Could not resolve "origin/gone" in this repository.',
					severity: 'warning',
				},
			]),
		);
		expect(toastWarning).toHaveBeenCalledTimes(2);
	});
});
