import { atom, useAtom, useAtomValue, useSetAtom } from 'jotai';
import { useCallback, useEffect } from 'react';

import { subscribePiRawFrames } from '@/renderer/api/ensemblr-queries';
import type { PiRawFrameBroadcast } from '@/shared/ipc/contracts/pi-session';

/**
 * Ring-buffered store of raw Pi RPC JSONL frames captured for the debug
 * panel. Sized to keep memory bounded even during long streaming sessions.
 */
const FRAME_BUFFER_SIZE = 1000;

/**
 * Lightweight classification computed at capture time so the panel can hide
 * noisy housekeeping traffic (get_session_stats / its response) without
 * re-parsing every frame on each filter change.
 */
type FrameCategory = 'session-stats-call' | 'session-stats-response' | 'other';

/** A captured raw Pi frame plus a stable id and a precomputed category for panel filtering. */
interface BufferedFrame extends PiRawFrameBroadcast {
	id: string;
	category: FrameCategory;
}

/** Inspects the JSONL payload to detect session-stats RPC plumbing. */
function classifyFrame(frame: PiRawFrameBroadcast): FrameCategory {
	let parsed: unknown;
	try {
		parsed = JSON.parse(frame.line);
	} catch {
		return 'other';
	}
	if (!parsed || typeof parsed !== 'object') {
		return 'other';
	}
	const record = parsed as Record<string, unknown>;
	if (frame.direction === 'tx' && record.type === 'get_session_stats') {
		return 'session-stats-call';
	}
	if (frame.direction === 'rx' && record.type === 'response') {
		const command =
			typeof record.command === 'string' ? record.command.toLowerCase() : '';
		if (
			command.includes('session_stats') ||
			command.includes('sessionstats') ||
			command.includes('session-stats')
		) {
			return 'session-stats-response';
		}
		// Some Pi builds answer stats requests without echoing `command`. The
		// payload still carries a `contextUsage` block, so treat that shape as
		// a stats response too.
		const data =
			record.data && typeof record.data === 'object'
				? (record.data as Record<string, unknown>)
				: null;
		if (
			data &&
			(typeof data.contextUsage === 'object' ||
				typeof data.context_usage === 'object')
		) {
			return 'session-stats-response';
		}
	}
	return 'other';
}

/** Ring-buffered raw Pi RPC frames captured for the debug panel; in-memory only. */
const rawFramesAtom = atom<readonly BufferedFrame[]>([]);
/** Whether the raw-frames debug panel is open; in-memory only. */
const debugPanelOpenAtom = atom<boolean>(false);

/** Reads the debug panel toggle state and exposes the setter. */
export function useDebugPanelToggle(): [boolean, (open: boolean) => void] {
	const [open, setOpen] = useAtom(debugPanelOpenAtom);
	return [open, setOpen];
}

/** Reads the buffered raw frames (latest at the end). */
export function useRawFrames(): readonly BufferedFrame[] {
	return useAtomValue(rawFramesAtom);
}

/** Clears the buffered raw frames. */
export function useClearRawFrames(): () => void {
	const setAll = useSetAtom(rawFramesAtom);
	return useCallback(() => setAll([]), [setAll]);
}

/**
 * Mount-once subscription that pipes incoming raw frames into the buffer.
 * @param enabled - Whether developer diagnostics should subscribe to raw frames.
 */
export function usePiRawFrameCapture(enabled: boolean): void {
	const setAll = useSetAtom(rawFramesAtom);
	useEffect(() => {
		if (!enabled) {
			setAll([]);
			return undefined;
		}
		let counter = 0;
		const unsubscribe = subscribePiRawFrames((frame) => {
			const buffered: BufferedFrame = {
				...frame,
				category: classifyFrame(frame),
				id: `${frame.at}:${frame.direction}:${counter++}`,
			};
			setAll((prev) => {
				const next = [...prev, buffered];
				if (next.length > FRAME_BUFFER_SIZE) {
					next.splice(0, next.length - FRAME_BUFFER_SIZE);
				}
				return next;
			});
		});
		return unsubscribe;
	}, [enabled, setAll]);
}

export type { FrameCategory };
