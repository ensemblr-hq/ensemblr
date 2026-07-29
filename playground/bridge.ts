/**
 * Stand-in for the preload `window.ensemblr` bridge. Renderer modules throw
 * when it is missing, so the playground installs a permissive no-op instead of
 * hand-maintaining a mock of the whole IPC surface: `subscribe*` calls hand back
 * an unsubscribe function, every other call resolves to `undefined`.
 */
export function installPlaygroundBridge(): void {
	const bridge = new Proxy(
		{},
		{
			get: (_target, property) =>
				typeof property === 'string' && property.startsWith('subscribe')
					? () => () => undefined
					: () => Promise.resolve(undefined),
			has: () => true,
		},
	);
	(window as unknown as { ensemblr: unknown }).ensemblr = bridge;
}
