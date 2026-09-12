/**
 * The renderer's Content-Security-Policy, built in one place because it is
 * applied from two: the main process attaches it as a response header
 * (`src/main/app/content-security-policy.ts`), and the renderer build stamps the
 * production form into `index.html` as a `<meta http-equiv>`
 * (`vite.renderer.config.mts`). A `file:` document is served by Electron's own
 * protocol handler rather than through Chromium's network stack, so the header
 * alone cannot be relied on there.
 *
 * Two directives are weaker than they look, and both are load-bearing rather
 * than oversights:
 *
 * - `style-src 'unsafe-inline'` — Tailwind 4, the shadcn primitives and
 *   `motion` all write inline `style` attributes.
 * - `img-src https:` — a markdown document renders remote images untouched
 *   (`src/renderer/hooks/markdown/use-markdown-image-source.ts`), which is how a
 *   pull-request comment draws its badges.
 */

/** Source list every directive inherits when the app is served from `file:`. */
const PACKAGED_SELF = ["'self'", 'file:'];

/**
 * Renders a directive map as a CSP header value.
 * @param directives - Directive name to its source list
 * @returns The policy as a single `; `-separated string
 */
function serializePolicy(directives: Record<string, string[]>): string {
	return Object.entries(directives)
		.map(([name, sources]) =>
			sources.length > 0 ? `${name} ${sources.join(' ')}` : name,
		)
		.join('; ');
}

/**
 * The websocket origin Vite's HMR client connects back to, derived from the
 * dev server's own origin so a workspace-assigned port needs no second source.
 * @param devServerOrigin - The Vite dev server origin
 * @returns The matching `ws://` origin
 */
function hmrSocketOrigin(devServerOrigin: string): string {
	return devServerOrigin.replace(/^http/, 'ws');
}

/**
 * Builds the renderer's Content-Security-Policy.
 *
 * The development form is deliberately looser in exactly two places — Vite
 * injects inline bootstrap scripts, and its HMR client opens a websocket — and
 * both relaxations are gated on a dev-server origin existing, so a packaged
 * build can never ship them.
 *
 * @param devServerOrigin - The Vite dev-server origin, or `null` for the packaged `file:` build.
 * @returns The policy string to send as `Content-Security-Policy`.
 */
export function contentSecurityPolicy(devServerOrigin: string | null): string {
	const self = devServerOrigin ? ["'self'"] : PACKAGED_SELF;
	const scriptSources = devServerOrigin
		? [...self, "'wasm-unsafe-eval'", "'unsafe-inline'"]
		: [...self, "'wasm-unsafe-eval'"];
	const connectSources = devServerOrigin
		? [...self, hmrSocketOrigin(devServerOrigin), 'data:', 'blob:']
		: [...self, 'data:', 'blob:'];

	return serializePolicy({
		'default-src': ["'none'"],
		'script-src': scriptSources,
		'style-src': [...self, "'unsafe-inline'"],
		'img-src': [...self, 'data:', 'blob:', 'linear-asset:', 'https:'],
		'font-src': [...self, 'data:'],
		'media-src': [...self, 'data:', 'blob:'],
		'connect-src': connectSources,
		'worker-src': [...self, 'blob:'],
		'object-src': [...self, 'blob:'],
		'frame-src': [...self, 'blob:'],
		'base-uri': ["'none'"],
		'form-action': ["'none'"],
	});
}
