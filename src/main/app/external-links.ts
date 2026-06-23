import { shell, type WebContents } from 'electron';

import {
	externalNavigationTarget,
	parseAllowedExternalUrl,
} from './external-links-policy';

/**
 * Opens a vetted external URL in the default browser. Silently ignores
 * non-string, unparseable, or disallowed-protocol input so it is safe to call
 * with values that originate from the renderer or web content.
 */
export async function openExternalUrl(url: unknown): Promise<void> {
	if (typeof url !== 'string') {
		console.warn('[external-links] ignored non-string url', typeof url);
		return;
	}

	const parsed = parseAllowedExternalUrl(url);

	if (!parsed) {
		return;
	}

	try {
		await shell.openExternal(parsed.toString());
	} catch (error) {
		console.error('[external-links] openExternal failed', error);
	}
}

/**
 * Forces every external link to open in the default system browser instead of
 * inside the app window. Covers the navigation paths web content can take:
 *
 * - `window.open` / `<a target="_blank">` → denied as an in-app window, opened
 *   externally instead;
 * - full-page navigations and redirects (`<a href>`, `location.assign`) to an
 *   http(s) origin other than the app's own → cancelled and opened externally.
 *
 * Same-origin navigations (the dev-server origin) and non-http(s) schemes (the
 * `file:` bundle in production) are left alone so in-app routing still works.
 *
 * @param webContents - The window contents to guard.
 * @param appOrigin - The app's own origin to treat as internal, or `null` when
 *   the app is served from `file:` (production), where there is none to match.
 */
export function routeExternalLinksToBrowser(
	webContents: WebContents,
	{ appOrigin }: { appOrigin: string | null },
): void {
	webContents.setWindowOpenHandler(({ url }) => {
		void openExternalUrl(url);
		return { action: 'deny' };
	});

	const redirectExternalNavigation = (
		event: { preventDefault: () => void },
		url: string,
	): void => {
		const target = externalNavigationTarget(url, appOrigin);

		if (!target) {
			return;
		}

		event.preventDefault();
		void openExternalUrl(target.toString());
	};

	webContents.on('will-navigate', redirectExternalNavigation);
	webContents.on('will-redirect', redirectExternalNavigation);
}
