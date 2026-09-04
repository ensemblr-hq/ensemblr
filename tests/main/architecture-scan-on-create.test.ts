import { describe, expect, it, vi } from 'vitest';

import { withArchitectureScanOnCreate } from '../../src/main/architecture/index.ts';
import type { CreateWorkspaceService } from '../../src/main/repository';
import type { CreateWorkspaceResult } from '../../src/shared/ipc/contracts/workspace';

/**
 * Builds a creation service returning a fixed result.
 * @param result - What `create` resolves to
 * @returns The stub and the spy behind it
 */
function createStub(result: CreateWorkspaceResult): {
	create: ReturnType<typeof vi.fn>;
	service: CreateWorkspaceService;
} {
	const create = vi.fn(async () => result);
	return { create, service: { create } as CreateWorkspaceService };
}

const success = {
	diagnostics: [],
	status: 'success',
	workspace: { id: 'ws-1' },
} as unknown as CreateWorkspaceResult;

const failure = {
	diagnostics: [{ code: 'branch-exists', message: 'taken' }],
	status: 'error',
} as unknown as CreateWorkspaceResult;

// Creation is the one moment a scan cannot destroy anything: the worktree has
// just been cut, so the file it writes lands in the workspace's first diff
// rather than over a refinement somebody already made.
describe('architecture scan on workspace create', () => {
	it('seeds the diagram once a workspace is created', async () => {
		const { service } = createStub(success);
		const queueScan = vi.fn();
		const decorated = withArchitectureScanOnCreate({
			createWorkspaceService: service,
			queueScan,
		});

		await decorated.create({ name: 'w', repositoryId: 'repo-1' });

		expect(queueScan).toHaveBeenCalledWith({ workspaceId: 'ws-1' });
	});

	it('leaves a failed create alone', async () => {
		const { service } = createStub(failure);
		const queueScan = vi.fn();
		const decorated = withArchitectureScanOnCreate({
			createWorkspaceService: service,
			queueScan,
		});

		await decorated.create({ name: 'w', repositoryId: 'repo-1' });

		expect(queueScan).not.toHaveBeenCalled();
	});

	it('returns the base service’s own result untouched', async () => {
		const { create, service } = createStub(success);
		const decorated = withArchitectureScanOnCreate({
			createWorkspaceService: service,
			queueScan: vi.fn(),
		});

		const request = { name: 'w', repositoryId: 'repo-1' };
		expect(await decorated.create(request)).toBe(success);
		expect(create).toHaveBeenCalledWith(request);
	});
});
