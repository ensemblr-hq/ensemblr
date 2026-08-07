import { useHotkey } from '@/renderer/hooks/use-hotkey';

/**
 * Keyboard navigation for the session tab strip: open, pin, cycle forward and
 * back, and jump to a tab by its 1-based position.
 * @param activeSessionId - Session id of the tab currently in the foreground
 * @param onOpenTab - Opens a new chat tab (⌘T)
 * @param onPinTab - Pins the active tab so it survives a preview replacement
 * @param onSelectSession - Activates the tab the shortcut resolved to
 * @param orderedSessionIds - The tab ids in their rendered order
 */
export function useSessionTabShortcuts({
	activeSessionId,
	onOpenTab,
	onPinTab,
	onSelectSession,
	orderedSessionIds,
}: {
	activeSessionId: string;
	onOpenTab: () => void;
	onPinTab: (sessionId: string) => void;
	onSelectSession: (sessionId: string) => void;
	orderedSessionIds: readonly string[];
}): void {
	/** Selects the tab `offset` positions from the active one, wrapping around. */
	const cycleTab = (offset: number) => {
		if (orderedSessionIds.length < 2) {
			return;
		}
		const activeIndex = orderedSessionIds.indexOf(activeSessionId);
		const base = activeIndex === -1 ? 0 : activeIndex;
		const nextIndex =
			(base + offset + orderedSessionIds.length) % orderedSessionIds.length;
		onSelectSession(orderedSessionIds[nextIndex]);
	};

	/** Selects a tab by its 1-based position; `9` always jumps to the last tab. */
	const selectTabByPosition = (position: number) => {
		if (!orderedSessionIds.length) {
			return;
		}
		const index = position === 9 ? orderedSessionIds.length - 1 : position - 1;
		const targetId = orderedSessionIds[index];
		if (targetId) {
			onSelectSession(targetId);
		}
	};

	useHotkey('tab.new', onOpenTab);
	useHotkey('tab.keepOpen', () => onPinTab(activeSessionId));
	useHotkey('tab.next', () => cycleTab(1));
	useHotkey('tab.prev', () => cycleTab(-1));
	useHotkey('tab.selectByIndex', (event) => {
		const position = Number.parseInt(event.key, 10);
		if (!Number.isNaN(position)) {
			selectTabByPosition(position);
		}
	});
}
