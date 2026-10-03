import { describe, expect, test } from 'vitest';

import { mapRepositoriesToProjects } from '../../src/renderer/lib/workbench';
import { statesPresentationVerdict } from '../../src/renderer/lib/workbench/navigation-model';
import type { WorkspaceShellModel } from '../../src/renderer/types/workbench';
import type {
	WorkspacePrPresentation,
	WorkspacePrPresentationStatus,
} from '../../src/shared/ipc/contracts/repository-navigation';

const NOW = '2026-10-03T00:00:00.000Z';

const ALL_STATUSES: WorkspacePrPresentationStatus[] = [
	'blocked',
	'checking',
	'closed',
	'merged',
	'open',
	'ready',
];

/**
 * Maps one workspace carrying `presentation` through the same path the sidebar
 * takes, and returns the PR model that row would hand `useLivePullRequestModel`.
 * @param presentation - The row's presentation, or null for a row with no pull request.
 * @returns The mapped PR model.
 */
function mappedPullRequest(
	presentation: WorkspacePrPresentation | null,
): WorkspaceShellModel['pullRequest'] {
	const [project] = mapRepositoriesToProjects([
		{
			createdAt: NOW,
			defaultBranch: 'main',
			id: 'repo-1',
			metadata: {},
			name: 'repo',
			path: '/repo',
			slug: 'repo',
			updatedAt: NOW,
			workspaces: [
				{
					archivedAt: null,
					baseBranch: 'main',
					branchName: 'feature',
					createdAt: NOW,
					id: 'workspace-1',
					metadata: {},
					name: 'Feature',
					path: '/repo/feature',
					pullRequest: presentation,
					repositoryId: 'repo-1',
					slug: 'feature',
					updatedAt: NOW,
				},
			],
		},
	]);
	const pullRequest = project?.workspaces[0]?.pullRequest;
	if (!pullRequest) {
		throw new Error('fixture workspace missing');
	}
	return pullRequest;
}

/**
 * A presentation of a pull request in the given status.
 * @param status - Compact status to present.
 * @param number - Pull request number, PR #7 unless given.
 * @returns The presentation.
 */
function presentationOf(
	status: WorkspacePrPresentationStatus,
	number = 7,
): WorkspacePrPresentation {
	return { branchSync: null, number, status };
}

// The gate decides whether a row's model may borrow the cached observation
// stamp. A model mapped from the current snapshot must always pass it, or every
// ordinary row silently loses its claim against a stale live snapshot.
describe('statesPresentationVerdict', () => {
	test.each(ALL_STATUSES)(
		'holds for the model mapped from a %s presentation',
		(status) => {
			const presentation = presentationOf(status);
			expect(
				statesPresentationVerdict(
					mappedPullRequest(presentation),
					presentation,
				),
			).toBe(true);
		},
	);

	test.each(ALL_STATUSES)(
		'tells a %s model apart from every other status',
		(status) => {
			const model = mappedPullRequest(presentationOf(status));
			for (const other of ALL_STATUSES.filter(
				(candidate) => candidate !== status,
			)) {
				expect(statesPresentationVerdict(model, presentationOf(other))).toBe(
					false,
				);
			}
		},
	);

	test('fails for a model of another pull request', () => {
		expect(
			statesPresentationVerdict(
				mappedPullRequest(presentationOf('ready')),
				presentationOf('ready', 8),
			),
		).toBe(false);
	});

	test('fails for a model that had no pull request at all', () => {
		expect(
			statesPresentationVerdict(
				mappedPullRequest(null),
				presentationOf('open'),
			),
		).toBe(false);
	});
});
