import { app, Menu } from 'electron';

import type { AppSettings } from '../../shared/config';
import { resolveLanguage } from '../../shared/i18n';
import type { MenuContext } from '../../shared/menu-commands';
import { aboutPanelOptions } from './about-panel';
import { buildAppMenu } from './app-menu';
import { buildChangesMenu } from './changes-menu';
import { buildChatMenu } from './chat-menu';
import { buildEditMenu } from './edit-menu';
import { buildFileMenu } from './file-menu';
import { buildHelpMenu } from './help-menu';
import {
	createMenuItemFactory,
	type DescribedMenuItem,
	toElectronTemplate,
} from './menu-item';
import { menuLabels } from './menu-strings';
import { buildViewMenu } from './view-menu';
import { buildWindowMenu } from './window-menu';
import { buildWorkspaceMenu } from './workspace-menu';

/**
 * Builds and installs the Ensemblr application menu in the language the app
 * setting resolves to, with the macOS app menu appearing only on darwin.
 * `Menu.setApplicationMenu` replaces the menu wholesale, so calling this again
 * after the language or the renderer's menu context changes *is* the rebuild.
 *
 * Returns the template it built, annotated with the command behind each item,
 * so the menu bar the app draws for itself where the desktop draws none is
 * serialized from this same tree rather than from a second declaration of it.
 * @param readSettings - Reads the current App settings; called on every rebuild
 * @param context - The menu context the renderer last reported, or null before
 * its first report, which leaves every item enabled
 * @returns The annotated template the menu was built from
 */
export function installApplicationMenu(
	readSettings: () => AppSettings,
	context: MenuContext | null = null,
): DescribedMenuItem[] {
	const language = resolveLanguage(
		readSettings().general.language,
		app.getPreferredSystemLanguages(),
	);

	app.setAboutPanelOptions(aboutPanelOptions(language));

	const labels = menuLabels(language, app.name);
	const items = createMenuItemFactory(context);

	const template: DescribedMenuItem[] = [
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

	Menu.setApplicationMenu(Menu.buildFromTemplate(toElectronTemplate(template)));

	return template;
}
