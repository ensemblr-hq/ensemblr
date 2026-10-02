import { StatusBadge } from '@/renderer/components/status-badge';
import { UpdatePanel } from '@/renderer/components/workbench-shell/navigation-sidebar/update-panel';
import { resolveUpdatePanelKind } from '@/renderer/state/updates';
import type { UpdateStatusSnapshot } from '@/shared/ipc/contracts/update';

import { SceneSection } from './scene-chrome.tsx';
import { UPDATE_PANEL_SNAPSHOTS } from './update-panel-fixtures.ts';

/**
 * Updater calls that resolve without doing anything, so the scene shows the
 * panel's busy state under a click without a bridge behind it.
 */
const INERT_ACTIONS = {
	check: () => Promise.resolve(),
	install: () => Promise.resolve(),
};

/**
 * The standing update offer the navigation sidebar pins to its own footer, in
 * every updater state it has to survive.
 *
 * There is no dismiss, so the states it must *not* appear in matter as much as
 * the ones it must: the last four rows are the exits — installed, switched off
 * in Settings, a background failure with nothing to act on — and each has to
 * leave the sidebar with no footer at all where the panel was.
 */
export function UpdatePanelScene() {
	return (
		<SceneSection
			label='sidebar update panel — UpdatePanel'
			note='pinned to the navigation sidebar’s footer at the shipped 16rem width; it leaves only when the update is installed or automatic updates are switched off in Settings → General'
		>
			<div className='flex flex-wrap items-start gap-4'>
				{UPDATE_PANEL_SNAPSHOTS.map((fixture) => (
					<PanelRow
						key={fixture.label}
						label={fixture.label}
						note={fixture.note}
						snapshot={fixture.snapshot}
					/>
				))}
			</div>
		</SceneSection>
	);
}

/**
 * One updater state in situ, with a badge saying whether the classifier let the
 * panel through — the rows that render nothing are results, not gaps.
 */
function PanelRow({
	label,
	note,
	snapshot,
}: {
	label: string;
	note: string;
	snapshot: UpdateStatusSnapshot;
}) {
	const kind = resolveUpdatePanelKind(snapshot);

	return (
		<section className='flex w-64 flex-col gap-1.5'>
			<div className='flex items-baseline gap-2'>
				<h3 className='font-mono text-muted-foreground text-xxs uppercase tracking-wide'>
					{snapshot.state}
				</h3>
				<StatusBadge tone={kind ? 'ok' : 'muted'}>
					{kind ?? 'no panel'}
				</StatusBadge>
			</div>
			<p className='text-muted-foreground text-xxs leading-4'>{note}</p>
			<SidebarFooterSurface hasPanel={kind !== null}>
				{kind ? (
					<UpdatePanel
						actions={INERT_ACTIONS}
						kind={kind}
						onOpenRelease={() => undefined}
						snapshot={snapshot}
					/>
				) : null}
			</SidebarFooterSurface>
			<p className='text-muted-foreground text-xxs leading-4'>{label}</p>
		</section>
	);
}

/**
 * The sidebar column the panel sits at the bottom of. The footer rule appears
 * only alongside a panel, because the shipped wrapper returns null wholesale —
 * a row with no update has no footer to draw, not an empty one.
 */
function SidebarFooterSurface({
	children,
	hasPanel,
}: {
	children: React.ReactNode;
	hasPanel: boolean;
}) {
	return (
		<div className='flex min-h-32 flex-col justify-end rounded-md border border-sidebar-border bg-sidebar text-sidebar-foreground'>
			<div className={hasPanel ? 'border-sidebar-border border-t p-2' : ''}>
				{children}
			</div>
		</div>
	);
}
