import type { StreamingTextPart, UIMessagePart } from './types';

/**
 * Folds an incoming streaming text or reasoning part into the parts array,
 * concatenating its text into the most recent same-type streaming part if one
 * is still open.
 *
 * Scanning stops at the first non-streaming part of the same type so that
 * deltas do not retroactively bleed into a paragraph that has already been
 * sealed (e.g. by an intervening tool call). When no live buffer is found the
 * delta is pushed as a fresh streaming entry.
 */
export function mergeStreamingTextPart(
	merged: UIMessagePart[],
	incoming: StreamingTextPart,
): UIMessagePart[] {
	for (let index = merged.length - 1; index >= 0; index -= 1) {
		const candidate = merged[index];
		if (candidate === undefined) {
			continue;
		}
		if (isStreamingTextPart(candidate) && candidate.type === incoming.type) {
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
 * Removes any in-flight streaming parts of the given type from `parts`.
 *
 * Called when a `done` text or reasoning part arrives so the finalized copy
 * supersedes whatever was being streamed in.
 */
export function dropStreamingPartsOfType(
	parts: readonly UIMessagePart[],
	type: 'text' | 'reasoning',
): UIMessagePart[] {
	return parts.filter(
		(part) => !(isStreamingTextPart(part) && part.type === type),
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
