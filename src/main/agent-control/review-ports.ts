/**
 * The two ports that let an agent review its own workspace: {@link DiffPort}
 * over the git service and {@link ReviewPort} over the review service.
 *
 * Kept out of `port-adapters.ts` because neither is thin delegation. The app has
 * no whole-workspace unified diff anywhere — the Changes panel renders one file
 * at a time — so the diff port composes the status read with a per-file patch
 * read and fits the concatenation to the payload budget. That assembly is the
 * only real logic in the control layer's adapters, and it is the part worth
 * testing on its own.
 */

import type {
	AddDiffCommentsResult,
	AgentDiffComment,
	GetDiffCommentsResult,
	GetWorkspaceDiffResult,
	ReviewCommentsChangedBroadcast,
} from '../../shared/agent-control.ts';
import {
	budgetWorkspaceDiff,
	clampFilePatch,
	type DiffFilePatch,
	MAX_AGENT_PAYLOAD_CHARS,
} from '../../shared/agent-control.ts';
import type {
	WorkspaceGitDiffScope,
	WorkspaceGitFileWire,
} from '../../shared/ipc/contracts/workspace-git';
import type { ReviewService } from '../review';
import type { EnsemblrDatabaseService } from '../storage';
import { selectWorkspaceWithRepositoryById } from '../storage/repositories/workspace-repository.ts';
import type { WorkspaceGitService } from '../workspace-git';
import type { DiffPort, ReviewPort } from './ports.ts';

/** Collaborators the review and diff ports delegate to. */
export interface ReviewPortDeps {
	databaseService: EnsemblrDatabaseService;
	workspaceGitService: WorkspaceGitService;
	reviewService: ReviewService;
	broadcastReviewCommentsChanged: (
		payload: ReviewCommentsChangedBroadcast,
	) => void;
}

/**
 * How many per-file patches to read at once. Each read costs a git subprocess,
 * so a serial loop makes a wide diff wait out the sum of every spawn; a window
 * this size collapses that to roughly an eighth without letting one agent's read
 * fork a process per changed file at once. The budget is re-checked between
 * windows, so the read still stops early rather than fetching patches the
 * concatenation would drop.
 */
const PATCH_READ_CONCURRENCY = 8;

/** Row shape read for a workspace's base branch. */
interface WorkspaceBaseRow {
	baseBranch: string | null;
}

/**
 * Resolves the ref a workspace's branch diff forks from, which is what makes an
 * agent's read match what the user sees in the Changes panel: every change on
 * this branch, committed and uncommitted alike. A workspace with no recorded
 * base degrades to the uncommitted change set, exactly as the panel does.
 * @param deps - Port collaborators exposing the database.
 * @param workspaceId - The workspace whose base branch to read.
 * @returns The base ref, or null when the workspace has none.
 */
function resolveBaseRef(
	deps: ReviewPortDeps,
	workspaceId: string,
): string | null {
	const database = deps.databaseService.getConnection()?.database;
	if (!database) {
		return null;
	}
	const row = selectWorkspaceWithRepositoryById({
		database,
		workspaceId,
	}) as WorkspaceBaseRow | undefined;
	return row?.baseBranch ?? null;
}

/**
 * Builds the diff scope for a base ref, mirroring the review panel's fallback.
 * @param baseRef - The workspace's base branch, or null when it has none.
 * @returns The branch scope, or the working-tree scope when no base resolves.
 */
function scopeFor(baseRef: string | null): WorkspaceGitDiffScope {
	return baseRef ? { baseRef, kind: 'branch' } : { kind: 'working-tree' };
}

/**
 * Renders a per-file read failure in place of its patch, so one unreadable file
 * — deleted between the status read and the diff read, say — costs the agent
 * that file rather than the whole diff.
 * @param path - The file whose patch could not be read.
 * @param message - Git's own words for why.
 * @returns The placeholder to concatenate in place of the patch.
 */
function unreadableFileNote(path: string, message: string): string {
	return `# ${path}: diff unavailable — ${message}`;
}

/**
 * Reads one file's patch through the git service. A read failure comes back as
 * data rather than a throw, because the two callers want opposite things from
 * it: a whole-diff read carries on without that file, a single-file read fails.
 * @param deps - Port collaborators exposing the git service.
 * @param input - The workspace path, the file, and the scope to diff against.
 * @returns The file's patch, whether git cut it at its output cap, and git's
 *   own words when the read failed.
 */
async function readFilePatch(
	deps: ReviewPortDeps,
	input: { workspaceCwd: string; path: string; scope: WorkspaceGitDiffScope },
): Promise<{ patch: string; isTruncated: boolean; error?: string }> {
	const result = await deps.workspaceGitService.getFileDiff({
		path: input.path,
		scope: input.scope,
		workspaceCwd: input.workspaceCwd,
	});
	if (result.error) {
		return {
			error: result.error.message,
			isTruncated: false,
			patch: unreadableFileNote(input.path, result.error.message),
		};
	}
	return {
		isTruncated: result.isTruncated ?? false,
		patch: result.patch ?? '',
	};
}

/**
 * Splits the changed files into the windows {@link PATCH_READ_CONCURRENCY}
 * reads at a time, so the budget can be re-checked between them.
 * @param files - Every changed file, in the order git reported them.
 * @returns The files grouped into fixed-size windows.
 */
function readWindows(
	files: readonly WorkspaceGitFileWire[],
): readonly (readonly WorkspaceGitFileWire[])[] {
	const windows: WorkspaceGitFileWire[][] = [];
	for (let start = 0; start < files.length; start += PATCH_READ_CONCURRENCY) {
		windows.push(files.slice(start, start + PATCH_READ_CONCURRENCY));
	}
	return windows;
}

/**
 * Reads every changed file's patch up to the budget, then stops issuing git
 * calls: once the patches already in hand fill the budget, every remaining file
 * would be dropped anyway, so fetching them costs a process per file and buys
 * nothing. The paths it skipped join the ones the budget drops, because the cut
 * always falls on a contiguous tail.
 * @param deps - Port collaborators exposing the git service.
 * @param input - The workspace path, the changed files, and the scope to diff against.
 * @returns The patches read and the paths deliberately left unread.
 */
async function readPatchesWithinBudget(
	deps: ReviewPortDeps,
	input: {
		workspaceCwd: string;
		files: readonly WorkspaceGitFileWire[];
		scope: WorkspaceGitDiffScope;
	},
): Promise<{
	patches: DiffFilePatch[];
	unread: string[];
	gitTruncated: boolean;
}> {
	const patches: DiffFilePatch[] = [];
	const unread: string[] = [];
	let size = 0;
	let gitTruncated = false;
	for (const window of readWindows(input.files)) {
		if (size >= MAX_AGENT_PAYLOAD_CHARS) {
			unread.push(...window.map((file) => file.path));
			continue;
		}
		const reads = await Promise.all(
			window.map((file) =>
				readFilePatch(deps, {
					path: file.path,
					scope: input.scope,
					workspaceCwd: input.workspaceCwd,
				}),
			),
		);
		reads.forEach((read, index) => {
			patches.push({ patch: read.patch, path: window[index].path });
			size += read.patch.length;
			gitTruncated = gitTruncated || read.isTruncated;
		});
	}
	return { gitTruncated, patches, unread };
}

/**
 * Builds the diff port over the workspace git service.
 * @param deps - Port collaborators.
 * @returns The diff port.
 */
export function makeDiffPort(deps: ReviewPortDeps): DiffPort {
	return {
		readWorkspaceDiff: async ({ workspaceId, workspaceCwd, file, stat }) => {
			const baseRef = resolveBaseRef(deps, workspaceId);
			const scope = scopeFor(baseRef);
			if (file) {
				const read = await readFilePatch(deps, {
					path: file,
					scope,
					workspaceCwd,
				});
				if (read.error) {
					throw new Error(read.error);
				}
				const clamped = clampFilePatch({ patch: read.patch, path: file });
				return {
					baseRef,
					diff: clamped.patch,
					omittedFiles: [],
					truncated: clamped.truncated || read.isTruncated,
				};
			}
			const status = await deps.workspaceGitService.getStatus({
				scope,
				workspaceCwd,
			});
			if (status.error) {
				throw new Error(status.error.message);
			}
			if (stat) {
				return {
					baseRef,
					files: status.files,
					omittedFiles: [],
					summary: status.summary,
					truncated: false,
				};
			}
			const read = await readPatchesWithinBudget(deps, {
				files: status.files,
				scope,
				workspaceCwd,
			});
			const budgeted = budgetWorkspaceDiff({
				patches: read.patches,
				unread: read.unread,
			});
			return {
				baseRef,
				diff: budgeted.diff,
				files: status.files,
				omittedFiles: budgeted.omittedFiles,
				summary: status.summary,
				truncated: budgeted.truncated || read.gitTruncated,
			} satisfies GetWorkspaceDiffResult;
		},
	};
}

/**
 * Renders the acknowledgement an agent reads after filing comments, naming
 * where they landed so it does not go looking for a second call to publish them.
 * @param count - How many comments were saved.
 * @returns The message returned alongside the new comment ids.
 */
function filedMessage(count: number): string {
	return `Filed ${count} review comment(s) on this workspace's diff. They are visible to the user in the Changes panel, labelled as yours.`;
}

/**
 * Builds the review-comment port over the review service.
 * @param deps - Port collaborators.
 * @returns The review port.
 */
export function makeReviewPort(deps: ReviewPortDeps): ReviewPort {
	return {
		listComments: async ({ workspaceId, file }) => {
			const { comments } = deps.reviewService.listComments({ workspaceId });
			return {
				comments: file
					? comments.filter((comment) => comment.filePath === file)
					: comments,
			} satisfies GetDiffCommentsResult;
		},
		addComments: async ({ workspaceId, comments }) => {
			const saved = comments.map(
				(comment: AgentDiffComment) =>
					deps.reviewService.saveComment({
						body: comment.body,
						filePath: comment.filePath,
						lineNumber: comment.lineNumber ?? null,
						origin: 'agent',
						workspaceId,
					}).comment,
			);
			deps.broadcastReviewCommentsChanged({ workspaceId });
			return {
				added: saved.length,
				commentIds: saved.map((comment) => comment.id),
				message: filedMessage(saved.length),
			} satisfies AddDiffCommentsResult;
		},
	};
}
