import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
	type AgentControlOp,
	HARNESS_AWARENESS,
	ORCHESTRATOR_AWARENESS,
	PLAN_MODE_AWARENESS,
	roleForDepth,
	SESSION_BRIEF_NUDGE_HEADER,
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

	it('leaves the naming ops available while planning and says so', () => {
		for (const toolName of [
			'ensemblr_set_name',
			'ensemblr_set_branch_name',
			'ensemblr_set_summary',
		]) {
			expect(PLAN_MODE_AWARENESS).toContain(toolName);
			expect(
				planModeControlOpDenial(controlOpForToolName(toolName)),
			).toBeNull();
		}
	});

	it('tells a planning agent the upkeep block is the one thing that outranks nothing', () => {
		expect(PLAN_MODE_AWARENESS).toContain(SESSION_BRIEF_NUDGE_HEADER);
	});

	// The upkeep block is built from live state, so it has no literal the parity
	// extractor could compare. Rendering it in the app and shipping the finished
	// string in the brief is what keeps it single-sourced — a copy that drifted
	// into the extension would be invisible to every other test here.
	it('never embeds the dynamic upkeep block, which the app renders', () => {
		const source = readExtensionSource();
		expect(source).not.toContain('buildSessionBriefNudge');
		expect(source).not.toContain(`const ${SESSION_BRIEF_NUDGE_HEADER}`);
		expect(source).toContain('getSessionBrief');
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

	// The `git.renameWorkspaceOnBranch` setting gates `ensemblr_set_branch_name`,
	// but a playbook is static and cannot see it. Only the per-turn upkeep block,
	// which is built from live state and already honours the setting, may tell an
	// agent to name the branch — otherwise an opted-out user's agent is ordered to
	// call a tool that will refuse it.
	it('never orders branch naming from a static playbook, which cannot see the setting', () => {
		for (const playbook of [
			ORCHESTRATOR_AWARENESS,
			SUBAGENT_AWARENESS,
			PLAN_MODE_AWARENESS,
		]) {
			expect(playbook).not.toContain('Name the tab and the branch');
			expect(playbook).not.toContain('name the workspace and branch on your');
		}
	});

	it('defers branch naming to the upkeep block in both role and plan playbooks', () => {
		expect(ORCHESTRATOR_AWARENESS).toContain(
			'only when the upkeep reminder asks for it',
		);
		expect(SUBAGENT_AWARENESS).toContain(
			'only when the upkeep reminder asks for it',
		);
		expect(PLAN_MODE_AWARENESS).toContain(
			'If the upkeep block also asks for the workspace and branch',
		);
	});

	it('treats only the root as orchestrator; every descendant is a sub-agent', () => {
		expect(roleForDepth(0)).toBe('orchestrator');
		expect(roleForDepth(1)).toBe('subagent');
		expect(roleForDepth(2)).toBe('subagent');
	});
});

describe('harness playbook', () => {
	it('names no Pi-only tool, which the MCP endpoint never serves a harness', () => {
		for (const toolName of [
			'ensemblr_set_name',
			'ensemblr_set_summary',
			'ensemblr_ask_user_question',
			'ensemblr_exit_plan_mode',
		]) {
			expect(HARNESS_AWARENESS).not.toContain(toolName);
		}
	});

	it('tells a harness its tab is titled from its own session log', () => {
		expect(HARNESS_AWARENESS).toContain(
			'names itself from your own session log',
		);
	});

	it('teaches the same wait-based delegation loop as the orchestrator variant', () => {
		expect(HARNESS_AWARENESS).toContain('ensemblr_start_conversation');
		expect(HARNESS_AWARENESS).toContain('ensemblr_wait_for_agents');
		expect(HARNESS_AWARENESS).toContain('Do the work yourself by default');
	});

	// A harness receives no per-turn upkeep block — the app renders that into a Pi
	// system prompt and a harness has no equivalent hook — so unlike the Pi
	// playbooks this one has to carry the branch nudge itself. The tool still
	// honours `git.renameWorkspaceOnBranch`; the playbook's job is to frame a
	// refusal as settled rather than as a fault worth retrying.
	it('carries the branch nudge itself, since a harness gets no upkeep block', () => {
		expect(HARNESS_AWARENESS).toContain('ensemblr_set_branch_name');
		expect(HARNESS_AWARENESS).toContain(
			'settled outcome, not a fault to retry',
		);
		expect(HARNESS_AWARENESS).not.toContain(SESSION_BRIEF_NUDGE_HEADER);
	});

	it('stays lighter than the orchestrator variant it stands in for', () => {
		expect(HARNESS_AWARENESS.length).toBeLessThan(
			ORCHESTRATOR_AWARENESS.length,
		);
	});

	it('is absent from the Pi extension, which never serves a harness', () => {
		expect(readExtensionSource()).not.toContain('HARNESS_AWARENESS');
	});
});
