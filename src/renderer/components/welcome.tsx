import { useQuery, useQueryClient } from '@tanstack/react-query';
import { FolderIcon, FolderPlusIcon, GlobeIcon } from 'lucide-react';
import { useCallback, useState } from 'react';

import {
	ensembleQueryKeys,
	githubRepositoryListQuery,
	isEnsembleApiAvailable,
	registerLocalRepository,
	selectLocalRepository,
} from '@/renderer/api/ensemble-queries';
import { SidebarInset } from '@/renderer/components/ui/sidebar';

import { CloneGithubDialog } from './welcome/clone-github-dialog';
import { WelcomeActionCard } from './welcome/welcome-action-card';
import { WelcomeWordmark } from './welcome/welcome-wordmark';

/** Status banner state shown when a local-repository registration completes. */
interface WelcomeNotice {
	tone: 'error' | 'success';
	text: string;
}

/** Default landing view shown when no project/workspace is selected. */
export function Welcome() {
	const [cloneOpen, setCloneOpen] = useState(false);
	const [notice, setNotice] = useState<WelcomeNotice | null>(null);
	const [isOpeningProject, setIsOpeningProject] = useState(false);
	const queryClient = useQueryClient();
	useQuery({
		...githubRepositoryListQuery,
		enabled: isEnsembleApiAvailable(),
	});

	const onOpenLocalProject = useCallback(async () => {
		if (!isEnsembleApiAvailable()) {
			setNotice({
				text: 'Preload bridge is unavailable in this context.',
				tone: 'error',
			});
			return;
		}

		setIsOpeningProject(true);
		setNotice(null);

		try {
			const selection = await selectLocalRepository();

			if (selection.canceled) {
				return;
			}

			if (selection.error) {
				setNotice({ text: selection.error, tone: 'error' });
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
				setNotice({ text: reason, tone: 'error' });
				return;
			}

			await queryClient.invalidateQueries({
				queryKey: ensembleQueryKeys.repositoryWorkspaceNavigation(),
			});
			setNotice({
				text: `Registered ${result.repository.name} (${result.repository.path}).`,
				tone: 'success',
			});
		} catch (error) {
			setNotice({
				text:
					error instanceof Error
						? error.message
						: 'The repository could not be registered.',
				tone: 'error',
			});
		} finally {
			setIsOpeningProject(false);
		}
	}, [queryClient]);

	return (
		<SidebarInset className='flex h-svh min-h-svh overflow-hidden bg-background text-foreground'>
			<main className='flex min-h-0 flex-1 items-center justify-center px-8 py-10'>
				<section className='flex flex-col items-center gap-12'>
					<WelcomeWordmark />
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
							onClick={() => {
								/* TODO: wire to quick-start flow */
							}}
						/>
					</div>
					{notice ? (
						<p
							className={
								notice.tone === 'error'
									? 'max-w-md text-center text-destructive text-sm'
									: 'max-w-md text-center text-muted-foreground text-sm'
							}
							data-testid='welcome-notice'
							data-tone={notice.tone}
						>
							{notice.text}
						</p>
					) : null}
				</section>
			</main>

			<CloneGithubDialog onOpenChange={setCloneOpen} open={cloneOpen} />
		</SidebarInset>
	);
}
