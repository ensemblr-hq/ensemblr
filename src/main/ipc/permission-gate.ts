import { ipcMain } from 'electron';

import {
	classifyPermissionAction,
	type PermissionActionKind,
	type PermissionMode,
} from '../../shared/permissions';

/**
 * Mode the permission gate operates under. `'allow-all'` is a transport-level
 * bypass that short-circuits classification entirely; remaining values delegate
 * to {@link classifyPermissionAction}.
 */
export type PermissionGateMode = PermissionMode | 'allow-all';

/**
 * Currently-active gate mode. Kept as a module-local constant so the seam exists
 * without yet wiring a renderer-driven mode source; can be swapped for a getter
 * once persisted mode reaches the main process.
 */
const ACTIVE_PERMISSION_GATE_MODE: PermissionGateMode = 'allow-all';

/**
 * Error raised when the gate denies an invocation. Crosses the IPC boundary as
 * a thrown rejection on the renderer's `invoke` promise.
 */
export class PermissionGateDeniedError extends Error {
	readonly action: PermissionActionKind;
	readonly channel: string;
	readonly reason: string;

	constructor({
		action,
		channel,
		reason,
	}: {
		action: PermissionActionKind;
		channel: string;
		reason: string;
	}) {
		super(`Permission denied for ${channel}: ${reason}`);
		this.name = 'PermissionGateDeniedError';
		this.action = action;
		this.channel = channel;
		this.reason = reason;
	}
}

/** Listener signature accepted by `ipcMain.handle`. */
type IpcHandleListener = Parameters<typeof ipcMain.handle>[1];

/**
 * Wraps an `ipcMain.handle` registration with a permission classification check
 * for the given action. Under `'allow-all'` the wrapper is a pass-through; under
 * any classifying mode a `'blocked'` boundary throws
 * {@link PermissionGateDeniedError} before the inner handler runs.
 *
 * @param channel - Wire channel name to register against.
 * @param action - Permission action kind associated with this channel.
 * @param handler - Inner listener invoked when the gate allows the call.
 */
export function withPermissionGate(
	channel: string,
	action: PermissionActionKind,
	handler: IpcHandleListener,
): void {
	const gated: IpcHandleListener = (event, ...args) => {
		const mode = ACTIVE_PERMISSION_GATE_MODE;

		if (mode !== 'allow-all') {
			const snapshot = classifyPermissionAction({ action, mode });

			if (snapshot.boundary === 'blocked') {
				throw new PermissionGateDeniedError({
					action,
					channel,
					reason: snapshot.reason,
				});
			}
		}

		return handler(event, ...args);
	};

	ipcMain.handle(channel, gated);
}
