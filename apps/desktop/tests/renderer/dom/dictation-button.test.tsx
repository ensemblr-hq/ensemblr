// @vitest-environment happy-dom

import { renderHook, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { DictationButton } from '../../../src/renderer/components/workbench-shell/conversation-panel/composer/dictation-button';
import {
	type DictationControl,
	useDictation,
} from '../../../src/renderer/hooks/workbench-shell/composer/use-dictation';
import {
	clearEnsemblrApi,
	installEnsemblrApi,
	renderWithProviders,
} from '../support/dom';

/** Tracks the microphone tracks handed out, so a leak is visible to the tests. */
const tracks: { stop: ReturnType<typeof vi.fn> }[] = [];

/** The recorder instances the hook created, newest last. */
const recorders: FakeMediaRecorder[] = [];

/**
 * Minimal `MediaRecorder` stand-in. happy-dom ships none, and the real one
 * needs a live audio device — the tests drive `emit`/`stop` by hand instead.
 */
class FakeMediaRecorder {
	static isTypeSupported = () => true;

	ondataavailable: ((event: { data: Blob }) => void) | null = null;
	onstop: (() => void) | null = null;
	state: 'inactive' | 'recording' = 'inactive';

	constructor(
		readonly stream: MediaStream,
		readonly options: { mimeType: string },
	) {
		recorders.push(this);
	}

	start() {
		this.state = 'recording';
	}

	/**
	 * Mirrors the spec: `state` flips synchronously and throws on a repeat call,
	 * while `dataavailable`/`stop` are queued. That gap is where a second click
	 * lands, so collapsing it would hide the bug this file guards.
	 */
	stop() {
		if (this.state === 'inactive') {
			throw new DOMException('recorder is not recording', 'InvalidStateError');
		}
		this.state = 'inactive';
		queueMicrotask(() => {
			this.ondataavailable?.({ data: new Blob(['audio-bytes']) });
			this.onstop?.();
		});
	}
}

/** Installs a microphone whose `getUserMedia` resolves or rejects on demand. */
function installMicrophone(rejection?: Error) {
	const track = { stop: vi.fn() };
	tracks.push(track);
	const stream = { getTracks: () => [track] } as unknown as MediaStream;

	Object.defineProperty(navigator, 'mediaDevices', {
		configurable: true,
		value: {
			getUserMedia: vi.fn(async () => {
				if (rejection) throw rejection;
				return stream;
			}),
		},
	});

	return track;
}

/** Renders the hook, wiring its transcript into a spy the tests assert on. */
function renderDictation(enabled = true) {
	const onTranscript = vi.fn();
	const view = renderHook(() => useDictation({ enabled, onTranscript }));
	return { ...view, onTranscript };
}

beforeEach(() => {
	tracks.length = 0;
	recorders.length = 0;
	vi.stubGlobal('MediaRecorder', FakeMediaRecorder);
	installEnsemblrApi({
		transcribeAudio: vi.fn(async () => ({
			status: 'ok',
			text: 'fix the parser',
		})),
	});
});

afterEach(() => {
	vi.unstubAllGlobals();
	clearEnsemblrApi();
	// The stub was defined straight onto the shared happy-dom navigator, so it
	// outlives the test file unless it is taken back off.
	Reflect.deleteProperty(navigator, 'mediaDevices');
});

describe('the dictation control', () => {
	test('stays out of the control row until dictation is available', () => {
		const dictation = {
			available: false,
			elapsedMs: 0,
			failure: null,
			phase: 'idle',
			toggle: vi.fn(),
		} satisfies DictationControl;

		renderWithProviders(<DictationButton dictation={dictation} />);

		expect(screen.queryByRole('button')).toBeNull();
	});

	test('toggles on click once available', async () => {
		const toggle = vi.fn();
		const dictation = {
			available: true,
			elapsedMs: 0,
			failure: null,
			phase: 'idle',
			toggle,
		} satisfies DictationControl;

		renderWithProviders(<DictationButton dictation={dictation} />);
		await userEvent.click(screen.getByRole('button'));

		expect(toggle).toHaveBeenCalledOnce();
	});

	test('is not clickable while a clip is being transcribed', () => {
		const dictation = {
			available: true,
			elapsedMs: 0,
			failure: null,
			phase: 'transcribing',
			toggle: vi.fn(),
		} satisfies DictationControl;

		renderWithProviders(<DictationButton dictation={dictation} />);

		expect(screen.getByRole('button')).toBeDisabled();
	});
});

describe('the dictation recorder', () => {
	test('records, transcribes, and hands the text back', async () => {
		installMicrophone();
		const { result, onTranscript } = renderDictation();

		await act(async () => result.current.toggle());
		expect(result.current.phase).toBe('recording');

		await act(async () => result.current.toggle());
		await waitFor(() =>
			expect(onTranscript).toHaveBeenCalledWith('fix the parser'),
		);
		expect(result.current.phase).toBe('idle');
	});

	test('releases the microphone once the clip is sent', async () => {
		const track = installMicrophone();
		const { result } = renderDictation();

		await act(async () => result.current.toggle());
		await act(async () => result.current.toggle());

		await waitFor(() => expect(track.stop).toHaveBeenCalled());
	});

	test('releases the microphone when the composer unmounts mid-recording', async () => {
		const track = installMicrophone();
		const { result, unmount } = renderDictation();

		await act(async () => result.current.toggle());
		unmount();

		expect(track.stop).toHaveBeenCalled();
	});

	test('surfaces a refused microphone as a coded failure', async () => {
		installMicrophone(
			Object.assign(new Error('denied'), { name: 'NotAllowedError' }),
		);
		const { result } = renderDictation();

		await act(async () => result.current.toggle());

		expect(result.current.failure?.code).toBe('dictation-microphone-denied');
		expect(result.current.phase).toBe('idle');
	});

	test('distinguishes an absent microphone from a refused one', async () => {
		installMicrophone(
			Object.assign(new Error('none'), { name: 'NotFoundError' }),
		);
		const { result } = renderDictation();

		await act(async () => result.current.toggle());

		expect(result.current.failure?.code).toBe('dictation-microphone-missing');
	});

	test('does nothing while dictation is unavailable', async () => {
		installMicrophone();
		const { result } = renderDictation(false);

		await act(async () => result.current.toggle());

		expect(result.current.phase).toBe('idle');
		expect(recorders).toHaveLength(0);
	});

	test('reports how long the clip ran, which sets the request deadline', async () => {
		const transcribeAudio = vi.fn(async () => ({
			status: 'ok' as const,
			text: 'fix the parser',
		}));
		installMicrophone();
		installEnsemblrApi({ transcribeAudio });
		const { result } = renderDictation();

		await act(async () => result.current.toggle());
		await act(async () => result.current.toggle());

		await waitFor(() =>
			expect(transcribeAudio).toHaveBeenCalledWith(
				expect.objectContaining({ durationMs: expect.any(Number) }),
			),
		);
	});

	test('survives a second stop before the recorder has finished stopping', async () => {
		installMicrophone();
		const { result } = renderDictation();

		await act(async () => result.current.toggle());
		// `phase` only leaves `recording` once `onstop` fires, so the button is
		// still live here — and the real recorder throws on a repeat `stop()`.
		await act(async () => {
			result.current.toggle();
			result.current.toggle();
		});

		expect(result.current.failure).toBeNull();
		await waitFor(() => expect(result.current.phase).toBe('idle'));
	});

	test('recovers the control when the transcription request rejects', async () => {
		const error = vi.spyOn(console, 'error').mockImplementation(() => {});
		installMicrophone();
		installEnsemblrApi({
			transcribeAudio: vi.fn(async () => {
				throw new Error('ipc channel is gone');
			}),
		});
		const { result } = renderDictation();

		await act(async () => result.current.toggle());
		await act(async () => result.current.toggle());

		// A phase left at `transcribing` disables the mic for good: nothing in the
		// UI resets it, so the composer has to be remounted to dictate again.
		await waitFor(() => expect(result.current.phase).toBe('idle'));
		expect(result.current.failure?.code).toBe('dictation-provider-error');

		error.mockRestore();
	});
});
