import { describe, expect, it } from 'vitest';

import { resolveForegroundCommand } from '../../src/main/terminal/foreground-command.ts';
import { allocateTerminalNumber } from '../../src/main/terminal/terminal-numbering.ts';

describe('allocateTerminalNumber', () => {
	it('starts at one and counts up while every number is held', () => {
		expect(allocateTerminalNumber([])).toBe(1);
		expect(allocateTerminalNumber([1])).toBe(2);
		expect(allocateTerminalNumber([1, 2, 3])).toBe(4);
	});

	// The alternative — always taking one past the highest — reaches Terminal 47
	// on a dock that has been open all day.
	it('fills the gap a closed terminal left rather than counting past it', () => {
		expect(allocateTerminalNumber([1, 3])).toBe(2);
		expect(allocateTerminalNumber([2, 3])).toBe(1);
	});

	it('ignores duplicates and unordered input', () => {
		expect(allocateTerminalNumber([3, 1, 1, 3])).toBe(2);
	});
});

describe('resolveForegroundCommand', () => {
	it('reports nothing while the session shell itself holds the foreground', () => {
		expect(resolveForegroundCommand('fish', '/opt/homebrew/bin/fish')).toBe(
			null,
		);
		expect(resolveForegroundCommand('zsh', 'zsh')).toBe(null);
	});

	it('names the command running in front of the shell', () => {
		expect(resolveForegroundCommand('npm', '/bin/zsh')).toBe('npm');
		expect(resolveForegroundCommand('sleep', '/opt/homebrew/bin/fish')).toBe(
			'sleep',
		);
	});

	// A login shell reports itself as `-zsh`, and some platforms report a whole
	// path; both are the same shell sitting idle rather than a command.
	it('reads a login shell and a full path as the shell they are', () => {
		expect(resolveForegroundCommand('-zsh', '/bin/zsh')).toBe(null);
		expect(resolveForegroundCommand('-BASH', '/bin/bash')).toBe(null);
		expect(
			resolveForegroundCommand(
				'/opt/homebrew/bin/fish',
				'/opt/homebrew/bin/fish',
			),
		).toBe(null);
	});

	it('shortens a path-shaped command to the name a tab can show', () => {
		expect(resolveForegroundCommand('/usr/local/bin/npm', '/bin/zsh')).toBe(
			'npm',
		);
	});

	it('reports nothing when the backend cannot read a foreground process', () => {
		expect(resolveForegroundCommand(null, '/bin/zsh')).toBe(null);
		expect(resolveForegroundCommand(undefined, '/bin/zsh')).toBe(null);
		expect(resolveForegroundCommand('   ', '/bin/zsh')).toBe(null);
	});
});
