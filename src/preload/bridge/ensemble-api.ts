import { type IpcRendererEvent, ipcRenderer } from 'electron';

import {
	type CloneGithubRepositoryProgressEvent,
	type EnsembleApi,
	IPC_CHANNELS,
	type PiRawFrameBroadcast,
	type PiSessionEventBroadcast,
	type TerminalLifecycleBroadcast,
	type TerminalOutputBroadcast,
} from '../../shared/ipc';

/**
 * Keys of {@link EnsembleApi} that represent typed `ipcRenderer.invoke`
 * round-trips (i.e. every method except the broadcast subscription helpers).
 */
type InvokeKey = Exclude<
	keyof EnsembleApi,
	| 'onCloneGithubRepositoryProgress'
	| 'onPiRawFrame'
	| 'onPiSessionEvent'
	| 'onTerminalLifecycle'
	| 'onTerminalOutput'
>;

/**
 * Mapping of {@link EnsembleApi} method names whose channel identifier diverges
 * from the method name (most match 1:1 against {@link IPC_CHANNELS}).
 */
const CHANNEL_OVERRIDES = {
	prepareCloneGithubRepository: IPC_CHANNELS.cloneGithubRepositoryPrepare,
	resolveSettings: IPC_CHANNELS.settingsResolution,
	startCloneGithubRepository: IPC_CHANNELS.cloneGithubRepositoryStart,
} as const satisfies Partial<Record<InvokeKey, string>>;

function channelFor(key: InvokeKey): string {
	if (key in CHANNEL_OVERRIDES) {
		return CHANNEL_OVERRIDES[key as keyof typeof CHANNEL_OVERRIDES];
	}
	// Every remaining invoke method shares its name with the channels registry key.
	return IPC_CHANNELS[key as keyof typeof IPC_CHANNELS];
}

/**
 * Typed wrapper around `ipcRenderer.invoke`. The return type is derived from
 * `EnsembleApi[K]`, so callers no longer need `as Promise<T>` casts.
 */
function invoke<K extends InvokeKey>(
	key: K,
	...args: Parameters<EnsembleApi[K]>
): ReturnType<EnsembleApi[K]> {
	return ipcRenderer.invoke(channelFor(key), ...args) as ReturnType<
		EnsembleApi[K]
	>;
}

/**
 * Subscribe to a broadcast IPC channel with a typed payload and return an
 * unsubscribe function. Wraps the raw `IpcRendererEvent` so consumers only see
 * the payload.
 */
function subscribe<E>(
	channel: string,
	listener: (event: E) => void,
): () => void {
	const wrapped = (_event: IpcRendererEvent, payload: E) => {
		listener(payload);
	};
	ipcRenderer.on(channel, wrapped);
	return () => {
		ipcRenderer.off(channel, wrapped);
	};
}

/**
 * Builds the `window.ensemble` bridge object exposed to the renderer, mapping
 * each typed method to its corresponding `ipcRenderer.invoke` call.
 * @returns A fully-populated {@link EnsembleApi}.
 */
export function createEnsembleApi(): EnsembleApi {
	return {
		applyRepositoryConfigMigration: (request) =>
			invoke('applyRepositoryConfigMigration', request),
		archiveRepository: (request) => invoke('archiveRepository', request),
		archiveWorkspace: (request) => invoke('archiveWorkspace', request),
		bindPiSessionToChatTab: (request) =>
			invoke('bindPiSessionToChatTab', request),
		closeChatTab: (request) => invoke('closeChatTab', request),
		computeTurnDiff: (request) => invoke('computeTurnDiff', request),
		confirmRootDirectoryChange: (request) =>
			invoke('confirmRootDirectoryChange', request),
		createTerminalSession: (request) =>
			invoke('createTerminalSession', request),
		createWorkspace: (request) => invoke('createWorkspace', request),
		deleteArchivedWorkspace: (request) =>
			invoke('deleteArchivedWorkspace', request),
		deleteRepository: (request) => invoke('deleteRepository', request),
		deleteWorkspace: (request) => invoke('deleteWorkspace', request),
		ensureWindowWidth: (minimumWidth) =>
			invoke('ensureWindowWidth', minimumWidth),
		environmentVariables: () => invoke('environmentVariables'),
		githubRepositoryList: () => invoke('githubRepositoryList'),
		health: () => invoke('health'),
		killTerminalSession: (request) => invoke('killTerminalSession', request),
		linearCancelLogin: () => invoke('linearCancelLogin'),
		linearConnectionStatus: () => invoke('linearConnectionStatus'),
		linearCreateComment: (request) => invoke('linearCreateComment', request),
		linearCreateIssue: (request) => invoke('linearCreateIssue', request),
		linearDisconnect: () => invoke('linearDisconnect'),
		linearGetIssue: (request) => invoke('linearGetIssue', request),
		linearListIssues: (request) => invoke('linearListIssues', request),
		linearMetadata: (request) => invoke('linearMetadata', request),
		linearStartLogin: () => invoke('linearStartLogin'),
		linearUpdateIssue: (request) => invoke('linearUpdateIssue', request),
		listArchivedWorkspaces: (request) =>
			invoke('listArchivedWorkspaces', request),
		listChatTabs: (request) => invoke('listChatTabs', request),
		listClosedChatTabsWithSummary: (request) =>
			invoke('listClosedChatTabsWithSummary', request),
		listPiModels: () => invoke('listPiModels'),
		listPiSessionEvents: (request) => invoke('listPiSessionEvents', request),
		listPiSessions: (request) => invoke('listPiSessions', request),
		listPiSlashCommands: (request) => invoke('listPiSlashCommands', request),
		listTurnCheckpoints: (request) => invoke('listTurnCheckpoints', request),
		listTerminalSessions: (request) => invoke('listTerminalSessions', request),
		listWorkspaceFiles: (request) => invoke('listWorkspaceFiles', request),
		onCloneGithubRepositoryProgress: (listener) =>
			subscribe<CloneGithubRepositoryProgressEvent>(
				IPC_CHANNELS.cloneGithubRepositoryProgress,
				listener,
			),
		onPiRawFrame: (listener) =>
			subscribe<PiRawFrameBroadcast>(IPC_CHANNELS.piRawFrame, listener),
		onPiSessionEvent: (listener) =>
			subscribe<PiSessionEventBroadcast>(IPC_CHANNELS.piSessionEvent, listener),
		onTerminalLifecycle: (listener) =>
			subscribe<TerminalLifecycleBroadcast>(
				IPC_CHANNELS.terminalLifecycle,
				listener,
			),
		onTerminalOutput: (listener) =>
			subscribe<TerminalOutputBroadcast>(IPC_CHANNELS.terminalOutput, listener),
		openChatTab: (request) => invoke('openChatTab', request),
		openPiSession: (request) => invoke('openPiSession', request),
		prepareCloneGithubRepository: (request) =>
			invoke('prepareCloneGithubRepository', request),
		previewRepositoryConfigMigration: (request) =>
			invoke('previewRepositoryConfigMigration', request),
		quickStartProject: (request) => invoke('quickStartProject', request),
		readWorkspaceFile: (request) => invoke('readWorkspaceFile', request),
		registerLocalRepository: (request) =>
			invoke('registerLocalRepository', request),
		renameWorkspace: (request) => invoke('renameWorkspace', request),
		repositoryConfig: (request) => invoke('repositoryConfig', request),
		repositoryWorkspaceNavigation: () =>
			invoke('repositoryWorkspaceNavigation'),
		resizeTerminalSession: (request) =>
			invoke('resizeTerminalSession', request),
		resolveSettings: (request) => invoke('resolveSettings', request),
		restoreChatTab: (request) => invoke('restoreChatTab', request),
		restoreCheckpoint: (request) => invoke('restoreCheckpoint', request),
		rootDirectory: () => invoke('rootDirectory'),
		runWorkspaceScript: (request) => invoke('runWorkspaceScript', request),
		selectCloneDestination: () => invoke('selectCloneDestination'),
		selectLocalRepository: () => invoke('selectLocalRepository'),
		selectPiExecutable: () => invoke('selectPiExecutable'),
		selectRootDirectory: () => invoke('selectRootDirectory'),
		setupDiagnostics: () => invoke('setupDiagnostics'),
		sharedRootAdoption: () => invoke('sharedRootAdoption'),
		startCloneGithubRepository: (request) =>
			invoke('startCloneGithubRepository', request),
		stopPiSession: (request) => invoke('stopPiSession', request),
		stopWorkspaceScript: (request) => invoke('stopWorkspaceScript', request),
		submitPiPrompt: (request) => invoke('submitPiPrompt', request),
		terminalSnapshot: (request) => invoke('terminalSnapshot', request),
		unarchiveWorkspace: (request) => invoke('unarchiveWorkspace', request),
		writeForkSummary: (request) => invoke('writeForkSummary', request),
		writeTerminalSession: (request) => invoke('writeTerminalSession', request),
	};
}
