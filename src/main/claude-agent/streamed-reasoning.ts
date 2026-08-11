/**
 * Collects the reasoning text Claude only ever sends as stream deltas.
 *
 * The SDK seals an assistant message with its `thinking` blocks already
 * emptied — `{ type: 'thinking', thinking: '', signature }` — so the block the
 * seal carries has no text to persist. The content arrives beforehand as
 * `thinking_delta` stream events keyed by their content-block index, which this
 * buffer accumulates so the seal can be refilled before it reaches the
 * timeline. Without it a turn's reasoning survives only as ephemeral deltas and
 * disappears the moment the timeline rehydrates from persisted events.
 *
 * The buffer owns the whole lifecycle of a block's text: `take` consumes what
 * it returns, so text can never be handed to a second block, and `reset` clears
 * whatever a message left behind unconsumed.
 */
export interface StreamedReasoning {
	/**
	 * Appends one `thinking_delta` chunk to the block at `index`.
	 * @param index - Content-block index the delta belongs to.
	 * @param text - The chunk of reasoning text.
	 */
	append: (index: number, text: string) => void;
	/** Drops everything collected, at each message boundary. */
	reset: () => void;
	/**
	 * Consumes the text collected for one content block, so the same reasoning
	 * can never refill a second block.
	 * @param index - Content-block index to take.
	 * @returns The accumulated reasoning, or null when nothing was collected.
	 */
	take: (index: number) => string | null;
}

/**
 * Holds one {@link StreamedReasoning} buffer per conversation thread.
 *
 * Claude forwards a subagent's stream events interleaved with the main thread's,
 * and both number their content blocks from zero, so a single session-wide
 * buffer would let one thread's `message_start` clear the other's banked text
 * and let one thread's seal consume reasoning the other produced.
 */
export interface StreamedReasoningByThread {
	/**
	 * The buffer owned by one thread, created on first use.
	 * @param parentToolCallId - Tool call whose subagent owns the thread, or null on the main thread.
	 * @returns That thread's reasoning buffer.
	 */
	forThread: (parentToolCallId: string | null) => StreamedReasoning;
}

/**
 * Creates an empty per-thread {@link StreamedReasoning} registry for one session.
 * @returns A registry that hands each thread its own buffer.
 */
export function createStreamedReasoningByThread(): StreamedReasoningByThread {
	const buffersByThread = new Map<string, StreamedReasoning>();

	return {
		forThread: (parentToolCallId) => {
			const threadKey = parentToolCallId ?? '';
			const existing = buffersByThread.get(threadKey);
			if (existing) {
				return existing;
			}
			const created = createStreamedReasoning();
			buffersByThread.set(threadKey, created);
			return created;
		},
	};
}

/**
 * Creates an empty {@link StreamedReasoning} buffer for one thread.
 * @returns A buffer scoped to the assistant message currently streaming.
 */
export function createStreamedReasoning(): StreamedReasoning {
	const chunksByIndex = new Map<number, string[]>();

	return {
		append: (index, text) => {
			const chunks = chunksByIndex.get(index);
			if (chunks) {
				chunks.push(text);
				return;
			}
			chunksByIndex.set(index, [text]);
		},
		reset: () => {
			chunksByIndex.clear();
		},
		take: (index) => {
			const chunks = chunksByIndex.get(index);
			chunksByIndex.delete(index);
			return chunks && chunks.length > 0 ? chunks.join('') : null;
		},
	};
}
