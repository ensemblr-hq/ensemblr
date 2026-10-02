import { EnsemblrWordmark } from '@/renderer/components/ensemblr-wordmark';
import { NavigationSidebarHeader } from '@/renderer/components/workbench-shell/navigation-sidebar/navigation-sidebar-header';
import { TRAFFIC_LIGHT_INSET_REM } from '@/shared/window-chrome';

import { MeasuredRow } from './measured-controls.tsx';
import { SceneSection } from './scene-chrome.tsx';
import { StubbedWorkbenchLayout } from './stubbed-workbench-layout.tsx';

/** The heights the wordmark is legible at, bracketing the shipped `h-3.5`. */
const WORDMARK_SIZES: readonly { className: string; label: string }[] = [
	{ className: 'h-2.5', label: 'h-2.5 · 10px — rows dropped' },
	{ className: 'h-3', label: 'h-3 · 12px — rows dropped' },
	{
		className: 'h-3.5',
		label:
			'h-3.5 · 14px — shipped, the site header, and the smallest that divides by 7',
	},
	{ className: 'h-4', label: 'h-4 · 16px — rows dropped' },
];

/**
 * The navigation sidebar's title-bar strip on both window chromes it has to
 * work under, since the running platform picks one and the app can never show
 * the other side by side.
 *
 * The wordmark exists because Linux and Windows leave the window's leading
 * corner empty — this is the only place to check that the mark reads at 14px
 * and that macOS still clears the traffic lights.
 */
export function NavigationSidebarHeaderScene() {
	return (
		<StubbedWorkbenchLayout>
			<div className='flex flex-col gap-8'>
				<ChromeStates />
				<WordmarkSizes />
			</div>
		</StubbedWorkbenchLayout>
	);
}

/** The strip under each platform's leading window chrome. */
function ChromeStates() {
	return (
		<SceneSection
			label='sidebar title bar — NavigationSidebarHeader'
			note='the h-12 strip above the navigation; the wordmark fills the corner only where the platform draws nothing there'
		>
			<MeasuredRow
				label='Linux / Windows — no leading window chrome'
				note='the corner is the app’s, so the wordmark takes it'
			>
				<SidebarSurface>
					<NavigationSidebarHeader showsWordmark={true} />
				</SidebarSurface>
			</MeasuredRow>

			<MeasuredRow
				label='macOS — system traffic lights'
				note={`the system owns the leading ${TRAFFIC_LIGHT_INSET_REM}rem, so the strip stays bare`}
			>
				<SidebarSurface>
					<div className='relative'>
						<NavigationSidebarHeader showsWordmark={false} />
						<TrafficLightStandIn />
					</div>
				</SidebarSurface>
			</MeasuredRow>
		</SceneSection>
	);
}

/** The mark on its own, to judge weight against the navigation below it. */
function WordmarkSizes() {
	return (
		<SceneSection
			label='wordmark — EnsemblrWordmark'
			note='ensemblr.dev’s 47×7 pixel grid: crispEdges snaps each cell to a device pixel, so only a whole multiple of 7px keeps every row of the letters'
		>
			{WORDMARK_SIZES.map(({ className, label }) => (
				<MeasuredRow key={className} label={label}>
					<div className='flex items-center gap-6 rounded-md bg-sidebar px-3 py-2.5 text-sidebar-foreground'>
						<EnsemblrWordmark className={className} />
						<EnsemblrWordmark
							className={`${className} text-sidebar-foreground/65`}
						/>
						<EnsemblrWordmark
							className={`${className} text-muted-foreground`}
						/>
					</div>
				</MeasuredRow>
			))}
		</SceneSection>
	);
}

/** The sidebar's own background, which the header inherits rather than sets. */
function SidebarSurface({ children }: { children: React.ReactNode }) {
	return (
		<div className='w-64 overflow-hidden rounded-md border border-sidebar-border bg-sidebar text-sidebar-foreground'>
			{children}
		</div>
	);
}

/**
 * Stands in for the traffic lights AppKit draws over the strip, which no
 * browser can render — without them the macOS row looks like an empty bar
 * rather than a corner that is already spoken for.
 */
function TrafficLightStandIn() {
	return (
		<div className='pointer-events-none absolute inset-y-0 left-0 flex items-center gap-2 pl-3.5'>
			<span className='size-3 rounded-full bg-foreground/20' />
			<span className='size-3 rounded-full bg-foreground/20' />
			<span className='size-3 rounded-full bg-foreground/20' />
		</div>
	);
}
