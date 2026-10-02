import { describe, expect, it } from 'vitest';

import { TOOL_DEFS } from '../../src/main/agent-control/index.ts';
import {
	AGENT_CONTROL_OPS,
	awarenessForAudience,
	controlToolNamingForRuntime,
	harnessAwareness,
	isEnsemblrControlTool,
	namespaceControlToolNames,
	orchestratorAwareness,
	subagentAwareness,
	VERBATIM_RESULT_OPS,
} from '../../src/shared/agent-control.ts';

/** Every control tool name, in the bare spelling the playbooks are written in. */
const BARE_TOOL_NAMES = AGENT_CONTROL_OPS.map(
	(op) =>
		`ensemblr_${op.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)}`,
);

/** Matches a bare control tool name that no wrapper precedes. */
const BARE_IN_PROSE = /\bensemblr_[a-z0-9_]+/g;

/** The playbooks, with every optional feature on. */
const ALL_ON = { architectureDiagram: true, tuiHarnesses: true } as const;

/** Every distinct bare name left in a rendered string. */
const bareNamesIn = (text: string): string[] => [
	...new Set(text.match(BARE_IN_PROSE) ?? []),
];

describe('control tool naming per runtime', () => {
	it('spells tools bare for Pi, which registers them unwrapped in-process', () => {
		expect(controlToolNamingForRuntime('pi')).toBe('bare');
	});

	it('spells tools under the MCP wrapper for a runtime with its own client', () => {
		expect(controlToolNamingForRuntime('claude')).toBe('mcp');
	});

	it('falls back to the bare names for a caller whose client is unknown', () => {
		expect(controlToolNamingForRuntime(null)).toBe('bare');
	});
});

describe('namespaceControlToolNames', () => {
	it('leaves prose untouched under the bare scheme', () => {
		const prose = 'Name your tab with `ensemblr_set_name`, argument `title`.';
		expect(namespaceControlToolNames(prose, 'bare')).toBe(prose);
	});

	it('rewrites every control tool name a caller would have to call', () => {
		expect(
			namespaceControlToolNames(
				'Call `ensemblr_set_name`, then `ensemblr_set_summary`.',
				'mcp',
			),
		).toBe(
			'Call `mcp__ensemblr__ensemblr_set_name`, then `mcp__ensemblr__ensemblr_set_summary`.',
		);
	});

	it('rewrites every registered tool into a name the app still recognises', () => {
		for (const def of TOOL_DEFS) {
			const wrapped = namespaceControlToolNames(def.name, 'mcp');
			expect(wrapped).toBe(`mcp__ensemblr__${def.name}`);
			expect(isEnsemblrControlTool(wrapped)).toBe(true);
		}
	});

	it('covers every op, not just the ops with a registered tool', () => {
		for (const name of BARE_TOOL_NAMES) {
			expect(namespaceControlToolNames(name, 'mcp')).toBe(
				`mcp__ensemblr__${name}`,
			);
		}
	});

	it('is idempotent, so a block rewritten twice is not wrapped twice', () => {
		const once = namespaceControlToolNames(
			orchestratorAwareness(ALL_ON),
			'mcp',
		);
		expect(namespaceControlToolNames(once, 'mcp')).toBe(once);
	});

	it('leaves a name this app does not serve exactly as written', () => {
		const prose =
			'Neither `ensemblr_make_coffee` nor `ensemblr_set_nam` exists.';
		expect(namespaceControlToolNames(prose, 'mcp')).toBe(prose);
	});

	it('leaves the bare `ensemblr_` prefix mentioned as a prefix alone', () => {
		const prose = 'the Ensemblr control tools (prefixed `ensemblr_`)';
		expect(namespaceControlToolNames(prose, 'mcp')).toBe(prose);
	});

	it('leaves another server tool that merely ends in a control name alone', () => {
		const prose = 'mcp__other__ensemblr_set_name is not ours';
		expect(namespaceControlToolNames(prose, 'mcp')).toBe(prose);
	});
});

describe('playbooks reach a caller in its own spelling', () => {
	const audience = {
		...ALL_ON,
		delegation: 'ensemblr',
		hasChatTab: true,
		role: 'orchestrator',
		toolNaming: 'bare',
	} as const;

	it('hands Pi the playbook verbatim', () => {
		expect(awarenessForAudience(audience)).toBe(orchestratorAwareness(ALL_ON));
	});

	it('leaves no bare tool name in any playbook an MCP client receives', () => {
		for (const role of ['orchestrator', 'subagent'] as const) {
			const playbook = awarenessForAudience({
				...audience,
				role,
				toolNaming: 'mcp',
			});
			expect(bareNamesIn(playbook)).toEqual([]);
		}
	});

	it('rewrites every name the playbook carried rather than a subset', () => {
		const bare = subagentAwareness(ALL_ON);
		const wrapped = awarenessForAudience({
			...audience,
			role: 'subagent',
			toolNaming: 'mcp',
		});
		expect(
			(wrapped.match(/mcp__ensemblr__ensemblr_[a-z0-9_]+/g) ?? []).length,
		).toBe((bare.match(BARE_IN_PROSE) ?? []).length);
	});

	it('keeps the harness playbook bare, because its client is unknown', () => {
		expect(
			awarenessForAudience({
				...audience,
				hasChatTab: false,
				toolNaming: 'bare',
			}),
		).toBe(harnessAwareness(ALL_ON));
	});

	it('leaves no bare tool name in any tool description an MCP client reads', () => {
		for (const def of TOOL_DEFS) {
			expect(
				bareNamesIn(namespaceControlToolNames(def.description, 'mcp')),
			).toEqual([]);
		}
	});
});

describe('VERBATIM_RESULT_OPS', () => {
	// A report is prose one agent wrote for another, which is what the rewrite is
	// for: a Pi child names a tool bare for a parent that may hold it wrapped.
	it('exempts no op that returns one agent’s prose to another', () => {
		for (const op of ['getLastMessage', 'waitForAgents'] as const) {
			expect(VERBATIM_RESULT_OPS.has(op)).toBe(false);
		}
	});

	it('exempts every op that returns content the app only read', () => {
		for (const op of [
			'getArchitectureDiagram',
			'getWorkspaceDiff',
			'readConversation',
			'readTerminalOutput',
		] as const) {
			expect(VERBATIM_RESULT_OPS.has(op)).toBe(true);
		}
	});
});
