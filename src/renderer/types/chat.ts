/** Start and end timestamps in milliseconds for one assistant turn, used to derive its duration. */
export interface ChatAssistantTurnTiming {
	endMs: number | null;
	startMs: number;
}

/**
 * Where a conversation viewport was left, so re-opening its tab lands in the
 * same place. `stuckToBottom` records that the viewport was following the
 * newest message rather than parked at a fixed offset, so it keeps following
 * instead of freezing at a position the stream has since grown past.
 */
export interface ConversationScrollOffset {
	scrollTop: number;
	stuckToBottom: boolean;
}
