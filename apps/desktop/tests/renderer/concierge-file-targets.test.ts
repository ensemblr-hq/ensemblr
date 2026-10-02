import { describe, expect, test } from 'vitest';

import { resolveConciergeFileTarget } from '../../src/renderer/lib/concierge';
import type {
	ProjectShellModel,
	WorkspaceShellModel,
} from '../../src/renderer/types/workbench';

const ROOT = '/Users/dev/Ensemblr (DEV)';

function workspace(
	id: string,
	pathLabel: string,
	extra: Partial<WorkspaceShellModel> = {},
): WorkspaceShellModel {
	return { id, name: id, pathLabel, ...extra } as WorkspaceShellModel;
}

function project(
	id: string,
	pathLabel: string,
	workspaces: WorkspaceShellModel[],
): ProjectShellModel {
	return { id, name: id, pathLabel, workspaces } as ProjectShellModel;
}

const APP = project('app', `${ROOT}/repos/app`, [
	workspace('bruckner', `${ROOT}/workspaces/app/bruckner`, {
		updatedAt: '2026-08-20T10:00:00.000Z',
	}),
	workspace('mahler', `${ROOT}/workspaces/app/mahler`, {
		updatedAt: '2026-08-24T10:00:00.000Z',
	}),
]);
const NOTES = project('notes', `${ROOT}/repos/notes`, [
	workspace('ravel', `${ROOT}/workspaces/notes/ravel`),
]);
const PROJECTS = [APP, NOTES];

describe('placing a Concierge path against a workspace', () => {
	test('resolves a path inside a worktree to that workspace, relatively', () => {
		expect(
			resolveConciergeFileTarget(
				PROJECTS,
				`${ROOT}/workspaces/app/bruckner/src/main/main.ts`,
			),
		).toEqual({
			filePath: 'src/main/main.ts',
			projectId: 'app',
			workspaceId: 'bruckner',
		});
	});

	test('picks the right worktree when two share a parent directory', () => {
		expect(
			resolveConciergeFileTarget(
				PROJECTS,
				`${ROOT}/workspaces/app/mahler/README.md`,
			)?.workspaceId,
		).toBe('mahler');
	});

	// The base checkout has no route of its own, so the file is shown in a
	// workspace of the same project — keeping the absolute path, or the preview
	// would read the worktree's copy instead of the repository's.
	test('shows a repository file in the project last worked on', () => {
		expect(
			resolveConciergeFileTarget(PROJECTS, `${ROOT}/repos/app/package.json`),
		).toEqual({
			filePath: `${ROOT}/repos/app/package.json`,
			projectId: 'app',
			workspaceId: 'mahler',
		});
	});

	test('refuses a relative path, which names a file in every project at once', () => {
		expect(resolveConciergeFileTarget(PROJECTS, 'README.md')).toBeNull();
		expect(resolveConciergeFileTarget(PROJECTS, 'src/main/main.ts')).toBeNull();
	});

	test('refuses a path under no known project', () => {
		expect(
			resolveConciergeFileTarget(PROJECTS, '/tmp/scratch/notes.md'),
		).toBeNull();
		expect(
			resolveConciergeFileTarget(PROJECTS, `${ROOT}/concierge/MEMORY.md`),
		).toBeNull();
	});

	// `/…/workspaces/app/bruckner-old` is not a file inside `bruckner`.
	test('refuses a sibling whose name merely starts with a workspace root', () => {
		expect(
			resolveConciergeFileTarget(
				PROJECTS,
				`${ROOT}/workspaces/app/bruckner-old/README.md`,
			),
		).toBeNull();
	});

	test('refuses the workspace root itself, which is no file', () => {
		expect(
			resolveConciergeFileTarget(PROJECTS, `${ROOT}/workspaces/app/bruckner`),
		).toBeNull();
	});

	test('normalizes a path that climbs before it descends', () => {
		expect(
			resolveConciergeFileTarget(
				PROJECTS,
				`${ROOT}/workspaces/app/mahler/src/../README.md`,
			),
		).toEqual({
			filePath: 'README.md',
			projectId: 'app',
			workspaceId: 'mahler',
		});
	});

	test('never places a path in a workspace still being created', () => {
		const pending = project('fresh', `${ROOT}/repos/fresh`, [
			workspace('pending', `${ROOT}/workspaces/fresh/pending`, {
				isPendingCreation: true,
			}),
		]);

		expect(
			resolveConciergeFileTarget(
				[pending],
				`${ROOT}/workspaces/fresh/pending/README.md`,
			),
		).toBeNull();
		expect(
			resolveConciergeFileTarget([pending], `${ROOT}/repos/fresh/README.md`),
		).toBeNull();
	});

	test('resolves a path in another project than the first listed', () => {
		expect(
			resolveConciergeFileTarget(
				PROJECTS,
				`${ROOT}/workspaces/notes/ravel/docs/plan.md`,
			),
		).toEqual({
			filePath: 'docs/plan.md',
			projectId: 'notes',
			workspaceId: 'ravel',
		});
	});
});
