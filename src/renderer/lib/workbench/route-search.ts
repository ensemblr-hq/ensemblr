import {
	DEFAULT_DOCK_TAB,
	DEFAULT_REVIEW_TAB,
	DEFAULT_TERMINAL_DOCK_TAB_ID,
} from '@/renderer/lib/workbench/constants';
import type {
	DockTabId,
	ReviewPanelTab,
	TerminalDockTabId,
	WorkbenchRouteSearch,
} from '@/renderer/types/workbench';

export function normalizeWorkbenchSearch(
	search: Record<string, unknown>,
): WorkbenchRouteSearch {
	return {
		chat: typeof search.chat === 'string' ? search.chat : undefined,
		dock: 'dock' in search ? normalizeDockTab(search.dock) : undefined,
		review:
			'review' in search
				? isReviewTab(search.review)
					? search.review
					: DEFAULT_REVIEW_TAB
				: undefined,
	};
}

function isReviewTab(value: unknown): value is ReviewPanelTab {
	return value === 'files' || value === 'changes' || value === 'checks';
}

function normalizeDockTab(value: unknown): DockTabId {
	if (value === 'terminal') {
		return DEFAULT_TERMINAL_DOCK_TAB_ID;
	}

	return isDockTab(value) ? value : DEFAULT_DOCK_TAB;
}

function isDockTab(value: unknown): value is DockTabId {
	return value === 'setup' || value === 'run' || isTerminalDockTabId(value);
}

function isTerminalDockTabId(value: unknown): value is TerminalDockTabId {
	return (
		typeof value === 'string' &&
		value.startsWith('terminal:') &&
		value.length > 'terminal:'.length
	);
}
