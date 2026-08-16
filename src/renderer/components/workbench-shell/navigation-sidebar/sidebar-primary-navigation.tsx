import { HistoryIcon, LayoutDashboardIcon, SettingsIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import {
	SidebarGroup,
	SidebarGroupContent,
	SidebarMenu,
	SidebarSeparator,
} from '@/renderer/components/ui/sidebar';
import { LinearLogo } from '@/renderer/components/workbench-shell/source-provider-logo';
import type {
	WorkbenchActiveView,
	WorkbenchStaticNavigationTarget,
} from '@/renderer/types/workbench-shell';

import { StaticNavigationItem } from './static-navigation-item';

/** Top-of-sidebar static navigation group (dashboard, Linear, history, settings). */
export function SidebarPrimaryNavigation({
	activeView,
	onPrefetchIssues,
	onStaticNavigationSelect,
}: {
	activeView: WorkbenchActiveView;
	/** Warms the issue lists the dashboard and Issues views both read. */
	onPrefetchIssues: () => void;
	onStaticNavigationSelect: (target: WorkbenchStaticNavigationTarget) => void;
}) {
	const { t } = useTranslation();

	return (
		<>
			<SidebarGroup className='min-h-11.75 justify-center py-1'>
				<SidebarGroupContent>
					<SidebarMenu className='gap-1'>
						<StaticNavigationItem
							icon={<LayoutDashboardIcon aria-hidden='true' />}
							isActive={activeView === 'dashboard'}
							label={t(
								'workbench:navigation-sidebar.nav.dashboard',
								'Dashboard',
							)}
							onPrefetch={onPrefetchIssues}
							onSelect={onStaticNavigationSelect}
							target='dashboard'
						/>
						<StaticNavigationItem
							icon={<LinearLogo aria-hidden='true' className='size-3.5!' />}
							isActive={activeView === 'linear'}
							label={t('workbench:navigation-sidebar.nav.linear', 'Linear')}
							onPrefetch={onPrefetchIssues}
							onSelect={onStaticNavigationSelect}
							target='issues'
						/>
						<StaticNavigationItem
							icon={<HistoryIcon aria-hidden='true' />}
							isActive={activeView === 'history'}
							label={t('workbench:navigation-sidebar.nav.history', 'History')}
							onSelect={onStaticNavigationSelect}
							target='history'
						/>
						<StaticNavigationItem
							ariaLabel={t(
								'workbench:navigation-sidebar.nav.settings-aria',
								'Open app settings',
							)}
							icon={<SettingsIcon aria-hidden='true' />}
							isActive={activeView === 'settings'}
							label={t('workbench:navigation-sidebar.nav.settings', 'Settings')}
							onSelect={onStaticNavigationSelect}
							target='settings'
						/>
					</SidebarMenu>
				</SidebarGroupContent>
			</SidebarGroup>

			<SidebarSeparator className='mx-0 w-full' />
		</>
	);
}
