import { app, shell, type WebContents } from 'electron';

import {
	type AppDocument,
	type NavigationDecision,
	navigationDecision,
	parseAllowedExternalUrl,
	subframeNavigationDecision,
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
 * Applies the deny-by-default navigation policy to one `WebContents`.
 *
 * Covers every path web content can take out of the current document:
 *
 * - `window.open` / `<a target="_blank">` → denied as an in-app window, opened
 *   externally instead;
 * - top-level navigations and redirects (`<a href>`, `location.assign`) and
 *   subframe navigations → same-document and dev-origin targets proceed, other
 *   http(s) origins are opened in the browser, and everything else is
 *   cancelled.
 *
 * The renderer routes with hash history, so an in-app route change never
 * reaches these handlers at all; a navigation that does is either the initial
 * load, a dev-server reload, or something the app did not ask for.
 *
 * @param webContents - The window contents to guard.
 * @param appDocument - Where the app's own renderer is being served from.
 */
export function routeExternalLinksToBrowser(
	webContents: WebContents,
	appDocument: AppDocument,
): void {
	webContents.setWindowOpenHandler(({ url }) => {
		void openExternalUrl(url);
		return { action: 'deny' };
	});

	const applyDecision = (
		event: { preventDefault: () => void },
		decision: NavigationDecision,
	): void => {
		if (decision.action === 'allow') {
			return;
		}

		event.preventDefault();

		if (decision.action === 'external') {
			void openExternalUrl(decision.url.toString());
			return;
		}

		console.warn('[external-links] blocked navigation', decision.reason);
	};

	const applyNavigationPolicy = (
		event: { preventDefault: () => void },
		url: string,
	): void => {
		applyDecision(event, navigationDecision(url, appDocument));
	};

	webContents.on('will-navigate', applyNavigationPolicy);
	webContents.on('will-redirect', applyNavigationPolicy);
	// `will-frame-navigate` also fires for the main frame, which `will-navigate`
	// has already handled — acting twice would open the browser twice. A
	// subframe is judged by `subframeNavigationDecision`, which additionally
	// admits the app's own blob and Chromium's PDF viewer.
	webContents.on('will-frame-navigate', (event) => {
		if (event.isMainFrame) {
			return;
		}
		applyDecision(event, subframeNavigationDecision(event.url, appDocument));
	});
}

/**
 * Carries the navigation policy onto every `WebContents` the app ever creates,
 * so a future window, devtools frame or embedded view inherits it instead of
 * needing its own call site, and refuses to let a `<webview>` attach at all.
 *
 * `webviewTag` is off, so no tag can be created today; this is the backstop for
 * the day that default changes, and it strips the preload rather than trusting
 * whoever set it.
 *
 * @param appDocument - Where the app's own renderer is being served from.
 */
export function guardEveryWebContents(appDocument: AppDocument): void {
	app.on('web-contents-created', (_event, contents) => {
		contents.on('will-attach-webview', (event, webPreferences, params) => {
			delete webPreferences.preload;
			webPreferences.nodeIntegration = false;
			webPreferences.contextIsolation = true;

			if (
				navigationDecision(params.src ?? '', appDocument).action !== 'allow'
			) {
				console.warn('[external-links] refused a webview attach', params.src);
				event.preventDefault();
			}
		});
	});
}
