import {
	BrowserWindow,
	dialog,
	type IpcMainInvokeEvent,
	ipcMain,
} from 'electron';

import { type AppLanguage, FALLBACK_LANGUAGE } from '../../shared/i18n.ts';
import {
	classifyPermissionAction,
	type PermissionActionKind,
	type PermissionMode,
} from '../../shared/permissions.ts';
import type { EnsemblrDatabaseService } from '../storage/index.ts';
import { isTrackedRepositoryPath } from '../storage/repositories/repository-path-repository.ts';
import { permissionActionForChannel } from './permission-actions.ts';
import { permissionConfirmStrings } from './permission-confirm-strings.ts';
import type { PermissionModeContext } from './permission-mode.ts';

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

/** Inputs for {@link installPermissionGate}. */
interface InstallPermissionGateOptions {
	/** Membership source for the `workspaceCwd` a request names. */
	databaseService: EnsemblrDatabaseService;
	/** Reads the app's resolved UI language for the confirmation dialog. */
	getLanguage: () => AppLanguage;
	/**
	 * Resolves the permission mode that applies to one request. Called per
	 * invocation so a mode the user just changed applies without a restart.
	 */
	resolveMode: (context: PermissionModeContext) => PermissionMode;
}

/**
 * Wraps `ipcMain.handle` for the duration of handler registration so every
 * channel is classified against the central action table without each
 * handler group having to opt in.
 *
 * Interception rather than a threaded wrapper is what closes the gap the audit
 * found: opt-in reached six handler groups out of thirty, and the ones running
 * shell commands were not among them. The patch is confined to the composition
 * root and restored by the returned function before it returns.
 * @param options - Database service, language reader, and the mode resolver.
 * @returns A function restoring the original `ipcMain.handle`.
 */
export function installPermissionGate({
	databaseService,
	getLanguage,
	resolveMode,
}: InstallPermissionGateOptions): () => void {
	const originalHandle = ipcMain.handle.bind(ipcMain);

	ipcMain.handle = (channel: string, listener: IpcHandleListener): void => {
		originalHandle(
			channel,
			gateListener({
				action: permissionActionForChannel(channel),
				channel,
				databaseService,
				getLanguage,
				listener,
				resolveMode,
			}),
		);
	};

	return () => {
		ipcMain.handle = originalHandle;
	};
}

/**
 * Builds the gated listener for one channel: it rejects a sub-frame sender,
 * classifies the action against the request's repository mode, denies a blocked
 * boundary, and asks the user before a boundary that needs approval.
 * @param options - Channel identity, its action, the collaborators, and the inner listener.
 * @returns A listener suitable for `ipcMain.handle`.
 */
function gateListener({
	action,
	channel,
	databaseService,
	getLanguage,
	listener,
	resolveMode,
}: InstallPermissionGateOptions & {
	action: PermissionActionKind | null;
	channel: string;
	listener: IpcHandleListener;
}): IpcHandleListener {
	return async (event, ...args) => {
		assertTopLevelSender(event, channel);

		const context = readPermissionModeContext(args[0]);
		assertKnownWorkspaceCwd({ channel, context, databaseService });

		if (!action) {
			return listener(event, ...args);
		}

		const mode = resolveMode(context);
		const snapshot = classifyPermissionAction({ action, mode });

		if (snapshot.boundary === 'blocked') {
			throw new PermissionGateDeniedError({
				action,
				channel,
				reason: snapshot.reason,
			});
		}

		if (
			snapshot.boundary === 'confirmation-required' &&
			mode !== 'workspace-trusted'
		) {
			const approved = await confirmPermissionAction({
				action,
				language: getLanguage(),
			});

			if (!approved) {
				throw new PermissionGateDeniedError({
					action,
					channel,
					reason: 'The user declined this action.',
				});
			}
		}

		return listener(event, ...args);
	};
}

/**
 * Refuses a request naming a `workspaceCwd` that matches no tracked repository
 * or workspace row. Every downstream containment check — `resolveWorkspacePath`,
 * `isWithinWorkspaceReal`, `validateRelativePath` — is relative to this root, so
 * without the membership test the caller picks the root those checks defend.
 * @param options - Channel name, the identifiers read off the payload, and the database.
 */
function assertKnownWorkspaceCwd({
	channel,
	context,
	databaseService,
}: {
	channel: string;
	context: PermissionModeContext;
	databaseService: EnsemblrDatabaseService;
}): void {
	const workspaceCwd = context.workspaceCwd?.trim();

	if (!workspaceCwd) {
		return;
	}

	const database = databaseService.getConnection()?.database ?? null;

	if (!isTrackedRepositoryPath({ database, repositoryPath: workspaceCwd })) {
		throw new Error(
			`Permission denied for ${channel}: workspace path is not a tracked workspace.`,
		);
	}
}

/**
 * Refuses an invocation that did not come from a window's top-level frame. The
 * app hosts no `<webview>` and blocks cross-origin navigation, so this is a
 * standing assertion rather than a live defence — it is what keeps the day a
 * remote-content frame is introduced from silently inheriting the whole bridge.
 * @param event - The invoke event whose sender is being checked.
 * @param channel - Channel name, for the raised error.
 */
function assertTopLevelSender(
	event: IpcMainInvokeEvent,
	channel: string,
): void {
	const senderFrame = event.senderFrame;

	if (senderFrame && senderFrame !== event.sender.mainFrame) {
		throw new Error(
			`Permission denied for ${channel}: sender is not the main frame.`,
		);
	}
}

/**
 * Reads the workspace or repository a request names, so its repository's mode
 * is the one enforced. A payload naming none resolves at app scope.
 * @param payload - First argument the renderer passed to the channel.
 * @returns The identifiers found on the payload.
 */
function readPermissionModeContext(payload: unknown): PermissionModeContext {
	if (!payload || typeof payload !== 'object') {
		return {};
	}

	const candidate = payload as Record<string, unknown>;
	return {
		repositoryId: readString(candidate.repositoryId),
		workspaceCwd: readString(candidate.workspaceCwd),
		workspaceId: readString(candidate.workspaceId),
	};
}

/**
 * Narrows an unknown payload field to a string.
 * @param value - Field read off the request payload.
 * @returns The string, or `null` when the field is absent or another type.
 */
function readString(value: unknown): string | null {
	return typeof value === 'string' ? value : null;
}

/**
 * Puts a native approval dialog to the user for an action the mode does not
 * allow outright, parented to the focused window when there is one.
 * @param input - The action being approved and the language to draw it in.
 * @returns True when the user approves.
 */
export async function confirmPermissionAction({
	action,
	language,
}: {
	action: PermissionActionKind;
	language: AppLanguage;
}): Promise<boolean> {
	const strings = permissionConfirmStrings(language ?? FALLBACK_LANGUAGE);
	const options = {
		buttons: [strings.deny, strings.allow],
		cancelId: 0,
		defaultId: 0,
		detail: strings.detail.replace('{{action}}', action),
		message: strings.message,
		title: strings.title,
		type: 'question' as const,
	};
	const parentWindow = BrowserWindow.getFocusedWindow();
	const answered = await (parentWindow
		? dialog.showMessageBox(parentWindow, options)
		: dialog.showMessageBox(options));

	return answered.response === 1;
}
