import { useQuery } from '@tanstack/react-query';
import { useAtom } from 'jotai';
import {
	type KeyboardEvent as ReactKeyboardEvent,
	useCallback,
	useEffect,
	useMemo,
	useState,
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
import { useConciergeRestoreOnOutsidePress } from '@/renderer/hooks/concierge/use-concierge-restore-on-outside-press';
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
	conciergePreviewAtom,
} from '@/renderer/state/concierge';
import { useMenuCommand } from '@/renderer/state/menu-commands';
import type { KeymapBinding } from '@/renderer/types/keymap';
import type { ClearConciergeContextRequest } from '@/shared/ipc/contracts/concierge';

/** Everything the Concierge panel renders from, already resolved. */
export interface ConciergePanelModel {
	anchor: ConciergeAnchoredSurface<HTMLElement>;
	/** Clears the context, asking first when a turn is streaming. */
	clearContext: () => void;
	/** The confirmation a clear raised mid-turn, and the two ways out of it. */
	clearConfirmation: {
		cancel: () => void;
		confirm: () => void;
		open: boolean;
	};
	/** Dismisses a preview if one is up, and otherwise closes the panel. For ⎋. */
	close: () => void;
	/** Closes the panel outright, preview and all. For the header's Close button. */
	closePanel: () => void;
	dismissBanner: () => void;
	handleKeyDown: (event: ReactKeyboardEvent<HTMLElement>) => void;
	/** The shell's content area, or null while the panel is not maximized. */
	insetRect: ShellInsetRect | null;
	isFullscreen: boolean;
	presentation: ConciergePresentation;
	/** Clears the context for a stated reason, asking first when a turn is streaming. */
	requestClear: (request: ClearConciergeContextRequest) => void;
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
	const [preview, setPreview] = useAtom(conciergePreviewAtom);
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

	// Held rather than acted on while a turn is streaming: a clear replaces the
	// conversation, so mid-answer it throws away work the user is watching arrive.
	// The reason rides along so the confirmed clear is still recorded as the one
	// the user asked for.
	const [pendingClear, setPendingClear] =
		useState<ClearConciergeContextRequest | null>(null);

	const requestClear = useCallback(
		(request: ClearConciergeContextRequest) => {
			if (session.isStreaming) {
				setPendingClear(request);
				return;
			}
			void session.clear(request);
		},
		[session.clear, session.isStreaming],
	);

	const clearContext = useCallback(
		() => requestClear({ reason: 'manual' }),
		[requestClear],
	);
	useMenuCommand('concierge.clear', clearContext, isOpen);

	const confirmClear = useCallback(() => {
		const request = pendingClear;
		setPendingClear(null);
		if (request) {
			void session.clear(request);
		}
	}, [pendingClear, session.clear]);
	const cancelClear = useCallback(() => setPendingClear(null), []);

	const closePanel = useCallback(() => {
		setPreview(null);
		setPresentation('closed');
	}, [setPresentation, setPreview]);

	// A preview is the innermost thing on screen, so ⎋ dismisses it before it
	// reaches the panel — closing the whole Concierge to get back to a transcript
	// the user never left is one keystroke doing two jobs. The header's button is
	// not this: it is labelled Close, the preview carries its own dismiss two rows
	// below it, and a button that needs pressing twice to do what it says is worse
	// than a chord that does one thing at a time.
	const close = useCallback(() => {
		if (preview) {
			setPreview(null);
			return;
		}
		closePanel();
	}, [closePanel, preview, setPreview]);
	const toggleFullscreen = useCallback(
		() => setPresentation(isFullscreen ? 'panel' : 'fullscreen'),
		[isFullscreen, setPresentation],
	);
	const restoreFromFullscreen = useCallback(
		() => setPresentation('panel'),
		[setPresentation],
	);
	useConciergeRestoreOnOutsidePress(
		isFullscreen,
		anchor.ref,
		restoreFromFullscreen,
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
		clearConfirmation: {
			cancel: cancelClear,
			confirm: confirmClear,
			open: pendingClear !== null,
		},
		clearContext,
		close,
		closePanel,
		dismissBanner,
		handleKeyDown,
		insetRect,
		isFullscreen,
		presentation,
		requestClear,
		resize,
		session,
		showClearBanner:
			!bannerDismissed && (pressure.data?.overThreshold ?? false),
		toggleFullscreen,
	};
}
