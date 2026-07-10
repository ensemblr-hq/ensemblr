import type { ChatTabRow } from '../storage/repositories/chat-tab-repository.ts';
import type { PiEventRow } from '../storage/repositories/pi-event-repository.ts';
import type { PiSessionRow } from '../storage/repositories/pi-session-repository.ts';

/** Snapshot of a persisted Pi session's state, including its open chat tabs and runtime status. */
export interface PiSessionSnapshot {
	branchId: string;
	closedAt: string | null;
	createdAt: string;
	cwd: string;
	id: string;
	label: string | null;
	model: string | null;
	openedTabs: readonly ChatTabRow[];
	piSessionId: string | null;
	runtimeOpen: boolean;
	status: PiSessionRow['status'];
	thinkingLevel: string | null;
	updatedAt: string;
	workspaceId: string;
}

/** Side-channel called once per persisted event so callers can broadcast it. */
export type PiSessionEventSink = (input: {
	event: PiEventRow;
	sessionId: string;
	workspaceId: string;
}) => void;
