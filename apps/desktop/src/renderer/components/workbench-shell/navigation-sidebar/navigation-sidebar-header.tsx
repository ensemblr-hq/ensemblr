import { EnsemblrWordmark } from '@/renderer/components/ensemblr-wordmark';
import {
	SidebarHeader,
	SidebarTrigger,
} from '@/renderer/components/ui/sidebar';
import { cn } from '@/renderer/lib/utils';
import { TOOLBAR_HEIGHT_CLASS } from '@/renderer/lib/workbench/shell-inset';

/**
 * The sidebar's title-bar strip: the collapse trigger, and — where the platform
 * leaves the window's leading corner to the app — the Ensemblr wordmark.
 *
 * macOS parks the traffic lights in that corner, so there the strip stays bare
 * rather than crowding them; everywhere else the corner is empty and the bar
 * reads as an unexplained gap above the navigation. Full screen takes the
 * traffic lights away, which hands macOS the same empty corner and the same
 * wordmark to fill it with.
 *
 * Not mounted at all where Ensemblr draws its own title bar: the wordmark is
 * already up there, which leaves a strip carrying nothing but the collapse
 * trigger — a second bare band directly under the first. The trigger moves to
 * the content toolbar instead, which the `sidebar-collapsed-trigger` rule keeps
 * visible there whether or not the sidebar is open.
 */
export function NavigationSidebarHeader({
	showsWordmark,
}: {
	showsWordmark: boolean;
}) {
	return (
		<SidebarHeader
			className={cn('border-sidebar-border border-b p-0', TOOLBAR_HEIGHT_CLASS)}
		>
			<div className='window-chrome-spacer flex h-full shrink-0 items-center justify-end gap-2 px-2'>
				{showsWordmark ? (
					<EnsemblrWordmark className='mr-auto ml-1.5 h-3.5 text-sidebar-foreground/65' />
				) : null}
				<SidebarTrigger />
			</div>
		</SidebarHeader>
	);
}
