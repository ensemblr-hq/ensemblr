/**
 * The one round trip `startReview` makes into the renderer: main asks a window
 * to compose the review prompt the Review button would compose, and the window
 * answers with it.
 *
 * It is a request rather than a mirror the renderer pushes because the answer
 * has to be current — the user's review instructions and their review model both
 * change from Settings — and a value cached in main would go stale silently.
 */

/** Main asking every window to compose a workspace's review prompt. */
export interface ReviewBriefRequestedBroadcast {
	requestId: string;
	workspaceId: string;
}

/**
 * A window's answer. `prompt` empty means "not mine to answer" — the window
 * holds no live model for that workspace — and main falls back to composing the
 * brief itself rather than opening a review on an empty prompt.
 */
export interface ReviewBriefReply {
	requestId: string;
	prompt: string;
	/** The model the user pinned for reviews, when they pinned one. */
	model?: string | null;
	/** The thinking level the user pinned for reviews, when they pinned one. */
	thinkingLevel?: string | null;
}
