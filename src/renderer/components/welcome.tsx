import { useQuery } from '@tanstack/react-query';
import { useNavigate, useRouter } from '@tanstack/react-router';
import { useAtomValue, useSetAtom } from 'jotai';
import { FolderIcon, FolderPlusIcon, GlobeIcon } from 'lucide-react';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import {
	githubRepositoryListQuery,
	isEnsemblrApiAvailable,
} from '@/renderer/api/ensemblr-queries';
import { SidebarTrigger } from '@/renderer/components/ui/sidebar';
import { ShellScreen } from '@/renderer/components/workbench-shell/shell-screen';
import { openLocalProjectFlow } from '@/renderer/lib/workbench/open-local-project-flow';
import { SHELL_FLOATING_TRIGGER_CLASS } from '@/renderer/lib/workbench/shell-inset';
import {
	cloneDialogOpenAtom,
	localProjectImportDialogOpenAtom,
	quickStartDialogOpenAtom,
} from '@/renderer/state/dialogs';
import { lastWorkspaceSelectionAtom } from '@/renderer/state/workspace';

import { WelcomeActionCard } from './welcome/welcome-action-card';
import { WelcomeWordmark } from './welcome/welcome-wordmark';

/** Default landing view shown when no project/workspace is selected. */
export function Welcome() {
	const { t } = useTranslation();
	const navigate = useNavigate();
	const router = useRouter();
	const setCloneOpen = useSetAtom(cloneDialogOpenAtom);
	const localProjectImportOpen = useAtomValue(localProjectImportDialogOpenAtom);
	const setLocalProjectImportOpen = useSetAtom(
		localProjectImportDialogOpenAtom,
	);
	const setQuickStartOpen = useSetAtom(quickStartDialogOpenAtom);
	const setLastWorkspaceSelection = useSetAtom(lastWorkspaceSelectionAtom);
	// Warm the GitHub repo-list cache so CloneGithubDialog opens with
	// a populated list instead of an empty spinner. Result is intentionally
	// discarded; the dialog reads from the React Query cache.
	useQuery({
		...githubRepositoryListQuery,
		enabled: isEnsemblrApiAvailable(),
	});

	const onOpenLocalProject = useCallback(() => {
		void openLocalProjectFlow({
			navigate,
			router,
			setLastWorkspaceSelection,
			setLocalProjectImportOpen,
		});
	}, [navigate, router, setLastWorkspaceSelection, setLocalProjectImportOpen]);

	return (
		<ShellScreen className='min-h-0 items-center justify-center px-8 py-10'>
			{/* Frameless welcome screen has no toolbar; this invisible top strip
			    gives the window a draggable edge. Interactive children opt out of
			    dragging via the global no-drag rule in styles/index.css. */}
			<div
				aria-hidden='true'
				className='window-drag-region absolute inset-x-0 top-0 z-10 h-12'
			/>
			<SidebarTrigger className={SHELL_FLOATING_TRIGGER_CLASS} />
			<section className='flex flex-col items-center gap-12'>
				{/* fallow-ignore-next-line css-token-drift -- intentional sub-pixel blur softens the wordmark; no design token exists for it */}
				<WelcomeWordmark className='blur-[0.046875rem]' />
				<div className='flex flex-wrap items-center justify-center gap-3'>
					<WelcomeActionCard
						disabled={localProjectImportOpen}
						icon={FolderIcon}
						label={t('common:welcome.open-project', 'Open project')}
						onClick={onOpenLocalProject}
					/>
					<WelcomeActionCard
						icon={GlobeIcon}
						label={t(
							'common:welcome.open-github-project',
							'Open GitHub project',
						)}
						onClick={() => setCloneOpen(true)}
					/>
					<WelcomeActionCard
						icon={FolderPlusIcon}
						label={t('common:welcome.quick-start', 'Quick start')}
						onClick={() => setQuickStartOpen(true)}
					/>
				</div>
			</section>
		</ShellScreen>
	);
}
