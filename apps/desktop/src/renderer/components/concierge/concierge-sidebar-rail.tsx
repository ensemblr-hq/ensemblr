import { useTranslation } from 'react-i18next';

import { useSidebar } from '@/renderer/components/ui/sidebar';
import { conciergeSidebarEdgeLabel } from '@/renderer/lib/concierge';
import { cn } from '@/renderer/lib/utils';

/**
 * The hover strip along the maximized panel's leading edge that opens and
 * closes the navigation sidebar.
 *
 * Maximized, the panel covers the sidebar's own rail — the strip every other
 * screen lets you hover and click — so it carries one along the same edge,
 * lighting the same rule the shell's does: the sidebar's border while it is
 * open, the panel's own edge once it is closed.
 */
export function ConciergeSidebarRail() {
	const { t } = useTranslation();
	const { state: sidebarState, toggleSidebar } = useSidebar();
	const sidebarIsCollapsed = sidebarState === 'collapsed';
	const label = conciergeSidebarEdgeLabel(sidebarIsCollapsed, t);

	return (
		<button
			aria-label={label}
			className={cn(
				'absolute inset-y-0 left-0 z-10 hidden w-2 transition-all ease-linear after:absolute after:inset-y-0 after:w-0.5 hover:after:bg-sidebar-border sm:block',
				sidebarIsCollapsed
					? 'after:left-full after:-translate-x-px hover:bg-sidebar'
					: 'after:-left-px',
			)}
			onClick={toggleSidebar}
			tabIndex={-1}
			title={label}
			type='button'
		/>
	);
}
