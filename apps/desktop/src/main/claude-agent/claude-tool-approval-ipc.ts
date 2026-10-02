/**
 * Electron wiring for Claude's per-tool approval prompt: the two broadcasts, the
 * answer channel, and the replay a reloaded window needs. Kept out of the
 * `claude-agent` barrel on purpose — the barrel is imported by Vitest suites
 * that run under plain Node, where `electron`'s named exports do not resolve.
 */
import { type App, BrowserWindow, type IpcMain } from 'electron';
import { z } from 'zod';

import { parseToolApprovalReply } from '../../shared/agent-tool-approval.ts';
import { IPC_CHANNELS } from '../../shared/ipc/channels.ts';
import type { ScopedToolApprovalReply } from '../../shared/ipc/contracts/agent-tool-approval.ts';
import type { ClaudeApprovalGate } from './claude-permission-bridge.ts';
import { createClaudeToolApprovalCoordinator } from './claude-tool-approval.ts';

/** Collaborators for {@link installClaudeToolApproval}. */
export interface InstallClaudeToolApprovalOptions {
	app: App;
	ipcMain: IpcMain;
}

/** The approval seam plus the switch that fails it closed when the app quits. */
export interface ClaudeToolApproval {
	/** Opens the per-session gate for the adapter's `canUseTool` option. */
	gate: ClaudeApprovalGate;
	/**
	 * Denies every prompt on screen and every tool call that follows. The quit
	 * path throws this before the shutdown grace period, so a session still
	 * pumping messages with no window left cannot run a tool unprompted.
	 */
	shutdown: () => void;
}

/**
 * The scope every answer must carry. Parsed apart from the decision itself so
 * the strict wire schema in `shared/agent-tool-approval` stays the single
 * definition of a decision.
 */
const replyScopeSchema = z.strictObject({
	agentSessionId: z.string().trim().min(1),
	decision: z.unknown(),
	requestId: z.unknown(),
});

/**
 * Validates a renderer's answer, including the chat it claims to answer for.
 * @param raw - Untrusted reply payload from the renderer.
 * @returns The parsed scoped reply, or null when the payload is malformed.
 */
function parseScopedToolApprovalReply(
	raw: unknown,
): ScopedToolApprovalReply | null {
	const scope = replyScopeSchema.safeParse(raw);
	if (!scope.success) {
		return null;
	}
	const reply = parseToolApprovalReply({
		decision: scope.data.decision,
		requestId: scope.data.requestId,
	});
	return reply ? { ...reply, agentSessionId: scope.data.agentSessionId } : null;
}

/**
 * Sends a payload to every live renderer window.
 * @param channel - IPC channel to send on.
 * @param payload - Data to deliver to each window.
 */
function broadcast(channel: string, payload: unknown): void {
	for (const window of BrowserWindow.getAllWindows()) {
		if (!window.isDestroyed()) {
			window.webContents.send(channel, payload);
		}
	}
}

/**
 * Wires the approval prompt into the main process and returns the seam to hand
 * `createClaudeAgentAdapter`. One call covers the whole round trip: the request
 * broadcast, the answer handler, the withdrawal broadcast, and the replay to a
 * window that reloads while a tool call is still blocked.
 *
 * Session stop and session close need no wiring here — the adapter releases the
 * seam from its single shutdown path, so a prompt cannot outlive the session
 * that raised it. App quit is the exception: the adapter's shutdown runs behind
 * a grace period, so the quit path throws the returned `shutdown` first to fail
 * the gate closed while that race plays out.
 * @param options - The Electron app and `ipcMain`.
 * @returns The per-session approval gate and the quit path's fail-closed switch.
 */
export function installClaudeToolApproval({
	app,
	ipcMain,
}: InstallClaudeToolApprovalOptions): ClaudeToolApproval {
	const coordinator = createClaudeToolApprovalCoordinator({
		/** Tells renderers a pending prompt is no longer answerable. */
		broadcastClosed: (payload) =>
			broadcast(IPC_CHANNELS.agentToolApprovalClosed, payload),
		/** Pushes a blocked tool call to every window; only its chat renders it. */
		broadcastRequested: (payload) =>
			broadcast(IPC_CHANNELS.agentToolApprovalRequested, payload),
		/** Reports whether any window is alive to host the card. */
		hasRenderer: () =>
			BrowserWindow.getAllWindows().some((window) => !window.isDestroyed()),
	});

	ipcMain.handle(IPC_CHANNELS.agentToolApprovalAnswered, (_event, reply) => {
		const parsed = parseScopedToolApprovalReply(reply);
		if (parsed) {
			coordinator.settle(parsed);
		}
	});

	// A renderer holds pending prompts in memory only and the tool call has no
	// deadline, so a reload would otherwise lose the card while Claude stayed
	// blocked with nothing on screen to unblock it.
	app.on('browser-window-created', (_event, window) => {
		window.webContents.on('did-finish-load', () => {
			for (const payload of coordinator.openRequests()) {
				window.webContents.send(
					IPC_CHANNELS.agentToolApprovalRequested,
					payload,
				);
			}
		});
	});

	return { gate: coordinator.openSession, shutdown: coordinator.shutdown };
}
