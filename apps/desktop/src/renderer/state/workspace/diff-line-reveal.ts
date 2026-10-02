import { atom, useAtomValue, useSetAtom } from 'jotai';
import { useCallback, useMemo } from 'react';

import type { DiffLineReveal } from '@/renderer/types/diff';

/** A pending request to scroll a mounted diff to one of its lines. */
interface DiffLineRevealRequest extends DiffLineReveal {
	filePath: string;
	workspaceId: string;
}

/**
 * The diff line that should be scrolled into view next, or null when none is
 * pending. A surface that routes the user to a line — a comment row in the
 * Checks panel, the location on a comment preview — sets it; the diff panel
 * mounted for that file reads it and scrolls.
 *
 * Not cleared on read: the request usually outlives the tab that will serve it,
 * because the diff tab is still opening (and its patch still loading) when the
 * gesture fires. It is cleared on *settle* instead — the viewer reports through
 * {@link useSettleDiffLineReveal} once it has scrolled to the line or
 * established the line is unreachable. A request left pending past that would
 * replay the jump on every later mount of the same file, since the viewer's own
 * de-dup lives in mount-scoped refs.
 */
const diffLineRevealRequestAtom = atom<DiffLineRevealRequest | null>(null);

/** Returns a stable callback that queues a jump to a file's line. */
export function useRequestDiffLineReveal(): (input: {
	filePath: string;
	line: number;
	side?: 'new' | 'old';
	workspaceId: string;
}) => void {
	const setRequest = useSetAtom(diffLineRevealRequestAtom);
	return useCallback(
		({ filePath, line, side = 'new', workspaceId }) => {
			setRequest((current) => ({
				filePath,
				line,
				requestId: (current?.requestId ?? 0) + 1,
				side,
				workspaceId,
			}));
		},
		[setRequest],
	);
}

/**
 * The pending reveal for one file in one workspace, or null when the pending
 * request targets a different one. Called by the diff panel, which passes the
 * result straight to the viewer.
 *
 * The workspace is half the match because paths here are repository-relative and
 * workspaces are branches of the same repository, so the same path exists in
 * every one of them; matching on the path alone would fire a jump requested in
 * one workspace inside another's panel.
 * @param filePath - Path of the file the calling panel is showing
 * @param workspaceId - Workspace the calling panel belongs to
 * @returns The reveal to serve, or null
 */
export function useDiffLineReveal(
	filePath: string,
	workspaceId: string,
): DiffLineReveal | null {
	const request = useAtomValue(diffLineRevealRequestAtom);
	const matches =
		request?.filePath === filePath && request?.workspaceId === workspaceId;
	return useMemo(
		() =>
			matches && request
				? {
						line: request.line,
						requestId: request.requestId,
						side: request.side,
					}
				: null,
		[matches, request],
	);
}

/**
 * Returns a stable callback the viewer calls once a request is served or found
 * unreachable, dropping it so no later mount replays it. Guarded on the id so a
 * settle arriving from an unmounting panel cannot swallow a newer jump.
 * @returns The settle callback, taking the id of the request it resolved
 */
export function useSettleDiffLineReveal(): (requestId: number) => void {
	const setRequest = useSetAtom(diffLineRevealRequestAtom);
	return useCallback(
		(requestId: number) => {
			setRequest((current) =>
				current?.requestId === requestId ? null : current,
			);
		},
		[setRequest],
	);
}
