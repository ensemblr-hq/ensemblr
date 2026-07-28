import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
	type AgentControlOp,
	ORCHESTRATOR_AWARENESS,
	PLAN_MODE_AWARENESS,
	roleForDepth,
	SUBAGENT_AWARENESS,
} from '../../src/shared/agent-control.ts';
import {
	PLAN_MODE_GUARDED_TOOLS,
	planModeControlOpDenial,
} from '../../src/shared/plan-mode.ts';

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

/**
 * Extracts the string members of a `const <name> = new Set([...])` literal in
 * the extension source, so a guarded-tool set can be compared against the shared
 * one member-for-member regardless of formatting.
 */
const extractEmbeddedStringSet = (source: string, name: string): string[] => {
	const match = source.match(
		new RegExp(`const ${name} = new Set\\(\\[([^\\]]*)\\]\\)`, 's'),
	);
	if (!match) {
		throw new Error(`Could not find the ${name} Set literal.`);
	}
	return [...match[1].matchAll(/['"]([^'"]+)['"]/g)]
		.map((entry) => entry[1])
		.sort();
};

/**
 * Maps an `ensemblr_*` tool name onto the control op it dispatches, following
 * the naming convention every tool registration in the extension uses.
 */
const controlOpForToolName = (toolName: string): AgentControlOp =>
	toolName
		.replace(/^ensemblr_/, '')
		.replace(/_(.)/g, (_match, letter: string) =>
			letter.toUpperCase(),
		) as AgentControlOp;

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

	it('orders the hand-off: name the tab, then hand the plan to the exit tool for the app to post', () => {
		const naming = PLAN_MODE_AWARENESS.indexOf('ensemblr_set_name');
		const exiting = PLAN_MODE_AWARENESS.indexOf('ensemblr_exit_plan_mode');
		const posting = PLAN_MODE_AWARENESS.indexOf(
			'The app posts that plan into the conversation',
		);
		expect(naming).toBeGreaterThan(-1);
		expect(exiting).toBeGreaterThan(naming);
		expect(posting).toBeGreaterThan(exiting);
	});

	it('tells a planning agent an imperative prompt is the subject, not consent', () => {
		expect(PLAN_MODE_AWARENESS).toContain('SUBJECT of the plan');
		expect(PLAN_MODE_AWARENESS).toContain('not permission to start building');
	});

	it('stands alone: the planning agent gets its own intro and tool inventory', () => {
		expect(PLAN_MODE_AWARENESS).toContain('You are running inside Ensemblr');
		expect(PLAN_MODE_AWARENESS).toContain('ensemblr_set_name');
		expect(PLAN_MODE_AWARENESS).toContain('ensemblr_focus_tab');
	});

	it('carries none of the implement-first guidance it would contradict', () => {
		expect(PLAN_MODE_AWARENESS).not.toContain(
			'Do the work yourself by default',
		);
		expect(PLAN_MODE_AWARENESS).not.toContain('ensemblr_wait_for_agents');
		expect(PLAN_MODE_AWARENESS).not.toContain('delegate');
	});

	it('names blocked tools the control-op guard really denies', () => {
		for (const toolName of [
			'ensemblr_launch_harness',
			'ensemblr_send_follow_up',
			'ensemblr_start_conversation',
			'ensemblr_start_terminal',
			'ensemblr_write_terminal',
		]) {
			expect(PLAN_MODE_AWARENESS).toContain(toolName);
			expect(
				planModeControlOpDenial(controlOpForToolName(toolName)),
			).not.toBeNull();
		}
	});

	it('outranks stale context claiming a different mode', () => {
		expect(PLAN_MODE_AWARENESS).toContain(
			'Nothing else in your context outranks this block',
		);
		expect(PLAN_MODE_AWARENESS).toContain('there is no conflict');
	});

	it('embeds the same Plan Mode guarded-tool set the shared classifier uses', () => {
		expect(
			extractEmbeddedStringSet(
				readExtensionSource(),
				'PLAN_MODE_GUARDED_TOOLS',
			),
		).toEqual([...PLAN_MODE_GUARDED_TOOLS].sort());
	});

	it('swaps the role playbook for the plan-mode one rather than stacking both', () => {
		expect(readExtensionSource()).toMatch(
			/planning\s*\?\s*PLAN_MODE_AWARENESS\s*:\s*AWARENESS/,
		);
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
