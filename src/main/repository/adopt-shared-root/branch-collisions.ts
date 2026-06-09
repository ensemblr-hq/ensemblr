import type { SharedRootAdoptionDiagnostic } from '../../../shared/ipc';

/** Groups workspace ids by branch name to surface collision diagnostics. */
export function trackBranchCollision({
	branch,
	collisionsByRepo,
	id,
	repositoryId,
}: {
	branch: string | null;
	collisionsByRepo: Map<string, Map<string, string[]>>;
	id: string;
	repositoryId: string;
}): void {
	if (!branch) {
		return;
	}
	let byBranch = collisionsByRepo.get(repositoryId);
	if (!byBranch) {
		byBranch = new Map();
		collisionsByRepo.set(repositoryId, byBranch);
	}
	const ids = byBranch.get(branch);
	if (ids) {
		ids.push(id);
	} else {
		byBranch.set(branch, [id]);
	}
}

/** Emits a diagnostic for every branch that has more than one workspace. */
export function appendBranchCollisionDiagnostics({
	collisionsByRepo,
	diagnostics,
}: {
	collisionsByRepo: Map<string, Map<string, string[]>>;
	diagnostics: SharedRootAdoptionDiagnostic[];
}): void {
	for (const [repositoryId, byBranch] of collisionsByRepo) {
		for (const [branch, ids] of byBranch) {
			if (ids.length > 1) {
				diagnostics.push({
					code: 'workspace-branch-collision',
					message: `Multiple workspaces in repository ${repositoryId} share branch "${branch}".`,
					severity: 'warning',
				});
			}
		}
	}
}
