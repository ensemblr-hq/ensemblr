import { ipcMain } from 'electron';

import type { SettingsResolutionSnapshot } from '../../shared/ipc';
import {
	classifyPermissionAction,
	DEFAULT_PERMISSION_MODE,
	normalizePermissionMode,
	type PermissionActionKind,
	type PermissionMode,
} from '../../shared/permissions';

/**
 * Mode the permission gate operates under. `'allow-all'` is a transport-level
 * bypass that short-circuits classification entirely; remaining values delegate
 * to {@link classifyPermissionAction}. Bypass mode is reserved for the test
 * harness so handler tests don't have to wire a settings service.
 */
export type PermissionGateMode = PermissionMode | 'allow-all';

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
 * Function shape returned by {@link createPermissionGate} — wraps an
 * `ipcMain.handle` registration with a permission classification check.
 */
export type WithPermissionGate = (
	channel: string,
	action: PermissionActionKind,
	handler: IpcHandleListener,
) => void;

/** Inputs for {@link createPermissionGate}. */
export interface CreatePermissionGateOptions {
	/**
	 * Resolves the currently-active permission mode every time a gated channel
	 * is invoked. Called per-invocation so the gate picks up settings changes
	 * without restarting Electron.
	 */
	getMode: () => PermissionGateMode;
}

/**
 * Builds a {@link WithPermissionGate} that uses `getMode` to look up the
 * active mode on every call. Under `'allow-all'` the wrapper is a pass-through;
 * under any classifying mode a `'blocked'` boundary throws
 * {@link PermissionGateDeniedError} before the inner handler runs.
 */
export function createPermissionGate({
	getMode,
}: CreatePermissionGateOptions): WithPermissionGate {
	return (channel, action, handler) => {
		const gated: IpcHandleListener = (event, ...args) => {
			const mode = getMode();

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
	};
}

/**
 * Reads `security.permissionMode` out of a resolved-settings snapshot,
 * normalising the value back to a valid {@link PermissionMode} and falling
 * back to {@link DEFAULT_PERMISSION_MODE} when the setting is absent.
 */
export function readPermissionModeFromSnapshot(
	snapshot: SettingsResolutionSnapshot,
): PermissionMode {
	const setting = snapshot.app.settings.find(
		(entry) => entry.key === 'security.permissionMode',
	);
	if (!setting) {
		return DEFAULT_PERMISSION_MODE;
	}
	return normalizePermissionMode(setting.value);
}
