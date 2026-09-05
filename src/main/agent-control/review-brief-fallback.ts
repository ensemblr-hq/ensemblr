/**
 * The review prompt main composes on its own, for when no renderer window
 * answers {@link createReviewLaunchCoordinator}'s request in time.
 *
 * Deliberately the *same* prompt with two inputs missing rather than a second
 * prompt: the template, the context sections, and the order they appear in come
 * from `shared/review-brief`, which is also what the renderer's Review button
 * composes from. What main cannot see is the user's personal per-repository
 * review instructions — still `localStorage` — and their pinned review model, a
 * preference atom. The repository's committed `[prompts]` preference does reach
 * it, so a repository that configures its review policy in the tracked file
 * keeps it even here.
 *
 * `startReview` tells the calling agent which of the two it got, so a review
 * that ran without the user's own instructions is reported rather than passed
 * off as the configured one.
 */

import { bareBranchName } from '../../shared/branch-ref.ts';
import type { SettingsResolutionSnapshot } from '../../shared/ipc/contracts/settings-resolution.ts';
import type { WorkspaceGitFileWire } from '../../shared/ipc/contracts/workspace-git.ts';
import type { ReviewBriefChangedFile } from '../../shared/review-brief.ts';
import { composeReviewBrief } from '../../shared/review-brief.ts';
import type { EnsemblrDatabaseService } from '../storage';
import { selectWorkspaceWithRepositoryById } from '../storage/repositories/workspace-repository.ts';
import type { WorkspaceGitService } from '../workspace-git';
import { scopeFor } from './review-ports.ts';

/** Collaborators for {@link makeReviewBriefFallback}. */
export interface ReviewBriefFallbackDeps {
	databaseService: EnsemblrDatabaseService;
	workspaceGitService: WorkspaceGitService;
	/** Resolves a repository's settings, for its committed review preference. */
	resolveRepositorySettings: (repository: {
		repositoryId: string;
		repositoryPath: string;
	}) => SettingsResolutionSnapshot;
}

/**
 * Settings key carrying the repository's committed review instructions. Named
 * once here because this is the only main-side reader of it; the renderer's
 * `sharedActionPreference` derives the same key from its action map.
 */
const SHARED_REVIEW_PREFERENCE_KEY = 'actionPreferences.codeReview';

/** Stands in for the branch name when the workspace row cannot be read. */
const UNNAMED_BRANCH = 'this branch';

/** Row shape the fallback brief is composed from. */
interface WorkspaceReviewRow {
	baseBranch: string | null;
	branchName: string | null;
	repositoryId: string;
	repositoryPath: string;
}

/**
 * Maps git status rows to the changed-file lines a review brief lists, matching
 * what the Changes panel shows the user: ignored files dropped, binary files
 * counted as zero.
 * @param files - Git status wire rows for the scope under review.
 * @returns The rows a review brief lists.
 */
function toReviewBriefChangedFiles(
	files: readonly WorkspaceGitFileWire[],
): ReviewBriefChangedFile[] {
	return files.flatMap((file) =>
		file.status === 'ignored'
			? []
			: [
					{
						additions: file.additions ?? 0,
						deletions: file.deletions ?? 0,
						path: file.path,
						status: file.status,
					},
				],
	);
}

/**
 * Reads the repository's committed review preference out of a resolved settings
 * snapshot.
 * @param snapshot - The repository's resolved settings.
 * @returns The configured preference, or `''` when it configures none.
 */
function readSharedReviewPreference(
	snapshot: SettingsResolutionSnapshot,
): string {
	const value = snapshot.repository?.settings.find(
		(setting) => setting.key === SHARED_REVIEW_PREFERENCE_KEY,
	)?.value;
	return typeof value === 'string' ? value : '';
}

/**
 * Builds the main-side review-brief composer.
 * @param deps - Database, git service, and settings resolver.
 * @returns A composer over a workspace id and checkout path.
 */
export function makeReviewBriefFallback(
	deps: ReviewBriefFallbackDeps,
): (input: { workspaceId: string; workspaceCwd: string }) => Promise<string> {
	return async ({ workspaceId, workspaceCwd }) => {
		const database = deps.databaseService.getConnection()?.database;
		const row = database
			? (selectWorkspaceWithRepositoryById({ database, workspaceId }) as
					| WorkspaceReviewRow
					| undefined)
			: undefined;
		const status = await deps.workspaceGitService.getStatus({
			scope: scopeFor(row?.baseBranch ?? null),
			workspaceCwd,
		});
		return composeReviewBrief({
			// `baseBranch` is stripped of its remote qualifier and `branchName` is
			// not, matching the Review button exactly: the prompt writes the base as
			// `origin/${TARGET_BRANCH}` itself, and a workspace branch is stored bare.
			baseBranch: bareBranchName(row?.baseBranch),
			branchName: row?.branchName ?? UNNAMED_BRANCH,
			changedFiles: toReviewBriefChangedFiles(status.files ?? []),
			preferences: row
				? readSharedReviewPreference(
						deps.resolveRepositorySettings({
							repositoryId: row.repositoryId,
							repositoryPath: row.repositoryPath,
						}),
					)
				: '',
			pullRequest: null,
		});
	};
}
