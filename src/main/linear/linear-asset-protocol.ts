import { protocol } from 'electron';
import { LINEAR_ASSET_SCHEME } from '../../shared/linear-assets.ts';
import { APP_SCHEME } from '../app/app-bundle.ts';
import type { LinearAssetProxy } from './linear-asset-proxy.ts';

/**
 * Declare every privileged scheme the app serves to Chromium. Must run before
 * the app's `ready` event, which is why it is separate from the handler below.
 *
 * Both schemes take the same three privileges and neither takes more.
 * `standard` gives the scheme a real tuple origin, which is what lets the
 * renderer document keep `localStorage` and lets `'self'` mean something in its
 * CSP; `secure` keeps it out of mixed-content handling; `supportFetchAPI` is
 * what lets a subresource load at all. Deliberately not `bypassCSP` — the
 * renderer's own policy has to apply to the renderer — and not
 * `allowServiceWorkers`, which nothing here registers.
 *
 * Electron honours only the **first** `registerSchemesAsPrivileged` call — a
 * second call's scheme fails to load as a document with `ERR_FAILED` — so a
 * further privileged scheme joins this one array rather than adding a call of
 * its own. That is why the name is not `registerLinearAssetScheme`, and why the
 * renderer's own scheme is declared from here rather than from `src/main/app/`.
 */
export function registerPrivilegedSchemes(): void {
	protocol.registerSchemesAsPrivileged([
		{
			privileges: { secure: true, standard: true, supportFetchAPI: true },
			scheme: APP_SCHEME,
		},
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
