import type { useNavigate, useRouter } from '@tanstack/react-router';
import { toast } from 'sonner';

import {
	importLocalRepository,
	isEnsemblrApiAvailable,
	selectLocalRepository,
} from '@/renderer/api/ensemblr-queries';
import { i18n } from '@/renderer/lib/i18n';

import { seedFirstWorkspace } from './seed-first-workspace';

/** Dependencies for the Open Local Project flow: navigation, router, and UI setters. */
interface OpenLocalProjectFlowOptions {
	navigate: ReturnType<typeof useNavigate>;
	router: ReturnType<typeof useRouter>;
	setLastWorkspaceSelection: (selection: {
		projectId: string;
		workspaceId: string;
	}) => void;
	setLocalProjectImportOpen: (open: boolean) => void;
}

/**
 * Runs the native picker → import → seed → navigate sequence for the
 * Open Local Project entry points (Welcome screen and sidebar add-project menu).
 */
export async function openLocalProjectFlow({
	navigate,
	router,
	setLastWorkspaceSelection,
	setLocalProjectImportOpen,
}: OpenLocalProjectFlowOptions): Promise<void> {
	if (!isEnsemblrApiAvailable()) {
		toast.error(
			i18n.t(
				'errors:open-local-project.bridge-unavailable.title',
				'Preload bridge is unavailable in this context.',
			),
		);
		return;
	}

	try {
		const selection = await selectLocalRepository();
		if (selection.canceled) {
			return;
		}
		if (selection.error) {
			toast.error(selection.error);
			return;
		}
		if (!selection.path) {
			return;
		}

		setLocalProjectImportOpen(true);
		const result = await importLocalRepository({ path: selection.path });

		if (!result.registered || !result.repository) {
			const reason =
				result.diagnostics.find((diagnostic) => diagnostic.severity === 'error')
					?.message ??
				i18n.t(
					'errors:open-local-project.import-failed.title',
					'The repository could not be imported.',
				);
			toast.error(reason);
			return;
		}

		const repository = result.repository;
		const seed = await seedFirstWorkspace({
			navigate,
			persistSelection: setLastWorkspaceSelection,
			repositoryId: repository.id,
			router,
		});

		if (seed.status === 'success') {
			toast.success(
				i18n.t('errors:open-local-project.opened.title', 'Opened {{name}}.', {
					name: repository.name,
				}),
			);
			return;
		}

		toast.error(
			seed.error ??
				i18n.t(
					'errors:open-local-project.seed-failed.title',
					"Imported {{name}} but couldn't open a workspace.",
					{ name: repository.name },
				),
		);
	} catch (error) {
		toast.error(
			error instanceof Error
				? error.message
				: i18n.t(
						'errors:open-local-project.unexpected.title',
						'The local project could not be opened.',
					),
		);
	} finally {
		setLocalProjectImportOpen(false);
	}
}
