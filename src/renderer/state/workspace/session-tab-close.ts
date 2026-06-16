import type { SessionTabModel } from '@/renderer/types/workbench';

/**
 * Picks the tab to activate after the tab at `closingIndex` is removed. Prefers
 * the right neighbor, falling back to the left when the rightmost tab closes.
 * Returns `null` when no neighbor exists (the closing tab was the only one) or
 * `closingIndex` is out of range. The input order matches the left-to-right
 * tab-bar render order.
 */
export function selectNeighborTab<T>(
	tabs: readonly T[],
	closingIndex: number,
): T | null {
	if (closingIndex < 0) {
		return null;
	}
	return tabs[closingIndex + 1] ?? tabs[closingIndex - 1] ?? null;
}

/** What ⌘/Ctrl+W does to the active workspace tab. */
export type ActiveCloseDecision =
	| { kind: 'noop' }
	| { kind: 'close'; activeId: string }
	| { kind: 'reset'; activeId: string };

/**
 * Decides ⌘/Ctrl+W behavior for the active workspace tab:
 * - more than one tab open → `close` (delegate to `closeSessionTab`: auxiliary
 *   tabs always close, chat tabs keep the min-one-chat invariant);
 * - the sole tab with no Pi session bound → `noop` (already a fresh, empty chat
 *   — replacing it would only flicker);
 * - the sole tab with a Pi session bound → `reset` (replace it with a fresh
 *   chat so ⌘W still "clears" the workspace without closing the window).
 *
 * The min-one-chat invariant guarantees the sole remaining tab is always the
 * protected chat, never an auxiliary (diff/file/preview) tab.
 */
export function decideActiveClose(
	tabs: readonly SessionTabModel[],
	active: Pick<SessionTabModel, 'id' | 'piSessionId'>,
): ActiveCloseDecision {
	if (tabs.length === 1) {
		if (!active.piSessionId) {
			return { kind: 'noop' };
		}
		return { kind: 'reset', activeId: active.id };
	}
	return { kind: 'close', activeId: active.id };
}
