import { queryOptions } from '@tanstack/react-query';

import { profileElectronIpcCall } from '@/renderer/lib/instrumentation';

import type {
	LinkedDirectoryRequest,
	LinkedDirectorySelectionResult,
	ListLinkedDirectoryRecentsResult,
	RecordLinkedDirectoryResult,
} from '@/shared/ipc/contracts/linked-directories';

import { ensemblrQueryKeys, getEnsemblrApi } from './query-keys';

/**
 * Query options for the app-global list of recently linked directories. Not
 * scoped to a project or workspace by design — the point of the list is that a
 * folder linked from one repo is one click away from the next.
 */
export const linkedDirectoryRecentsQuery = queryOptions({
	queryFn: () =>
		profileElectronIpcCall(
			{ channel: 'ensemblr:list-linked-directory-recents', usesDatabase: true },
			() => getEnsemblrApi().listLinkedDirectoryRecents(),
		),
	queryKey: ensemblrQueryKeys.linkedDirectoryRecents(),
	staleTime: 30_000,
});

/** Opens the native folder picker behind the directory picker's "Browse…" row. */
export function selectLinkedDirectory(): Promise<LinkedDirectorySelectionResult> {
	return profileElectronIpcCall(
		{ channel: 'ensemblr:select-linked-directory', usesDatabase: false },
		() => getEnsemblrApi().selectLinkedDirectory(),
	);
}

/** Validates a directory and moves it to the head of the recents list. */
export function recordLinkedDirectoryRecent(
	request: LinkedDirectoryRequest,
): Promise<RecordLinkedDirectoryResult> {
	return profileElectronIpcCall(
		{ channel: 'ensemblr:record-linked-directory-recent', usesDatabase: true },
		() => getEnsemblrApi().recordLinkedDirectoryRecent(request),
	);
}

/** Drops a directory from the recents list without touching any chat's links. */
export function forgetLinkedDirectoryRecent(
	request: LinkedDirectoryRequest,
): Promise<ListLinkedDirectoryRecentsResult> {
	return profileElectronIpcCall(
		{ channel: 'ensemblr:forget-linked-directory-recent', usesDatabase: true },
		() => getEnsemblrApi().forgetLinkedDirectoryRecent(request),
	);
}
