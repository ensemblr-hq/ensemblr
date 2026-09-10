import { describe, expect, it } from 'vitest';

import {
	type AgentControlOp,
	subAgentControlOpDenial,
	withheldControlOps,
} from '../../src/shared/agent-control.ts';

const DELEGATION_OPS = [
	'startConversation',
	'listModels',
	'waitForAgents',
	'sendFollowUp',
	'closeTab',
] as const satisfies readonly AgentControlOp[];

/** Builds the shared audience used to verify descendant tool discovery. */
const descendantAudience = (depth?: 0 | 1 | 2) => ({
	architectureDiagram: true,
	delegation: 'ensemblr' as const,
	...(depth === undefined ? {} : { depth }),
	hasChatTab: true,
	role: 'subagent' as const,
	tuiHarnesses: true,
});

describe('depth-aware descendant policy', () => {
	it('lets a verified depth-1 sub-agent manage one fresh leaf', () => {
		for (const op of DELEGATION_OPS) {
			expect(subAgentControlOpDenial(op, 1), op).toBeNull();
			expect(withheldControlOps(descendantAudience(1)).has(op), op).toBe(false);
		}
	});

	it('keeps peer, review, raw tab, terminal, and user authority from depth 1', () => {
		for (const op of [
			'spawnChatTab',
			'startReview',
			'launchHarness',
			'startTerminal',
			'askUserQuestion',
			'setWorkspaceStatus',
		] as const) {
			expect(subAgentControlOpDenial(op, 1), op).not.toBeNull();
			expect(withheldControlOps(descendantAudience(1)).has(op), op).toBe(true);
		}
	});

	it('withholds delegation from depth 2 and fail-closed missing descendant depth', () => {
		for (const op of DELEGATION_OPS) {
			expect(subAgentControlOpDenial(op, 2), op).not.toBeNull();
			expect(withheldControlOps(descendantAudience(2)).has(op), op).toBe(true);
			expect(withheldControlOps(descendantAudience()).has(op), op).toBe(true);
		}
	});
});
