import { useQuery } from '@tanstack/react-query';
import { useNavigate, useRouter } from '@tanstack/react-router';
import { useSetAtom } from 'jotai';
import { FolderIcon, FolderPlusIcon, GlobeIcon } from 'lucide-react';
import { useCallback, useState } from 'react';
import { toast } from 'sonner';

import {
	githubRepositoryListQuery,
	isEnsembleApiAvailable,
	registerLocalRepository,
	selectLocalRepository,
} from '@/renderer/api/ensemble-queries';
import { SidebarInset } from '@/renderer/components/ui/sidebar';
import { seedFirstWorkspace } from '@/renderer/lib/workbench/seed-first-workspace';
import {
	cloneDialogOpenAtom,
	quickStartDialogOpenAtom,
} from '@/renderer/state/dialogs';

import { WelcomeActionCard } from './welcome/welcome-action-card';
import { WelcomeWordmark } from './welcome/welcome-wordmark';

/** Default landing view shown when no project/workspace is selected. */
export function Welcome() {
	const [isOpeningProject, setIsOpeningProject] = useState(false);
	const navigate = useNavigate();
	const router = useRouter();
	const setCloneOpen = useSetAtom(cloneDialogOpenAtom);
	const setQuickStartOpen = useSetAtom(quickStartDialogOpenAtom);
	// Warm the GitHub repo-list cache so CloneGithubDialog opens with
	// a populated list instead of an empty spinner. Result is intentionally
	// discarded; the dialog reads from the React Query cache.
	useQuery({
		...githubRepositoryListQuery,
		enabled: isEnsembleApiAvailable(),
	});

	const onOpenLocalProject = useCallback(async () => {
		if (!isEnsembleApiAvailable()) {
			toast.error('Preload bridge is unavailable in this context.');
			return;
		}

		setIsOpeningProject(true);

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

			const result = await registerLocalRepository({ path: selection.path });

			if (!result.registered || !result.repository) {
				const reason =
					result.diagnostics.find(
						(diagnostic) => diagnostic.severity === 'error',
					)?.message ?? 'The repository could not be registered.';
				toast.error(reason);
				return;
			}

			const repository = result.repository;
			const seed = await seedFirstWorkspace({
				navigate,
				repositoryId: repository.id,
				router,
			});
			if (seed.status === 'success') {
				toast.success(`Opened ${repository.name}.`);
			} else {
				toast.error(
					seed.error ??
						`Registered ${repository.name} but couldn't open a workspace.`,
				);
			}
		} catch (error) {
			toast.error(
				error instanceof Error
					? error.message
					: 'The repository could not be registered.',
			);
		} finally {
			setIsOpeningProject(false);
		}
	}, [navigate, router]);

	return (
		<SidebarInset className='flex h-svh min-h-svh overflow-hidden bg-background text-foreground'>
			<main className='flex min-h-0 flex-1 items-center justify-center px-8 py-10'>
				<section className='flex flex-col items-center gap-12'>
					<WelcomeWordmark className='blur-[0.75px]' />
					<div className='flex flex-wrap items-center justify-center gap-3'>
						<WelcomeActionCard
							disabled={isOpeningProject}
							icon={FolderIcon}
							label='Open project'
							onClick={onOpenLocalProject}
						/>
						<WelcomeActionCard
							icon={GlobeIcon}
							label='Open GitHub project'
							onClick={() => setCloneOpen(true)}
						/>
						<WelcomeActionCard
							icon={FolderPlusIcon}
							label='Quick start'
							onClick={() => setQuickStartOpen(true)}
						/>
					</div>
				</section>
			</main>
		</SidebarInset>
	);
}
