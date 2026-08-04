import { describe, expect, it, vi } from 'vitest';

import {
	makeDiffPort,
	makeReviewPort,
	type ReviewPortDeps,
} from '../../src/main/agent-control/review-ports.ts';
import type {
	ReviewCommentOrigin,
	ReviewCommentWire,
} from '../../src/shared/ipc/contracts/review-comments';
import type { WorkspaceGitFileWire } from '../../src/shared/ipc/contracts/workspace-git';

const fileRow = (
	path: string,
	overrides: Partial<WorkspaceGitFileWire> = {},
): WorkspaceGitFileWire => ({
	additions: 1,
	deletions: 0,
	path,
	status: 'modified',
	...overrides,
});

const commentRow = (
	overrides: Partial<ReviewCommentWire> = {},
): ReviewCommentWire => ({
	body: 'nit',
	createdAt: '2026-01-01T00:00:00.000Z',
	filePath: 'src/a.ts',
	id: 'c-1',
	lineNumber: 3,
	origin: 'user',
	status: 'open',
	updatedAt: '2026-01-01T00:00:00.000Z',
	workspaceId: 'ws',
	...overrides,
});

/**
 * Builds the deps with an in-memory database stub whose only job is to answer
 * the base-branch lookup, plus recording stubs for the two services.
 */
const makeDeps = (
	overrides: {
		baseBranch?: string | null;
		files?: readonly WorkspaceGitFileWire[];
		patchFor?: (path: string) => string;
		statusError?: string;
		fileDiffError?: string;
		comments?: readonly ReviewCommentWire[];
	} = {},
) => {
	const getStatus = vi.fn().mockResolvedValue(
		overrides.statusError
			? {
					error: { code: 'not-a-git-repo', message: overrides.statusError },
					files: [],
					summary: { additions: 0, deletions: 0, files: 0 },
				}
			: {
					files: overrides.files ?? [],
					summary: {
						additions: 1,
						deletions: 0,
						files: (overrides.files ?? []).length,
					},
				},
	);
	const getFileDiff = vi.fn(async ({ path }: { path: string }) =>
		overrides.fileDiffError
			? {
					error: { code: 'invalid-path', message: overrides.fileDiffError },
					path,
				}
			: { patch: overrides.patchFor?.(path) ?? `patch:${path}`, path },
	);
	const saved: {
		body: string;
		filePath: string;
		lineNumber: number | null;
		origin?: ReviewCommentOrigin;
	}[] = [];
	const saveComment = vi.fn(
		(request: {
			body?: string;
			filePath?: string;
			lineNumber?: number | null;
			origin?: ReviewCommentOrigin;
		}) => {
			saved.push({
				body: request.body ?? '',
				filePath: request.filePath ?? '',
				lineNumber: request.lineNumber ?? null,
				origin: request.origin,
			});
			return {
				comment: commentRow({
					body: request.body ?? '',
					filePath: request.filePath ?? '',
					id: `c-${saved.length}`,
					lineNumber: request.lineNumber ?? null,
					origin: request.origin ?? 'user',
				}),
			};
		},
	);
	const broadcastReviewCommentsChanged = vi.fn();
	const deps = {
		broadcastReviewCommentsChanged,
		databaseService: {
			getConnection: () => ({
				database: {
					prepare: () => ({
						get: () => ({
							baseBranch:
								overrides.baseBranch === undefined
									? 'origin/master'
									: overrides.baseBranch,
						}),
					}),
				},
			}),
		},
		reviewService: {
			listComments: vi
				.fn()
				.mockReturnValue({ comments: overrides.comments ?? [] }),
			saveComment,
		},
		workspaceGitService: { getFileDiff, getStatus },
	} as unknown as ReviewPortDeps;
	return {
		broadcastReviewCommentsChanged,
		deps,
		getFileDiff,
		getStatus,
		saved,
	};
};

describe('diff port: scope', () => {
	it('scopes the read to the workspace’s base branch', async () => {
		const { deps, getStatus } = makeDeps({ files: [fileRow('a.ts')] });
		const result = await makeDiffPort(deps).readWorkspaceDiff({
			stat: true,
			workspaceCwd: '/ws',
			workspaceId: 'ws',
		});
		expect(result.baseRef).toBe('origin/master');
		expect(getStatus).toHaveBeenCalledWith({
			scope: { baseRef: 'origin/master', kind: 'branch' },
			workspaceCwd: '/ws',
		});
	});

	// The Changes panel degrades to the uncommitted change set when a workspace
	// has no recorded base, and an agent's read has to see the same thing the
	// user does or its review is of a diff nobody else can see.
	it('falls back to the working tree when the workspace has no base', async () => {
		const { deps, getStatus } = makeDeps({ baseBranch: null });
		const result = await makeDiffPort(deps).readWorkspaceDiff({
			stat: true,
			workspaceCwd: '/ws',
			workspaceId: 'ws',
		});
		expect(result.baseRef).toBeNull();
		expect(getStatus).toHaveBeenCalledWith({
			scope: { kind: 'working-tree' },
			workspaceCwd: '/ws',
		});
	});
});

describe('diff port: stat mode', () => {
	// Stat mode is the cheap probe the playbook tells agents to call first, so it
	// must not spend a git process per changed file to answer it.
	it('issues no per-file git call', async () => {
		const { deps, getFileDiff } = makeDeps({
			files: [fileRow('a.ts'), fileRow('b.ts')],
		});
		const result = await makeDiffPort(deps).readWorkspaceDiff({
			stat: true,
			workspaceCwd: '/ws',
			workspaceId: 'ws',
		});
		expect(getFileDiff).not.toHaveBeenCalled();
		expect(result.diff).toBeUndefined();
		expect(result.files?.map((file) => file.path)).toEqual(['a.ts', 'b.ts']);
		expect(result.summary).toEqual({ additions: 1, deletions: 0, files: 2 });
		expect(result.truncated).toBe(false);
	});
});

describe('diff port: full and single-file reads', () => {
	it('concatenates every changed file’s patch', async () => {
		const { deps, getFileDiff } = makeDeps({
			files: [fileRow('a.ts'), fileRow('b.ts')],
		});
		const result = await makeDiffPort(deps).readWorkspaceDiff({
			workspaceCwd: '/ws',
			workspaceId: 'ws',
		});
		expect(getFileDiff).toHaveBeenCalledTimes(2);
		expect(result.diff).toBe('patch:a.ts\npatch:b.ts');
		expect(result.truncated).toBe(false);
		expect(result.omittedFiles).toEqual([]);
	});

	it('reads one file without a status call', async () => {
		const { deps, getStatus, getFileDiff } = makeDeps();
		const result = await makeDiffPort(deps).readWorkspaceDiff({
			file: 'src/a.ts',
			workspaceCwd: '/ws',
			workspaceId: 'ws',
		});
		expect(getStatus).not.toHaveBeenCalled();
		expect(getFileDiff).toHaveBeenCalledWith({
			path: 'src/a.ts',
			scope: { baseRef: 'origin/master', kind: 'branch' },
			workspaceCwd: '/ws',
		});
		expect(result.diff).toBe('patch:src/a.ts');
	});

	// The budget drops a contiguous tail, so the files never fetched sit after
	// every file that was — which is what lets the two omitted lists concatenate.
	// Reads go out a window at a time, so the stop lands on a window boundary:
	// the first eight are fetched, the rest are skipped unread.
	it('stops fetching once the budget is spent and names what it skipped', async () => {
		const files = Array.from({ length: 12 }, (_, index) =>
			fileRow(`f${index}.ts`),
		);
		const { deps, getFileDiff } = makeDeps({
			files,
			patchFor: (path) => (path === 'f0.ts' ? 'x'.repeat(40_000) : `p:${path}`),
		});
		const result = await makeDiffPort(deps).readWorkspaceDiff({
			workspaceCwd: '/ws',
			workspaceId: 'ws',
		});
		expect(getFileDiff).toHaveBeenCalledTimes(8);
		expect(result.truncated).toBe(true);
		expect(result.omittedFiles).toEqual(files.map((file) => file.path));
		expect(result.diff).toContain('12 file(s) omitted');
	});

	// A serial read makes a wide diff wait out the sum of every git spawn. The
	// window is what stops that, so it has to actually overlap rather than just
	// batch the awaits.
	it('reads a window of files concurrently', async () => {
		let inFlight = 0;
		let peak = 0;
		const { deps } = makeDeps({
			files: Array.from({ length: 8 }, (_, index) => fileRow(`f${index}.ts`)),
		});
		(
			deps.workspaceGitService.getFileDiff as unknown as ReturnType<
				typeof vi.fn
			>
		).mockImplementation(async ({ path }: { path: string }) => {
			inFlight += 1;
			peak = Math.max(peak, inFlight);
			await Promise.resolve();
			inFlight -= 1;
			return { patch: `p:${path}`, path };
		});
		await makeDiffPort(deps).readWorkspaceDiff({
			workspaceCwd: '/ws',
			workspaceId: 'ws',
		});
		expect(peak).toBe(8);
	});

	// The whole-diff budget drops an oversized file and points at the per-file
	// call to recover it, which would make that call the one unbounded read in
	// the surface — an instruction to blow the context the budget just protected.
	it('clamps an oversized single-file read at a hunk boundary', async () => {
		const hunk = `\n@@ -1,2 +1,2 @@\n-${'a'.repeat(9_000)}\n+${'b'.repeat(9_000)}`;
		const { deps } = makeDeps({
			patchFor: () => `diff --git a/big.ts b/big.ts${hunk.repeat(4)}`,
		});
		const result = await makeDiffPort(deps).readWorkspaceDiff({
			file: 'big.ts',
			workspaceCwd: '/ws',
			workspaceId: 'ws',
		});
		expect(result.truncated).toBe(true);
		expect(result.diff?.length).toBeLessThanOrEqual(32_000);
		expect(result.diff).toContain('patch shortened at a hunk boundary');
		expect(result.diff).toContain('big.ts');
	});

	// A note standing in for a patch is right inside a concatenation, where one
	// bad file must not cost the review. Alone it is the whole answer, so a
	// failure has to read as one.
	it('fails a single-file read rather than returning the failure as a patch', async () => {
		const { deps } = makeDeps({ fileDiffError: 'fatal: bad revision' });
		await expect(
			makeDiffPort(deps).readWorkspaceDiff({
				file: 'gone.ts',
				workspaceCwd: '/ws',
				workspaceId: 'ws',
			}),
		).rejects.toThrow('fatal: bad revision');
	});

	it('propagates git’s own per-file truncation flag', async () => {
		const { deps } = makeDeps({ files: [fileRow('a.ts')] });
		(
			deps.workspaceGitService.getFileDiff as unknown as ReturnType<
				typeof vi.fn
			>
		).mockResolvedValue({ isTruncated: true, patch: 'p', path: 'a.ts' });
		const result = await makeDiffPort(deps).readWorkspaceDiff({
			workspaceCwd: '/ws',
			workspaceId: 'ws',
		});
		expect(result.truncated).toBe(true);
		expect(result.omittedFiles).toEqual([]);
	});

	// One unreadable file — deleted between the status read and the diff read —
	// must cost that file rather than the whole review.
	it('notes an unreadable file in place of its patch', async () => {
		const { deps } = makeDeps({
			fileDiffError: 'fatal: bad revision',
			files: [fileRow('gone.ts')],
		});
		const result = await makeDiffPort(deps).readWorkspaceDiff({
			workspaceCwd: '/ws',
			workspaceId: 'ws',
		});
		expect(result.diff).toContain('gone.ts');
		expect(result.diff).toContain('fatal: bad revision');
	});

	it('surfaces a status failure rather than an empty diff', async () => {
		const { deps } = makeDeps({ statusError: 'fatal: not a git repository' });
		await expect(
			makeDiffPort(deps).readWorkspaceDiff({
				workspaceCwd: '/ws',
				workspaceId: 'ws',
			}),
		).rejects.toThrow('not a git repository');
	});
});

describe('review port', () => {
	it('returns every comment, carrying who wrote it', async () => {
		const { deps } = makeDeps({
			comments: [
				commentRow({ id: 'c-1', origin: 'user' }),
				commentRow({ id: 'c-2', origin: 'agent' }),
			],
		});
		const result = await makeReviewPort(deps).listComments({
			workspaceId: 'ws',
		});
		expect(result.comments.map((comment) => comment.origin)).toEqual([
			'user',
			'agent',
		]);
	});

	it('narrows a read to one file', async () => {
		const { deps } = makeDeps({
			comments: [
				commentRow({ filePath: 'src/a.ts', id: 'c-1' }),
				commentRow({ filePath: 'src/b.ts', id: 'c-2' }),
			],
		});
		const result = await makeReviewPort(deps).listComments({
			file: 'src/b.ts',
			workspaceId: 'ws',
		});
		expect(result.comments.map((comment) => comment.id)).toEqual(['c-2']);
	});

	// Authorship is stamped by the port, never taken from the agent's args, so
	// nothing an agent can send makes its comment read as the user's.
	it('stamps every filed comment as agent-authored', async () => {
		const { deps, saved } = makeDeps();
		const result = await makeReviewPort(deps).addComments({
			comments: [
				{ body: 'first', filePath: 'src/a.ts', lineNumber: 3 },
				{ body: 'second', filePath: 'src/b.ts' },
			],
			workspaceId: 'ws',
		});
		expect(saved).toEqual([
			{ body: 'first', filePath: 'src/a.ts', lineNumber: 3, origin: 'agent' },
			{
				body: 'second',
				filePath: 'src/b.ts',
				lineNumber: null,
				origin: 'agent',
			},
		]);
		expect(result.added).toBe(2);
		expect(result.commentIds).toEqual(['c-1', 'c-2']);
		expect(result.message).toContain('Changes panel');
	});

	// The result promises the user can see the comments; the renderer only
	// invalidates its cached list on a renderer-local mutation, so without the
	// broadcast that promise is false for as long as the panel stays mounted.
	it('announces the write so the renderer refreshes the panel it named', async () => {
		const { deps, broadcastReviewCommentsChanged } = makeDeps();
		await makeReviewPort(deps).addComments({
			comments: [{ body: 'nit', filePath: 'src/a.ts' }],
			workspaceId: 'ws',
		});
		expect(broadcastReviewCommentsChanged).toHaveBeenCalledWith({
			workspaceId: 'ws',
		});
	});
});
