/// <reference types="bun" />

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { EventEmitter } from 'node:events';

interface SpawnCall {
	command: string;
	args: string[];
}

type SpawnOutcome = 'spawn' | 'error';

// Per-test control over how the mocked spawn resolves and what openPath returns.
const calls: SpawnCall[] = [];
let outcomeFor: (command: string) => SpawnOutcome = () => 'spawn';
let openPathResult = '';

const openPath = mock((_path: string) => Promise.resolve(openPathResult));

mock.module('electron', () => ({ shell: { openPath } }));

mock.module('node:child_process', () => ({
	spawn: (command: string, args: string[]) => {
		calls.push({ command, args });
		const child = new EventEmitter() as EventEmitter & { unref: () => void };
		child.unref = () => undefined;
		// Emit asynchronously so listeners attach first, mirroring real spawn.
		queueMicrotask(() => child.emit(outcomeFor(command)));
		return child;
	},
}));

const { openInEditor } = await import(
	'../../src/main/config/open-in-editor.ts'
);

const originalEnv = { VISUAL: process.env.VISUAL, EDITOR: process.env.EDITOR };
const originalPlatform = process.platform;

function setPlatform(platform: NodeJS.Platform): void {
	Object.defineProperty(process, 'platform', { value: platform });
}

beforeEach(() => {
	calls.length = 0;
	outcomeFor = () => 'spawn';
	openPathResult = '';
	openPath.mockClear();
	delete process.env.VISUAL;
	delete process.env.EDITOR;
});

afterEach(() => {
	process.env.VISUAL = originalEnv.VISUAL;
	process.env.EDITOR = originalEnv.EDITOR;
	if (process.env.VISUAL === undefined) delete process.env.VISUAL;
	if (process.env.EDITOR === undefined) delete process.env.EDITOR;
	setPlatform(originalPlatform);
});

describe('openInEditor', () => {
	test('launches $VISUAL with the file path and reports success', async () => {
		process.env.VISUAL = 'code --wait';
		const result = await openInEditor('/cfg/config.json');

		expect(result).toEqual({});
		expect(calls[0]).toEqual({
			command: 'code',
			args: ['--wait', '/cfg/config.json'],
		});
		expect(openPath).not.toHaveBeenCalled();
	});

	test('falls back to $EDITOR when $VISUAL is unset', async () => {
		process.env.EDITOR = 'vim';
		await openInEditor('/cfg/config.json');

		expect(calls[0]).toEqual({ command: 'vim', args: ['/cfg/config.json'] });
	});

	test('falls back to TextEdit on macOS when the editor binary is missing', async () => {
		setPlatform('darwin');
		process.env.EDITOR = 'missing-editor';
		outcomeFor = (command) =>
			command === 'missing-editor' ? 'error' : 'spawn';

		const result = await openInEditor('/cfg/config.json');

		expect(result).toEqual({});
		expect(calls.map((call) => call.command)).toEqual([
			'missing-editor',
			'open',
		]);
		expect(calls[1]).toEqual({
			command: 'open',
			args: ['-a', 'TextEdit', '/cfg/config.json'],
		});
	});

	test('uses shell.openPath when no editor env var is set off macOS', async () => {
		setPlatform('linux');
		const result = await openInEditor('/cfg/config.json');

		expect(result).toEqual({});
		expect(calls).toHaveLength(0);
		expect(openPath).toHaveBeenCalledWith('/cfg/config.json');
	});

	test('surfaces a shell.openPath error as the last resort', async () => {
		setPlatform('darwin');
		outcomeFor = () => 'error';
		openPathResult = 'no app available';

		const result = await openInEditor('/cfg/config.json');

		expect(result).toEqual({ error: 'no app available' });
		expect(calls.map((call) => call.command)).toEqual(['open']);
	});
});
