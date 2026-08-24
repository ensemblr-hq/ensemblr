/**
 * Public entrypoint for the Zod schemas validating raw IPC payloads at the
 * main-process boundary. Implementation lives in `request-schemas/<concern>.ts`.
 *
 * Two flavours coexist there intentionally because the legacy handlers chose
 * two different stances on bad input:
 *
 *   - **Strict (chat-tab):** Throw when the renderer sends a malformed
 *     payload. Surfaces as an IPC error in the renderer. Schemas are used via
 *     `schema.parse(raw)`.
 *   - **Lenient (clone / root / repository-config):** Coerce malformed input
 *     into a known-empty payload (e.g. `{ url: '' }`) and let the service layer
 *     emit a diagnostic. Schemas are used via `schema.safeParse(raw)` with the
 *     fallback returned on failure.
 *
 * Replacing these hand-rolled validators with Zod must preserve the EXACT
 * pre-existing semantics — every chat-tab test and every clone/root/config
 * test must continue to pass. Any deviation is annotated in the owning module.
 */

export { activeChatContextSchema } from './request-schemas/active-chat.ts';
export {
	agentProviderRequestSchema,
	listAgentProviderMcpServersRequestSchema,
	listAgentProviderSlashCommandsRequestSchema,
	openAgentProviderSettingsFileRequestSchema,
	setAgentProviderExecutablePathRequestSchema,
} from './request-schemas/agent-provider.ts';
export {
	listAgentSessionEventsRequestSchema,
	listAgentSessionsRequestSchema,
	openAgentSessionRequestSchema,
	refreshAgentPlanUsageRequestSchema,
	setAgentPlanModeRequestSchema,
	stopAgentSessionRequestSchema,
	submitAgentPromptRequestSchema,
	writeForkSummaryRequestSchema,
} from './request-schemas/agent-session.ts';
export {
	launchAgentHarnessRequestSchema,
	resumeAgentHarnessRequestSchema,
} from './request-schemas/agents.ts';
export {
	bindAgentSessionToChatTabRequestSchema,
	closeChatTabRequestSchema,
	listAllChatTabsRequestSchema,
	listChatTabsRequestSchema,
	listClosedChatTabsWithSummaryRequestSchema,
	openChatTabRequestSchema,
	pinChatTabRequestSchema,
	reorderChatTabsRequestSchema,
	restoreChatTabRequestSchema,
} from './request-schemas/chat-tab.ts';
export {
	computeTurnDiffRequestSchema,
	listTurnCheckpointsRequestSchema,
	restoreCheckpointRequestSchema,
} from './request-schemas/checkpoint.ts';
export {
	cloneGithubRepositoryRequestSchema,
	cloneGithubRepositoryStartRequestSchema,
	githubRepositoryListRequestSchema,
	parseCloneGithubRepositoryRequest,
	parseCloneGithubRepositoryStartRequest,
	parseGithubRepositoryListRequest,
} from './request-schemas/clone.ts';
export {
	clearConciergeContextRequestSchema,
	listConciergeEventsRequestSchema,
	openConciergeSessionRequestSchema,
	stopConciergeSessionRequestSchema,
	submitConciergePromptRequestSchema,
} from './request-schemas/concierge.ts';
export {
	commitWorkspaceChangesRequestSchema,
	createPullRequestRequestSchema,
	getPullRequestSnapshotRequestSchema,
	listRepositoryIssuesRequestSchema,
	listRepositorySourcesRequestSchema,
	mergePullRequestRequestSchema,
	pushWorkspaceBranchRequestSchema,
} from './request-schemas/github.ts';
export {
	addInfisicalAccountRequestSchema,
	infisicalAccountRequestSchema,
	infisicalLinkScopeRequestSchema,
	setInfisicalLinkRequestSchema,
} from './request-schemas/infisical.ts';
export {
	createLinearCommentRequestSchema,
	createLinearIssueRequestSchema,
	getLinearIssueRequestSchema,
	getLinearMetadataRequestSchema,
	linearDisconnectRequestSchema,
	listLinearIssuesRequestSchema,
	updateLinearIssueRequestSchema,
} from './request-schemas/linear.ts';
export { linkedDirectoryRequestSchema } from './request-schemas/linked-directories.ts';
export { menuContextSchema } from './request-schemas/menu.ts';
export {
	archiveWorkspaceRequestSchema,
	continueWorkspaceBranchRequestSchema,
	createWorkspaceRequestSchema,
	deleteArchivedWorkspaceRequestSchema,
	deleteRepositoryRequestSchema,
	deleteWorkspaceRequestSchema,
	listArchivedWorkspacesRequestSchema,
	parseArchiveWorkspaceRequest,
	parseContinueWorkspaceBranchRequest,
	parseCreateWorkspaceRequest,
	parseDeleteArchivedWorkspaceRequest,
	parseDeleteRepositoryRequest,
	parseDeleteWorkspaceRequest,
	parseListArchivedWorkspacesRequest,
	parseQuickStartProjectRequest,
	parseRegisterLocalRepositoryRequest,
	parseRenameWorkspaceRequest,
	parseSetWorkspaceBaseBranchRequest,
	parseUnarchiveWorkspaceRequest,
	quickStartProjectRequestSchema,
	registerLocalRepositoryRequestSchema,
	renameWorkspaceRequestSchema,
	setWorkspaceBaseBranchRequestSchema,
	unarchiveWorkspaceRequestSchema,
} from './request-schemas/repository.ts';
export {
	parseRepositoryConfigRequest,
	repositoryConfigRequestSchema,
} from './request-schemas/repository-config.ts';
export {
	reviewDeleteCommentRequestSchema,
	reviewDeleteRequestSchema,
	reviewListRequestSchema,
	saveReviewCommentRequestSchema,
	saveReviewTodoRequestSchema,
} from './request-schemas/review.ts';
export {
	parseRootDirectoryChangeRequest,
	rootDirectoryChangeRequestSchema,
} from './request-schemas/root.ts';
export {
	addWordToDictionaryRequestSchema,
	replaceMisspellingRequestSchema,
	textEditCommandSchema,
} from './request-schemas/text-editing.ts';
export {
	readWorkspaceFileRequestSchema,
	writeWorkspaceActionPromptRequestSchema,
	writeWorkspaceFileAttachmentRequestSchema,
	writeWorkspaceImageAttachmentRequestSchema,
} from './request-schemas/workspace-files.ts';
export {
	discardWorkspaceChangesRequestSchema,
	getWorkspaceCommitsRequestSchema,
	getWorkspaceFileDiffRequestSchema,
	getWorkspaceGitStatusRequestSchema,
	getWorkspaceMergeConflictsRequestSchema,
} from './request-schemas/workspace-git.ts';
export {
	parseUpdateRepositoryScriptsRequest,
	parseUpdateRepositorySettingsRequest,
	updateRepositoryScriptsRequestSchema,
	updateRepositorySettingsRequestSchema,
} from './request-schemas/workspace-scripts.ts';
