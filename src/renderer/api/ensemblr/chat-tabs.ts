import { queryOptions } from '@tanstack/react-query';

import { profileElectronIpcCall } from '@/renderer/lib/instrumentation';
import type {
	CloseChatTabRequest,
	CloseChatTabResult,
	ListAllChatTabsResult,
	ListChatTabSummariesResult,
	ListChatTabsResult,
	OpenChatTabRequest,
	OpenChatTabResult,
	PinChatTabRequest,
	PinChatTabResult,
	ReorderChatTabsRequest,
	ReorderChatTabsResult,
	RestoreChatTabRequest,
	RestoreChatTabResult,
} from '@/shared/ipc/contracts/chat-tab';

import { ensemblrQueryKeys, getEnsemblrApi } from './query-keys';

/**
 * Query options for the open + closed chat tabs persisted for a workspace.
 * Mirrors the `chat_tabs` SQLite rows; renderer derives `SessionTabModel`s from
 * the `open` entries and feeds the history menu from `closed`.
 */
export function listChatTabsQuery(workspaceId: string) {
	return queryOptions({
		enabled: workspaceId.length > 0,
		queryFn: (): Promise<ListChatTabsResult> =>
			profileElectronIpcCall(
				{ channel: 'ensemblr:list-chat-tabs', usesDatabase: true },
				() => getEnsemblrApi().listChatTabs({ workspaceId }),
			),
		queryKey: ensemblrQueryKeys.chatTabs(workspaceId),
		staleTime: 2000,
	});
}

/**
 * Query options for every workspace's chat tabs at once — open tabs plus the
 * newest closed ones — for a surface that addresses the whole app rather than
 * one workspace.
 *
 * One query rather than a fan-out of {@link listChatTabsQuery} over every
 * workspace: a mention menu ranks across all of them on every keystroke, and a
 * per-workspace query apiece would be one cache entry and one IPC round trip per
 * project the user has open.
 */
export const allChatTabsQuery = queryOptions({
	queryFn: (): Promise<ListAllChatTabsResult> =>
		profileElectronIpcCall(
			{ channel: 'ensemblr:list-all-chat-tabs', usesDatabase: true },
			() => getEnsemblrApi().listAllChatTabs({}),
		),
	queryKey: ensemblrQueryKeys.allChatTabs(),
	staleTime: 2000,
});

/**
 * Query options for a workspace's chat tabs joined with their persisted session
 * summary files (path + title), newest summary first. Open tabs are included —
 * a live chat's summary is rewritten at every turn boundary — so the new-chat
 * chips can offer them; the history dropdown narrows the same result to the
 * closed entries.
 */
export function listChatTabSummariesQuery(workspaceId: string) {
	return queryOptions({
		enabled: workspaceId.length > 0,
		queryFn: (): Promise<ListChatTabSummariesResult> =>
			profileElectronIpcCall(
				{
					channel: 'ensemblr:list-chat-tab-summaries',
					usesDatabase: true,
				},
				() => getEnsemblrApi().listChatTabSummaries({ workspaceId }),
			),
		queryKey: ensemblrQueryKeys.chatTabSummaries(workspaceId),
		staleTime: 2000,
	});
}

/** Opens a new chat tab in a workspace. */
export function openChatTab(
	request: OpenChatTabRequest,
): Promise<OpenChatTabResult> {
	return profileElectronIpcCall(
		{ channel: 'ensemblr:open-chat-tab', usesDatabase: true },
		() => getEnsemblrApi().openChatTab(request),
	);
}

/**
 * Promotes an ephemeral tab to a permanent one: a preview tab releases the
 * workspace's preview slot, and a placeholder chat stops being a tab a spawned
 * conversation may take over.
 */
export function pinChatTab(
	request: PinChatTabRequest,
): Promise<PinChatTabResult> {
	return profileElectronIpcCall(
		{ channel: 'ensemblr:pin-chat-tab', usesDatabase: true },
		() => getEnsemblrApi().pinChatTab(request),
	);
}

/** Closes a chat tab and (if needed) returns a fresh replacement tab. */
export function closeChatTab(
	request: CloseChatTabRequest,
): Promise<CloseChatTabResult> {
	return profileElectronIpcCall(
		{ channel: 'ensemblr:close-chat-tab', usesDatabase: true },
		() => getEnsemblrApi().closeChatTab(request),
	);
}

/** Persists the left-to-right order of the workspace tab strip. */
export function reorderChatTabs(
	request: ReorderChatTabsRequest,
): Promise<ReorderChatTabsResult> {
	return profileElectronIpcCall(
		{ channel: 'ensemblr:reorder-chat-tabs', usesDatabase: true },
		() => getEnsemblrApi().reorderChatTabs(request),
	);
}

/** Restores a closed chat tab to the open-tab strip. */
export function restoreChatTab(
	request: RestoreChatTabRequest,
): Promise<RestoreChatTabResult> {
	return profileElectronIpcCall(
		{ channel: 'ensemblr:restore-chat-tab', usesDatabase: true },
		() => getEnsemblrApi().restoreChatTab(request),
	);
}
