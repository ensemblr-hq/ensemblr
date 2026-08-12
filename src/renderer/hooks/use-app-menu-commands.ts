import { useNavigate } from '@tanstack/react-router';
import { useAtom } from 'jotai';
import { useCallback } from 'react';

import {
	useMenuCommand,
	useMenuCommandChecked,
} from '@/renderer/state/menu-commands';
import { themeAtom } from '@/renderer/state/preferences';

/**
 * Registers the native-menu commands that belong to the app as a whole rather
 * than to any one workspace — navigation, the theme radio group, and Help.
 *
 * These live at the router root so they stay reachable from every screen,
 * including the ones (settings, welcome, error) that mount no workspace shell.
 *
 * `settings.open` is deliberately not among them: the menu owns ⌘, so the
 * command has to reproduce the hotkey exactly, and closing the command palette
 * first needs state only `CommandPalette` holds. Registering it here as well
 * would put this weaker handler on top of the stack — a parent's effect runs
 * after its children's.
 */
export function useAppMenuCommands(): void {
	const navigate = useNavigate();
	const [theme, setTheme] = useAtom(themeAtom);

	const goWorkbench = useCallback(() => {
		void navigate({ to: '/' });
	}, [navigate]);
	const goLinear = useCallback(() => {
		void navigate({ to: '/linear' });
	}, [navigate]);
	const goHistory = useCallback(() => {
		void navigate({ to: '/history' });
	}, [navigate]);
	const openShortcuts = useCallback(() => {
		void navigate({ to: '/settings/shortcuts' });
	}, [navigate]);
	const openDiagnostics = useCallback(() => {
		void navigate({ to: '/settings/diagnostics' });
	}, [navigate]);
	const openConfigFile = useCallback(() => {
		void window.ensemblr?.openAppConfigFile();
	}, []);

	const useSystemTheme = useCallback(() => setTheme('system'), [setTheme]);
	const useLightTheme = useCallback(() => setTheme('light'), [setTheme]);
	const useDarkTheme = useCallback(() => setTheme('dark'), [setTheme]);

	useMenuCommand('go.workbench', goWorkbench);
	useMenuCommand('go.linear', goLinear);
	useMenuCommand('go.history', goHistory);
	useMenuCommand('help.shortcuts', openShortcuts);
	useMenuCommand('help.diagnostics', openDiagnostics);
	useMenuCommand('help.configFile', openConfigFile);

	useMenuCommand('theme.system', useSystemTheme);
	useMenuCommand('theme.light', useLightTheme);
	useMenuCommand('theme.dark', useDarkTheme);
	useMenuCommandChecked('theme.system', theme === 'system');
	useMenuCommandChecked('theme.light', theme === 'light');
	useMenuCommandChecked('theme.dark', theme === 'dark');
}
