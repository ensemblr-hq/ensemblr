import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { net, protocol } from 'electron';

import { APP_SCHEME, bundleFilePath } from './app-bundle';

/**
 * The built renderer directory, beside the main bundle. Vite compiles every
 * main-process module into one file, so `__dirname` is the build directory
 * whichever source file reads it.
 * @returns The absolute path Vite's renderer build wrote.
 */
function rendererBundleRoot(): string {
	return path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}`);
}

/**
 * Serves the packaged renderer over the app scheme. Must run after the app's
 * `ready` event; the scheme itself is declared before it, in
 * `src/main/linear/linear-asset-protocol.ts`.
 *
 * Registered in development too, where nothing loads it — the dev server serves
 * the renderer instead — so the packaged path is not a branch that only exists
 * in a build nobody runs locally.
 */
export function registerAppProtocol(): void {
	const bundleRoot = rendererBundleRoot();

	protocol.handle(APP_SCHEME, async (request) => {
		const filePath = bundleFilePath(bundleRoot, request.url);

		if (!filePath) {
			console.warn(
				'[app-protocol] refused a request off the bundle',
				request.url,
			);
			return new Response(null, { status: 404 });
		}

		try {
			return await net.fetch(pathToFileURL(filePath).href);
		} catch (error) {
			console.warn('[app-protocol] could not serve', request.url, error);
			return new Response(null, { status: 404 });
		}
	});
}
