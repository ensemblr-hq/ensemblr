/** Answers one `window.ensemblr` method with a scene-supplied stand-in result. */
type BridgeHandler = (payload: unknown) => unknown;

/**
 * Whether a bridge method registers a listener rather than answering a request.
 * Both spellings on the preload surface hand back an unsubscribe function that
 * a caller stores as an effect cleanup, so neither may be wrapped in a promise.
 * @param method - Name of the method being read off the bridge.
 * @returns True when the method is a subscription rather than a request.
 */
function isSubscription(method: string): boolean {
	return method.startsWith('subscribe') || method.startsWith('on');
}

/**
 * Reads the workspace path out of a bridge request. Handlers receive `unknown`
 * because the stub bypasses the typed preload surface, so every fixture that
 * answers a per-workspace call has to narrow the same shape.
 * @param payload - The request a renderer query passed to the bridge.
 * @returns The requested workspace path, or an empty string when absent.
 */
export function readBridgeWorkspaceCwd(payload: unknown): string {
	if (typeof payload !== 'object' || payload === null) {
		return '';
	}
	return 'workspaceCwd' in payload ? String(payload.workspaceCwd) : '';
}

/**
 * Stand-in for the preload `window.ensemblr` bridge. Renderer modules throw when
 * it is missing, so the playground installs a permissive no-op instead of
 * hand-maintaining a mock of the whole IPC surface: `subscribe*` calls hand back
 * an unsubscribe function, every other call resolves to `undefined`.
 *
 * `handlers` covers the calls a scene actually depends on. React Query rejects
 * an `undefined` result, so any polled query a scene drives has to answer here
 * rather than lean on the blanket no-op — seeding the cache is not enough, since
 * the query's own `refetchInterval` overrides the client's defaults.
 *
 * A handler for a `subscribe*` or `on*` method is handed the listener and must
 * return the unsubscribe function synchronously, the way preload does.
 * @param handlers - Method-name to stand-in result, keyed as on the bridge.
 */
export function installPlaygroundBridge(
	handlers: Record<string, BridgeHandler> = {},
): void {
	const bridge = new Proxy(
		{},
		{
			get: (_target, property) => {
				if (typeof property !== 'string') {
					return () => Promise.resolve(undefined);
				}
				const handler = handlers[property];
				if (isSubscription(property)) {
					return handler ?? (() => () => undefined);
				}
				return handler
					? (payload: unknown) => Promise.resolve(handler(payload))
					: () => Promise.resolve(undefined);
			},
			has: () => true,
		},
	);
	(window as unknown as { ensemblr: unknown }).ensemblr = bridge;
}
