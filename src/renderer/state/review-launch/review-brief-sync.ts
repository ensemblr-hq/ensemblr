import { useQueryClient } from '@tanstack/react-query';
import { useStore } from 'jotai';
import { useEffect } from 'react';

import { settingsResolutionQuery } from '@/renderer/api/ensemblr';
import { writeWorkspaceActionPrompt } from '@/renderer/api/ensemblr-queries';
import {
	resolveActionPreference,
	sharedActionPreference,
} from '@/renderer/lib/workbench/action-preference';
import {
	ACTION_TRIGGER_MESSAGE,
	buildActionAttachmentBlock,
	composeActionPrompt,
} from '@/renderer/lib/workbench/action-prompts';
import {
	repoSettingsOverrideAtomFamily,
	reviewModelAtom,
	reviewThinkingLevelAtom,
} from '@/renderer/state/preferences';
import type { ReviewBriefReply } from '@/shared/ipc/contracts/review-launch';
import type { SettingsResolutionSnapshot } from '@/shared/ipc/contracts/settings-resolution';

import {
	type LiveReviewContext,
	liveReviewContextAtom,
} from './live-review-context';

/**
 * Answers main's request for a workspace's review prompt, so an agent that
 * called `ensemblr_start_review` gets the review the user configured rather than
 * a generic one.
 *
 * The prompt is composed through the same {@link composeActionPrompt} the Review
 * button uses and persisted to the same `.context/` attachment, so the review
 * conversation it opens is indistinguishable from one the user clicked — the
 * first message reads as the trigger line plus the inlined prompt file, and the
 * conversation runs on the model and thinking level they pinned for reviews.
 *
 * A request for any workspace other than the mounted one is declined with an
 * empty prompt rather than answered from a stale model; main composes its own
 * brief in that case, and tells the calling agent it did.
 *
 * The published context is read from the store inside the callback rather than
 * subscribed to, so the subscription outlives it. The route republishes its
 * context on every git-status refetch, and a hook that re-subscribed on each one
 * would tear the IPC listener down and rebuild it several times a minute — with
 * a window each time where a request would reach nobody.
 */
export function useReviewBriefSync(): void {
	const store = useStore();
	const queryClient = useQueryClient();

	useEffect(() => {
		const unsubscribe = window.ensemblr?.onReviewBriefRequested((payload) => {
			void (async () => {
				const reply = await composeReply({
					context: store.get(liveReviewContextAtom),
					queryClient,
					requestId: payload.requestId,
					store,
					workspaceId: payload.workspaceId,
				});
				await window.ensemblr?.replyReviewBrief(reply);
			})();
		});
		return () => {
			unsubscribe?.();
		};
	}, [queryClient, store]);
}

/**
 * The line that fronts the attached prompt file, the same one a clicked Review
 * sends. Read from the shared table rather than restated so the review tab's
 * first message is identical whichever opened it.
 */
const REVIEW_TRIGGER_MESSAGE = ACTION_TRIGGER_MESSAGE.review ?? '';

/** The declined answer, telling main to compose the brief itself. */
function declined(requestId: string): ReviewBriefReply {
	return { prompt: '', requestId };
}

/**
 * Resolves the review instructions for a repository the way the Review button
 * does: the user's personal per-repository override, falling back to the
 * committed `[prompts]` preference the settings resolver reports.
 * @param context - The mounted route's review context.
 * @param queryClient - Query cache holding the resolved settings snapshot.
 * @param store - Jotai store holding the personal override.
 * @returns The effective review preferences, empty when none are configured.
 */
function reviewPreferences(
	context: LiveReviewContext,
	queryClient: ReturnType<typeof useQueryClient>,
	store: ReturnType<typeof useStore>,
): string {
	const resolution = queryClient.getQueryData<SettingsResolutionSnapshot>(
		settingsResolutionQuery({
			repositoryId: context.repositoryId,
			repositoryPath: context.repositoryPath,
		}).queryKey,
	);
	const overrides = store.get(
		repoSettingsOverrideAtomFamily(context.repositoryId),
	);
	return resolveActionPreference(
		overrides.actionPreferences?.codeReview ?? '',
		sharedActionPreference(resolution, 'codeReview'),
	);
}

/**
 * Reads the model and thinking level the user pinned for reviews, so the review
 * conversation runs on them exactly as a clicked one does.
 * @param store - Jotai store holding the review preference atoms.
 * @returns The pins, each null when the user set none.
 */
function reviewPins(store: ReturnType<typeof useStore>): {
	model: string | null;
	thinkingLevel: string | null;
} {
	return {
		model: store.get(reviewModelAtom) ?? null,
		thinkingLevel: store.get(reviewThinkingLevelAtom) ?? null,
	};
}

/**
 * Composes the reply for one request: the review prompt as the button would
 * build it, persisted as an attachment, plus the user's review model pins.
 *
 * A failed attachment write is declined rather than worked around. The block the
 * composer inlines names the file it came from, and a path that does not exist
 * would send the reviewer looking for it — main's own brief carries no such
 * reference and is the better answer.
 * @param input - The request, the mounted route's context, and the jotai store.
 * @returns The reply to send back over IPC.
 */
async function composeReply({
	context,
	queryClient,
	requestId,
	store,
	workspaceId,
}: {
	context: LiveReviewContext | null;
	queryClient: ReturnType<typeof useQueryClient>;
	requestId: string;
	store: ReturnType<typeof useStore>;
	workspaceId: string;
}): Promise<ReviewBriefReply> {
	if (!context || context.workspaceId !== workspaceId) {
		return declined(requestId);
	}
	const content = composeActionPrompt({
		action: 'review',
		preferences: reviewPreferences(context, queryClient, store),
		workspace: context.workspace,
	});
	const written = await writeWorkspaceActionPrompt({
		action: 'review',
		content,
		workspaceCwd: context.workspace.pathLabel,
	});
	if (written.error || !written.file) {
		return declined(requestId);
	}
	return {
		...reviewPins(store),
		prompt: `${REVIEW_TRIGGER_MESSAGE}\n\n${buildActionAttachmentBlock(
			written.file.path,
			content,
		)}`,
		requestId,
	};
}
