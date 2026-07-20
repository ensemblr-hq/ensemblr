import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '../../../shared/ipc/channels';
import type {
	BindPiSessionToTabResult,
	ChatTabWire,
	CloseChatTabResult,
	ListChatTabsResult,
	ListClosedChatTabsWithSummaryResult,
	OpenChatTabResult,
	ReorderChatTabsResult,
	RestoreChatTabResult,
} from '../../../shared/ipc/contracts/chat-tab';
import type { ChatTabService } from '../../chat-tabs';
import type { ChatTabRow } from '../../storage/repositories';
import {
	bindPiSessionToChatTabRequestSchema,
	closeChatTabRequestSchema,
	listChatTabsRequestSchema,
	listClosedChatTabsWithSummaryRequestSchema,
	openChatTabRequestSchema,
	reorderChatTabsRequestSchema,
	restoreChatTabRequestSchema,
} from '../request-schemas.ts';

/**
 * Registers IPC handlers exposing chat-tab CRUD and closed-tab history to the
 * renderer. All lifecycle policy lives in {@link ChatTabService}; handlers
 * only parse requests, delegate, and map rows to wire shapes.
 */
export function registerChatTabHandlers({
	chatTabService,
}: {
	chatTabService: ChatTabService;
}): void {
	ipcMain.handle(
		IPC_CHANNELS.listChatTabs,
		async (_event, raw: unknown): Promise<ListChatTabsResult> => {
			const request = listChatTabsRequestSchema.parse(raw);
			const { closed, open } = chatTabService.listTabs(request);
			return {
				closed: closed.map(toWire),
				open: open.map(toWire),
			};
		},
	);

	ipcMain.handle(
		IPC_CHANNELS.openChatTab,
		async (_event, raw: unknown): Promise<OpenChatTabResult> => {
			const request = openChatTabRequestSchema.parse(raw);
			const tab = chatTabService.openTab(request);
			return { tab: toWire(tab) };
		},
	);

	ipcMain.handle(
		IPC_CHANNELS.closeChatTab,
		async (_event, raw: unknown): Promise<CloseChatTabResult> => {
			const { chatTabId, metadataPatch, title } =
				closeChatTabRequestSchema.parse(raw);
			const { deleted } = chatTabService.closeTab({
				chatTabId,
				metadataPatch,
				title,
			});
			return { deleted, ok: true };
		},
	);

	ipcMain.handle(
		IPC_CHANNELS.reorderChatTabs,
		async (_event, raw: unknown): Promise<ReorderChatTabsResult> => {
			const request = reorderChatTabsRequestSchema.parse(raw);
			const open = chatTabService.reorderTabs(request);
			return { open: open.map(toWire) };
		},
	);

	ipcMain.handle(
		IPC_CHANNELS.restoreChatTab,
		async (_event, raw: unknown): Promise<RestoreChatTabResult> => {
			const request = restoreChatTabRequestSchema.parse(raw);
			const restored = chatTabService.restoreTab(request);
			return { tab: restored ? toWire(restored) : null };
		},
	);

	ipcMain.handle(
		IPC_CHANNELS.bindPiSessionToChatTab,
		async (_event, raw: unknown): Promise<BindPiSessionToTabResult> => {
			const request = bindPiSessionToChatTabRequestSchema.parse(raw);
			chatTabService.bindPiSession(request);
			return { ok: true };
		},
	);

	ipcMain.handle(
		IPC_CHANNELS.listClosedChatTabsWithSummary,
		async (
			_event,
			raw: unknown,
		): Promise<ListClosedChatTabsWithSummaryResult> => {
			const request = listClosedChatTabsWithSummaryRequestSchema.parse(raw);
			const entries = chatTabService.listClosedWithSummary(request);
			return {
				entries: entries.map((entry) => ({
					closedAt: entry.closedAt,
					summaryPath: entry.summaryPath,
					summaryTitle: entry.summaryTitle,
					tab: toWire(entry.tab),
				})),
			};
		},
	);
}

/**
 * Map a chat-tab database row to its renderer-facing wire shape.
 * @param row - The stored chat-tab row
 * @returns The chat tab in wire form
 */
function toWire(row: ChatTabRow): ChatTabWire {
	return {
		closedAt: row.closedAt,
		id: row.id,
		kind: row.kind,
		metadata: row.metadata,
		openedAt: row.openedAt,
		piSessionId: row.piSessionId,
		position: row.position,
		title: row.title,
		workspaceId: row.workspaceId,
	};
}
