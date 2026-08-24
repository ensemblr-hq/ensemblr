import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { TOOL_DEFS } from '../../src/main/agent-control/index.ts';
import {
	AGENT_CONTROL_OPS,
	type AgentControlOp,
	argKeysForOp,
	CONCIERGE_ONLY_OPS,
	CONCIERGE_WITHHELD_OPS,
	isSpawnOp,
	isWriteOp,
	SUBAGENT_UNUSABLE_OPS,
	SUBAGENT_WITHHELD_OPS,
	subAgentControlOpDenial,
	validateArgs,
	withheldControlOps,
} from '../../src/shared/agent-control.ts';
import {
	codeSpansIn,
	type DocTool,
	numberWord,
	paragraphsIn,
	parseToolReference,
	readAgentControlDoc,
} from './support/agent-control-doc.ts';

const DOC = readAgentControlDoc();
const PARAGRAPHS = paragraphsIn(DOC);
const DOC_TOOLS = parseToolReference(DOC);
const DOC_TOOLS_BY_NAME = new Map(DOC_TOOLS.map((tool) => [tool.name, tool]));

// The chat-tab axis alone: `withheldControlOps` folds in the Concierge-only ops
// as well, and those are withheld from every workspace agent whether or not it
// has a tab, so counting them here would document them under the wrong reason.
const CHAT_TAB_ONLY_OPS = new Set(
	[
		...withheldControlOps({
			delegation: 'ensemblr',
			hasChatTab: false,
			role: 'orchestrator',
		}),
	].filter((op) => !CONCIERGE_ONLY_OPS.has(op)),
);

const DENIED_OPS = AGENT_CONTROL_OPS.filter(
	(op) => subAgentControlOpDenial(op) !== null,
);

const LITERAL_UNION_PATTERN = /^'[^']*'( \| '[^']*')*$/;

/**
 * Finds the row documenting a tool, failing by name rather than by a property
 * read on undefined when the doc has dropped it.
 * @param toolName - The `ensemblr_*` tool to look up.
 * @returns Its parsed row.
 */
const documented = (toolName: string): DocTool => {
	const tool = DOC_TOOLS_BY_NAME.get(toolName);
	if (!tool) {
		throw new Error(`The Tool reference has no ${toolName} row.`);
	}
	return tool;
};

/**
 * Finds the one paragraph making a claim, so a claim can be checked wherever the
 * prose puts it rather than at a line number that moves.
 * @param pattern - Anchor identifying the claim, with its value captured.
 * @returns The match against that paragraph.
 */
const claim = (pattern: RegExp): RegExpExecArray => {
	for (const paragraph of PARAGRAPHS) {
		const match = pattern.exec(paragraph);
		if (match) {
			return match;
		}
	}
	throw new Error(`docs/agent-control.md makes no claim matching ${pattern}.`);
};

/**
 * Reads the paragraph following a claim, which is where the doc puts a list its
 * lead-in sentence introduces.
 * @param pattern - Anchor identifying the lead-in paragraph.
 * @returns The paragraph after it.
 */
const paragraphAfter = (pattern: RegExp): string => {
	const index = PARAGRAPHS.findIndex((paragraph) => pattern.test(paragraph));
	if (index < 0 || index + 1 === PARAGRAPHS.length) {
		throw new Error(`docs/agent-control.md has nothing after ${pattern}.`);
	}
	return PARAGRAPHS[index + 1];
};

/**
 * The arguments an op cannot be called without, measured through the validator
 * the agent actually meets rather than off a schema shape: an empty payload is
 * rejected with one issue per missing key, and those keys are the doc's bold set.
 * @param op - Operation to probe.
 * @returns Its required argument keys, sorted.
 */
const requiredArgKeys = (op: AgentControlOp): readonly string[] => {
	const result = validateArgs(op, {});
	if (result.ok) {
		return [];
	}
	const accepted = new Set(argKeysForOp(op));
	return result.reason
		.split('; ')
		.map((issue) => issue.slice(0, issue.indexOf(':')))
		.filter((key) => accepted.has(key))
		.sort();
};

/**
 * Reads the options an argument's schema fixes, seeing through the optional
 * wrapper the shape puts around most of them.
 * @param schema - The argument's declared schema.
 * @returns Its options, or null when the argument is not an enum.
 */
const enumOptions = (schema: unknown): readonly string[] | null => {
	const inner = schema instanceof z.ZodOptional ? schema.unwrap() : schema;
	return inner instanceof z.ZodEnum ? inner.options.map(String) : null;
};

/**
 * Renders an option list the way the tables write a union type.
 * @param options - The schema's options.
 * @returns The union as the doc spells it.
 */
const unionText = (options: readonly string[]): string =>
	options.map((option) => `'${option}'`).join(' | ');

/**
 * The gate an op passes through, in the vocabulary the Gate column uses.
 * @param op - Operation to classify.
 * @returns Its gate entries, sorted.
 */
const gateFor = (op: AgentControlOp): readonly string[] =>
	[
		isWriteOp(op) ? 'write' : 'read',
		...(isSpawnOp(op) ? ['spawn'] : []),
	].sort();

/**
 * The callers whose tool list omits an op, in the vocabulary the Withheld from
 * column uses.
 * @param op - Operation to classify.
 * @returns Its withholding entries, sorted.
 */
const withheldFor = (op: AgentControlOp): readonly string[] =>
	[
		...(CHAT_TAB_ONLY_OPS.has(op) ? ['no chat tab'] : []),
		...(CONCIERGE_ONLY_OPS.has(op) ? ['workspace agent'] : []),
		...(CONCIERGE_WITHHELD_OPS.has(op) ? ['Concierge'] : []),
		...(subAgentControlOpDenial(op) ? ['sub-agent'] : []),
		...(SUBAGENT_UNUSABLE_OPS.has(op) ? ['sub-agent*'] : []),
	].sort();

// This is the reference an agent reads to decide which tool to call and with
// which arguments, and it is hand-maintained against modules it cannot import. It
// has drifted three times — a missing `scriptName`, a set documented as two ops
// when it held three, and a rename that never reached the tables — and every one
// of those spends a real tool call on a validation error.
describe('agent-control tool reference', () => {
	it('documents every tool the MCP endpoint serves, and only those', () => {
		expect(DOC_TOOLS.map((tool) => tool.name).sort()).toEqual(
			TOOL_DEFS.map((def) => def.name).sort(),
		);
	});

	it('counts the tools its tables carry', () => {
		expect(
			claim(/(\S+) tools, enumerated from `TOOL_DEFS`/)[1].toLowerCase(),
		).toBe(numberWord(TOOL_DEFS.length));
	});

	it('names the arguments every schema accepts', () => {
		for (const def of TOOL_DEFS) {
			expect(
				documented(def.name)
					.args.map((arg) => arg.name)
					.sort(),
				def.name,
			).toEqual([...argKeysForOp(def.op)]);
		}
	});

	it('bolds exactly the arguments a call cannot omit', () => {
		for (const def of TOOL_DEFS) {
			expect(
				documented(def.name)
					.args.filter((arg) => arg.bolded)
					.map((arg) => arg.name)
					.sort(),
				`${def.name}: the arguments the doc marks required`,
			).toEqual([...requiredArgKeys(def.op)]);
		}
	});

	it('agrees with itself about which arguments are optional', () => {
		for (const def of TOOL_DEFS) {
			for (const arg of documented(def.name).args) {
				expect(
					arg.optionalMarked,
					`${def.name}.${arg.name}: the \`?\` marker against the bold one`,
				).toBe(!arg.bolded);
			}
		}
	});

	it('spells every enum argument with the options its schema fixes', () => {
		for (const def of TOOL_DEFS) {
			for (const arg of documented(def.name).args) {
				const options = enumOptions(def.shape[arg.name]);
				if (options) {
					expect(arg.type, `${def.name}.${arg.name}`).toBe(unionText(options));
				} else {
					expect(
						LITERAL_UNION_PATTERN.test(arg.type),
						`${def.name}.${arg.name} is written as a literal union, but its schema fixes no options`,
					).toBe(false);
				}
			}
		}
	});

	it('gives every tool the gate its op really passes through', () => {
		for (const def of TOOL_DEFS) {
			expect([...documented(def.name).gate].sort(), def.name).toEqual(
				gateFor(def.op),
			);
		}
	});

	it('names every caller each tool is withheld from', () => {
		for (const def of TOOL_DEFS) {
			expect([...documented(def.name).withheld].sort(), def.name).toEqual(
				withheldFor(def.op),
			);
		}
	});

	it('names the ops that reach no MCP tool at all', () => {
		expect(
			[
				...codeSpansIn(
					claim(/^(.+?) are control ops with no entry in `TOOL_DEFS`/)[1],
				),
			].sort(),
		).toEqual(
			AGENT_CONTROL_OPS.filter(
				(op) => !TOOL_DEFS.some((def) => def.op === op),
			).sort(),
		);
	});
});

// The two withholding axes are spelled out twice: once per row in the tables, and
// once as prose with a count in words. The count is what drifted last time, and a
// number nobody can check is the part a doc edit forgets.
describe('agent-control withholding prose', () => {
	it('counts and lists the ops a sub-agent is denied', () => {
		const anchor = /refuses a spawned sub-agent (\S+) ops with `denied-scope`/;
		expect(claim(anchor)[1].toLowerCase()).toBe(numberWord(DENIED_OPS.length));
		expect([...codeSpansIn(paragraphAfter(anchor))].sort()).toEqual(
			[...DENIED_OPS].sort(),
		);
	});

	it('lists the ops withheld from a sub-agent as merely unusable', () => {
		expect([...codeSpansIn(claim(/^(.+?) are not denied/)[1])].sort()).toEqual(
			[...SUBAGENT_UNUSABLE_OPS].sort(),
		);
	});

	it('counts every op a sub-agent tool list leaves out', () => {
		expect(
			claim(/`SUBAGENT_WITHHELD_OPS` — (\S+) ops in all/)[1].toLowerCase(),
		).toBe(numberWord(SUBAGENT_WITHHELD_OPS.size));
	});

	it('lists the ops a caller with no chat tab is refused', () => {
		expect(
			[
				...codeSpansIn(claim(/`CHAT_TAB_ONLY_OPS` — (.+?) — which the/)[1]),
			].sort(),
		).toEqual([...CHAT_TAB_ONLY_OPS].sort());
	});
});
