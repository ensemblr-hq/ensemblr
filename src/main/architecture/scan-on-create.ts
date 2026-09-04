/**
 * Seeds a new workspace's architecture diagram at the moment it is created.
 *
 * Creation is the one point where a scan cannot destroy anything: the worktree
 * has just been cut, nobody has refined the diagram, and the file the scan
 * writes lands in the workspace's first diff rather than on top of somebody's
 * work. Everything after this is the agent's, through the control op.
 *
 * Shaped as a decorator over the creation service, the same way the setup
 * script hook is, so `repository/` keeps no knowledge of the architecture
 * concern.
 */
import type { CreateWorkspaceService } from '../repository';

import type { ArchitectureScanPort } from './scan-queue.ts';

/**
 * Decorates workspace creation so a successful create queues the seed scan.
 * Never awaited and never able to fail the create: the diagram is derived data,
 * and a workspace without one is worth strictly more than a create that failed
 * because a tree walk did.
 * @param createWorkspaceService - Base service to decorate
 * @param queueScan - Queues the seed scan for a workspace
 * @returns A {@link CreateWorkspaceService} that seeds the diagram on create
 */
export function withArchitectureScanOnCreate({
	createWorkspaceService,
	queueScan,
}: {
	createWorkspaceService: CreateWorkspaceService;
	queueScan: ArchitectureScanPort;
}): CreateWorkspaceService {
	return {
		create: async (request) => {
			const result = await createWorkspaceService.create(request);
			const workspaceId = result.workspace?.id;
			if (result.status === 'success' && workspaceId) {
				queueScan({ workspaceId });
			}
			return result;
		},
	};
}
