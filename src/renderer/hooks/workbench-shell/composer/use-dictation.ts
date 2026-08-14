import { useCallback, useEffect, useRef, useState } from 'react';

import { transcribeAudio } from '@/renderer/api/ensemblr';
import { preferredRecorderMimeType } from '@/renderer/lib/dictation';
import {
	MAX_DICTATION_AUDIO_BYTES,
	MAX_DICTATION_CLIP_MS,
} from '@/shared/dictation-limits';
import type { DictationFailure } from '@/shared/ipc/contracts/dictation';

/** How often the recording timer re-renders its elapsed readout. */
const ELAPSED_TICK_MS = 250;

/** Where a dictation attempt currently stands. */
export type DictationPhase =
	| 'idle'
	| 'recording'
	| 'requesting'
	| 'transcribing';

/** What the composer's mic control reads and drives. */
export interface DictationControl {
	/** False when dictation is off or unconfigured, which hides the control entirely. */
	available: boolean;
	elapsedMs: number;
	failure: DictationFailure | null;
	phase: DictationPhase;
	/** Starts recording when idle, stops and transcribes while recording. */
	toggle: () => void;
}

/**
 * Maps a `getUserMedia` rejection onto the dictation failure vocabulary. The
 * browser reports permission refusal and absent hardware as distinct names, and
 * they need different advice.
 * @param error - Whatever `getUserMedia` rejected with
 * @returns The failure to surface
 */
function captureFailure(error: unknown): DictationFailure {
	const name = error instanceof Error ? error.name : '';

	if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
		return {
			code: 'dictation-microphone-missing',
			// i18next-instrument-ignore -- English fallback behind the code
			message: 'No microphone was found.',
		};
	}

	return {
		code: 'dictation-microphone-denied',
		// i18next-instrument-ignore -- English fallback behind the code
		message: 'Microphone access was denied.',
	};
}

/**
 * Owns one composer's voice dictation: microphone capture, the elapsed-time
 * readout, and the single transcription request made when recording stops.
 *
 * The recorded clip is transcribed in one batch rather than streamed, so the
 * transcript arrives whole and lands at the caret through `onTranscript`.
 * Nothing here sends the draft — the user always presses send.
 *
 * @param options - Whether dictation is available, and where a transcript goes
 * @returns The state and controls the mic button binds to
 */
export function useDictation({
	enabled,
	onTranscript,
}: {
	enabled: boolean;
	onTranscript: (text: string) => void;
}): DictationControl {
	const [phase, setPhase] = useState<DictationPhase>('idle');
	const [elapsedMs, setElapsedMs] = useState(0);
	const [failure, setFailure] = useState<DictationFailure | null>(null);

	const mountedRef = useRef(true);
	const streamRef = useRef<MediaStream | null>(null);
	const recorderRef = useRef<MediaRecorder | null>(null);
	const chunksRef = useRef<Blob[]>([]);
	const discardRef = useRef(false);
	const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
	const limitRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const startedAtRef = useRef(0);
	const onTranscriptRef = useRef(onTranscript);

	useEffect(() => {
		onTranscriptRef.current = onTranscript;
	});

	/** Stops the elapsed-time interval and the maximum-duration timer. */
	const clearTimers = useCallback(() => {
		if (tickRef.current !== null) {
			clearInterval(tickRef.current);
			tickRef.current = null;
		}
		if (limitRef.current !== null) {
			clearTimeout(limitRef.current);
			limitRef.current = null;
		}
	}, []);

	/**
	 * Releases the microphone. Every exit path runs this: a track left live keeps
	 * the macOS recording indicator lit, which reads as the app still listening.
	 */
	const releaseStream = useCallback(() => {
		for (const track of streamRef.current?.getTracks() ?? []) {
			track.stop();
		}
		streamRef.current = null;
		recorderRef.current = null;
		chunksRef.current = [];
	}, []);

	/**
	 * Sends the recorded clip for transcription and hands the text to the
	 * composer, leaving the control idle either way.
	 *
	 * Every exit resets the phase, including a rejected IPC call: `transcribing`
	 * disables the mic button, so a phase left set there is a control the user
	 * cannot recover without remounting the composer.
	 * @param mimeType - Container the clip was recorded in
	 * @param durationMs - How long the clip ran, which scales the request deadline
	 */
	const submitRecording = useCallback(
		async (mimeType: string, durationMs: number) => {
			const clip = new Blob(chunksRef.current, { type: mimeType });
			releaseStream();

			if (clip.size === 0) {
				if (mountedRef.current) {
					setPhase('idle');
				}
				return;
			}

			if (clip.size > MAX_DICTATION_AUDIO_BYTES) {
				if (mountedRef.current) {
					setPhase('idle');
					setFailure({
						code: 'dictation-too-large',
						// i18next-instrument-ignore -- English fallback behind the code
						message: 'The recording is too long to transcribe in one request.',
					});
				}
				return;
			}

			try {
				const audio = new Uint8Array(await clip.arrayBuffer());
				const result = await transcribeAudio({ audio, durationMs, mimeType });

				if (!mountedRef.current) {
					return;
				}

				setPhase('idle');

				if (result.status === 'error') {
					setFailure(result.failure);
					return;
				}

				onTranscriptRef.current(result.text);
			} catch (error) {
				console.error('[dictation] the transcription request failed', error);

				if (mountedRef.current) {
					setPhase('idle');
					setFailure({
						code: 'dictation-provider-error',
						// i18next-instrument-ignore -- English fallback behind the code
						message: 'The transcription request could not be completed.',
					});
				}
			}
		},
		[releaseStream],
	);

	/**
	 * Ends the recording, transcribing what was captured. `MediaRecorder.stop()`
	 * throws on an already-stopped recorder, and `phase` only leaves `recording`
	 * once `onstop` fires — so a second click in that window reaches here with a
	 * recorder that is already inactive.
	 */
	const stop = useCallback(() => {
		clearTimers();
		if (recorderRef.current?.state === 'recording') {
			recorderRef.current.stop();
		}
	}, [clearTimers]);

	/** Begins capture, surfacing a failure when the microphone is unavailable. */
	const start = useCallback(async () => {
		const mimeType = preferredRecorderMimeType();

		if (
			!mimeType ||
			typeof navigator.mediaDevices?.getUserMedia !== 'function'
		) {
			setFailure({
				code: 'dictation-recorder-unavailable',
				// i18next-instrument-ignore -- English fallback behind the code
				message: 'Audio recording is not available in this build.',
			});
			return;
		}

		setFailure(null);
		setPhase('requesting');

		let stream: MediaStream;

		try {
			stream = await navigator.mediaDevices.getUserMedia({
				audio: { echoCancellation: true, noiseSuppression: true },
			});
		} catch (error) {
			if (mountedRef.current) {
				setPhase('idle');
				setFailure(captureFailure(error));
			}
			return;
		}

		// The user may have cancelled or navigated away while the OS prompt was up.
		if (!mountedRef.current) {
			for (const track of stream.getTracks()) {
				track.stop();
			}
			return;
		}

		const recorder = new MediaRecorder(stream, { mimeType });
		streamRef.current = stream;
		recorderRef.current = recorder;
		chunksRef.current = [];
		discardRef.current = false;

		recorder.ondataavailable = (event: BlobEvent) => {
			if (event.data.size > 0) {
				chunksRef.current = [...chunksRef.current, event.data];
			}
		};

		recorder.onstop = () => {
			if (discardRef.current) {
				releaseStream();
				return;
			}
			if (mountedRef.current) {
				setPhase('transcribing');
			}
			void submitRecording(
				mimeType,
				Math.round(performance.now() - startedAtRef.current),
			);
		};

		const startedAt = performance.now();
		startedAtRef.current = startedAt;
		setElapsedMs(0);
		setPhase('recording');
		recorder.start();

		tickRef.current = setInterval(() => {
			setElapsedMs(performance.now() - startedAt);
		}, ELAPSED_TICK_MS);
		limitRef.current = setTimeout(stop, MAX_DICTATION_CLIP_MS);
	}, [releaseStream, stop, submitRecording]);

	const toggle = useCallback(() => {
		if (!enabled) {
			return;
		}
		if (phase === 'recording') {
			stop();
			return;
		}
		if (phase === 'idle') {
			void start();
		}
	}, [enabled, phase, start, stop]);

	useEffect(() => {
		mountedRef.current = true;
		return () => {
			mountedRef.current = false;
			clearTimers();
			discardRef.current = true;
			if (recorderRef.current?.state === 'recording') {
				recorderRef.current.stop();
			}
			releaseStream();
		};
	}, [clearTimers, releaseStream]);

	return { available: enabled, elapsedMs, failure, phase, toggle };
}
