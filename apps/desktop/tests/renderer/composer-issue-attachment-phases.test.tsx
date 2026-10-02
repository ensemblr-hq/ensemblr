// @vitest-environment happy-dom

import { QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import type {
	ComposerIssueAttachment,
	WorkspaceLinkedIssueSummary,
} from '@/renderer/types/workbench';
import type {
	GetLinearIssueResult,
	LinearIssueWire,
} from '@/shared/ipc/contracts/linear';
import type { RepositoryIssueWire } from '@/shared/ipc/contracts/workspace-sources';
import {
	clearEnsemblrApi,
	createTestQueryClient,
	installEnsemblrApi,
} from './support/dom';

const attachIssueDocument = vi.hoisted(() => vi.fn());

vi.mock('@/renderer/lib/workbench/composer-attachments', () => ({
	attachIssueDocument,
}));

const { useIssueAttachments } = await import(
	'@/renderer/hooks/workbench-shell/composer/use-issue-attachments'
);

const linearIssue: LinearIssueWire = {
	accountId: 'acct-1',
	archivedAt: null,
	assigneeId: null,
	assigneeName: null,
	cycleId: null,
	cycleName: null,
	description: 'The picker row already carries this description.',
	dueDate: null,
	id: 'issue-uuid-1',
	identifier: 'ENG-106',
	labels: [],
	organizationName: 'Acme',
	priority: null,
	projectId: null,
	projectName: null,
	stateColor: null,
	stateId: null,
	stateName: 'In Progress',
	stateType: 'started',
	syncedAt: null,
	teamId: null,
	teamKey: null,
	teamName: null,
	title: 'Composer stalls on link issue',
	updatedAt: null,
	url: 'https://linear.app/acme/issue/ENG-106',
};

const githubIssue: RepositoryIssueWire = {
	assigneeLogins: [],
	authorLogin: 'octocat',
	body: 'Repro steps.',
	labels: [],
	number: 42,
	state: 'OPEN',
	title: 'Dedup recents',
	updatedAt: '2026-09-13T09:00:00.000Z',
	url: 'https://github.com/o/r/issues/42',
};

const linkedLinearIssue: WorkspaceLinkedIssueSummary = {
	accountId: 'acct-1',
	description: 'What the workspace was created from.',
	provider: 'linear',
	reference: 'ENG-106',
	remoteId: 'issue-uuid-1',
	title: 'Composer stalls on link issue',
};

const linkedGithubIssue: WorkspaceLinkedIssueSummary = {
	description: 'What the workspace was created from.',
	provider: 'github',
	reference: '#42',
	remoteId: 'https://github.com/o/r/issues/42',
	title: 'Dedup recents',
};

/**
 * Stands in for the content-addressed store: distinct documents get distinct
 * paths, so a test can tell which of the two passes a chip is pointing at.
 * Keyed on the content rather than its length, so two documents that happen to
 * run to the same number of characters do not collide into one path.
 * @param document - The rendered markdown the pass wrote.
 * @returns A path unique to that content.
 */
function contentKey(document: string): string {
	let hash = 0;
	for (const character of document) {
		hash = (hash * 31 + character.charCodeAt(0)) | 0;
	}
	return (hash >>> 0).toString(16);
}

/** An attachment whose path tracks the document it was written from. */
function attachmentFor(
	document: string,
	reference: string,
	provider: 'github' | 'linear' = 'linear',
): ComposerIssueAttachment {
	return {
		id: `issue:${provider}:${reference}`,
		kind: 'issue',
		label: reference,
		path: `.context/attachments/${contentKey(document)}/${provider}-issue.md`,
		provider,
	};
}

/** Mounts the hook with spies standing in for every sink it writes through. */
function renderIssueAttachments() {
	const addAttachments = vi.fn();
	const setAttachmentError = vi.fn();
	const updateAttachment = vi.fn();
	const client = createTestQueryClient();
	const { result } = renderHook(
		() =>
			useIssueAttachments({
				addAttachments,
				setAttachmentError,
				updateAttachment,
				workspaceCwd: '/tmp/workspace',
			}),
		{
			wrapper: ({ children }: { children: ReactNode }) => (
				<QueryClientProvider client={client}>{children}</QueryClientProvider>
			),
		},
	);
	return { addAttachments, result, setAttachmentError, updateAttachment };
}

/** The document text each `attachIssueDocument` call was handed, in order. */
function writtenDocuments(): string[] {
	return attachIssueDocument.mock.calls.map(
		(call) => (call[0] as { document: string }).document,
	);
}

/**
 * Waits until the background pass has read Linear and had a turn to act on it,
 * so a test asserting that it wrote nothing is asserting about a pass that
 * finished rather than one that had not started.
 * @param linearGetIssue - The bridge stub the second pass reads through.
 */
async function settleSecondPass(linearGetIssue: {
	mock: { calls: unknown[] };
}) {
	await waitFor(() => expect(linearGetIssue.mock.calls.length).toBe(1));
	await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('useIssueAttachments', () => {
	beforeEach(() => {
		attachIssueDocument.mockReset();
		attachIssueDocument.mockImplementation(
			async ({
				document,
				provider,
				reference,
			}: {
				document: string;
				provider: 'github' | 'linear';
				reference: string;
			}) => attachmentFor(document, reference, provider),
		);
	});

	afterEach(() => {
		clearEnsemblrApi();
	});

	test('attaches a Linear issue before its comments have been read', async () => {
		let releaseDetail: (result: GetLinearIssueResult) => void = () => {};
		const detail = new Promise<GetLinearIssueResult>((resolve) => {
			releaseDetail = resolve;
		});
		installEnsemblrApi({ linearGetIssue: () => detail });

		const { addAttachments, result, updateAttachment } =
			renderIssueAttachments();

		await result.current.attachLinearIssue(linearIssue);

		expect(addAttachments).toHaveBeenCalledTimes(1);
		expect(writtenDocuments()).toHaveLength(1);
		expect(writtenDocuments()[0]).toContain(
			'The picker row already carries this description.',
		);
		expect(updateAttachment).not.toHaveBeenCalled();

		releaseDetail({
			comments: [
				{
					authorName: 'Ada',
					body: 'Reproduced on 0.1.16.',
					createdAt: '2026-09-13T10:00:00.000Z',
					id: 'comment-1',
				},
			],
			issue: linearIssue,
			source: 'remote',
			status: 'ok',
		});

		await waitFor(() => expect(updateAttachment).toHaveBeenCalledTimes(1));

		const fullerDocument = writtenDocuments()[1] ?? '';
		const [repointedId, repointed] = updateAttachment.mock.calls[0] as [
			string,
			ComposerIssueAttachment,
		];
		expect(fullerDocument).toContain('Reproduced on 0.1.16.');
		expect(repointedId).toBe('issue:linear:ENG-106');
		expect(repointed.path).toBe(attachmentFor(fullerDocument, 'ENG-106').path);
	});

	test('keeps the attached document when the comment read fails', async () => {
		const linearGetIssue = vi.fn(
			async (): Promise<GetLinearIssueResult> => ({
				failure: {
					code: 'network',
					message: 'offline',
					retryAfterSeconds: null,
				},
				status: 'error',
			}),
		);
		installEnsemblrApi({ linearGetIssue });

		const { result, setAttachmentError, updateAttachment } =
			renderIssueAttachments();

		await expect(result.current.attachLinearIssue(linearIssue)).resolves.toBe(
			true,
		);
		await settleSecondPass(linearGetIssue);

		expect(writtenDocuments()).toHaveLength(1);
		expect(updateAttachment).not.toHaveBeenCalled();
		expect(setAttachmentError.mock.calls).toEqual([[null]]);
	});

	test('does not rewrite the document when the second read adds nothing', async () => {
		const linearGetIssue = vi.fn(
			async (): Promise<GetLinearIssueResult> => ({
				comments: [],
				issue: linearIssue,
				source: 'cache',
				status: 'ok',
			}),
		);
		installEnsemblrApi({ linearGetIssue });

		const { result, updateAttachment } = renderIssueAttachments();

		await result.current.attachLinearIssue(linearIssue);
		await settleSecondPass(linearGetIssue);

		expect(writtenDocuments()).toHaveLength(1);
		expect(updateAttachment).not.toHaveBeenCalled();
	});

	test('attaches a GitHub issue in a single pass', async () => {
		installEnsemblrApi({});
		const { addAttachments, result, updateAttachment } =
			renderIssueAttachments();

		await expect(result.current.attachGithubIssue(githubIssue)).resolves.toBe(
			true,
		);

		expect(addAttachments).toHaveBeenCalledTimes(1);
		expect(writtenDocuments()).toHaveLength(1);
		expect(updateAttachment).not.toHaveBeenCalled();
	});

	// The issue a workspace was created from takes the same two passes, so the
	// seeded draft ends up carrying the comments rather than the bare summary the
	// workspace stored when it was cut.
	test('upgrades the issue a workspace was seeded from', async () => {
		const linearGetIssue = vi.fn(
			async (): Promise<GetLinearIssueResult> => ({
				comments: [
					{
						authorName: 'Ada',
						body: 'Reproduced on 0.1.16.',
						createdAt: '2026-09-13T10:00:00.000Z',
						id: 'comment-1',
					},
				],
				issue: linearIssue,
				source: 'remote',
				status: 'ok',
			}),
		);
		installEnsemblrApi({ linearGetIssue });

		const { result, updateAttachment } = renderIssueAttachments();

		await expect(
			result.current.attachLinkedIssue(linkedLinearIssue),
		).resolves.toBe(true);
		await settleSecondPass(linearGetIssue);

		expect(writtenDocuments()[0]).toContain(
			'What the workspace was created from.',
		);
		expect(writtenDocuments()[1]).toContain('Reproduced on 0.1.16.');
		expect(updateAttachment).toHaveBeenCalledTimes(1);

		const [repointedId, repointed] = updateAttachment.mock.calls[0] as [
			string,
			ComposerIssueAttachment,
		];
		expect(repointedId).toBe('issue:linear:ENG-106');
		expect(repointed.path).toBe(
			attachmentFor(writtenDocuments()[1] ?? '', 'ENG-106').path,
		);
	});

	test('takes one pass for a GitHub issue a workspace was seeded from', async () => {
		const linearGetIssue = vi.fn();
		installEnsemblrApi({ linearGetIssue });

		const { result, updateAttachment } = renderIssueAttachments();

		await expect(
			result.current.attachLinkedIssue(linkedGithubIssue),
		).resolves.toBe(true);
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(writtenDocuments()).toHaveLength(1);
		expect(linearGetIssue).not.toHaveBeenCalled();
		expect(updateAttachment).not.toHaveBeenCalled();
	});

	test('reports a failed write and attaches nothing', async () => {
		installEnsemblrApi({});
		attachIssueDocument.mockRejectedValue(new Error('disk full'));

		const { addAttachments, result, setAttachmentError, updateAttachment } =
			renderIssueAttachments();

		await expect(result.current.attachLinearIssue(linearIssue)).resolves.toBe(
			false,
		);

		expect(addAttachments).not.toHaveBeenCalled();
		expect(updateAttachment).not.toHaveBeenCalled();
		expect(setAttachmentError).toHaveBeenCalledWith('disk full');
	});
});
