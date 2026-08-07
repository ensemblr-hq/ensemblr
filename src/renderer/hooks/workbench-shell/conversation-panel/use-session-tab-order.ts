import { useEffect, useMemo, useRef, useState } from 'react';

import {
	areStringArraysEqual,
	reconcileOrderedIdsByCanonicalSlot,
} from '@/renderer/lib/ordered-ids';
import type { SessionTabModel } from '@/renderer/types/workbench';

/**
 * Drag order for the session tab strip. Local order tracks motion's in-drag
 * moves so tabs follow the pointer, and reconciles against the canonical session
 * list whenever tabs are opened or closed elsewhere. The committed order is only
 * pushed back to the workspace controller once the drag ends and actually
 * changed something.
 * @param onSessionTabsReorder - Commits a finished drag to the tab controller
 * @param sessions - The workspace's open session tabs, in canonical order
 * @returns The rendered order, drag handlers, and a session lookup by id
 */
export function useSessionTabOrder({
	onSessionTabsReorder,
	sessions,
}: {
	onSessionTabsReorder: (
		sessionIds: string[],
		draggedSessionId: string,
	) => void;
	sessions: SessionTabModel[];
}) {
	const sessionIds = useMemo(
		() => sessions.map((session) => session.id),
		[sessions],
	);
	const [orderedSessionIds, setOrderedSessionIds] =
		useState<string[]>(sessionIds);
	const [prevSessionIds, setPrevSessionIds] = useState(sessionIds);
	const [isDraggingTab, setIsDraggingTab] = useState(false);
	const orderedSessionIdsRef = useRef(orderedSessionIds);
	const canReorderTabs = sessionIds.length > 1;

	useEffect(() => {
		orderedSessionIdsRef.current = orderedSessionIds;
	}, [orderedSessionIds]);

	if (prevSessionIds !== sessionIds) {
		setPrevSessionIds(sessionIds);
		setOrderedSessionIds((currentIds) => {
			const nextIds = reconcileOrderedIdsByCanonicalSlot(
				currentIds,
				sessionIds,
			);
			return areStringArraysEqual(nextIds, currentIds) ? currentIds : nextIds;
		});
	}

	return {
		canReorderTabs,
		/** Applies motion's in-drag order to local state while the user moves a tab. */
		handleReorder: (nextIds: string[]) => {
			if (!canReorderTabs) {
				return;
			}
			orderedSessionIdsRef.current = nextIds;
			setOrderedSessionIds(nextIds);
		},
		/**
		 * Commits the final dragged order to the workspace tab controller, naming the
		 * tab the drag was pointed at so the controller can tell a deliberate
		 * placement from a tab that was merely pushed aside.
		 */
		handleReorderEnd: (draggedSessionId: string) => {
			setIsDraggingTab(false);
			if (!canReorderTabs) {
				return;
			}
			const nextIds = orderedSessionIdsRef.current;
			if (areStringArraysEqual(nextIds, sessionIds)) {
				return;
			}
			onSessionTabsReorder(nextIds, draggedSessionId);
		},
		/** Hides hover-only controls while a tab is being reordered. */
		handleReorderStart: () => {
			if (!canReorderTabs) {
				return;
			}
			setIsDraggingTab(true);
		},
		isDraggingTab,
		orderedSessionIds,
		sessionById: useMemo(
			() => new Map(sessions.map((session) => [session.id, session] as const)),
			[sessions],
		),
	};
}
