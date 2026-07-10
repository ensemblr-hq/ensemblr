/** Start and end timestamps in milliseconds for one assistant turn, used to derive its duration. */
export interface ChatAssistantTurnTiming {
	endMs: number | null;
	startMs: number;
}
