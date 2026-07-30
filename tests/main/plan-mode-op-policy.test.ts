import { describe, expect, it } from 'vitest';

import {
	AGENT_CONTROL_OPS,
	type AgentControlOp,
	type AgentControlRole,
} from '../../src/shared/agent-control.ts';
import {
	PLAN_MODE_CONDITIONAL_OPS,
	planModeControlOpDenial,
	planModeFollowUpDenial,
} from '../../src/shared/plan-mode.ts';

/**
 * How Plan Mode is expected to answer for every control op, per role. Held here
 * rather than derived from the implementation on purpose: this table is the
 * classification a human has to make, so adding an op to `AGENT_CONTROL_OPS`
 * fails this suite until someone decides what Plan Mode does with it.
 *
 * `WRITE_OPS` is deliberately NOT the oracle — `exitPlanMode` is excluded from it,
 * and the naming, focus, and board writes are ones Plan Mode allows on purpose.
 *
 * The failure this guards against got worse when spawning became legal. A missing
 * *spawn-shaped* op no longer means one unrestricted call; it means a whole
 * non-planning child with full write access, spawned by an agent that is supposed
 * to be reading.
 */
const EXPECTED_DENIALS: Record<
	AgentControlOp,
	readonly AgentControlRole[] | 'conditional'
> = {
	addDiffComments: [],
	askUserQuestion: ['subagent'],
	checkPlanModeTool: [],
	closeTab: [],
	getDiffComments: [],
	exitPlanMode: ['subagent'],
	focusDockTab: [],
	focusPanel: [],
	focusTab: [],
	getConversationStatus: [],
	getLastMessage: [],
	getSessionBrief: [],
	getWorkspaceDiff: [],
	getWorkspaceStatus: [],
	launchHarness: ['orchestrator', 'subagent'],
	listModels: [],
	listTabs: [],
	listTerminals: [],
	listWorkspaces: [],
	notifyOrchestrator: [],
	openTab: [],
	readTerminalOutput: [],
	sendFollowUp: 'conditional',
	setBranchName: [],
	setName: [],
	setSummary: [],
	setWorkspaceStatus: [],
	spawnChatTab: [],
	startConversation: 'conditional',
	startTerminal: ['orchestrator', 'subagent'],
	stopTerminal: [],
	waitForAgents: [],
	writeTerminal: ['orchestrator', 'subagent'],
};

const ROLES: readonly AgentControlRole[] = ['orchestrator', 'subagent'];

describe('plan mode: control-op policy covers every op', () => {
	it('classifies every op in the canonical list', () => {
		for (const op of AGENT_CONTROL_OPS) {
			expect(EXPECTED_DENIALS[op]).toBeDefined();
		}
		expect(Object.keys(EXPECTED_DENIALS).sort()).toEqual(
			[...AGENT_CONTROL_OPS].sort(),
		);
	});

	it('denies exactly the ops the table says, per role', () => {
		for (const op of AGENT_CONTROL_OPS) {
			const expected = EXPECTED_DENIALS[op];
			if (expected === 'conditional') {
				continue;
			}
			for (const role of ROLES) {
				const denial = planModeControlOpDenial(op, role);
				if (expected.includes(role)) {
					expect(denial, `${op} for ${role}`).not.toBeNull();
				} else {
					expect(denial, `${op} for ${role}`).toBeNull();
				}
			}
		}
	});

	// A conditional op must be reachable for an orchestrator through the arg-free
	// policy, so its real answer comes from the caller that knows the extra input.
	it('lets every conditional op through for an orchestrator', () => {
		for (const op of PLAN_MODE_CONDITIONAL_OPS) {
			expect(EXPECTED_DENIALS[op]).toBe('conditional');
			expect(planModeControlOpDenial(op, 'orchestrator')).toBeNull();
		}
	});

	it('still denies every conditional op to a sub-agent', () => {
		for (const op of PLAN_MODE_CONDITIONAL_OPS) {
			expect(planModeControlOpDenial(op, 'subagent')).not.toBeNull();
		}
	});
});

describe('plan mode: follow-up policy', () => {
	it('allows a planning target and refuses one that is not planning', () => {
		expect(planModeFollowUpDenial(true)).toBeNull();
		expect(planModeFollowUpDenial(false)).not.toBeNull();
	});

	it('closes the refusal with the shared escape hatch and the spawn route', () => {
		const denial = planModeFollowUpDenial(false);
		expect(denial).toContain('Plan Mode is on');
		expect(denial).toContain('finish the plan and call');
		expect(denial).toContain('ensemblr_start_conversation');
	});
});
