import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
	findExecutableInCommonDirs,
	findExecutableOnPath,
	isExecutableFile,
} from '../../src/main/pi-runtime/executable-discovery.ts';

/** Creates a temp dir holding an executable file named `name`, returns its dir. */
function makeExecutable(name: string): { dir: string; file: string } {
	const dir = mkdtempSync(path.join(tmpdir(), 'exec-discovery-'));
	const file = path.join(dir, name);
	writeFileSync(file, '#!/bin/sh\nexit 0\n');
	chmodSync(file, 0o755);
	return { dir, file };
}

describe('isExecutableFile', () => {
	it('returns true for an executable file', () => {
		const { file } = makeExecutable('tool');
		expect(isExecutableFile(file)).toBe(true);
	});

	it('returns false for a non-executable file', () => {
		const dir = mkdtempSync(path.join(tmpdir(), 'exec-discovery-'));
		const file = path.join(dir, 'plain.txt');
		writeFileSync(file, 'not runnable');
		chmodSync(file, 0o644);
		expect(isExecutableFile(file)).toBe(false);
	});

	it('returns false for a directory', () => {
		const dir = mkdtempSync(path.join(tmpdir(), 'exec-discovery-'));
		const nested = path.join(dir, 'nested');
		mkdirSync(nested);
		expect(isExecutableFile(nested)).toBe(false);
	});

	it('returns false for a missing path', () => {
		expect(isExecutableFile('/no/such/binary-xyz')).toBe(false);
	});
});

describe('findExecutableOnPath', () => {
	it('resolves a command present in a PATH directory', () => {
		const { dir, file } = makeExecutable('mytool');
		const pathValue = ['/no/such/dir', dir].join(path.delimiter);
		expect(findExecutableOnPath('mytool', pathValue)).toBe(file);
	});

	it('returns null when the command is absent from PATH', () => {
		const { dir } = makeExecutable('present');
		expect(findExecutableOnPath('absent', dir)).toBeNull();
	});

	it('skips empty PATH segments', () => {
		const { dir, file } = makeExecutable('edgetool');
		const pathValue = ['', dir, ''].join(path.delimiter);
		expect(findExecutableOnPath('edgetool', pathValue)).toBe(file);
	});
});

describe('findExecutableInCommonDirs', () => {
	it('resolves a command under ~/.local/bin via the home override', () => {
		const home = mkdtempSync(path.join(tmpdir(), 'exec-home-'));
		const localBin = path.join(home, '.local', 'bin');
		mkdirSync(localBin, { recursive: true });
		const file = path.join(localBin, 'homedtool');
		writeFileSync(file, '#!/bin/sh\nexit 0\n');
		chmodSync(file, 0o755);
		expect(findExecutableInCommonDirs('homedtool', home)).toBe(file);
	});

	it('returns null when the command is in no common dir', () => {
		const home = mkdtempSync(path.join(tmpdir(), 'exec-home-'));
		expect(findExecutableInCommonDirs('nonexistent-xyz', home)).toBeNull();
	});
});
