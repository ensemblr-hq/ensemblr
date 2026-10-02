import type { UpdateStatusSnapshot } from '@/shared/ipc/contracts/update';

/**
 * Which shape the sidebar's update panel takes. Every one names a version the
 * user does not have yet, which is what makes the panel worth pinning.
 */
export type UpdatePanelKind = 'available' | 'downloading' | 'failed' | 'ready';

/**
 * Decides whether a snapshot has an update worth pinning to the sidebar, and in
 * which shape.
 *
 * Every shape requires `availableVersion`, because every one names it — without
 * one there is nothing to offer and the panel would headline the build the user
 * is already running. An errored check with no version behind it therefore
 * stays out, which is also what a laptop off wifi produces every few hours, and
 * a panel that cannot be dismissed must never be raised by something the user
 * cannot act on. Once a version *is* known, main has already established the
 * error is the download failing rather than the check — a feed error over a
 * standing offer leaves the state at `available` — so it keeps the panel rather
 * than silently retracting it.
 *
 * `checking` is not a shape of its own: main passes through it on every check,
 * and the sidebar holds whatever it was showing rather than blinking the panel
 * out for the round trip.
 *
 * Lives with the state rather than with the panel because it is also what the
 * menu-driven check consults before toasting — the two surfaces agree on which
 * one is speaking instead of each deciding for itself.
 * @param snapshot - The updater's state, or null before the first read lands
 * @returns The shape to render, or null when the sidebar shows no panel
 */
export function resolveUpdatePanelKind(
	snapshot: UpdateStatusSnapshot | null,
): UpdatePanelKind | null {
	if (!snapshot?.availableVersion) {
		return null;
	}
	switch (snapshot.state) {
		case 'ready':
			return 'ready';
		case 'downloading':
			return 'downloading';
		case 'available':
			return 'available';
		case 'error':
			return 'failed';
		case 'checking':
		case 'disabled':
		case 'idle':
		case 'unsupported':
			return null;
		default:
			snapshot.state satisfies never;
			return null;
	}
}
