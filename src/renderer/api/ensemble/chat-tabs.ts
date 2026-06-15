import { queryOptions } from '@tanstack/react-query';

import { profileElectronIpcCall } from '@/renderer/lib/instrumentation';
import type {
	BindPiSessionToTabRequest,
	BindPiSessionToTabResult,
	CloseChatTabRequest,
	CloseChatTabResult,
	ListChatTabsResult,
	ListClosedChatTabsWithSummaryResult,
	OpenChatTabRequest,
	OpenChatTabResult,
	RestoreChatTabRequest,
	RestoreChatTabResult,
} from '@/shared/ipc/contracts/chat-tab';

import { ensembleQueryKeys, getEnsembleApi } from './query-keys';

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
				{ channel: 'ensemble:list-chat-tabs', usesDatabase: true },
				() => getEnsembleApi().listChatTabs({ workspaceId }),
			),
		queryKey: ensembleQueryKeys.chatTabs(workspaceId),
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
					channel: 'ensemble:list-closed-chat-tabs-with-summary',
					usesDatabase: true,
				},
				() => getEnsembleApi().listClosedChatTabsWithSummary({ workspaceId }),
			),
		queryKey: ensembleQueryKeys.closedChatTabsWithSummary(workspaceId),
		staleTime: 2000,
	});
}

/** Opens a new chat tab in a workspace. */
export function openChatTab(
	request: OpenChatTabRequest,
): Promise<OpenChatTabResult> {
	return profileElectronIpcCall(
		{ channel: 'ensemble:open-chat-tab', usesDatabase: true },
		() => getEnsembleApi().openChatTab(request),
	);
}

/** Closes a chat tab and (if needed) returns a fresh replacement tab. */
export function closeChatTab(
	request: CloseChatTabRequest,
): Promise<CloseChatTabResult> {
	return profileElectronIpcCall(
		{ channel: 'ensemble:close-chat-tab', usesDatabase: true },
		() => getEnsembleApi().closeChatTab(request),
	);
}

/** Restores a closed chat tab to the open-tab strip. */
export function restoreChatTab(
	request: RestoreChatTabRequest,
): Promise<RestoreChatTabResult> {
	return profileElectronIpcCall(
		{ channel: 'ensemble:restore-chat-tab', usesDatabase: true },
		() => getEnsembleApi().restoreChatTab(request),
	);
}

/** Binds an open Pi session to an existing chat tab. */
export function bindPiSessionToChatTab(
	request: BindPiSessionToTabRequest,
): Promise<BindPiSessionToTabResult> {
	return profileElectronIpcCall(
		{ channel: 'ensemble:bind-pi-session-to-chat-tab', usesDatabase: true },
		() => getEnsembleApi().bindPiSessionToChatTab(request),
	);
}
