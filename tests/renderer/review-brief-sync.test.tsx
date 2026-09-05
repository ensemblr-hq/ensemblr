// @vitest-environment happy-dom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import { createStore, Provider } from 'jotai';
import { act } from 'react';
import { beforeEach, expect, test, vi } from 'vitest';

const { onReviewBriefRequested, replyReviewBrief, writeWorkspaceActionPrompt } =
	vi.hoisted(() => ({
		onReviewBriefRequested: vi.fn(),
		replyReviewBrief: vi.fn(),
		writeWorkspaceActionPrompt: vi.fn(),
	}));

vi.mock('@/renderer/api/ensemblr-queries', () => ({
	writeWorkspaceActionPrompt,
}));

import { settingsResolutionQuery } from '../../src/renderer/api/ensemblr';
import {
	repoSettingsOverrideAtomFamily,
	reviewModelAtom,
	reviewThinkingLevelAtom,
} from '../../src/renderer/state/preferences';
import {
	type LiveReviewContext,
	liveReviewContextAtom,
	useReviewBriefSync,
} from '../../src/renderer/state/review-launch';
import type { WorkspaceShellModel } from '../../src/renderer/types/workbench';
import type { ReviewBriefReply } from '../../src/shared/ipc/contracts/review-launch';
import type { SettingsResolutionSnapshot } from '../../src/shared/ipc/contracts/settings-resolution';

const REPOSITORY = {
	repositoryId: 'repo-1',
	repositoryPath: '/repos/ensemblr',
};

/** The route's published context, carrying only what the review prompt reads. */
const CONTEXT: LiveReviewContext = {
	repositoryId: REPOSITORY.repositoryId,
	repositoryPath: REPOSITORY.repositoryPath,
	workspace: {
		branchName: 'psoldunov/thing',
		landingSummary: { branchSource: { baseBranch: 'master' } },
		pathLabel: '/tmp/ws',
		pullRequest: { checks: [] },
		reviewFiles: [
			{
				additions: 4,
				deletions: 2,
				path: 'src/main/thing.ts',
				status: 'modified',
			},
		],
	} as unknown as WorkspaceShellModel,
	workspaceId: 'ws-1',
};

/** Host component whose only job is to run the hook under test. */
function Host() {
	useReviewBriefSync();
	return null;
}

/** Mounts the responder over a store and query client the case seeds. */
function mountSync(store: ReturnType<typeof createStore>, client: QueryClient) {
	render(
		<QueryClientProvider client={client}>
			<Provider store={store}>
				<Host />
			</Provider>
		</QueryClientProvider>,
	);
	return {
		request: onReviewBriefRequested.mock.calls[0][0] as (payload: {
			requestId: string;
			workspaceId: string;
		}) => void,
	};
}

/** A store with the route's context published and the review pins set. */
function seededStore(context: LiveReviewContext | null = CONTEXT) {
	const store = createStore();
	if (context) {
		store.set(liveReviewContextAtom, context);
	}
	store.set(reviewModelAtom, 'claude-opus-5');
	store.set(reviewThinkingLevelAtom, 'high');
	return store;
}

/** The reply the responder sent back over IPC. */
function lastReply(): ReviewBriefReply {
	return replyReviewBrief.mock.calls.at(-1)?.[0] as ReviewBriefReply;
}

beforeEach(() => {
	onReviewBriefRequested.mockReset();
	onReviewBriefRequested.mockReturnValue(() => undefined);
	replyReviewBrief.mockReset();
	replyReviewBrief.mockResolvedValue(undefined);
	writeWorkspaceActionPrompt.mockReset();
	writeWorkspaceActionPrompt.mockResolvedValue({
		file: { path: '.context/prompts/review.md' },
	});
	// `reviewModelAtom` writes through to app settings, so the responder's own
	// reads of it need the bridge call that write makes.
	window.ensemblr = {
		onReviewBriefRequested,
		replyReviewBrief,
		updateAppSettings: vi.fn().mockResolvedValue(undefined),
	} as never;
});

test('composes the workspace review prompt the Review button would', async () => {
	const store = seededStore();
	const { request } = mountSync(store, new QueryClient());

	await act(async () => {
		request({ requestId: 'req-1', workspaceId: 'ws-1' });
	});

	const reply = lastReply();
	expect(reply.requestId).toBe('req-1');
	expect(reply.prompt).toContain('Please review the changes in this workspace');
	expect(reply.prompt).toContain('# Review guidelines');
	expect(reply.prompt).toContain('psoldunov/thing');
	expect(reply.prompt).toContain('- src/main/thing.ts (modified, +4/-2)');
});

// The prompt is persisted the same way a clicked Review persists it, so the
// review tab's first message reads as the trigger line plus the attached file.
test('attaches the persisted prompt file the way a clicked review does', async () => {
	const store = seededStore();
	const { request } = mountSync(store, new QueryClient());

	await act(async () => {
		request({ requestId: 'req-1', workspaceId: 'ws-1' });
	});

	expect(writeWorkspaceActionPrompt).toHaveBeenCalledWith(
		expect.objectContaining({ action: 'review', workspaceCwd: '/tmp/ws' }),
	);
	expect(lastReply().prompt).toContain(
		'<attached_file path=".context/prompts/review.md"',
	);
});

test('runs the review on the model and thinking level the user pinned', async () => {
	const store = seededStore();
	const { request } = mountSync(store, new QueryClient());

	await act(async () => {
		request({ requestId: 'req-1', workspaceId: 'ws-1' });
	});

	expect(lastReply()).toMatchObject({
		model: 'claude-opus-5',
		thinkingLevel: 'high',
	});
});

// The personal override is the input main cannot see, and carrying it is the
// whole reason main asks a window at all.
test("carries the user's personal review instructions", async () => {
	const store = seededStore();
	store.set(repoSettingsOverrideAtomFamily(REPOSITORY.repositoryId), {
		actionPreferences: { codeReview: 'Only flag security findings.' },
	});
	const { request } = mountSync(store, new QueryClient());

	await act(async () => {
		request({ requestId: 'req-1', workspaceId: 'ws-1' });
	});

	expect(lastReply().prompt).toContain('Only flag security findings.');
});

test("falls back to the repository's committed review preference", async () => {
	const client = new QueryClient();
	client.setQueryData(settingsResolutionQuery(REPOSITORY).queryKey, {
		repository: {
			settings: [
				{
					candidates: [],
					key: 'actionPreferences.codeReview',
					locked: false,
					source: 'repository-config',
					value: 'Check the migrations.',
				},
			],
		},
	} as unknown as SettingsResolutionSnapshot);
	const { request } = mountSync(seededStore(), client);

	await act(async () => {
		request({ requestId: 'req-1', workspaceId: 'ws-1' });
	});

	expect(lastReply().prompt).toContain('Check the migrations.');
});

// Answering from a model the route is not showing would review the wrong
// workspace, so the responder declines and main composes its own brief.
test('declines a request for a workspace this window is not showing', async () => {
	const { request } = mountSync(seededStore(), new QueryClient());

	await act(async () => {
		request({ requestId: 'req-1', workspaceId: 'ws-other' });
	});

	expect(lastReply()).toEqual({ prompt: '', requestId: 'req-1' });
	expect(writeWorkspaceActionPrompt).not.toHaveBeenCalled();
});

test('declines when no workspace route is mounted', async () => {
	const { request } = mountSync(seededStore(null), new QueryClient());

	await act(async () => {
		request({ requestId: 'req-1', workspaceId: 'ws-1' });
	});

	expect(lastReply()).toEqual({ prompt: '', requestId: 'req-1' });
});

// The attachment block names a file the reviewer can open; a path that does not
// exist would send it looking, and main's own brief carries no such reference.
test('declines rather than attaching a file it could not write', async () => {
	writeWorkspaceActionPrompt.mockResolvedValue({
		error: { message: 'disk full' },
	});
	const { request } = mountSync(seededStore(), new QueryClient());

	await act(async () => {
		request({ requestId: 'req-1', workspaceId: 'ws-1' });
	});

	expect(lastReply()).toEqual({ prompt: '', requestId: 'req-1' });
});
