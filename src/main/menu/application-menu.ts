import { app, Menu, type MenuItemConstructorOptions } from 'electron';

import { author } from '../../../package.json';
import type { AppSettings } from '../../shared/config';
import { resolveLanguage } from '../../shared/i18n';
import type { MenuContext } from '../../shared/menu-commands';
import { buildAppMenu } from './app-menu';
import { buildChangesMenu } from './changes-menu';
import { buildChatMenu } from './chat-menu';
import { buildEditMenu } from './edit-menu';
import { buildFileMenu } from './file-menu';
import { buildHelpMenu } from './help-menu';
import { createMenuItemFactory } from './menu-item';
import { menuLabels } from './menu-strings';
import { buildViewMenu } from './view-menu';
import { buildWindowMenu } from './window-menu';
import { buildWorkspaceMenu } from './workspace-menu';

/**
 * Builds the About-panel copyright line from the package author and the current
 * year, so the notice tracks the build date instead of a baked-in constant.
 * @returns Copyright string such as `© Philipp Soldunov 2026`.
 */
function getCopyrightNotice(): string {
	return `© ${author.name} ${new Date().getFullYear()}`;
}

/**
 * Builds and installs the Ensemblr application menu in the language the app
 * setting resolves to, with the macOS app menu appearing only on darwin.
 * `Menu.setApplicationMenu` replaces the menu wholesale, so calling this again
 * after the language or the renderer's menu context changes *is* the rebuild.
 * @param readSettings - Reads the current App settings; called on every rebuild
 * @param context - The menu context the renderer last reported, or null before
 * its first report, which leaves every item enabled
 */
export function installApplicationMenu(
	readSettings: () => AppSettings,
	context: MenuContext | null = null,
): void {
	app.setAboutPanelOptions({ copyright: getCopyrightNotice() });

	const language = resolveLanguage(
		readSettings().general.language,
		app.getPreferredSystemLanguages(),
	);
	const labels = menuLabels(language, app.name);
	const items = createMenuItemFactory(context);

	const template: MenuItemConstructorOptions[] = [
		...buildAppMenu(labels, items),
		buildFileMenu(labels, items, context),
		buildEditMenu(labels),
		buildViewMenu(labels, items),
		buildWorkspaceMenu(labels, items, context),
		buildChatMenu(labels, items, context),
		buildChangesMenu(labels, items),
		buildWindowMenu(labels, items),
		buildHelpMenu(labels, items),
	];

	Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
