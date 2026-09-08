import { describe, expect, it } from 'vitest';

import {
	type AgentControlContextUsage,
	CONTEXT_PRESSURE_PERCENT,
	type ContextPressureAudience,
	delegateContextPressureNote,
	isUnderContextPressure,
	ownContextPressureNote,
	resolveContextPressureAudience,
	SUBAGENT_WITHHELD_OPS,
	withheldControlOps,
} from '../../src/shared/agent-control.ts';

const usage = (percent: number | null): AgentControlContextUsage => ({
	contextWindow: 200_000,
	percent,
	tokens: percent === null ? null : Math.round((percent / 100) * 200_000),
});

/** Every audience, so a note assertion cannot silently skip one. */
const AUDIENCES: readonly ContextPressureAudience[] = [
	'spawns-tabs',
	'spawns-natively',
	'cannot-delegate',
];

/** The audiences whose tool list has `startConversation` withheld. */
const WITHOUT_SPAWN: readonly ContextPressureAudience[] = [
	'spawns-natively',
	'cannot-delegate',
];

describe('context pressure: the threshold', () => {
	it('is on the 0-100 scale the runtimes report, not a 0-1 fraction', () => {
		expect(CONTEXT_PRESSURE_PERCENT).toBeGreaterThan(1);
		expect(CONTEXT_PRESSURE_PERCENT).toBeLessThanOrEqual(100);
	});

	it('fires at the threshold and above it', () => {
		expect(isUnderContextPressure(usage(CONTEXT_PRESSURE_PERCENT))).toBe(true);
		expect(isUnderContextPressure(usage(99))).toBe(true);
	});

	it('does not fire below it', () => {
		expect(isUnderContextPressure(usage(CONTEXT_PRESSURE_PERCENT - 0.1))).toBe(
			false,
		);
		expect(isUnderContextPressure(usage(0))).toBe(false);
	});

	// A runtime that has reported a token count before it reported a window has
	// no percentage yet. Reading that as an empty window would tell an agent it
	// has room it may not have.
	it('treats an unknown reading as unknown rather than empty', () => {
		expect(isUnderContextPressure(null)).toBe(false);
		expect(isUnderContextPressure(undefined)).toBe(false);
		expect(isUnderContextPressure(usage(null))).toBe(false);
	});
});

// The audience must track `withheldControlOps`, because the whole point of the
// axis is naming a tool the caller actually holds.
describe('context pressure: resolving the audience', () => {
	it('gives a spawned sub-agent the no-delegation audience whatever its mechanism', () => {
		for (const delegation of ['ensemblr', 'native'] as const) {
			expect(
				resolveContextPressureAudience({ delegation, role: 'subagent' }),
			).toBe('cannot-delegate');
		}
	});

	it('splits a root by its delegation mechanism', () => {
		expect(
			resolveContextPressureAudience({
				delegation: 'native',
				role: 'orchestrator',
			}),
		).toBe('spawns-natively');
		expect(
			resolveContextPressureAudience({
				delegation: 'ensemblr',
				role: 'orchestrator',
			}),
		).toBe('spawns-tabs');
	});

	// The Concierge is not on the lineage axis at all, and its blocked-op table
	// does not deny it `startConversation` — briefing workspace agents is most of
	// what it does.
	it('leaves the Concierge on the spawn audience', () => {
		expect(
			resolveContextPressureAudience({
				delegation: 'native',
				role: 'concierge',
			}),
		).toBe('spawns-tabs');
	});

	// The guard that matters: an audience that says "spawn" for a caller whose
	// list has the op withheld is the bug this axis exists to stop.
	it('claims a spawn only for callers that actually hold the op', () => {
		const audienceFor = (
			role: 'orchestrator' | 'subagent',
			delegation: 'ensemblr' | 'native',
		) => ({
			audience: resolveContextPressureAudience({ delegation, role }),
			withheld: withheldControlOps({
				architectureDiagram: true,
				delegation,
				hasChatTab: true,
				role,
				tuiHarnesses: true,
			}),
		});

		for (const role of ['orchestrator', 'subagent'] as const) {
			for (const delegation of ['ensemblr', 'native'] as const) {
				const { audience, withheld } = audienceFor(role, delegation);
				expect(audience === 'spawns-tabs', `${role}/${delegation}`).toBe(
					!withheld.has('startConversation'),
				);
			}
		}
		expect(SUBAGENT_WITHHELD_OPS.has('startConversation')).toBe(true);
	});
});

describe('context pressure: the note a caller reading itself gets', () => {
	it('is silent while the window has room, for every audience', () => {
		for (const audience of AUDIENCES) {
			expect(ownContextPressureNote(usage(10), audience)).toBeNull();
			expect(ownContextPressureNote(null, audience)).toBeNull();
		}
	});

	it('names the percentage whoever is reading', () => {
		for (const audience of AUDIENCES) {
			expect(ownContextPressureNote(usage(62.4), audience)).toContain('62%');
		}
	});

	it('points a chat-tab orchestrator at the spawn op', () => {
		expect(ownContextPressureNote(usage(62.4), 'spawns-tabs')).toContain(
			'ensemblr_start_conversation',
		);
	});

	// A root delegating through its own runtime has the spawn ops withheld, so
	// naming one sends it hunting for a tool its list does not carry.
	it('points a natively-delegating root at its own runtime instead', () => {
		const note = ownContextPressureNote(usage(62.4), 'spawns-natively');
		expect(note).toContain("your own runtime's sub-agent tool");
		expect(note).not.toContain('ensemblr_start_conversation');
	});

	// A sub-agent cannot delegate at all, so neither phrasing works: its move is
	// to wrap up and tell the orchestrator, which is the one reader that can act.
	it('tells a sub-agent to report rather than to delegate', () => {
		const note = ownContextPressureNote(usage(62.4), 'cannot-delegate');
		expect(note).toContain('cannot delegate onward');
		expect(note).toContain('report');
		expect(note).not.toContain('ensemblr_start_conversation');
	});

	it('never names a spawn op to an audience that lacks one', () => {
		for (const audience of WITHOUT_SPAWN) {
			expect(ownContextPressureNote(usage(90), audience)).not.toContain(
				'ensemblr_start_conversation',
			);
		}
	});
});

describe('context pressure: the note a caller gets about others', () => {
	it('is silent when nothing it is reading is crowded', () => {
		for (const audience of AUDIENCES) {
			expect(
				delegateContextPressureNote(
					[
						{ agentSessionId: 'c1', contextUsage: usage(12) },
						{ agentSessionId: 'c2', contextUsage: null },
					],
					audience,
				),
			).toBeNull();
		}
	});

	it('names only the crowded conversations, with their readings', () => {
		const note = delegateContextPressureNote(
			[
				{ agentSessionId: 'roomy', contextUsage: usage(12) },
				{ agentSessionId: 'full', contextUsage: usage(81.6) },
			],
			'spawns-tabs',
		);
		expect(note).toContain('"full" (82%)');
		expect(note).not.toContain('roomy');
	});

	// An orchestrator told only to retire a crowded child abandons one mid-thread
	// and pays to rebuild its context somewhere else, which costs more than the
	// room it saved. The exception has to travel with the rule.
	it('states the exception as well as the rule for the audience that can act', () => {
		const note = delegateContextPressureNote(
			[{ agentSessionId: 'full', contextUsage: usage(90) }],
			'spawns-tabs',
		);
		expect(note).toContain('ensemblr_start_conversation');
		expect(note).toContain('Follow up anyway when');
	});

	// Neither of these holds `sendFollowUp` either, so for them the reading is
	// something to route around or pass upward, never a conversation to reload.
	it('never names a spawn op to an audience that lacks one', () => {
		for (const audience of WITHOUT_SPAWN) {
			const note = delegateContextPressureNote(
				[{ agentSessionId: 'full', contextUsage: usage(90) }],
				audience,
			);
			expect(note).toContain('"full" (90%)');
			expect(note).not.toContain('ensemblr_start_conversation');
			expect(note).not.toContain('ensemblr_send_follow_up');
		}
	});

	it('tells a sub-agent to pass the reading up in its report', () => {
		const note = delegateContextPressureNote(
			[{ agentSessionId: 'full', contextUsage: usage(90) }],
			'cannot-delegate',
		);
		expect(note).toContain('report');
		expect(note).toContain('orchestrator');
	});
});
