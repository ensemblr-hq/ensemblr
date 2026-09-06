import { useState } from 'react';

import { SidebarFooter } from '@/renderer/components/ui/sidebar';
import {
	resolveUpdatePanelKind,
	useUpdateActions,
	useUpdateStatus,
} from '@/renderer/state/updates';

import { UpdatePanel } from './update-panel';

/**
 * The update panel wired to the running app: main's snapshot and the updater's
 * own actions.
 *
 * Kept apart from {@link UpdatePanel} so the panel itself stays drivable from a
 * fixture — every state it has to look right in is one main reaches on its own
 * schedule, which no playground can wait for. The footer chrome lives here
 * rather than in the panel so that a sidebar with no update to report shows no
 * bordered strip where the panel would have been.
 *
 * The live region wraps the slot rather than the panel, and so stays mounted
 * whether or not there is an update: a region that arrives with its own content
 * is not a change to anything assistive tech was watching, and announces
 * nothing.
 */
export function SidebarUpdatePanel() {
	const snapshot = useUpdateStatus();
	const actions = useUpdateActions();
	const kind = resolveUpdatePanelKind(snapshot);
	// Main passes through `checking` on every re-check, including the one the
	// panel's own retry button starts. Holding the last shape keeps the panel
	// still for the round trip instead of unmounting it under the click.
	const isRechecking = snapshot?.state === 'checking';
	const [heldKind, setHeldKind] = useState(kind);
	if (heldKind !== kind && !isRechecking) {
		setHeldKind(kind);
	}
	const shownKind = isRechecking ? heldKind : kind;

	return (
		<div aria-live='polite'>
			{shownKind && snapshot ? (
				<SidebarFooter className='border-sidebar-border border-t p-2'>
					<UpdatePanel
						actions={actions}
						kind={shownKind}
						onOpenRelease={(releaseUrl) =>
							void window.ensemblr?.openExternal(releaseUrl)
						}
						snapshot={snapshot}
					/>
				</SidebarFooter>
			) : null}
		</div>
	);
}
