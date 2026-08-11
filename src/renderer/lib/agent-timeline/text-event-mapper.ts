import type {
	StreamingTextPart,
	UIMessagePart,
} from '@/renderer/types/agent-timeline';
import { parentToolCallIdOf } from './subagent-parts.ts';

/**
 * Folds an incoming streaming text or reasoning part into the parts array,
 * concatenating its text into the most recent same-type streaming part if one
 * is still open.
 *
 * Scanning stops at the first non-streaming part of the same type so that
 * deltas do not retroactively bleed into a paragraph that has already been
 * sealed (e.g. by an intervening tool call). When no live buffer is found the
 * delta is pushed as a fresh streaming entry.
 *
 * Only a buffer belonging to the same thread can be joined: Claude interleaves a
 * subagent's deltas with the main thread's, so matching on type alone would
 * splice a delegate's prose into the middle of the agent's own paragraph.
 */
export function mergeStreamingTextPart(
	merged: UIMessagePart[],
	incoming: StreamingTextPart,
): UIMessagePart[] {
	const incomingOwner = parentToolCallIdOf(incoming);
	for (let index = merged.length - 1; index >= 0; index -= 1) {
		const candidate = merged[index];
		if (candidate === undefined) {
			continue;
		}
		const isSameThread = parentToolCallIdOf(candidate) === incomingOwner;
		if (
			isSameThread &&
			isStreamingTextPart(candidate) &&
			candidate.type === incoming.type
		) {
			const next = [...merged];
			next[index] = {
				...candidate,
				text: candidate.text + incoming.text,
			};
			return next;
		}
		// Stop scanning once we cross any non-streaming-of-same-type boundary so
		// deltas don't fold into a paragraph emitted before a tool ran.
		if (
			isSameThread &&
			(candidate.type === 'text' || candidate.type === 'reasoning') &&
			candidate.type === incoming.type &&
			'state' in candidate &&
			candidate.state !== 'streaming'
		) {
			break;
		}
	}
	return [...merged, incoming];
}

/**
 * Removes the given thread's in-flight streaming parts of `type` from `parts`.
 *
 * Called when a `done` text or reasoning part arrives so the finalized copy
 * supersedes whatever was being streamed in. Scoped to the thread that sealed,
 * so a subagent finishing its prose cannot delete the main agent's in-flight
 * paragraph — or the other way round.
 * @param parts - The parts accumulated for the turn so far
 * @param type - Which streaming parts the arriving seal supersedes
 * @param parentToolCallId - Thread that sealed, or null for the main thread
 * @returns The parts with that thread's matching streaming entries removed
 */
export function dropStreamingPartsOfType(
	parts: readonly UIMessagePart[],
	type: 'text' | 'reasoning',
	parentToolCallId: string | null = null,
): UIMessagePart[] {
	return parts.filter(
		(part) =>
			!(
				isStreamingTextPart(part) &&
				part.type === type &&
				parentToolCallIdOf(part) === parentToolCallId
			),
	);
}

/** True when `part` is a text or reasoning part still accumulating deltas. */
export function isStreamingTextPart(
	part: UIMessagePart,
): part is StreamingTextPart {
	return (
		(part.type === 'text' || part.type === 'reasoning') &&
		'state' in part &&
		part.state === 'streaming'
	);
}

/** True when `part` is a finalized text or reasoning part. */
export function isDoneTextPart(part: UIMessagePart): part is Extract<
	UIMessagePart,
	{ type: 'text' | 'reasoning' }
> & {
	state: 'done';
} {
	return (
		(part.type === 'text' || part.type === 'reasoning') &&
		'state' in part &&
		part.state === 'done'
	);
}
