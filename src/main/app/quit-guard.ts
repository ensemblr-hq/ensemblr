/**
 * Confirmation gate in front of app quit while agents are still working.
 *
 * Every quit gesture — ⌘Q, the app-menu Quit, the Dock Quit — reaches
 * `before-quit`, which tears down every Pi RPC child and PTY inside a three
 * second grace. This decides whether that teardown gets to run unannounced.
 *
 * Two independent things count as an agent at work, and the dialog must agree
 * with what the sidebar already shows the user: a chat session mid-turn (from
 * the activity monitor) and a harness terminal mid-turn (from the terminal
 * service, using the same busy predicate the renderer applies). Every
 * dependency is injected so this stays free of the `electron` import.
 */

import type { AppLanguage } from '../../shared/i18n.ts';
import type { TerminalSessionSnapshot } from '../../shared/ipc/contracts/terminal.ts';
import {
	isHarnessTitleBusy,
	stripHarnessTitleDecoration,
} from '../../shared/terminal.ts';
import type { RunningAgentSession } from '../agent-runtime/agent-activity-monitor.ts';
import {
	type QuitGuardStrings,
	quitGuardStrings,
} from './quit-guard-strings.ts';

/** How many running agents the dialog names before collapsing the rest to a count. */
const MAX_LISTED_AGENTS = 6;
/** Index of the button that keeps the app alive; also the default and the Esc target. */
const CANCEL_BUTTON_INDEX = 0;
/** Index of the button that lets the quit proceed. */
const QUIT_BUTTON_INDEX = 1;

/** A native message box, narrowed to what the quit confirmation needs. */
export interface QuitConfirmRequest {
	buttons: string[];
	cancelId: number;
	defaultId: number;
	detail: string;
	message: string;
}

/** Options for {@link createQuitGuard}. */
export interface QuitGuardOptions {
	/**
	 * Shows the confirmation and resolves to the index of the button pressed.
	 * Returning the index rather than a verdict keeps every fact about the button
	 * order inside this module.
	 */
	confirm: (request: QuitConfirmRequest) => Promise<number>;
	/** Reads the app's resolved UI language at the moment of the prompt. */
	getLanguage: () => AppLanguage;
	/** Whether a window is alive to host the dialog. */
	hasWindow: () => boolean;
	/** Every live terminal session of kind `agent`, across all workspaces. */
	listAgentTerminals: () => readonly TerminalSessionSnapshot[];
	/** Every chat session mid-turn, across all workspaces. */
	listRunningSessions: () => readonly RunningAgentSession[];
	/** Workspace id → display name, for naming what is still running. */
	listWorkspaceNames: () => Promise<ReadonlyMap<string, string>>;
	/**
	 * The chat's title, so a running chat names what it is working on rather than
	 * rendering as one more indistinguishable bullet. Null when nobody has named
	 * it yet.
	 */
	readChatTitle: (sessionId: string) => string | null;
}

/** Public surface of the quit guard. */
export interface QuitGuard {
	/** Resolves true when the quit may proceed. */
	confirmQuit: () => Promise<boolean>;
}

/** One running agent as the dialog lists it. */
interface RunningAgentEntry {
	/** What it is working on, or null when nothing meaningful is known yet. */
	detail: string | null;
	workspaceName: string;
}

/**
 * Reports whether a harness terminal is mid-turn. Mirrors the renderer's
 * `useWorkspaceAgentBusy` exactly — a spinner-less harness reports through
 * `agentBusy`, every other one animates a braille frame in its OSC title — so
 * this dialog and the sidebar badge can never disagree.
 * @param session - An agent-kind terminal session snapshot.
 * @returns True when the harness is working right now.
 */
function isHarnessBusy(session: TerminalSessionSnapshot): boolean {
	return (
		session.status === 'running' &&
		(session.agentBusy || isHarnessTitleBusy(session.title))
	);
}

/**
 * Picks the conversation text to show beside a busy harness terminal, preferring
 * the title read from its session log over the OSC title it animates.
 * @param session - A busy agent-kind terminal session snapshot.
 * @returns The conversation title, or null when the session has yet to name one.
 */
function harnessDetail(session: TerminalSessionSnapshot): string | null {
	if (session.agentTitle) {
		return session.agentTitle;
	}
	if (session.titleIsDefault) {
		return null;
	}
	const stripped = stripHarnessTitleDecoration(session.title);
	return stripped.length > 0 ? stripped : null;
}

/**
 * Builds the dialog's list of running agents, sorted so repeated prompts render
 * in the same order. `localeCompare` rather than `<`, both so equal entries
 * compare as equal — two chats in one workspace key identically, and a
 * comparator that never returns 0 forfeits their insertion order — and so a
 * Cyrillic or Greek workspace name sorts among its peers rather than after
 * every Latin one.
 * @param input - The running sessions and terminals, workspace names, and the chat-title reader.
 * @returns The entries to list, in display order.
 */
function buildEntries({
	readChatDetail,
	sessions,
	terminals,
	workspaceNames,
}: {
	readChatDetail: (sessionId: string) => string;
	sessions: readonly RunningAgentSession[];
	terminals: readonly TerminalSessionSnapshot[];
	workspaceNames: ReadonlyMap<string, string>;
}): RunningAgentEntry[] {
	const nameOf = (workspaceId: string): string =>
		workspaceNames.get(workspaceId) ?? workspaceId;
	const entries: RunningAgentEntry[] = [
		...sessions.map((session) => ({
			detail: readChatDetail(session.sessionId),
			workspaceName: nameOf(session.workspaceId),
		})),
		...terminals.map((terminal) => ({
			detail: harnessDetail(terminal),
			workspaceName: nameOf(terminal.workspaceId),
		})),
	];
	const sortKey = (entry: RunningAgentEntry): string =>
		`${entry.workspaceName}\u0000${entry.detail ?? ''}`;
	return [...entries].sort((left, right) =>
		sortKey(left).localeCompare(sortKey(right)),
	);
}

/**
 * Renders the dialog body: the consequence, then a bullet per running agent,
 * capped so a busy machine cannot produce a dialog taller than the screen.
 * @param entries - The running agents, already in display order.
 * @param strings - Copy in the app's language.
 * @returns The `detail` text for the message box.
 */
function renderDetail(
	entries: readonly RunningAgentEntry[],
	strings: QuitGuardStrings,
): string {
	const listed = entries.slice(0, MAX_LISTED_AGENTS);
	const lines = listed.map((entry) =>
		entry.detail
			? `• ${entry.workspaceName} — ${entry.detail}`
			: `• ${entry.workspaceName}`,
	);
	const hidden = entries.length - listed.length;
	if (hidden > 0) {
		lines.push(strings.more.replace('{{count}}', String(hidden)));
	}
	return [strings.detailIntro, '', ...lines].join('\n');
}

/**
 * Builds the quit guard.
 * @param options - The injected readers, language source, and confirm surface.
 * @returns A guard whose `confirmQuit` decides whether quit may proceed.
 */
export function createQuitGuard(options: QuitGuardOptions): QuitGuard {
	const readWorkspaceNames = async (): Promise<ReadonlyMap<string, string>> => {
		try {
			return await options.listWorkspaceNames();
		} catch (error) {
			console.warn('[quit-guard] could not read workspace names', error);
			return new Map();
		}
	};

	/**
	 * Names what a running chat is working on, falling back to the generic word
	 * for a chat nobody has titled yet — and for one whose title cannot be read,
	 * because an unreadable row must cost the bullet its detail, not the user
	 * their confirmation.
	 * @param sessionId - The running chat session.
	 * @param strings - Copy in the app's language.
	 * @returns The chat's title, or the localized word for a chat.
	 */
	const readChatDetail = (
		sessionId: string,
		strings: QuitGuardStrings,
	): string => {
		try {
			return options.readChatTitle(sessionId)?.trim() || strings.chat;
		} catch (error) {
			console.warn('[quit-guard] could not read a chat title', error);
			return strings.chat;
		}
	};

	const confirmQuit = async (): Promise<boolean> => {
		// Nothing is left to host a dialog once the last window is gone, and
		// cancelling there would strand a windowless process the user can only
		// reach through the Dock. Fail open instead.
		if (!options.hasWindow()) {
			return true;
		}
		const sessions = options.listRunningSessions();
		const terminals = options.listAgentTerminals().filter(isHarnessBusy);
		if (sessions.length === 0 && terminals.length === 0) {
			return true;
		}
		const strings = quitGuardStrings(options.getLanguage());
		const entries = buildEntries({
			readChatDetail: (sessionId) => readChatDetail(sessionId, strings),
			sessions,
			terminals,
			workspaceNames: await readWorkspaceNames(),
		});
		const response = await options.confirm({
			buttons: [strings.cancel, strings.quitAnyway],
			cancelId: CANCEL_BUTTON_INDEX,
			defaultId: CANCEL_BUTTON_INDEX,
			detail: renderDetail(entries, strings),
			message: strings.message,
		});
		return response === QUIT_BUTTON_INDEX;
	};

	return { confirmQuit };
}
