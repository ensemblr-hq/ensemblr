/**
 * Stand-in for the preload `window.ensemblr` bridge.
 *
 * Written for demo mode rather than shared with `playground/`: the playground is
 * a component-review sandbox with its own job, and coupling the two would make
 * one unable to move without the other. The ~90 lines below are a deliberate
 * duplicate.
 */

/** Answers one `window.ensemblr` method with a scenario-supplied result. */
export type DemoBridgeHandler = (payload: unknown) => unknown;

/** The handler map a scenario contributes, keyed as on the preload surface. */
export type DemoBridgeHandlers = Record<string, DemoBridgeHandler>;

/**
 * Whether a bridge method registers a listener rather than answering a request.
 * Both spellings hand back an unsubscribe function the caller stores as an
 * effect cleanup, so neither may be wrapped in a promise.
 * @param method - Name of the method being read off the bridge.
 * @returns True when the method is a subscription rather than a request.
 */
function isSubscription(method: string): boolean {
	return method.startsWith('subscribe') || method.startsWith('on');
}

/**
 * Installs the demo bridge onto `window`, resolving every method the handler map
 * does not name to a no-op.
 *
 * The stub has to live in the renderer's main world rather than behind
 * `contextBridge`: `exposeInMainWorld` deep-clones by enumerating own keys, and
 * a `get`-trap Proxy over ~200 method names has none to enumerate.
 *
 * Handlers are read through `getHandlers` on every call rather than captured
 * once, so swapping the active scenario over HMR takes effect without
 * reinstalling the bridge or reloading the window.
 * @param getHandlers - Reads the handler map for the scenario currently applied.
 */
export function installDemoBridge(getHandlers: () => DemoBridgeHandlers): void {
	const bridge = new Proxy(
		{},
		{
			get: (_target, property) => {
				if (typeof property !== 'string') {
					return () => Promise.resolve(undefined);
				}
				if (isSubscription(property)) {
					return (listener: unknown) =>
						getHandlers()[property]?.(listener) ?? (() => undefined);
				}
				return (payload: unknown) =>
					Promise.resolve(getHandlers()[property]?.(payload));
			},
			has: () => true,
		},
	);
	Object.defineProperty(window, 'ensemblr', {
		configurable: true,
		value: bridge,
		writable: true,
	});
}

/** A listener registered against one broadcast channel of the demo bridge. */
type BroadcastListener = (payload: never) => void;

/**
 * Registry backing the bridge's `on*` methods, so a scenario's playhead can push
 * events at the renderer exactly as the main process broadcasts them.
 */
export class DemoBroadcastChannels {
	private readonly listeners = new Map<string, Set<BroadcastListener>>();

	/**
	 * Builds the subscribe function one bridge channel hands its caller.
	 * @param channel - Bridge method name, e.g. `onAgentSessionEvent`.
	 * @returns A handler that registers the listener and returns its unsubscribe.
	 */
	subscriber(channel: string): DemoBridgeHandler {
		return (listener) => {
			const registered = this.listeners.get(channel) ?? new Set();
			registered.add(listener as BroadcastListener);
			this.listeners.set(channel, registered);
			return () => registered.delete(listener as BroadcastListener);
		};
	}

	/**
	 * Delivers one payload to every listener on a channel.
	 * @param channel - Bridge method name the listeners subscribed through.
	 * @param payload - The broadcast body, shaped as the real channel's.
	 */
	emit<TPayload>(channel: string, payload: TPayload): void {
		for (const listener of this.listeners.get(channel) ?? []) {
			(listener as (value: TPayload) => void)(payload);
		}
	}

	/** Drops every registered listener, so a scenario swap starts clean. */
	clear(): void {
		this.listeners.clear();
	}
}
