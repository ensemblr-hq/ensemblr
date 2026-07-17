import { cn } from '@/renderer/lib/utils';
import type { WorkspaceDockActivityState } from '@/renderer/state/workspace';

/** Sidebar status dot: yellow while a setup script runs, green for other running dock activity. */
export function DockActivityDot({
	state,
}: {
	state: WorkspaceDockActivityState;
}) {
	return (
		<span
			aria-hidden='true'
			className={cn(
				'size-2 rounded-full ring-2 ring-sidebar',
				state === 'setup-running' ? 'bg-status-warning' : 'bg-status-ok',
			)}
			data-workspace-dock-activity={state}
			title='Dock activity running'
		/>
	);
}
