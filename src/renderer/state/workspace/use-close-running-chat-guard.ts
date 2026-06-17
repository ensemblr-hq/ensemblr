import { useCallback, useMemo, useState } from 'react';

import {
	type CloseRunningChatRequest,
	type PendingClose,
	planClose,
	runConfirmedClose,
} from './close-running-chat-guard';

export type { CloseRunningChatRequest } from './close-running-chat-guard';

/** Imperative surface wiring tab closes to the running-chat confirmation dialog. */
export interface CloseRunningChatGuard {
	/** Dismisses the dialog and abandons the deferred close. */
	cancelClose: () => void;
	/** Cancels the agent, then runs the deferred close. */
	confirmClose: () => void;
	/** True while a running tab is awaiting confirmation. */
	isConfirming: boolean;
	/** Closes idle tabs immediately; defers running tabs behind the dialog. */
	requestClose: (request: CloseRunningChatRequest) => void;
}

/**
 * Gates tab closes that would silently cancel a running agent. Idle tabs close
 * straight through; a running tab is held until the user confirms, at which
 * point the agent is cancelled *before* the tab closes — closing the tab alone
 * leaves the Pi runtime streaming in the background, so the dialog's "Closing it
 * will stop the current Pi session" promise has to be made true here.
 *
 * The decision and stop-then-close sequencing live in {@link planClose} and
 * {@link runConfirmedClose} (framework-free and unit-tested); this hook only
 * holds the pending state and wires those to React.
 */
export function useCloseRunningChatGuard(): CloseRunningChatGuard {
	const [pending, setPending] = useState<PendingClose | null>(null);

	const requestClose = useCallback((request: CloseRunningChatRequest) => {
		const plan = planClose(request);
		if (plan.kind === 'close-now') {
			request.onClose();
			return;
		}
		setPending(plan.pending);
	}, []);

	const confirmClose = useCallback(() => {
		if (!pending) {
			return;
		}
		setPending(null);
		void runConfirmedClose(pending);
	}, [pending]);

	const cancelClose = useCallback(() => {
		setPending(null);
	}, []);

	// Memoised so the returned surface is referentially stable across renders.
	// Callers thread it through `useCallback`/`useMemo` deps and into
	// `useRegisterCloseAction`; an unstable object would re-run those every
	// render and defeat their memoisation.
	return useMemo(
		() => ({
			cancelClose,
			confirmClose,
			isConfirming: pending !== null,
			requestClose,
		}),
		[cancelClose, confirmClose, pending, requestClose],
	);
}
