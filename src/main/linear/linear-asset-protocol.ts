import { protocol } from 'electron';

import { LINEAR_ASSET_SCHEME } from '../../shared/linear-assets.ts';
import type { LinearAssetProxy } from './linear-asset-proxy.ts';

/**
 * Declare every privileged scheme the app serves to Chromium. Must run before
 * the app's `ready` event, which is why it is separate from the handler below.
 *
 * `standard` and `secure` make a served image an ordinary subresource rather
 * than a `file:`-like opaque one, so it is not treated as cross-origin from the
 * renderer and does not tip a page into mixed-content handling.
 * `supportFetchAPI` is what lets an `<img>` load it at all. The scheme is
 * deliberately not `bypassCSP` and not `allowServiceWorkers`: it serves image
 * bytes and nothing else.
 *
 * Electron honours only the **first** `registerSchemesAsPrivileged` call — a
 * second call's scheme fails to load as a document with `ERR_FAILED` — so a
 * further privileged scheme joins this one array rather than adding a call of
 * its own. That is why the name is not `registerLinearAssetScheme`: whenever
 * the renderer moves off `file:` onto an `app:` scheme, it lands here.
 */
export function registerPrivilegedSchemes(): void {
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
