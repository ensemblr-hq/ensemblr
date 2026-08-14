import { Outlet } from '@tanstack/react-router';
import { useAtom } from 'jotai';
import { useCallback } from 'react';

import { useAppMenuCommands } from '@/renderer/hooks/use-app-menu-commands';
import { useConfigReloadSync } from '@/renderer/hooks/use-config-reload-sync';
import { useHotkey } from '@/renderer/hooks/use-hotkey';
import { useNotificationSoundSync } from '@/renderer/hooks/use-notification-sound-sync';
import { useAskUserQuestionSync } from '@/renderer/state/ask-user-question';
import {
	useMenuCommand,
	useMenuCommandBridge,
	useMenuCommandChecked,
} from '@/renderer/state/menu-commands';
import { usePlanModeSync, usePlanReviewSync } from '@/renderer/state/plan-mode';
import {
	toolCallCollapseAtom,
	useAppearanceEffect,
	useAppSettingsSync,
	useLanguageEffect,
	useThemeEffect,
} from '@/renderer/state/preferences';
import { useToolApprovalSync } from '@/renderer/state/tool-approval';

/** Root app component — delegates rendering to the active TanStack Router outlet. */
export function App() {
	useThemeEffect();
	useAppearanceEffect();
	useLanguageEffect();
	useAppSettingsSync();
	useConfigReloadSync();
	useNotificationSoundSync();
	useAskUserQuestionSync();
	useToolApprovalSync();
	usePlanReviewSync();
	usePlanModeSync();

	useMenuCommandBridge();
	useAppMenuCommands();

	// App-wide toggle for the tool-call expand/collapse default (⌃O / Ctrl+O).
	const [toolCallCollapse, setToolCallCollapse] = useAtom(toolCallCollapseAtom);
	const toggleToolCallCollapse = useCallback(() => {
		setToolCallCollapse((prev) =>
			prev === 'expanded' ? 'collapsed' : 'expanded',
		);
	}, [setToolCallCollapse]);
	useHotkey('toolCalls.toggleCollapse', toggleToolCallCollapse);
	useMenuCommand('toolCalls.toggleCollapse', toggleToolCallCollapse);
	useMenuCommandChecked(
		'toolCalls.toggleCollapse',
		toolCallCollapse === 'collapsed',
	);

	return <Outlet />;
}
