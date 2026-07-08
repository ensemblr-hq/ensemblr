import {
	DEFAULT_DOCK_TAB,
	DEFAULT_REVIEW_TAB,
} from '@/renderer/lib/workbench/constants';
import type {
	DockTabId,
	ReviewPanelTab,
	TerminalDockTabId,
	WorkbenchRouteSearch,
} from '@/renderer/types/workbench';

/**
 * Coerces raw router search params into a typed {@link WorkbenchRouteSearch},
 * defaulting invalid `dock`/`review` values to their canonical fallbacks.
 * @param search - Raw router search record.
 * @returns Normalised workbench search.
 */
export function normalizeWorkbenchSearch(
	search: Record<string, unknown>,
): WorkbenchRouteSearch {
	return {
		dock: 'dock' in search ? normalizeDockTab(search.dock) : undefined,
		review:
			'review' in search
				? isReviewTab(search.review)
					? search.review
					: DEFAULT_REVIEW_TAB
				: undefined,
	};
}

/** Type guard for the review-panel tab enum. */
function isReviewTab(value: unknown): value is ReviewPanelTab {
	return value === 'files' || value === 'changes' || value === 'checks';
}

/** Coerces a raw `dock` search param to a valid {@link DockTabId}. */
function normalizeDockTab(value: unknown): DockTabId {
	return isDockTab(value) ? value : DEFAULT_DOCK_TAB;
}

/** Type guard for the dock-panel tab enum. */
function isDockTab(value: unknown): value is DockTabId {
	return value === 'setup' || value === 'run' || isTerminalDockTabId(value);
}

/** Type guard for `terminal:*` dock tab ids. */
function isTerminalDockTabId(value: unknown): value is TerminalDockTabId {
	return (
		typeof value === 'string' &&
		value.startsWith('terminal:') &&
		value.length > 'terminal:'.length
	);
}
