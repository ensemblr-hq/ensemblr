import { describe, expect, it } from 'vitest';

import { detectSecretPrompt } from '../../src/main/terminal/secret-prompt.ts';

const ESC = String.fromCharCode(27);

// A setup or run script that calls `sudo` used to hang with nowhere to type:
// the Setup and Run panes take no keyboard input. These are the prompt shapes
// the dock has to recognise to offer its masked field instead.
describe('detectSecretPrompt', () => {
	it.each([
		['sudo', '[sudo] password for philipp: '],
		['sudo-rs', '[sudo: authenticate] Password: '],
		['macOS sudo', 'Password:'],
		['doas', 'doas (philipp@host) password: '],
		['ssh key', "Enter passphrase for key '/home/philipp/.ssh/id_ed25519': "],
		['ssh host', "philipp@example.com's password: "],
		['git over HTTPS', "Password for 'https://philipp@github.com': "],
		['Russian sudo', '[sudo] пароль для philipp: '],
		['Greek sudo', '[sudo] κωδικός πρόσβασης για philipp: '],
	])('recognises the %s prompt', (_label, prompt) => {
		expect(detectSecretPrompt(`installing system deps\n${prompt}`)).toBe(
			prompt.trim(),
		);
	});

	it('reads through the colour codes a prompt is printed in', () => {
		expect(
			detectSecretPrompt(`${ESC}[1m[sudo] password for philipp:${ESC}[0m `),
		).toBe('[sudo] password for philipp:');
	});

	it('clears once the script has read the answer and moved to a new line', () => {
		expect(
			detectSecretPrompt('[sudo] password for philipp: \r\nuid=0(root)\r\n'),
		).toBeNull();
		expect(detectSecretPrompt('[sudo] password for philipp: \r\n')).toBeNull();
	});

	it('recognises the prompt sudo repeats after a wrong password', () => {
		expect(
			detectSecretPrompt(
				'[sudo] password for philipp: \r\nSorry, try again.\r\n[sudo] password for philipp: ',
			),
		).toBe('[sudo] password for philipp:');
	});

	it.each([
		['a log line about passwords', 'sent a password reset link'],
		['a line that already carries its answer', 'Password: hunter2'],
		['output with no password in it', 'Compiling: '],
		['an empty tail', ''],
	])('ignores %s', (_label, tail) => {
		expect(detectSecretPrompt(tail)).toBeNull();
	});

	it('ignores a line too long to be a prompt', () => {
		expect(detectSecretPrompt(`${'x'.repeat(250)} password:`)).toBeNull();
	});
});
