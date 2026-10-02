/**
 * Keeps a control tool call audible on the wire for as long as it is pending.
 *
 * MCP's only in-band way to say "still working" is a `notifications/progress`
 * carrying the token the caller put in the request's `_meta`; a client that
 * opted into the TypeScript SDK's `resetTimeoutOnProgress` restarts its clock on
 * each one. Without it a blocked `ensemblr_ask_user_question` is silent for as
 * long as the user is away, and a client with any timeout at all concludes the
 * server is dead.
 *
 * This is the second line of defence, not the first: none of the three
 * harnesses Ensemblr launches resets on progress, which is why
 * `mcp-tool-timeout.ts` raises their hard limits at launch. What this adds is a
 * call that is visibly alive — to those harnesses' progress UI, and to any other
 * MCP client that does honour the mechanism.
 *
 * A caller that sent no `progressToken` gets nothing: the spec has no way to
 * address a progress notification to a request that did not ask for one.
 */
import type { ServerNotification } from '@modelcontextprotocol/sdk/types.js';

/**
 * How often a pending call announces itself. Well under the 60-second default
 * every harness ships, so a client that does reset on progress gets several
 * chances before its own clock would have run out.
 */
export const MCP_PROGRESS_INTERVAL_MS = 20_000;

/** Everything {@link withProgressHeartbeat} needs beyond the call itself. */
interface ProgressHeartbeatOptions {
	/** Token from the request's `_meta`, or undefined when it carried none. */
	progressToken: string | number | undefined;
	/** Sends a notification bound to the request being handled. */
	sendNotification: (notification: ServerNotification) => Promise<void>;
	/** Tool the notification names, so a client can render which call is open. */
	toolName: string;
	/** Overrides the beat interval; tests scale it down. */
	intervalMs?: number;
}

/**
 * Runs one tool call, emitting a progress notification on an interval until it
 * settles. A send that fails stops the heartbeat rather than the call — the
 * stream is gone, but the user may still be answering.
 * @param options - Progress token, notification sink, tool name, and interval.
 * @param run - The tool call to hold open.
 * @returns Whatever the call resolves to; a rejection passes through untouched.
 */
export async function withProgressHeartbeat<T>(
	{
		intervalMs = MCP_PROGRESS_INTERVAL_MS,
		progressToken,
		sendNotification,
		toolName,
	}: ProgressHeartbeatOptions,
	run: () => Promise<T>,
): Promise<T> {
	if (progressToken === undefined) {
		return await run();
	}
	let beats = 0;
	const timer = setInterval(() => {
		beats += 1;
		sendNotification({
			method: 'notifications/progress',
			params: {
				message: `${toolName} is still running.`,
				progress: beats,
				progressToken,
			},
		}).catch(() => clearInterval(timer));
	}, intervalMs);
	try {
		return await run();
	} finally {
		clearInterval(timer);
	}
}
