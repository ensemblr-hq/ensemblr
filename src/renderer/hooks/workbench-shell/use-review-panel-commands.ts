import { useCallback } from 'react';

import { useHotkey } from '@/renderer/hooks/use-hotkey';
import { useSetChangesSource } from '@/renderer/hooks/workbench-shell/review-files/use-changes-source';
import {
	useMenuCommand,
	useMenuCommandChecked,
} from '@/renderer/state/menu-commands';
import type { ReviewPanelTab } from '@/renderer/types/workbench';

/**
 * Registers every command that reaches the review panel from outside it: the
 * View menu's Files / Changes / Checks picks, ⌥⌘U's jump to the uncommitted
 * change set, and ⌘P's file palette.
 *
 * They live in the workspace shell rather than in the panel they act on, because
 * the panel is not always mounted: a narrow window hosts the rail in a sheet that
 * unmounts when dismissed, which would leave the menu items permanently disabled
 * and both chords dead — and dead is literal, since the menu owns those
 * accelerators on macOS, so AppKit swallows the key before the renderer sees it.
 *
 * Everything that selects a tab reveals the rail too, since picking a tab behind
 * a collapsed rail shows the user nothing. `openFileSearch` deliberately does
 * not: the palette is a modal over the whole window, so it works at any width
 * whether or not the rail is open.
 * @param options - The tab state, the openers, and the reveal to compose
 */
export function useReviewPanelCommands({
	activeTab,
	onTabChange,
	openFileSearch,
	revealRail,
	workspaceId,
}: {
	activeTab: ReviewPanelTab;
	onTabChange: (tab: ReviewPanelTab) => void;
	openFileSearch: () => void;
	revealRail: () => void;
	workspaceId: string;
}): void {
	const setChangesSource = useSetChangesSource(workspaceId);
	const showFilesTab = useCallback(() => {
		onTabChange('files');
		revealRail();
	}, [onTabChange, revealRail]);
	const showChangesTab = useCallback(() => {
		onTabChange('changes');
		revealRail();
	}, [onTabChange, revealRail]);
	const showChecksTab = useCallback(() => {
		onTabChange('checks');
		revealRail();
	}, [onTabChange, revealRail]);
	const showUncommittedChanges = useCallback(() => {
		setChangesSource({ kind: 'uncommitted' });
		showChangesTab();
	}, [setChangesSource, showChangesTab]);

	useMenuCommand('panel.files', showFilesTab);
	useMenuCommand('panel.changes', showChangesTab);
	useMenuCommand('panel.checks', showChecksTab);
	useMenuCommandChecked('panel.files', activeTab === 'files');
	useMenuCommandChecked('panel.changes', activeTab === 'changes');
	useMenuCommandChecked('panel.checks', activeTab === 'checks');
	useHotkey('changes.uncommitted', showUncommittedChanges);
	useMenuCommand('changes.uncommitted', showUncommittedChanges);
	useHotkey('files.search', openFileSearch);
	useMenuCommand('files.search', openFileSearch);
}
