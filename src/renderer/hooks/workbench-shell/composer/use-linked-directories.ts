import { useQueryClient } from '@tanstack/react-query';
import { useAtom, useAtomValue } from 'jotai';
import { useCallback } from 'react';

import {
	ensemblrQueryKeys,
	recordLinkedDirectoryRecent,
} from '@/renderer/api/ensemblr';
import {
	chatAppliedLinkedDirectoriesAtomFamily,
	chatLinkedDirectoriesAtomFamily,
} from '@/renderer/state/preferences';
import type { LinkedDirectory } from '@/renderer/types/workbench';
import type { RecordLinkedDirectoryFailureCode } from '@/shared/ipc/contracts/linked-directories';

/** The chat's linked directories plus the callbacks that change the set. */
export interface LinkedDirectoriesState {
	/**
	 * Validates the path in main, records it as recent, and links it to this chat.
	 * Resolves to a failure code the caller translates, or null on success.
	 */
	linkDirectory: (
		path: string,
	) => Promise<RecordLinkedDirectoryFailureCode | null>;
	linkedDirectories: readonly LinkedDirectory[];
	/** Directories linked since the runtime session opened, so not readable yet. */
	pendingDirectories: readonly LinkedDirectory[];
	unlinkDirectory: (path: string) => void;
}

/**
 * The linked directories a running session cannot read yet, because it opened
 * before they were linked.
 *
 * `null` applied paths mean no session has opened for this chat, so the first
 * open will carry the whole set and nothing is pending. An empty array is a
 * different answer: a session did open, carrying nothing, so everything linked
 * since is pending.
 * @param linkedDirectories - The chat's current linked set.
 * @param appliedPaths - Paths the running session was launched with, or null when none has opened.
 * @returns The subset the running session was not launched with.
 */
function pendingLinkedDirectories(
	linkedDirectories: readonly LinkedDirectory[],
	appliedPaths: readonly string[] | null,
): readonly LinkedDirectory[] {
	if (appliedPaths === null) {
		return [];
	}
	const applied = new Set(appliedPaths);
	return linkedDirectories.filter((directory) => !applied.has(directory.path));
}

/**
 * Owns the directories a chat has been given access to outside its workspace.
 *
 * The set is durable per chat tab and, unlike an attachment, survives a send —
 * "linked" is a standing grant, not a one-message reference.
 * @param input - The chat tab that owns the set.
 * @returns The linked set and the callbacks that change it.
 */
export function useLinkedDirectories({
	chatTabId,
}: {
	chatTabId: string;
}): LinkedDirectoriesState {
	const queryClient = useQueryClient();
	const [linkedDirectories, setLinkedDirectories] = useAtom(
		chatLinkedDirectoriesAtomFamily(chatTabId),
	);
	const appliedPaths = useAtomValue(
		chatAppliedLinkedDirectoriesAtomFamily(chatTabId),
	);

	const linkDirectory = useCallback(
		async (path: string): Promise<RecordLinkedDirectoryFailureCode | null> => {
			const result = await recordLinkedDirectoryRecent({ path });
			if (result.error || !result.directory) {
				return result.error?.code ?? 'read-failed';
			}
			const { name, path: resolvedPath } = result.directory;
			setLinkedDirectories((current) =>
				current.some((directory) => directory.path === resolvedPath)
					? current
					: [...current, { name, path: resolvedPath }],
			);
			void queryClient.invalidateQueries({
				queryKey: ensemblrQueryKeys.linkedDirectoryRecents(),
			});
			return null;
		},
		[queryClient, setLinkedDirectories],
	);

	const unlinkDirectory = useCallback(
		(path: string) => {
			setLinkedDirectories((current) =>
				current.filter((directory) => directory.path !== path),
			);
		},
		[setLinkedDirectories],
	);

	return {
		linkDirectory,
		linkedDirectories,
		pendingDirectories: pendingLinkedDirectories(
			linkedDirectories,
			appliedPaths,
		),
		unlinkDirectory,
	};
}
