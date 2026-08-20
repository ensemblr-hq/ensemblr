import { protocol } from 'electron';

import { LINEAR_ASSET_SCHEME } from '../../shared/linear-assets.ts';
import type { LinearAssetProxy } from './linear-asset-proxy.ts';

/**
 * Declare the Linear asset scheme to Chromium. Must run before the app's
 * `ready` event, which is why it is separate from the handler below.
 *
 * `standard` and `secure` make a served image an ordinary subresource rather
 * than a `file:`-like opaque one, so it is not treated as cross-origin from the
 * renderer and does not tip a page into mixed-content handling.
 * `supportFetchAPI` is what lets an `<img>` load it at all. The scheme is
 * deliberately not `bypassCSP` and not `allowServiceWorkers`: it serves image
 * bytes and nothing else.
 */
export function registerLinearAssetScheme(): void {
	protocol.registerSchemesAsPrivileged([
		{
			privileges: { secure: true, standard: true, supportFetchAPI: true },
			scheme: LINEAR_ASSET_SCHEME,
		},
	]);
}

/**
 * Serve the Linear asset scheme from the proxy. Must run after the app's
 * `ready` event.
 * @param proxy - Resolves an asset request against Linear's storage.
 */
export function registerLinearAssetProtocol(proxy: LinearAssetProxy): void {
	protocol.handle(LINEAR_ASSET_SCHEME, (request) => proxy.fetch(request.url));
}
