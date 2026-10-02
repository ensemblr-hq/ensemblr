import { describe, expect, test } from 'vitest';

import {
	parseSlashCommand,
	skillInvocationKey,
} from '../../src/shared/pi-skill-invocation';

const SKILL_BODY = ['# Caveman', '', 'Respond terse.'].join('\n');

function expandedPrompt(args?: string): string {
	const block = [
		'<skill name="caveman" location="/Users/dev/.pi/agent/skills/caveman/SKILL.md">',
		SKILL_BODY,
		'</skill>',
	].join('\n');
	return args === undefined ? block : `${block}\n\n${args}`;
}

describe('parseSlashCommand', () => {
	test('splits a skill invocation into its name and arguments', () => {
		expect(parseSlashCommand('/skill:caveman write a haiku')).toEqual({
			args: 'write a haiku',
			name: 'skill:caveman',
		});
	});

	test('splits a plain slash command into its name and arguments', () => {
		expect(parseSlashCommand('/plan add a dark mode toggle')).toEqual({
			args: 'add a dark mode toggle',
			name: 'plan',
		});
	});

	test('reports empty arguments for a bare command', () => {
		expect(parseSlashCommand('/compact')).toEqual({
			args: '',
			name: 'compact',
		});
	});

	test('keeps a plugin-scoped skill name intact', () => {
		expect(parseSlashCommand('/skill:caveman:caveman')).toEqual({
			args: '',
			name: 'skill:caveman:caveman',
		});
	});

	test('collapses extra spacing before the arguments', () => {
		expect(parseSlashCommand('/skill:caveman    make it shorter')?.args).toBe(
			'make it shorter',
		);
	});

	test('keeps multi-line arguments', () => {
		expect(parseSlashCommand('/plan\nline one\nline two')).toEqual({
			args: 'line one\nline two',
			name: 'plan',
		});
	});

	test("reads Pi's expanded skill block as the same invocation", () => {
		expect(parseSlashCommand(expandedPrompt('write a haiku'))).toEqual({
			args: 'write a haiku',
			name: 'skill:caveman',
		});
	});

	test('returns null for a path that merely starts with a slash', () => {
		expect(parseSlashCommand('/usr/bin/env is on PATH')).toBeNull();
	});

	test('returns null when the slash is not leading', () => {
		expect(parseSlashCommand('Use / to open the command menu')).toBeNull();
	});

	test('returns null for a bare slash', () => {
		expect(parseSlashCommand('/ leading slash space')).toBeNull();
	});

	test('returns null for an ordinary prompt', () => {
		expect(parseSlashCommand('Fix the login redirect bug')).toBeNull();
	});
});

describe('skillInvocationKey', () => {
	test('keys only skill commands, not every slash command', () => {
		expect(skillInvocationKey('/skill:caveman')).toBe('skill:caveman');
		expect(skillInvocationKey('/plan add a dark mode toggle')).toBeNull();
	});

	test('keys the typed and expanded forms alike', () => {
		expect(skillInvocationKey('/skill:caveman write a haiku')).toBe(
			skillInvocationKey(expandedPrompt('write a haiku')),
		);
	});
});
