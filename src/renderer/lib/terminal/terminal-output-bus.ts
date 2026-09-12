import type { TerminalOutputBroadcast } from '@/shared/ipc/contracts/terminal';

/** What one mounted surface is handed for its own session's chunks. */
type TerminalOutputListener = (event: TerminalOutputBroadcast) => void;

const listenersByTerminalId = new Map<string, Set<TerminalOutputListener>>();

let unsubscribeBridge: (() => void) | null = null;

/**
 * Fans one broadcast out to the surfaces bound to that session.
 * @param event - The chunk the main process broadcast
 */
function dispatch(event: TerminalOutputBroadcast): void {
	const listeners = listenersByTerminalId.get(event.terminalId);

	if (!listeners) {
		return;
	}

	for (const listener of [...listeners]) {
		listener(event);
	}
}

/**
 * Subscribes a surface to one terminal session's output.
 *
 * Every mounted `XtermTerminal` used to open its own `onTerminalOutput`
 * subscription and filter by id in JS, so a chatty PTY dispatched through one
 * listener per force-mounted tab. This keeps a single bridge subscription and
 * indexes by session, so the dispatch cost stops scaling with how many tabs the
 * workspace happens to have open.
 * @param terminalId - Session whose chunks the listener wants
 * @param listener - Called with each chunk for that session
 * @returns Unsubscribes the listener, closing the bridge subscription with the last one
 */
export function subscribeTerminalOutput(
	terminalId: string,
	listener: TerminalOutputListener,
): () => void {
	const listeners = listenersByTerminalId.get(terminalId) ?? new Set();
	listeners.add(listener);
	listenersByTerminalId.set(terminalId, listeners);
	unsubscribeBridge ??= window.ensemblr?.onTerminalOutput(dispatch) ?? null;

	return () => {
		const current = listenersByTerminalId.get(terminalId);

		if (!current) {
			return;
		}

		current.delete(listener);

		if (current.size === 0) {
			listenersByTerminalId.delete(terminalId);
		}

		if (listenersByTerminalId.size === 0) {
			unsubscribeBridge?.();
			unsubscribeBridge = null;
		}
	};
}
