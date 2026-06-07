import { FolderIcon, FolderPlusIcon, GlobeIcon } from 'lucide-react';
import { useState } from 'react';

import { SidebarInset } from '@/renderer/components/ui/sidebar';
import type { RecentGithubRepo } from '@/renderer/types/workbench';

import { CloneGithubDialog } from './dashboard-welcome/clone-github-dialog';
import { WelcomeActionCard } from './dashboard-welcome/welcome-action-card';
import { WelcomeWordmark } from './dashboard-welcome/welcome-wordmark';

interface DashboardWelcomeProps {
	recentGithubRepos: RecentGithubRepo[];
}

/** Default landing view shown when no project/workspace is selected. */
export function DashboardWelcome({ recentGithubRepos }: DashboardWelcomeProps) {
	const [cloneOpen, setCloneOpen] = useState(false);

	return (
		<SidebarInset className='flex h-svh min-h-svh overflow-hidden bg-background text-foreground'>
			<main className='flex min-h-0 flex-1 items-center justify-center px-8 py-10'>
				<section className='flex flex-col items-center gap-12'>
					<WelcomeWordmark />
					<div className='flex flex-wrap items-center justify-center gap-3'>
						<WelcomeActionCard
							icon={FolderIcon}
							label='Open project'
							onClick={() => {
								/* TODO: open native macOS folder picker (showOpenDialog) */
							}}
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
				</section>
			</main>

			<CloneGithubDialog
				onOpenChange={setCloneOpen}
				open={cloneOpen}
				recentRepos={recentGithubRepos}
			/>
		</SidebarInset>
	);
}
