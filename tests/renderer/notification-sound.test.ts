import { afterAll, afterEach, beforeEach, expect, test, vi } from 'vitest';

import { playNotificationSound } from '../../src/renderer/lib/notification-sound';

const play = vi.fn<() => Promise<void>>();

/** Stands in for the single `HTMLAudioElement` the player builds and reuses. */
class FakeAudio {
	static instances = 0;
	static last: FakeAudio | null = null;
	currentTime = 7;
	constructor() {
		FakeAudio.instances += 1;
		FakeAudio.last = this;
	}
	play() {
		return play();
	}
}

// The player's throttle keeps module state, so the clock only ever moves
// forward across this file — winding it back would make one test's last play
// look like it happened in another test's future.
let clock = Date.parse('2026-08-14T12:00:00.000Z');

/** Moves the shared clock forward and returns the new instant. */
function advance(ms: number): void {
	clock += ms;
	vi.setSystemTime(clock);
}

beforeEach(() => {
	play.mockReset();
	play.mockResolvedValue(undefined);
	vi.stubGlobal('Audio', FakeAudio);
	vi.useFakeTimers();
	advance(60_000);
});

afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

afterAll(() => {
	expect(FakeAudio.instances).toBe(1);
});

test('plays the chime', () => {
	playNotificationSound();
	expect(play).toHaveBeenCalledTimes(1);
});

test('rewinds the element so a chime is never cut short', () => {
	playNotificationSound();
	const audio = FakeAudio.last;
	expect(audio).not.toBeNull();
	if (audio) {
		audio.currentTime = 7;
	}
	advance(2_200);
	playNotificationSound();
	expect(audio?.currentTime).toBe(0);
});

test('collapses a burst of notifications into one chime', () => {
	playNotificationSound();
	advance(400);
	playNotificationSound();
	advance(500);
	playNotificationSound();
	expect(play).toHaveBeenCalledTimes(1);
});

test('stays quiet while the clip is still sounding', () => {
	playNotificationSound();
	advance(1_700);
	playNotificationSound();
	expect(play).toHaveBeenCalledTimes(1);
});

test('plays again once the gap has passed', () => {
	playNotificationSound();
	advance(2_200);
	playNotificationSound();
	expect(play).toHaveBeenCalledTimes(2);
});

test('survives a refused playback', async () => {
	play.mockRejectedValue(new Error('no audio output device'));
	const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
	expect(() => playNotificationSound()).not.toThrow();
	await Promise.resolve();
	await Promise.resolve();
	expect(warn).toHaveBeenCalled();
	warn.mockRestore();
});
