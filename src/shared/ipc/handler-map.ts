/**
 * Compile-time table that maps every IPC channel key to its request and
 * response wire shapes. The string identifier keyed by each entry is
 * `(typeof IPC_CHANNELS)[K]` so adding a channel without typing it surfaces as
 * a `Property '...' is missing in type` error at compile time rather than as a
 * silent runtime mismatch on the other side of the preload bridge.
 *
 * Channels that broadcast events from main to renderer (push, no request) use
 * `void` for `req` and carry the broadcast envelope in `res`. Channels with
 * optional payloads (e.g. `listPiSlashCommands`) widen `req` to include
 * `undefined`.
 *
 * Type-only file — no runtime export. Consume by indexing
 * `IpcHandlerMap['createWorkspace']` to derive the request/response shapes
 * inline.
 */

import type { IPC_CHANNELS } from './channels';
import type {
	BindPiSessionToTabRequest,
	BindPiSessionToTabResult,
	CloseChatTabRequest,
	CloseChatTabResult,
	ListChatTabsRequest,
	ListChatTabsResult,
	ListClosedChatTabsWithSummaryRequest,
	ListClosedChatTabsWithSummaryResult,
	OpenChatTabRequest,
	OpenChatTabResult,
	ReorderChatTabsRequest,
	ReorderChatTabsResult,
	RestoreChatTabRequest,
	RestoreChatTabResult,
} from './contracts/chat-tab';
import type {
	CloneDestinationSelectionResult,
	CloneGithubRepositoryPrepareResult,
	CloneGithubRepositoryProgressEvent,
	CloneGithubRepositoryRequest,
	CloneGithubRepositoryStartRequest,
	CloneGithubRepositoryStartResult,
	GithubRepositoryListRequest,
	GithubRepositoryListResult,
} from './contracts/clone';
import type { EnvironmentVariablesSnapshot } from './contracts/environment';
import type {
	CommitWorkspaceChangesRequest,
	CommitWorkspaceChangesResult,
	CreatePullRequestRequest,
	CreatePullRequestResult,
	GetPullRequestSnapshotRequest,
	GetPullRequestSnapshotResult,
	MergePullRequestRequest,
	MergePullRequestResult,
	PushWorkspaceBranchRequest,
	PushWorkspaceBranchResult,
} from './contracts/github';
import type { HealthSnapshot } from './contracts/health';
import type {
	CreateLinearCommentRequest,
	CreateLinearCommentResult,
	CreateLinearIssueRequest,
	GetLinearIssueRequest,
	GetLinearIssueResult,
	GetLinearMetadataRequest,
	GetLinearMetadataResult,
	LinearConnectionSnapshot,
	LinearDisconnectResult,
	LinearLoginResult,
	ListLinearIssuesRequest,
	ListLinearIssuesResult,
	MutateLinearIssueResult,
	UpdateLinearIssueRequest,
} from './contracts/linear';
import type {
	ListPiModelsResult,
	ListPiSessionEventsRequest,
	ListPiSessionEventsResult,
	ListPiSessionsRequest,
	ListPiSessionsResult,
	ListPiSlashCommandsRequest,
	ListPiSlashCommandsResult,
	OpenPiSessionRequest,
	OpenPiSessionResult,
	PiExecutablePathSnapshot,
	PiExecutableSelectionResult,
	PiRawFrameBroadcast,
	PiSessionEventBroadcast,
	SetPiExecutablePathRequest,
	StopPiSessionRequest,
	StopPiSessionResult,
	SubmitPiPromptRequest,
	SubmitPiPromptResult,
	WriteForkSummaryRequest,
	WriteForkSummaryResult,
} from './contracts/pi-session';
import type {
	QuickStartProjectRequest,
	QuickStartProjectResult,
} from './contracts/quick-start';
import type {
	ArchiveRepositoryRequest,
	ArchiveRepositoryResult,
	DeleteRepositoryRequest,
	DeleteRepositoryResult,
	LocalRepositorySelectionResult,
	RegisterLocalRepositoryRequest,
	RegisterLocalRepositoryResult,
} from './contracts/repository';
import type {
	RepositoryConfigRequest,
	RepositoryConfigSnapshot,
} from './contracts/repository-config';
import type { RepositoryWorkspaceNavigationSnapshot } from './contracts/repository-navigation';
import type {
	OpenRepositoryConfigFileRequest,
	OpenRepositoryConfigFileResult,
	UpdateRepositorySettingsRequest,
	UpdateRepositorySettingsResult,
} from './contracts/repository-settings';
import type {
	DeleteReviewCommentRequest,
	DeleteReviewCommentResult,
	DeleteReviewTodoRequest,
	DeleteReviewTodoResult,
	ListReviewCommentsRequest,
	ListReviewCommentsResult,
	ListReviewTodosRequest,
	ListReviewTodosResult,
	SaveReviewCommentRequest,
	SaveReviewCommentResult,
	SaveReviewTodoRequest,
	SaveReviewTodoResult,
} from './contracts/review-comments';
import type {
	RootDirectoryChangeApplyResult,
	RootDirectoryChangeRequest,
	RootDirectorySelectionResult,
	RootDirectorySnapshot,
} from './contracts/root-directory';
import type {
	SettingsResolutionRequest,
	SettingsResolutionSnapshot,
} from './contracts/settings-resolution';
import type { SetupDiagnosticsSnapshot } from './contracts/setup';
import type { SharedRootAdoptionSnapshot } from './contracts/shared-root-adoption';
import type { InitialShellSnapshot } from './contracts/shell-snapshot';
import type {
	CreateTerminalSessionRequest,
	CreateTerminalSessionResult,
	KillTerminalRequest,
	KillTerminalResult,
	ListTerminalSessionsRequest,
	ListTerminalSessionsResult,
	ResizeTerminalRequest,
	TerminalLifecycleBroadcast,
	TerminalOutputBroadcast,
	TerminalSnapshotRequest,
	TerminalSnapshotResult,
	WriteTerminalRequest,
} from './contracts/terminal';
import type {
	ArchiveWorkspaceRequest,
	ArchiveWorkspaceResult,
	CreateWorkspaceRequest,
	CreateWorkspaceResult,
	DeleteArchivedWorkspaceRequest,
	DeleteArchivedWorkspaceResult,
	DeleteWorkspaceRequest,
	DeleteWorkspaceResult,
	ListArchivedWorkspacesRequest,
	ListArchivedWorkspacesResult,
	RenameWorkspaceRequest,
	RenameWorkspaceResult,
	UnarchiveWorkspaceRequest,
	UnarchiveWorkspaceResult,
} from './contracts/workspace';
import type {
	ListWorkspaceFilesRequest,
	ListWorkspaceFilesResult,
	ReadWorkspaceDirectoryRequest,
	ReadWorkspaceDirectoryResult,
	ReadWorkspaceFileRequest,
	ReadWorkspaceFileResult,
	WriteWorkspaceActionPromptRequest,
	WriteWorkspaceActionPromptResult,
	WriteWorkspaceFileAttachmentRequest,
	WriteWorkspaceFileAttachmentResult,
	WriteWorkspaceImageAttachmentRequest,
	WriteWorkspaceImageAttachmentResult,
} from './contracts/workspace-files';
import type {
	GetWorkspaceFileDiffRequest,
	GetWorkspaceFileDiffResult,
	GetWorkspaceGitStatusRequest,
	GetWorkspaceGitStatusResult,
} from './contracts/workspace-git';
import type {
	RunWorkspaceScriptRequest,
	RunWorkspaceScriptResult,
	StopWorkspaceScriptRequest,
	StopWorkspaceScriptResult,
	UpdateRepositoryScriptsRequest,
	UpdateRepositoryScriptsResult,
} from './contracts/workspace-scripts';

/** Per-channel { req, res } pair. */
interface IpcHandlerEntry<Req, Res> {
	req: Req;
	res: Res;
}

/**
 * Map every `IPC_CHANNELS` key to its request and response shapes.
 *
 * Channels keyed by `void` request mean "no payload" (the renderer calls the
 * preload method with zero arguments). Broadcast channels (push from main)
 * also use `void` for `req` and put the wire envelope in `res`.
 */
export interface IpcHandlerMap {
	[IPC_CHANNELS.archiveRepository]: IpcHandlerEntry<
		ArchiveRepositoryRequest,
		ArchiveRepositoryResult
	>;
	[IPC_CHANNELS.archiveWorkspace]: IpcHandlerEntry<
		ArchiveWorkspaceRequest,
		ArchiveWorkspaceResult
	>;
	[IPC_CHANNELS.bindPiSessionToChatTab]: IpcHandlerEntry<
		BindPiSessionToTabRequest,
		BindPiSessionToTabResult
	>;
	[IPC_CHANNELS.closeChatTab]: IpcHandlerEntry<
		CloseChatTabRequest,
		CloseChatTabResult
	>;
	[IPC_CHANNELS.cloneGithubRepositoryPrepare]: IpcHandlerEntry<
		CloneGithubRepositoryRequest,
		CloneGithubRepositoryPrepareResult
	>;
	[IPC_CHANNELS.cloneGithubRepositoryProgress]: IpcHandlerEntry<
		void,
		CloneGithubRepositoryProgressEvent
	>;
	[IPC_CHANNELS.cloneGithubRepositoryStart]: IpcHandlerEntry<
		CloneGithubRepositoryStartRequest,
		CloneGithubRepositoryStartResult
	>;
	[IPC_CHANNELS.confirmRootDirectoryChange]: IpcHandlerEntry<
		RootDirectoryChangeRequest,
		RootDirectoryChangeApplyResult
	>;
	[IPC_CHANNELS.createTerminalSession]: IpcHandlerEntry<
		CreateTerminalSessionRequest,
		CreateTerminalSessionResult
	>;
	[IPC_CHANNELS.createWorkspace]: IpcHandlerEntry<
		CreateWorkspaceRequest,
		CreateWorkspaceResult
	>;
	[IPC_CHANNELS.deleteArchivedWorkspace]: IpcHandlerEntry<
		DeleteArchivedWorkspaceRequest,
		DeleteArchivedWorkspaceResult
	>;
	[IPC_CHANNELS.deleteRepository]: IpcHandlerEntry<
		DeleteRepositoryRequest,
		DeleteRepositoryResult
	>;
	[IPC_CHANNELS.deleteReviewComment]: IpcHandlerEntry<
		DeleteReviewCommentRequest,
		DeleteReviewCommentResult
	>;
	[IPC_CHANNELS.deleteReviewTodo]: IpcHandlerEntry<
		DeleteReviewTodoRequest,
		DeleteReviewTodoResult
	>;
	[IPC_CHANNELS.deleteWorkspace]: IpcHandlerEntry<
		DeleteWorkspaceRequest,
		DeleteWorkspaceResult
	>;
	[IPC_CHANNELS.ensureWindowWidth]: IpcHandlerEntry<number, void>;
	[IPC_CHANNELS.openExternal]: IpcHandlerEntry<string, void>;
	[IPC_CHANNELS.environmentVariables]: IpcHandlerEntry<
		void,
		EnvironmentVariablesSnapshot
	>;
	[IPC_CHANNELS.commitWorkspaceChanges]: IpcHandlerEntry<
		CommitWorkspaceChangesRequest,
		CommitWorkspaceChangesResult
	>;
	[IPC_CHANNELS.createPullRequest]: IpcHandlerEntry<
		CreatePullRequestRequest,
		CreatePullRequestResult
	>;
	[IPC_CHANNELS.getPullRequestSnapshot]: IpcHandlerEntry<
		GetPullRequestSnapshotRequest,
		GetPullRequestSnapshotResult
	>;
	[IPC_CHANNELS.mergePullRequest]: IpcHandlerEntry<
		MergePullRequestRequest,
		MergePullRequestResult
	>;
	[IPC_CHANNELS.pushWorkspaceBranch]: IpcHandlerEntry<
		PushWorkspaceBranchRequest,
		PushWorkspaceBranchResult
	>;
	[IPC_CHANNELS.getWorkspaceFileDiff]: IpcHandlerEntry<
		GetWorkspaceFileDiffRequest,
		GetWorkspaceFileDiffResult
	>;
	[IPC_CHANNELS.getWorkspaceGitStatus]: IpcHandlerEntry<
		GetWorkspaceGitStatusRequest,
		GetWorkspaceGitStatusResult
	>;
	[IPC_CHANNELS.githubRepositoryList]: IpcHandlerEntry<
		GithubRepositoryListRequest | undefined,
		GithubRepositoryListResult
	>;
	[IPC_CHANNELS.health]: IpcHandlerEntry<void, HealthSnapshot>;
	[IPC_CHANNELS.importLocalRepository]: IpcHandlerEntry<
		RegisterLocalRepositoryRequest,
		RegisterLocalRepositoryResult
	>;
	[IPC_CHANNELS.initialShellSnapshot]: IpcHandlerEntry<
		void,
		InitialShellSnapshot
	>;
	[IPC_CHANNELS.killTerminalSession]: IpcHandlerEntry<
		KillTerminalRequest,
		KillTerminalResult
	>;
	[IPC_CHANNELS.linearCancelLogin]: IpcHandlerEntry<void, void>;
	[IPC_CHANNELS.linearConnectionStatus]: IpcHandlerEntry<
		void,
		LinearConnectionSnapshot
	>;
	[IPC_CHANNELS.linearCreateComment]: IpcHandlerEntry<
		CreateLinearCommentRequest,
		CreateLinearCommentResult
	>;
	[IPC_CHANNELS.linearCreateIssue]: IpcHandlerEntry<
		CreateLinearIssueRequest,
		MutateLinearIssueResult
	>;
	[IPC_CHANNELS.linearDisconnect]: IpcHandlerEntry<
		void,
		LinearDisconnectResult
	>;
	[IPC_CHANNELS.linearGetIssue]: IpcHandlerEntry<
		GetLinearIssueRequest,
		GetLinearIssueResult
	>;
	[IPC_CHANNELS.linearListIssues]: IpcHandlerEntry<
		ListLinearIssuesRequest | undefined,
		ListLinearIssuesResult
	>;
	[IPC_CHANNELS.linearMetadata]: IpcHandlerEntry<
		GetLinearMetadataRequest | undefined,
		GetLinearMetadataResult
	>;
	[IPC_CHANNELS.linearStartLogin]: IpcHandlerEntry<void, LinearLoginResult>;
	[IPC_CHANNELS.linearUpdateIssue]: IpcHandlerEntry<
		UpdateLinearIssueRequest,
		MutateLinearIssueResult
	>;
	[IPC_CHANNELS.listArchivedWorkspaces]: IpcHandlerEntry<
		ListArchivedWorkspacesRequest,
		ListArchivedWorkspacesResult
	>;
	[IPC_CHANNELS.listChatTabs]: IpcHandlerEntry<
		ListChatTabsRequest,
		ListChatTabsResult
	>;
	[IPC_CHANNELS.listClosedChatTabsWithSummary]: IpcHandlerEntry<
		ListClosedChatTabsWithSummaryRequest,
		ListClosedChatTabsWithSummaryResult
	>;
	[IPC_CHANNELS.listPiModels]: IpcHandlerEntry<void, ListPiModelsResult>;
	[IPC_CHANNELS.listPiSessionEvents]: IpcHandlerEntry<
		ListPiSessionEventsRequest,
		ListPiSessionEventsResult
	>;
	[IPC_CHANNELS.listPiSessions]: IpcHandlerEntry<
		ListPiSessionsRequest,
		ListPiSessionsResult
	>;
	[IPC_CHANNELS.listPiSlashCommands]: IpcHandlerEntry<
		ListPiSlashCommandsRequest | undefined,
		ListPiSlashCommandsResult
	>;
	[IPC_CHANNELS.listReviewComments]: IpcHandlerEntry<
		ListReviewCommentsRequest,
		ListReviewCommentsResult
	>;
	[IPC_CHANNELS.listReviewTodos]: IpcHandlerEntry<
		ListReviewTodosRequest,
		ListReviewTodosResult
	>;
	[IPC_CHANNELS.listTerminalSessions]: IpcHandlerEntry<
		ListTerminalSessionsRequest,
		ListTerminalSessionsResult
	>;
	[IPC_CHANNELS.listWorkspaceFiles]: IpcHandlerEntry<
		ListWorkspaceFilesRequest,
		ListWorkspaceFilesResult
	>;
	[IPC_CHANNELS.openChatTab]: IpcHandlerEntry<
		OpenChatTabRequest,
		OpenChatTabResult
	>;
	[IPC_CHANNELS.openPiSession]: IpcHandlerEntry<
		OpenPiSessionRequest,
		OpenPiSessionResult
	>;
	[IPC_CHANNELS.piRawFrame]: IpcHandlerEntry<void, PiRawFrameBroadcast>;
	[IPC_CHANNELS.piSessionEvent]: IpcHandlerEntry<void, PiSessionEventBroadcast>;
	[IPC_CHANNELS.quickStartProject]: IpcHandlerEntry<
		QuickStartProjectRequest,
		QuickStartProjectResult
	>;
	[IPC_CHANNELS.readWorkspaceDirectory]: IpcHandlerEntry<
		ReadWorkspaceDirectoryRequest,
		ReadWorkspaceDirectoryResult
	>;
	[IPC_CHANNELS.readWorkspaceFile]: IpcHandlerEntry<
		ReadWorkspaceFileRequest,
		ReadWorkspaceFileResult
	>;
	[IPC_CHANNELS.writeWorkspaceImageAttachment]: IpcHandlerEntry<
		WriteWorkspaceImageAttachmentRequest,
		WriteWorkspaceImageAttachmentResult
	>;
	[IPC_CHANNELS.writeWorkspaceFileAttachment]: IpcHandlerEntry<
		WriteWorkspaceFileAttachmentRequest,
		WriteWorkspaceFileAttachmentResult
	>;
	[IPC_CHANNELS.writeWorkspaceActionPrompt]: IpcHandlerEntry<
		WriteWorkspaceActionPromptRequest,
		WriteWorkspaceActionPromptResult
	>;
	[IPC_CHANNELS.registerLocalRepository]: IpcHandlerEntry<
		RegisterLocalRepositoryRequest,
		RegisterLocalRepositoryResult
	>;
	[IPC_CHANNELS.renameWorkspace]: IpcHandlerEntry<
		RenameWorkspaceRequest,
		RenameWorkspaceResult
	>;
	[IPC_CHANNELS.reorderChatTabs]: IpcHandlerEntry<
		ReorderChatTabsRequest,
		ReorderChatTabsResult
	>;
	[IPC_CHANNELS.restoreChatTab]: IpcHandlerEntry<
		RestoreChatTabRequest,
		RestoreChatTabResult
	>;
	[IPC_CHANNELS.repositoryConfig]: IpcHandlerEntry<
		RepositoryConfigRequest,
		RepositoryConfigSnapshot
	>;
	[IPC_CHANNELS.resizeTerminalSession]: IpcHandlerEntry<
		ResizeTerminalRequest,
		void
	>;
	[IPC_CHANNELS.repositoryWorkspaceNavigation]: IpcHandlerEntry<
		void,
		RepositoryWorkspaceNavigationSnapshot
	>;
	[IPC_CHANNELS.rootDirectory]: IpcHandlerEntry<void, RootDirectorySnapshot>;
	[IPC_CHANNELS.runWorkspaceScript]: IpcHandlerEntry<
		RunWorkspaceScriptRequest,
		RunWorkspaceScriptResult
	>;
	[IPC_CHANNELS.saveReviewComment]: IpcHandlerEntry<
		SaveReviewCommentRequest,
		SaveReviewCommentResult
	>;
	[IPC_CHANNELS.saveReviewTodo]: IpcHandlerEntry<
		SaveReviewTodoRequest,
		SaveReviewTodoResult
	>;
	[IPC_CHANNELS.selectCloneDestination]: IpcHandlerEntry<
		void,
		CloneDestinationSelectionResult
	>;
	[IPC_CHANNELS.selectLocalRepository]: IpcHandlerEntry<
		void,
		LocalRepositorySelectionResult
	>;
	[IPC_CHANNELS.selectPiExecutable]: IpcHandlerEntry<
		void,
		PiExecutableSelectionResult
	>;
	[IPC_CHANNELS.getPiExecutablePath]: IpcHandlerEntry<
		void,
		PiExecutablePathSnapshot
	>;
	[IPC_CHANNELS.setPiExecutablePath]: IpcHandlerEntry<
		SetPiExecutablePathRequest,
		PiExecutableSelectionResult
	>;
	[IPC_CHANNELS.clearPiExecutablePath]: IpcHandlerEntry<
		void,
		PiExecutableSelectionResult
	>;
	[IPC_CHANNELS.selectRootDirectory]: IpcHandlerEntry<
		void,
		RootDirectorySelectionResult
	>;
	[IPC_CHANNELS.setupDiagnostics]: IpcHandlerEntry<
		void,
		SetupDiagnosticsSnapshot
	>;
	[IPC_CHANNELS.stopPiSession]: IpcHandlerEntry<
		StopPiSessionRequest,
		StopPiSessionResult
	>;
	[IPC_CHANNELS.stopWorkspaceScript]: IpcHandlerEntry<
		StopWorkspaceScriptRequest,
		StopWorkspaceScriptResult
	>;
	[IPC_CHANNELS.updateRepositoryScripts]: IpcHandlerEntry<
		UpdateRepositoryScriptsRequest,
		UpdateRepositoryScriptsResult
	>;
	[IPC_CHANNELS.updateRepositorySettings]: IpcHandlerEntry<
		UpdateRepositorySettingsRequest,
		UpdateRepositorySettingsResult
	>;
	[IPC_CHANNELS.openRepositoryConfigFile]: IpcHandlerEntry<
		OpenRepositoryConfigFileRequest,
		OpenRepositoryConfigFileResult
	>;
	[IPC_CHANNELS.submitPiPrompt]: IpcHandlerEntry<
		SubmitPiPromptRequest,
		SubmitPiPromptResult
	>;
	[IPC_CHANNELS.settingsResolution]: IpcHandlerEntry<
		SettingsResolutionRequest | undefined,
		SettingsResolutionSnapshot
	>;
	[IPC_CHANNELS.sharedRootAdoption]: IpcHandlerEntry<
		void,
		SharedRootAdoptionSnapshot
	>;
	[IPC_CHANNELS.terminalLifecycle]: IpcHandlerEntry<
		void,
		TerminalLifecycleBroadcast
	>;
	[IPC_CHANNELS.terminalOutput]: IpcHandlerEntry<void, TerminalOutputBroadcast>;
	[IPC_CHANNELS.terminalSnapshot]: IpcHandlerEntry<
		TerminalSnapshotRequest,
		TerminalSnapshotResult
	>;
	[IPC_CHANNELS.unarchiveWorkspace]: IpcHandlerEntry<
		UnarchiveWorkspaceRequest,
		UnarchiveWorkspaceResult
	>;
	[IPC_CHANNELS.writeForkSummary]: IpcHandlerEntry<
		WriteForkSummaryRequest,
		WriteForkSummaryResult
	>;
	[IPC_CHANNELS.writeTerminalSession]: IpcHandlerEntry<
		WriteTerminalRequest,
		void
	>;
}
