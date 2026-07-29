import { describe, expect, test } from 'vitest';

import {
	describesGracefulTermination,
	isGracefulTermination,
} from '@/shared/pi-rpc/process-exit';

describe('isGracefulTermination', () => {
	test('treats requested-stop signals and their 128+N codes as graceful', () => {
		expect(isGracefulTermination(143, null)).toBe(true);
		expect(isGracefulTermination(130, null)).toBe(true);
		expect(isGracefulTermination(129, null)).toBe(true);
		expect(isGracefulTermination(null, 'SIGTERM')).toBe(true);
		expect(isGracefulTermination(null, 'SIGINT')).toBe(true);
		expect(isGracefulTermination(null, 'SIGHUP')).toBe(true);
	});

	test('keeps force-kills and application failures as crashes', () => {
		expect(isGracefulTermination(137, null)).toBe(false);
		expect(isGracefulTermination(null, 'SIGKILL')).toBe(false);
		expect(isGracefulTermination(1, null)).toBe(false);
		expect(isGracefulTermination(2, null)).toBe(false);
	});
});

describe('describesGracefulTermination', () => {
	test('reads the exit code back out of a persisted diagnostic', () => {
		expect(
			describesGracefulTermination('Pi RPC process exited with code 143.'),
		).toBe(true);
		expect(
			describesGracefulTermination('Pi RPC process exited with code 137.'),
		).toBe(false);
		expect(
			describesGracefulTermination('Pi RPC process exited with code 1.'),
		).toBe(false);
	});

	test('reads the signal back out of a persisted diagnostic', () => {
		expect(
			describesGracefulTermination('Pi RPC process killed by signal SIGTERM.'),
		).toBe(true);
		expect(
			describesGracefulTermination('Pi RPC process killed by signal SIGKILL.'),
		).toBe(false);
	});

	test('leaves unrelated error messages alone', () => {
		expect(describesGracefulTermination('Connection error.')).toBe(false);
		expect(describesGracefulTermination('')).toBe(false);
		expect(describesGracefulTermination('exited with code')).toBe(false);
	});
});
