import type { useNavigate, useRouter } from '@tanstack/react-router';

import {
	createWorkspace,
	ensembleQueryKeys,
} from '@/renderer/api/ensemble-queries';
import { queryClient } from '@/renderer/api/query-client';

import { pickComposerSurname } from './workspace-name-pool';

interface SeedFirstWorkspaceOptions {
	navigate: ReturnType<typeof useNavigate>;
	repositoryId: string;
	router?: ReturnType<typeof useRouter>;
}

interface SeedFirstWorkspaceResult {
	error?: string;
	status: 'failure' | 'success';
	workspaceId?: string;
}

/**
 * Creates a fresh workspace for a newly-added repository and navigates to it.
 * Used by every add-project flow (register, quick-start, clone) so the user
 * lands directly in a usable workspace instead of an empty project shell.
 */
export async function seedFirstWorkspace({
	navigate,
	repositoryId,
	router,
}: SeedFirstWorkspaceOptions): Promise<SeedFirstWorkspaceResult> {
	const name = pickComposerSurname();
	const result = await createWorkspace({ name, repositoryId });

	if (result.status !== 'success' || !result.workspace) {
		const reason =
			result.diagnostics.find((diagnostic) => diagnostic.severity === 'error')
				?.message ?? 'The starter workspace could not be created.';
		return { error: reason, status: 'failure' };
	}

	const workspaceId = result.workspace.id;

	await queryClient.invalidateQueries({
		queryKey: ensembleQueryKeys.repositoryWorkspaceNavigation(),
	});
	await queryClient.refetchQueries({
		queryKey: ensembleQueryKeys.repositoryWorkspaceNavigation(),
	});

	if (router) {
		await router.invalidate();
	}

	await navigate({
		params: { projectId: repositoryId, workspaceId },
		to: '/projects/$projectId/workspaces/$workspaceId',
	});

	return { status: 'success', workspaceId };
}
