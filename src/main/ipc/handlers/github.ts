import { ipcMain } from 'electron';

import { IPC_CHANNELS } from '../../../shared/ipc';
import type { GithubService } from '../../github';
import {
	commitWorkspaceChangesRequestSchema,
	createPullRequestRequestSchema,
	getPullRequestSnapshotRequestSchema,
	mergePullRequestRequestSchema,
	pushWorkspaceBranchRequestSchema,
} from '../request-schemas.ts';

export interface GithubHandlersOptions {
	githubService: GithubService;
}

/** Registers IPC handlers for the gh-backed review flow (ADR 0013). */
export function registerGithubHandlers({
	githubService,
}: GithubHandlersOptions): void {
	ipcMain.handle(IPC_CHANNELS.commitWorkspaceChanges, (_event, raw: unknown) =>
		githubService.commitWorkspaceChanges(
			commitWorkspaceChangesRequestSchema.parse(raw),
		),
	);
	ipcMain.handle(IPC_CHANNELS.pushWorkspaceBranch, (_event, raw: unknown) =>
		githubService.pushWorkspaceBranch(
			pushWorkspaceBranchRequestSchema.parse(raw),
		),
	);
	ipcMain.handle(IPC_CHANNELS.createPullRequest, (_event, raw: unknown) =>
		githubService.createPullRequest(createPullRequestRequestSchema.parse(raw)),
	);
	ipcMain.handle(IPC_CHANNELS.getPullRequestSnapshot, (_event, raw: unknown) =>
		githubService.getPullRequestSnapshot(
			getPullRequestSnapshotRequestSchema.parse(raw),
		),
	);
	ipcMain.handle(IPC_CHANNELS.mergePullRequest, (_event, raw: unknown) =>
		githubService.mergePullRequest(mergePullRequestRequestSchema.parse(raw)),
	);
}
