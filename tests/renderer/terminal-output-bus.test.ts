// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { subscribeTerminalOutput } from '@/renderer/lib/terminal/terminal-output-bus';

import { clearEnsemblrApi, installEnsemblrApi } from './support/dom';

type OutputListener = (event: {
	data: string;
	seq: number;
	terminalId: string;
}) => void;

const bridgeListeners: OutputListener[] = [];
const unsubscribeBridge = vi.fn();

function broadcast(terminalId: string, data: string, seq = 1): void {
	for (const listener of [...bridgeListeners]) {
		listener({ data, seq, terminalId });
	}
}

beforeEach(() => {
	bridgeListeners.length = 0;
	unsubscribeBridge.mockClear();
	installEnsemblrApi({
		onTerminalOutput: (listener: OutputListener) => {
			bridgeListeners.push(listener);
			return unsubscribeBridge;
		},
	});
});

afterEach(() => {
	clearEnsemblrApi();
});

describe('subscribeTerminalOutput', () => {
	// Every force-mounted dock tab used to open its own bridge subscription and
	// filter by id in JS, so a chatty PTY dispatched through one listener per tab.
	it('opens one bridge subscription however many surfaces subscribe', () => {
		const unsubscribes = ['a', 'b', 'c'].map((id) =>
			subscribeTerminalOutput(id, () => undefined),
		);

		expect(bridgeListeners).toHaveLength(1);

		for (const unsubscribe of unsubscribes) {
			unsubscribe();
		}
	});

	it('delivers a chunk only to the surfaces bound to that session', () => {
		const a = vi.fn();
		const b = vi.fn();
		const unsubscribeA = subscribeTerminalOutput('terminal:a', a);
		const unsubscribeB = subscribeTerminalOutput('terminal:b', b);

		broadcast('terminal:a', 'hello');

		expect(a).toHaveBeenCalledTimes(1);
		expect(a.mock.calls[0]?.[0]).toMatchObject({ data: 'hello' });
		expect(b).not.toHaveBeenCalled();

		unsubscribeA();
		unsubscribeB();
	});

	it('fans one chunk out to every surface on the same session', () => {
		const first = vi.fn();
		const second = vi.fn();
		const unsubscribeFirst = subscribeTerminalOutput('terminal:a', first);
		const unsubscribeSecond = subscribeTerminalOutput('terminal:a', second);

		broadcast('terminal:a', 'hello');

		expect(first).toHaveBeenCalledTimes(1);
		expect(second).toHaveBeenCalledTimes(1);

		unsubscribeFirst();
		unsubscribeSecond();
	});

	it('stops delivering to an unsubscribed surface', () => {
		const listener = vi.fn();
		const unsubscribe = subscribeTerminalOutput('terminal:a', listener);

		unsubscribe();
		broadcast('terminal:a', 'hello');

		expect(listener).not.toHaveBeenCalled();
	});

	it('closes the bridge subscription with the last surface and reopens after', () => {
		const unsubscribeFirst = subscribeTerminalOutput('a', () => undefined);
		const unsubscribeSecond = subscribeTerminalOutput('b', () => undefined);

		unsubscribeFirst();
		expect(unsubscribeBridge).not.toHaveBeenCalled();

		unsubscribeSecond();
		expect(unsubscribeBridge).toHaveBeenCalledTimes(1);

		const unsubscribeThird = subscribeTerminalOutput('c', () => undefined);
		expect(bridgeListeners).toHaveLength(2);

		unsubscribeThird();
	});

	it('tolerates a second unsubscribe', () => {
		const unsubscribe = subscribeTerminalOutput('terminal:a', () => undefined);

		unsubscribe();

		expect(() => unsubscribe()).not.toThrow();
	});

	it('drops a chunk for a session nothing is bound to', () => {
		const listener = vi.fn();
		const unsubscribe = subscribeTerminalOutput('terminal:a', listener);

		expect(() => broadcast('terminal:z', 'hello')).not.toThrow();
		expect(listener).not.toHaveBeenCalled();

		unsubscribe();
	});
});
