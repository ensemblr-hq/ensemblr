import { createFileRoute } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';

import { LinearIssueList } from '@/renderer/components/linear/issue-list';
import { LinearConnectionGate } from '@/renderer/components/linear/linear-connection-gate';
import { SidebarInset, SidebarTrigger } from '@/renderer/components/ui/sidebar';
import { SHELL_INSET_CLASS } from '@/renderer/lib/workbench/shell-inset';

/** Linear issue browse route (list, search, and filters). */
export const Route = createFileRoute('/_workbench/_shell/linear/')({
	component: LinearBrowseRoute,
	staticData: {
		workbenchView: 'linear',
	},
});

/** Linear issue browse view (list + search + filters). */
function LinearBrowseRoute() {
	const { t } = useTranslation();

	return (
		<SidebarInset className={SHELL_INSET_CLASS}>
			<main className='flex min-w-0 flex-1 flex-col overflow-hidden'>
				<header className='native-toolbar flex h-12 shrink-0 items-center gap-2.5 border-border border-b px-4 font-medium text-sm'>
					<SidebarTrigger className='sidebar-collapsed-trigger' />
					<span>{t('linear:browse.title', 'Linear issues')}</span>
				</header>
				<div className='min-h-0 flex-1 overflow-y-auto px-6 py-5'>
					<div className='mx-auto flex w-full max-w-4xl flex-col'>
						<LinearConnectionGate>
							<LinearIssueList />
						</LinearConnectionGate>
					</div>
				</div>
			</main>
		</SidebarInset>
	);
}
