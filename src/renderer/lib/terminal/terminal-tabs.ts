import type {
	DockTabStatus,
	TerminalDockTabModel,
} from '@/renderer/types/workbench';
import type {
	TerminalSessionSnapshot,
	TerminalSessionStatus,
} from '@/shared/ipc/contracts/terminal';

/** Result of folding terminal input into command/activity state. */
export interface TerminalInputActivityResult {
	commandSubmitted: boolean;
	interrupted: boolean;
	nextBuffer: string;
}

/** Raw terminal keystroke payload published to renderer-local input listeners. */
export interface TerminalInputEventDetail {
	data: string;
	terminalId: string;
}

type TerminalInputListener = (detail: TerminalInputEventDetail) => void;

const terminalInputListeners = new Set<TerminalInputListener>();

/**
 * Publishes a raw terminal keystroke to renderer-local activity listeners.
 * @param detail - Keystroke data and its owning terminal id.
 */
export function emitTerminalInput(detail: TerminalInputEventDetail): void {
	for (const listener of terminalInputListeners) {
		listener(detail);
	}
}

/**
 * Subscribes to renderer-local terminal keystroke events.
 * @param listener - Receives each published keystroke payload.
 * @returns An unsubscribe function that detaches the listener.
 */
export function subscribeTerminalInput(
	listener: TerminalInputListener,
): () => void {
	terminalInputListeners.add(listener);
	return () => {
		terminalInputListeners.delete(listener);
	};
}

type EscapeState = 'none' | 'introducer' | 'sequence';

/**
 * Advances ANSI escape-sequence parsing one character at a time.
 * @param state - Current escape-parsing state.
 * @param char - The next input character.
 * @returns The next state and whether the character belonged to an escape sequence.
 */
function stepEscapeState(
	state: EscapeState,
	char: string,
): { consumed: boolean; state: EscapeState } {
	if (state === 'introducer') {
		return {
			consumed: true,
			state: char === '[' || char === 'O' ? 'sequence' : 'none',
		};
	}
	if (state === 'sequence') {
		const terminated = char >= '@' && char <= '~';
		return { consumed: true, state: terminated ? 'none' : 'sequence' };
	}
	if (char === '\u001b') {
		return { consumed: true, state: 'introducer' };
	}
	return { consumed: false, state: 'none' };
}

/** Reduces terminal input into a command-submission signal and buffered command line. */
export function reduceTerminalInputActivity(
	buffer: string,
	data: string,
): TerminalInputActivityResult {
	let nextBuffer = buffer;
	let commandSubmitted = false;
	let escapeState: EscapeState = 'none';

	for (const char of data) {
		const escapeStep = stepEscapeState(escapeState, char);
		escapeState = escapeStep.state;
		if (escapeStep.consumed) {
			continue;
		}
		if (char === '\u0003') {
			return { commandSubmitted: false, interrupted: true, nextBuffer: '' };
		}
		if (char === '\r' || char === '\n') {
			commandSubmitted = commandSubmitted || nextBuffer.trim().length > 0;
			nextBuffer = '';
			continue;
		}
		if (char === '\b' || char === '\u007f') {
			nextBuffer = nextBuffer.slice(0, -1);
			continue;
		}
		if (char >= ' ') {
			nextBuffer += char;
		}
	}

	return { commandSubmitted, interrupted: false, nextBuffer };
}

/** Maps interactive terminal lifecycle to dock activity without treating an open shell as busy work. */
export function terminalSessionToDockStatus(
	status: TerminalSessionStatus,
): DockTabStatus {
	switch (status) {
		case 'failed':
			return 'warning';
		case 'exited':
		case 'running':
		case 'stopped':
			return 'idle';
	}
}

/**
 * Builds the terminal dock tabs for the live interactive sessions of one
 * workspace. Script-kind sessions render in the fixed Setup/Run tabs and are
 * excluded here. With no interactive session the dock shows only Setup/Run and
 * the `+` button — an empty list is returned.
 * @param options - Live sessions plus the interactive terminal ids with recent output activity.
 * @returns The terminal dock tabs (empty when no interactive session exists).
 */
export function mapTerminalSessionsToDockTabs({
	activeTerminalIds = new Set(),
	sessions,
}: {
	activeTerminalIds?: ReadonlySet<string>;
	sessions: readonly TerminalSessionSnapshot[];
}): TerminalDockTabModel[] {
	const tabs: TerminalDockTabModel[] = [];
	for (const session of sessions) {
		if (session.kind !== 'terminal') {
			continue;
		}
		tabs.push({
			id: `terminal:${session.id}` as const,
			kind: 'terminal',
			label: session.title,
			sessionStatus: session.status,
			status:
				session.status === 'running' && activeTerminalIds.has(session.id)
					? 'running'
					: terminalSessionToDockStatus(session.status),
			terminalId: session.id,
		});
	}
	return tabs;
}

/**
 * Returns a new session list with `session` inserted or replacing its existing
 * entry, preserving creation order.
 * @param sessions - Current session list.
 * @param session - Incoming snapshot (creation result or lifecycle broadcast).
 * @returns The updated list.
 */
export function upsertTerminalSession(
	sessions: readonly TerminalSessionSnapshot[],
	session: TerminalSessionSnapshot,
): TerminalSessionSnapshot[] {
	const index = sessions.findIndex((candidate) => candidate.id === session.id);

	if (index === -1) {
		return [...sessions, session];
	}

	return [...sessions.slice(0, index), session, ...sessions.slice(index + 1)];
}
