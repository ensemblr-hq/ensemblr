import { atom } from 'jotai';
import { atomWithStorage } from 'jotai/utils';
import type { AgentProviderId } from '@/shared/agent-provider';

/** Where a draggable Concierge surface sits, as a viewport offset. */
export interface ConciergePoint {
	x: number;
	y: number;
}

/**
 * Sentinel for "never moved", so the Concierge can dock itself to the
 * bottom-right corner on first paint and stay there through a resize — which a
 * stored coordinate could not do, having no way to say it was a default.
 */
export const CONCIERGE_UNPLACED: ConciergePoint = { x: -1, y: -1 };

/**
 * How much of the screen the Concierge is taking. `closed` shows only the
 * launcher bubble, `panel` the docked card, `fullscreen` the whole shell.
 */
export type ConciergePresentation = 'closed' | 'fullscreen' | 'panel';

/** Current Concierge presentation. Ephemeral: it resets with the window. */
export const conciergePresentationAtom = atom<ConciergePresentation>('closed');

/** The open Concierge session: what it is, where it runs, and on which runtime. */
export interface ConciergeSessionIdentity {
	/** The Concierge home the session runs in, which its composer resolves against. */
	cwd: string;
	id: string;
	provider: AgentProviderId;
}

/**
 * The Concierge session the panel is showing, or null before it opens. Held here
 * rather than in the panel so the launcher can read live state without mounting
 * the panel.
 *
 * All three fields travel together because the panel does not survive a visit to
 * Settings: `/_workbench/settings/*` is a sibling of the shell layout the
 * launcher mounts in, so that subtree unmounts and anything held in component
 * state comes back empty while an id kept here survives. A session whose cwd went
 * missing that way disables the composer with nothing on screen to explain it.
 */
export const conciergeSessionAtom = atom<ConciergeSessionIdentity | null>(null);

/**
 * Whether the automatic-clear banner has been dismissed for the current session.
 * Reset whenever a new session opens, so the next threshold crossing asks again.
 */
export const conciergeClearBannerDismissedAtom = atom(false);

/** Opens the Concierge in its docked panel, or closes it when already open. */
export const toggleConciergeAtom = atom(null, (get, set) => {
	set(
		conciergePresentationAtom,
		get(conciergePresentationAtom) === 'closed' ? 'panel' : 'closed',
	);
});

/**
 * Takes the Concierge over the shell's content area, or puts it back in its
 * docked card. A closed Concierge maximizes straight from closed, so the
 * shortcut and the menu item do not need the panel open first.
 */
export const toggleConciergeFullscreenAtom = atom(null, (get, set) => {
	set(
		conciergePresentationAtom,
		get(conciergePresentationAtom) === 'fullscreen' ? 'panel' : 'fullscreen',
	);
});

/**
 * Puts a maximized Concierge back in its docked card, leaving it alone in every
 * other presentation. What the panel does when it sends the user somewhere in
 * the shell — a file it named, opened in the workspace that holds it — since
 * maximized it would otherwise be covering the surface it just opened.
 */
export const restoreConciergePanelAtom = atom(null, (get, set) => {
	if (get(conciergePresentationAtom) === 'fullscreen') {
		set(conciergePresentationAtom, 'panel');
	}
});

/**
 * Nonce the Concierge composer focuses on. Counted rather than flagged so two
 * requests in a row are distinct events, and the composer refocuses on the
 * second instead of reading an already-set flag and doing nothing.
 */
export const conciergeComposerFocusRequestAtom = atom(0);

/**
 * Opens the Concierge if it is closed and asks its composer for focus.
 *
 * Written as one action rather than left to the caller because the composer
 * mounts with the panel: a request raised while the Concierge is shut has
 * nobody to consume it, and the nonce it leaves behind would fire the next time
 * the panel opened for an unrelated reason.
 */
export const focusConciergeComposerAtom = atom(null, (get, set) => {
	if (get(conciergePresentationAtom) === 'closed') {
		set(conciergePresentationAtom, 'panel');
	}
	set(
		conciergeComposerFocusRequestAtom,
		get(conciergeComposerFocusRequestAtom) + 1,
	);
});

/**
 * Persisted bottom-right corner the whole Concierge hangs from; unplaced until
 * the user drags it.
 *
 * One point rather than one per surface, because the launcher bubble and the
 * panel are the same thing in two sizes: the bubble opens into a panel whose
 * corner it was sitting on, and closing puts the bubble back on the corner the
 * panel was left at. A corner rather than a top-left is what makes that hold —
 * the two surfaces differ by hundreds of pixels in both axes, so a shared
 * top-left would have them agree only on the one edge nobody drags from.
 */
export const conciergeAnchorAtom = atomWithStorage<ConciergePoint>(
	'concierge_anchor',
	CONCIERGE_UNPLACED,
);

/** A file in the Concierge home the panel is showing instead of its transcript. */
export interface ConciergePreviewTarget {
	/** Path relative to the Concierge home, which is what the read resolves against. */
	path: string;
	/** What the preview header calls it, usually the basename. */
	title: string;
}

/**
 * The memory file or artifact the Concierge panel is previewing, or null when it
 * is showing the conversation.
 *
 * The panel owns this rather than the workbench because the Concierge home
 * belongs to no workspace: there is no file tree to open a tab in, and the panel
 * is reachable from the dashboard where no workspace is focused at all.
 */
export const conciergePreviewAtom = atom<ConciergePreviewTarget | null>(null);

/** How large a draggable Concierge surface is, in pixels. */
export interface ConciergeSize {
	height: number;
	width: number;
}

/**
 * The docked panel's size before the user resizes it, which is also the floor a
 * resize cannot go below.
 *
 * One constant for both because the shipped size was chosen as the smallest the
 * panel reads well at: a transcript column, a composer card, and a header row.
 * Anything under it starts truncating the model name and wrapping the control
 * row, so there is nothing to be gained by letting a drag get there.
 */
export const CONCIERGE_MIN_PANEL_SIZE: ConciergeSize = {
	height: 512,
	width: 416,
};

/**
 * Persisted size of the docked Concierge panel. Sits beside the anchor rather
 * than with it because the two are dragged by different handles and a resize
 * must not move the corner the panel hangs from.
 */
export const conciergePanelSizeAtom = atomWithStorage<ConciergeSize>(
	'concierge_panel_size',
	CONCIERGE_MIN_PANEL_SIZE,
);
