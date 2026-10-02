import { app } from 'electron';

import { author, homepage } from '../../../package.json';
import type { AppLanguage } from '../../shared/i18n.ts';
import { linuxWindowIconPath } from '../app/index.ts';
import { aboutPanelStrings } from './about-panel-strings';
import { creditLines, creditsText } from './credits';
import { CREDITS_PACKAGES } from './credits-manifest.gen';

/**
 * The About panel Electron shows for the `about` menu role.
 *
 * Only `copyright` is cross-platform. macOS reads every other field off the
 * bundle and ignores the rest, but Linux's GTK dialog reads *nothing* on its
 * own: with no `applicationName` it falls back to `g_get_application_name()`,
 * which under an AppImage is the executable's file name — the panel then titles
 * itself `Ensemblr-0.1.0-beta.18-x64.AppImage` — and with no `iconPath` it
 * looks the icon up in the desktop's theme by a name an unintegrated AppImage
 * never installed, drawing GTK's broken-image glyph instead.
 *
 * The credits split the same way: `authors` reaches only GTK's credits page and
 * `credits` only the macOS panel, so both carry the same document. GTK files
 * every `authors` entry under its own fixed "Created by" heading — Electron
 * exposes no second credit section — which is why the group headings are lines
 * in the list rather than sections.
 * @param language - The app's resolved UI language, for the credit headings.
 * @returns Options for `app.setAboutPanelOptions`.
 */
export function aboutPanelOptions(
	language: AppLanguage,
): Electron.AboutPanelOptionsOptions {
	const iconPath = linuxWindowIconPath();
	const strings = aboutPanelStrings(language);

	return {
		applicationName: app.name,
		applicationVersion: app.getVersion(),
		authors: creditLines(strings, CREDITS_PACKAGES, author.name),
		credits: creditsText(strings, CREDITS_PACKAGES, author.name),
		copyright: getCopyrightNotice(),
		website: homepage,
		...(iconPath ? { iconPath } : {}),
	};
}

/**
 * Builds the About-panel copyright line from the package author and the current
 * year, so the notice tracks the build date instead of a baked-in constant.
 * @returns Copyright string such as `© Philipp Soldunov 2026`.
 */
function getCopyrightNotice(): string {
	return `© ${author.name} ${new Date().getFullYear()}`;
}
