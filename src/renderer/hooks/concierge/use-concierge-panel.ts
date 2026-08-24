import { useQuery } from '@tanstack/react-query';
import { useAtom } from 'jotai';
import {
	type KeyboardEvent as ReactKeyboardEvent,
	useCallback,
	useEffect,
	useMemo,
} from 'react';

import { conciergeContextPressureQuery } from '@/renderer/api/ensemblr';
import {
	type ConciergeAnchoredSurface,
	useConciergeAnchor,
} from '@/renderer/hooks/concierge/use-concierge-anchor';
import {
	type ConciergeResizableSurface,
	useConciergeResize,
} from '@/renderer/hooks/concierge/use-concierge-resize';
import {
	type ConciergeSessionModel,
	useConciergeSession,
} from '@/renderer/hooks/concierge/use-concierge-session';
import {
	type ShellInsetRect,
	useShellInsetRect,
} from '@/renderer/hooks/concierge/use-shell-inset-rect';
import { useKeymapHandler } from '@/renderer/hooks/use-keymap-handler';
import {
	type ConciergePresentation,
	conciergeClearBannerDismissedAtom,
	conciergePresentationAtom,
} from '@/renderer/state/concierge';
import { useMenuCommand } from '@/renderer/state/menu-commands';
import type { KeymapBinding } from '@/renderer/types/keymap';

/** Everything the Concierge panel renders from, already resolved. */
export interface ConciergePanelModel {
	anchor: ConciergeAnchoredSurface<HTMLElement>;
	clearContext: () => void;
	close: () => void;
	dismissBanner: () => void;
	handleKeyDown: (event: ReactKeyboardEvent<HTMLElement>) => void;
	/** The shell's content area, or null while the panel is not maximized. */
	insetRect: ShellInsetRect | null;
	isFullscreen: boolean;
	presentation: ConciergePresentation;
	/** The docked panel's size, and the handles that change it. */
	resize: ConciergeResizableSurface;
	session: ConciergeSessionModel;
	/** Whether the context is full enough to offer a clear the user did not ask for. */
	showClearBanner: boolean;
	toggleFullscreen: () => void;
}

/**
 * Drives the Concierge panel: opens its session, watches how full the context
 * is, places the card, and binds the two chords that need a live conversation.
 *
 * Split from the component so the panel is left rendering a resolved model
 * rather than doing its own fetching and wiring between JSX branches.
 *
 * Both chords are bound to the panel rather than to the window: closing on ⎋
 * from a window listener would take the key from every dialog and popover in
 * the app, and clearing from one would throw away the conversation while the
 * user was typing in a workspace chat with the Concierge merely open behind it.
 * The composer's own handler runs first on the way up and marks the autocomplete
 * case as handled, so dismissing a slash list does not also close the panel.
 * @returns The resolved panel model.
 */
export function useConciergePanel(): ConciergePanelModel {
	const [presentation, setPresentation] = useAtom(conciergePresentationAtom);
	const [bannerDismissed, setBannerDismissed] = useAtom(
		conciergeClearBannerDismissedAtom,
	);
	const isOpen = presentation !== 'closed';
	const isFullscreen = presentation === 'fullscreen';
	const session = useConciergeSession(isOpen);
	const insetRect = useShellInsetRect(isFullscreen);
	const pressure = useQuery({
		...conciergeContextPressureQuery,
		enabled: isOpen,
	});

	const resize = useConciergeResize({ enabled: !isFullscreen });
	const anchor = useConciergeAnchor<HTMLElement>({
		enabled: !isFullscreen,
		externalRef: resize.ref,
		size: resize.size,
		suspended: resize.isResizing,
	});

	const clearContext = useCallback(() => {
		void session.clear({ reason: 'manual' });
	}, [session.clear]);
	useMenuCommand('concierge.clear', clearContext, isOpen);

	const close = useCallback(() => setPresentation('closed'), [setPresentation]);
	const toggleFullscreen = useCallback(
		() => setPresentation(isFullscreen ? 'panel' : 'fullscreen'),
		[isFullscreen, setPresentation],
	);

	const panelBindings = useMemo<readonly KeymapBinding<HTMLElement>[]>(
		() => [
			[
				'concierge.clear',
				() => {
					clearContext();
					return true;
				},
			],
			[
				'concierge.close',
				() => {
					close();
					return true;
				},
			],
		],
		[clearContext, close],
	);
	const handlePanelKeys = useKeymapHandler(panelBindings);
	const handleKeyDown = useCallback(
		(event: ReactKeyboardEvent<HTMLElement>) => {
			if (event.defaultPrevented) {
				return;
			}
			handlePanelKeys(event);
		},
		[handlePanelKeys],
	);

	const dismissBanner = useCallback(
		() => setBannerDismissed(true),
		[setBannerDismissed],
	);

	const panelRef = anchor.ref;
	useEffect(() => {
		// The composer takes focus from the handoff the launcher drives; the panel
		// itself is the fallback for a composer that cannot take it — disabled while
		// the session opens — so the two chords above still have a target.
		const node = isOpen ? panelRef.current : null;
		if (node && !node.contains(document.activeElement)) {
			node.focus();
		}
	}, [isOpen, panelRef]);

	return {
		anchor,
		clearContext,
		close,
		dismissBanner,
		handleKeyDown,
		insetRect,
		isFullscreen,
		presentation,
		resize,
		session,
		showClearBanner:
			!bannerDismissed && (pressure.data?.overThreshold ?? false),
		toggleFullscreen,
	};
}
