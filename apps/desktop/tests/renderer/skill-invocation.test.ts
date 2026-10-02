import { describe, expect, test } from 'vitest';

import {
	parseSkillInvocation,
	skillInvocationKey,
} from '../../src/renderer/lib/pi/skill-invocation';

const SKILL_BODY = [
	'References are relative to /Users/dev/.pi/agent/skills/caveman.',
	'',
	'# Caveman',
	'',
	'Respond terse.',
].join('\n');

function expandedPrompt(args?: string): string {
	const block = [
		'<skill name="caveman" location="/Users/dev/.pi/agent/skills/caveman/SKILL.md">',
		SKILL_BODY,
		'</skill>',
	].join('\n');
	return args === undefined ? block : `${block}\n\n${args}`;
}

describe('parseSkillInvocation', () => {
	test('lifts the skill block out and keeps the arguments as the prompt', () => {
		const parsed = parseSkillInvocation(expandedPrompt('make it shorter'));

		expect(parsed.skill).toEqual({ content: SKILL_BODY, name: 'caveman' });
		expect(parsed.text).toBe('make it shorter');
	});

	test('leaves an empty prompt when the skill was invoked without arguments', () => {
		const parsed = parseSkillInvocation(expandedPrompt());

		expect(parsed.skill?.name).toBe('caveman');
		expect(parsed.text).toBe('');
	});

	test('returns an ordinary prompt untouched', () => {
		const parsed = parseSkillInvocation('Implement the attached plan.');

		expect(parsed.skill).toBeNull();
		expect(parsed.text).toBe('Implement the attached plan.');
	});

	test('ignores a skill tag the user merely mentioned mid-prompt', () => {
		const prompt =
			'Explain <skill name="x" location="y">\nbody\n</skill> please';
		const parsed = parseSkillInvocation(prompt);

		expect(parsed.skill).toBeNull();
		expect(parsed.text).toBe(prompt);
	});

	test('falls back to a placeholder name when the block names no skill', () => {
		const parsed = parseSkillInvocation(
			'<skill name="" location="/x/SKILL.md">\nbody\n</skill>\n\ngo',
		);

		expect(parsed.skill?.name).toBe('skill');
		expect(parsed.text).toBe('go');
	});
});

describe('skillInvocationKey', () => {
	test('keys the typed and expanded forms of the same invocation alike', () => {
		expect(skillInvocationKey('/skill:caveman')).toBe(
			skillInvocationKey(expandedPrompt()),
		);
		expect(skillInvocationKey('/skill:caveman')).toBe('skill:caveman');
	});

	test('folds the arguments into the key across both forms', () => {
		expect(skillInvocationKey('/skill:caveman make it shorter')).toBe(
			skillInvocationKey(expandedPrompt('make it shorter')),
		);
		expect(skillInvocationKey('/skill:caveman make it shorter')).toBe(
			'skill:caveman\nmake it shorter',
		);
	});

	test('tolerates extra spacing between the invocation and its arguments', () => {
		expect(skillInvocationKey('/skill:caveman    make it shorter')).toBe(
			'skill:caveman\nmake it shorter',
		);
	});

	test('keys a plugin-scoped skill name including its colon', () => {
		expect(skillInvocationKey('/skill:caveman:caveman')).toBe(
			'skill:caveman:caveman',
		);
	});

	test('returns null for an ordinary prompt', () => {
		expect(skillInvocationKey('Implement the attached plan.')).toBeNull();
	});

	test('returns null for a skill tag merely mentioned mid-prompt', () => {
		expect(
			skillInvocationKey('Explain <skill name="x" location="y">\nb\n</skill>'),
		).toBeNull();
	});
});
