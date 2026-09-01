import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '../../../shared/ipc/channels';
import type {
	BindAgentSessionToTabResult,
	ChatTabWire,
	CloseChatTabResult,
	ListAllChatTabsResult,
	ListChatTabsResult,
	ListClosedChatTabsWithSummaryResult,
	OpenChatTabResult,
	PinChatTabResult,
	ReorderChatTabsResult,
	RestoreChatTabResult,
} from '../../../shared/ipc/contracts/chat-tab';
import type { ChatTabService } from '../../chat-tabs';
import { isPreviewTab } from '../../chat-tabs/preview-tab-slot.ts';
import type { ChatTabRow } from '../../storage/repositories';
import {
	bindAgentSessionToChatTabRequestSchema,
	closeChatTabRequestSchema,
	listAllChatTabsRequestSchema,
	listChatTabsRequestSchema,
	listClosedChatTabsWithSummaryRequestSchema,
	openChatTabRequestSchema,
	pinChatTabRequestSchema,
	reorderChatTabsRequestSchema,
	restoreChatTabRequestSchema,
} from '../request-schemas.ts';

/**
 * How many recently-closed tabs an app-wide listing returns when the caller names
 * no cap. Sized for a mention menu: enough that a chat closed earlier today is
 * still reachable, few enough that the payload stays a menu rather than a history.
 */
const DEFAULT_CLOSED_TAB_LIMIT = 100;

/**
 * Registers IPC handlers exposing chat-tab CRUD and closed-tab history to the
 * renderer. All lifecycle policy lives in {@link ChatTabService}; handlers
 * only parse requests, delegate, and map rows to wire shapes.
 */
export function registerChatTabHandlers({
	chatTabService,
	flushSummaryForChatTab,
}: {
	chatTabService: ChatTabService;
	/**
	 * Writes the summary a closing tab's live session still owes, before the row
	 * is archived. Closing never stops the runtime, so this is the only flush the
	 * final turn gets; the two services meet here rather than inside either one.
	 */
	flushSummaryForChatTab: (chatTabId: string) => Promise<void>;
}): void {
	ipcMain.handle(
		IPC_CHANNELS.listAllChatTabs,
		async (_event, raw: unknown): Promise<ListAllChatTabsResult> => {
			const { closedLimit } = listAllChatTabsRequestSchema.parse(raw ?? {});
			const { closed, open } = chatTabService.listAllTabs({
				closedLimit: closedLimit ?? DEFAULT_CLOSED_TAB_LIMIT,
			});
			return { closed: closed.map(toWire), open: open.map(toWire) };
		},
	);

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
		IPC_CHANNELS.pinChatTab,
		async (_event, raw: unknown): Promise<PinChatTabResult> => {
			const request = pinChatTabRequestSchema.parse(raw);
			const pinned = chatTabService.pinTab(request);
			return { tab: pinned ? toWire(pinned) : null };
		},
	);

	ipcMain.handle(
		IPC_CHANNELS.closeChatTab,
		async (_event, raw: unknown): Promise<CloseChatTabResult> => {
			const { chatTabId, fullTitle, metadataPatch, title } =
				closeChatTabRequestSchema.parse(raw);
			// Ahead of the archive, so the history entry this close produces carries
			// this turn's summary rather than the previous turn's. A failed write is
			// swallowed: archival work must not cost the user the close itself.
			try {
				await flushSummaryForChatTab(chatTabId);
			} catch (cause) {
				console.warn('[chat-tab] could not flush the closing tab’s summary.', {
					cause: cause instanceof Error ? cause.message : String(cause),
					chatTabId,
				});
			}
			const { deleted } = chatTabService.closeTab({
				chatTabId,
				fullTitle,
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
		IPC_CHANNELS.bindAgentSessionToChatTab,
		async (_event, raw: unknown): Promise<BindAgentSessionToTabResult> => {
			const request = bindAgentSessionToChatTabRequestSchema.parse(raw);
			chatTabService.bindAgentSession(request);
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
		fullTitle: row.fullTitle,
		id: row.id,
		isPreview: isPreviewTab(row),
		kind: row.kind,
		metadata: row.metadata,
		openedAt: row.openedAt,
		agentSessionId: row.agentSessionId,
		position: row.position,
		title: row.title,
		workspaceId: row.workspaceId,
	};
}
