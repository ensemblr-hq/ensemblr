import { queryOptions } from '@tanstack/react-query';

import { profileElectronIpcCall } from '@/renderer/lib/instrumentation';
import type {
	CloseChatTabRequest,
	CloseChatTabResult,
	ListChatTabsResult,
	ListClosedChatTabsWithSummaryResult,
	OpenChatTabRequest,
	OpenChatTabResult,
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
 * Query options for closed chat tabs joined with their persisted session
 * summary files (path + title), used by the history dropdown.
 */
export function listClosedChatTabsWithSummaryQuery(workspaceId: string) {
	return queryOptions({
		enabled: workspaceId.length > 0,
		queryFn: (): Promise<ListClosedChatTabsWithSummaryResult> =>
			profileElectronIpcCall(
				{
					channel: 'ensemblr:list-closed-chat-tabs-with-summary',
					usesDatabase: true,
				},
				() => getEnsemblrApi().listClosedChatTabsWithSummary({ workspaceId }),
			),
		queryKey: ensemblrQueryKeys.closedChatTabsWithSummary(workspaceId),
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

/** Closes a chat tab and (if needed) returns a fresh replacement tab. */
export function closeChatTab(
	request: CloseChatTabRequest,
): Promise<CloseChatTabResult> {
	return profileElectronIpcCall(
		{ channel: 'ensemblr:close-chat-tab', usesDatabase: true },
		() => getEnsemblrApi().closeChatTab(request),
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
