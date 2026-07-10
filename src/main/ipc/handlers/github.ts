import { ipcMain } from 'electron';

import { IPC_CHANNELS } from '../../../shared/ipc/channels';
import type { GithubService } from '../../github';
import type { WithPermissionGate } from '../permission-gate.ts';
import {
	commitWorkspaceChangesRequestSchema,
	createPullRequestRequestSchema,
	getPullRequestSnapshotRequestSchema,
	mergePullRequestRequestSchema,
	pushWorkspaceBranchRequestSchema,
} from '../request-schemas.ts';

/** Registers IPC handlers for the gh-backed review flow (ADR 0013). */
export function registerGithubHandlers({
	githubService,
	withPermissionGate,
}: {
	githubService: GithubService;
	withPermissionGate: WithPermissionGate;
}): void {
	withPermissionGate(
		IPC_CHANNELS.commitWorkspaceChanges,
		'workspace-write',
		(_event, raw: unknown) =>
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
	withPermissionGate(
		IPC_CHANNELS.mergePullRequest,
		'pull-request-merge',
		(_event, raw: unknown) =>
			githubService.mergePullRequest(mergePullRequestRequestSchema.parse(raw)),
	);
}
