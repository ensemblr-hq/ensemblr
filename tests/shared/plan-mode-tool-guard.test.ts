import { describe, expect, it } from 'vitest';

import { buildPlanSubmittedResult, validateArgs } from '@/shared/agent-control';
import { evaluatePlanModeTool } from '@/shared/plan-mode';

describe('evaluatePlanModeTool', () => {
	it.each(['write', 'edit'])('always blocks %s', (tool) => {
		const verdict = evaluatePlanModeTool({ tool });
		expect(verdict.blocked).toBe(true);
		expect(verdict.reason).toContain(tool);
	});

	it('allows a read-only bash command', () => {
		expect(
			evaluatePlanModeTool({ command: 'git status', tool: 'bash' }),
		).toEqual({ blocked: false });
	});

	it('blocks a mutating bash command and says why', () => {
		const verdict = evaluatePlanModeTool({
			command: 'rm -rf build',
			tool: 'bash',
		});
		expect(verdict.blocked).toBe(true);
		expect(verdict.reason).toContain('rm');
	});

	it('blocks bash with no command rather than assuming it is harmless', () => {
		expect(evaluatePlanModeTool({ tool: 'bash' }).blocked).toBe(true);
	});

	it.each(['read', 'grep', 'find', 'ls', 'ensemblr_ask_user_question'])(
		'leaves %s untouched',
		(tool) => {
			expect(evaluatePlanModeTool({ tool })).toEqual({ blocked: false });
		},
	);

	// The set a Pi session holds is open — the user can install another extension
	// or point Pi at an MCP server — so a filter listing the mutating tools
	// somebody thought of is a filter every other write walks past. Deny by
	// default, exactly as the bash classifier is an allowlist.
	it.each([
		'mcp__filesystem__write_file',
		'apply_patch',
		'str_replace_editor',
		'powershell',
		'multiedit',
		'Write',
	])('blocks %s, which nothing here vouches for', (tool) => {
		const verdict = evaluatePlanModeTool({ tool });
		expect(verdict.blocked).toBe(true);
		expect(verdict.reason).toContain(tool);
	});

	it('names the tool it refused, so the agent can say what it reached for', () => {
		expect(
			evaluatePlanModeTool({ tool: 'mcp__filesystem__write_file' }).reason,
		).toContain('mcp__filesystem__write_file');
	});

	// The control tools have a better gate one layer up: `planModeControlOpDenial`
	// answers per op and per role, and a blanket denial here would take away the
	// reads and the spawn route planning is for.
	it.each([
		'ensemblr_get_workspace_diff',
		'ensemblr_start_conversation',
		'ensemblr_exit_plan_mode',
	])('leaves the control tool %s to its own op gate', (tool) => {
		expect(evaluatePlanModeTool({ tool })).toEqual({ blocked: false });
	});

	it('always points the agent at the way out of plan mode', () => {
		expect(evaluatePlanModeTool({ tool: 'write' }).reason).toContain(
			'ensemblr_exit_plan_mode',
		);
	});
});

describe('exitPlanMode args', () => {
	it('accepts a title and plan', () => {
		expect(
			validateArgs('exitPlanMode', {
				plan: '# Steps\n\n1. Do it',
				title: 'Add X',
			}).ok,
		).toBe(true);
	});

	it('rejects an empty title or plan', () => {
		expect(validateArgs('exitPlanMode', { plan: 'x', title: '' }).ok).toBe(
			false,
		);
		expect(validateArgs('exitPlanMode', { plan: '', title: 'x' }).ok).toBe(
			false,
		);
	});

	it('rejects an over-long title', () => {
		expect(
			validateArgs('exitPlanMode', { plan: 'x', title: 'a'.repeat(81) }).ok,
		).toBe(false);
	});

	it('rejects an over-long plan', () => {
		expect(
			validateArgs('exitPlanMode', { plan: 'a'.repeat(60_001), title: 'x' }).ok,
		).toBe(false);
	});
});

describe('buildPlanSubmittedResult', () => {
	it('reports where the plan was saved', () => {
		const result = buildPlanSubmittedResult(
			'.context/plans/20260728-1400-add-x.md',
		);
		expect(result.planPath).toBe('.context/plans/20260728-1400-add-x.md');
		expect(result.summary).toContain('.context/plans/20260728-1400-add-x.md');
	});

	// The whole point of the one-way call: the plan has to stay the last thing
	// in the conversation while the user reads it.
	it('leaves no doubt that the turn is over', () => {
		const { summary } = buildPlanSubmittedResult('plan.md');
		expect(summary).toContain('Your turn ends here');
		expect(summary).toContain('produce no further output');
		expect(summary).toContain('do not start implementing');
	});

	it('points the agent at its next prompt rather than at a decision', () => {
		expect(buildPlanSubmittedResult('plan.md').summary).toContain(
			'arrives as your next prompt',
		);
	});

	it('says so when the plan could not be saved', () => {
		const result = buildPlanSubmittedResult(null);
		expect(result.planPath).toBeNull();
		expect(result.summary).toContain('could not be saved');
	});
});
