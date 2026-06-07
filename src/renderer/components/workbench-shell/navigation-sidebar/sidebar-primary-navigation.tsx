import {
	CircleHelpIcon,
	HistoryIcon,
	LayoutDashboardIcon,
	SettingsIcon,
} from 'lucide-react';

import {
	SidebarGroup,
	SidebarGroupContent,
	SidebarMenu,
	SidebarSeparator,
} from '@/renderer/components/ui/sidebar';
import type {
	WorkbenchActiveView,
	WorkbenchStaticNavigationTarget,
} from '@/renderer/types/workbench-shell';

import { StaticNavigationItem } from './static-navigation-item';

/** Top-of-sidebar static navigation group (dashboard, history, settings, help). */
export function SidebarPrimaryNavigation({
	activeView,
	onStaticNavigationSelect,
}: {
	activeView: WorkbenchActiveView;
	onStaticNavigationSelect: (target: WorkbenchStaticNavigationTarget) => void;
}) {
	return (
		<>
			<SidebarGroup className='min-h-11.75 justify-center py-1'>
				<SidebarGroupContent>
					<SidebarMenu className='gap-1'>
						<StaticNavigationItem
							icon={<LayoutDashboardIcon aria-hidden='true' />}
							isActive={activeView === 'dashboard'}
							label='Dashboard'
							onSelect={onStaticNavigationSelect}
							target='dashboard'
						/>
						<StaticNavigationItem
							icon={<HistoryIcon aria-hidden='true' />}
							isActive={activeView === 'history'}
							label='History'
							onSelect={onStaticNavigationSelect}
							target='history'
						/>
						<StaticNavigationItem
							ariaLabel='Open app settings'
							icon={<SettingsIcon aria-hidden='true' />}
							isActive={activeView === 'settings'}
							label='Settings'
							onSelect={onStaticNavigationSelect}
							target='settings'
						/>
						<StaticNavigationItem
							ariaLabel='Open help'
							icon={<CircleHelpIcon aria-hidden='true' />}
							isActive={activeView === 'help'}
							label='Help'
							onSelect={onStaticNavigationSelect}
							target='help'
						/>
					</SidebarMenu>
				</SidebarGroupContent>
			</SidebarGroup>

			<SidebarSeparator className='mx-0 w-full' />
		</>
	);
}
