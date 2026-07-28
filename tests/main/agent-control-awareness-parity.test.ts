import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
	ORCHESTRATOR_AWARENESS,
	PLAN_MODE_AWARENESS,
	roleForDepth,
	SUBAGENT_AWARENESS,
} from '../../src/shared/agent-control.ts';

/**
 * The Pi extension cannot import from `src/` at runtime, so it embeds a copy of
 * each shared awareness constant. These tests are the guardrail that stops the
 * two injection points from drifting.
 */
const readExtensionSource = (): string =>
	readFileSync(
		fileURLToPath(
			new URL(
				'../../resources/pi-extensions/ensemblr-control.mts',
				import.meta.url,
			),
		),
		'utf8',
	);

/**
 * Extracts the value of a named `const <name> = \`...\`` template literal from the
 * extension source and unescapes its backticks back to their runtime form.
 */
const extractEmbeddedAwareness = (source: string, name: string): string => {
	const match = source.match(
		new RegExp(`const ${name} = \`((?:\\\\.|[^\`\\\\])*)\`;`, 's'),
	);
	if (!match) {
		throw new Error(`Could not find the ${name} template literal.`);
	}
	return match[1].replace(/\\`/g, '`').replace(/\\\\/g, '\\');
};

describe('agent-control AWARENESS parity', () => {
	it('embeds the orchestrator variant byte-for-byte in the Pi extension', () => {
		expect(
			extractEmbeddedAwareness(readExtensionSource(), 'ORCHESTRATOR_AWARENESS'),
		).toBe(ORCHESTRATOR_AWARENESS);
	});

	it('embeds the sub-agent variant byte-for-byte in the Pi extension', () => {
		expect(
			extractEmbeddedAwareness(readExtensionSource(), 'SUBAGENT_AWARENESS'),
		).toBe(SUBAGENT_AWARENESS);
	});

	it('embeds the plan-mode playbook byte-for-byte in the Pi extension', () => {
		expect(
			extractEmbeddedAwareness(readExtensionSource(), 'PLAN_MODE_AWARENESS'),
		).toBe(PLAN_MODE_AWARENESS);
	});

	it('tells a planning agent how enforcement works and how to leave plan mode', () => {
		expect(PLAN_MODE_AWARENESS).toContain('ensemblr_exit_plan_mode');
		expect(PLAN_MODE_AWARENESS).toContain('ensemblr_ask_user_question');
		expect(PLAN_MODE_AWARENESS).toContain('do not look for a way around it');
	});

	it('orders the hand-off: name the tab, post the plan, then call the tool', () => {
		const naming = PLAN_MODE_AWARENESS.indexOf('ensemblr_set_name');
		const posting = PLAN_MODE_AWARENESS.indexOf('Write the plan out in full');
		const exiting = PLAN_MODE_AWARENESS.indexOf('ensemblr_exit_plan_mode');
		expect(naming).toBeGreaterThan(-1);
		expect(posting).toBeGreaterThan(naming);
		expect(exiting).toBeGreaterThan(posting);
	});

	it('tells a planning agent an imperative prompt is the subject, not consent', () => {
		expect(PLAN_MODE_AWARENESS).toContain('SUBJECT of the plan');
		expect(PLAN_MODE_AWARENESS).toContain('not permission to start building');
	});

	it('teaches the orchestrator the wait-based delegation loop', () => {
		expect(ORCHESTRATOR_AWARENESS).toContain('ensemblr_wait_for_agents');
		expect(ORCHESTRATOR_AWARENESS).toContain('ensemblr_notify_orchestrator');
	});

	it('tells sub-agents to do the work themselves and escalate, not fan out', () => {
		expect(SUBAGENT_AWARENESS).toContain('Do NOT spawn further sub-agents');
		expect(SUBAGENT_AWARENESS).toContain('ensemblr_notify_orchestrator');
		expect(SUBAGENT_AWARENESS).not.toContain('ensemblr_wait_for_agents');
	});

	it('treats only the root as orchestrator; every descendant is a sub-agent', () => {
		expect(roleForDepth(0)).toBe('orchestrator');
		expect(roleForDepth(1)).toBe('subagent');
		expect(roleForDepth(2)).toBe('subagent');
	});
});
