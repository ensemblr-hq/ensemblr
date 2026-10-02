import { useMatches, useNavigate } from '@tanstack/react-router';
import { atom, useAtom, useSetAtom } from 'jotai';
import { useEffect } from 'react';

import {
	subscribeFocusChatRequests,
	subscribeFocusConciergeRequests,
} from '@/renderer/api/ensemblr';
import { conciergePresentationAtom } from '@/renderer/state/concierge';

import type { UnreadChatRef } from './entries';

/** Layout route whose shell mounts the bridge that drains a parked request. */
const SHELL_ROUTE_ID = '/_workbench/_shell';

/**
 * The chat a clicked desktop notification asked for, parked until the workbench
 * shell can route to it. In-memory and single-slot: a second click before the
 * first is drained supersedes it, which is what the user meant by clicking it.
 */
export const pendingNotificationFocusAtom = atom<UnreadChatRef | null>(null);

/**
 * Whether a clicked Concierge notification is still waiting for the shell to
 * come back. The panel itself needs no request parked — opening it is one atom —
 * but the launcher that renders it only exists under the shell route, so the trip
 * back is derived from this exactly as the chat's is from its own request.
 */
const pendingConciergeFocusAtom = atom(false);

/**
 * Takes notification clicks at the app root and parks the chat they name for the
 * shell to open, sending the window back to the shell when it is somewhere else.
 *
 * The subscription cannot live in the shell alone. `/settings/*` and
 * `/onboarding` are siblings of the shell route rather than descendants, so a
 * click that arrives while one of those is open would reach no listener at all
 * and the notification would look dead. Parking the request survives the
 * navigation back, and the shell's bridge picks it up as it mounts.
 *
 * The trip back to the shell is derived from the parked request rather than
 * decided inside the click handler. A handler reads the route one commit late,
 * so a click landing in the same tick as a move into settings would see the
 * shell as still mounted and skip the redirect — leaving the request parked with
 * nothing left to drain it. Deriving it also pushes back a request that is still
 * parked when the window leaves the shell later.
 *
 * A clicked Concierge notification takes the same trip for the same reason. What
 * it does on arrival is simpler: the panel is one atom away, and every window
 * opens its own rather than one being sent somewhere.
 */
export function useNotificationFocusSync(): void {
	const navigate = useNavigate();
	const [pendingFocus, setPendingFocus] = useAtom(pendingNotificationFocusAtom);
	const [pendingConciergeFocus, setPendingConciergeFocus] = useAtom(
		pendingConciergeFocusAtom,
	);
	const setConciergePresentation = useSetAtom(conciergePresentationAtom);
	const isShellMounted = useMatches({
		select: (matches) =>
			matches.some((match) => match.routeId === SHELL_ROUTE_ID),
	});

	useEffect(() => {
		if ((pendingFocus || pendingConciergeFocus) && !isShellMounted) {
			void navigate({ to: '/' });
		}
	}, [isShellMounted, navigate, pendingConciergeFocus, pendingFocus]);

	useEffect(() => {
		if (pendingConciergeFocus && isShellMounted) {
			setPendingConciergeFocus(false);
		}
	}, [isShellMounted, pendingConciergeFocus, setPendingConciergeFocus]);

	useEffect(
		() =>
			subscribeFocusChatRequests((payload) => {
				setPendingFocus({
					agentSessionId: payload.agentSessionId,
					chatTabId: payload.chatTabId,
					workspaceId: payload.workspaceId,
				});
			}),
		[setPendingFocus],
	);

	useEffect(
		() =>
			subscribeFocusConciergeRequests(() => {
				setConciergePresentation('panel');
				setPendingConciergeFocus(true);
			}),
		[setConciergePresentation, setPendingConciergeFocus],
	);
}
