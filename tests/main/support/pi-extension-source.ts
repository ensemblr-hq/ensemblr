import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { AgentControlOp } from '../../../src/shared/agent-control.ts';

/**
 * The Pi extension cannot import from `src/` at runtime, so it embeds its own
 * copy of every awareness constant, tool description, and parameter schema.
 * Reading its source is the only guardrail there is against the two injection
 * points drifting apart.
 */
export const readExtensionSource = (): string =>
	readFileSync(
		fileURLToPath(
			new URL(
				'../../../resources/pi-extensions/ensemblr-control.mts',
				import.meta.url,
			),
		),
		'utf8',
	);

/**
 * Matches one `tool(name, op, description, …)` registration in the extension,
 * capturing the three leading string literals. The description alternates
 * between quote styles across registrations, so the closing quote is
 * back-referenced rather than fixed.
 */
const EXTENSION_TOOL_PATTERN =
	/\btool\(\s*(['"])(ensemblr_[a-z_0-9]+)\1,\s*(['"])([A-Za-z]+)\3,\s*(['"])((?:\\.|(?!\5)[^\\])*)\5/gs;

/**
 * Matches a `pi.registerTool({ name, description, … })` registration, the form
 * `ensemblr_exit_plan_mode` uses because it ends the turn itself rather than
 * going through the shared `tool` helper.
 */
const EXTENSION_REGISTER_TOOL_PATTERN =
	/name: '(ensemblr_[a-z_0-9]+)',\s*description:\s*(['"])((?:\\.|(?!\2)[^\\])*)\2/gs;

/**
 * Unescapes a captured source literal back to the string the extension registers
 * at runtime, so it can be compared with the endpoint's copy byte for byte.
 */
const unescapeLiteral = (literal: string): string =>
	literal.replace(/\\(['"\\])/g, '$1').replace(/\\n/g, '\n');

/**
 * Maps an `ensemblr_*` tool name onto the control op it dispatches, following
 * the naming convention every tool registration in the extension uses.
 */
export const controlOpForToolName = (toolName: string): AgentControlOp =>
	toolName
		.replace(/^ensemblr_/, '')
		.replace(/_(.)/g, (_match, letter: string) =>
			letter.toUpperCase(),
		) as AgentControlOp;

/**
 * Reads each tool description the Pi extension registers, keyed by tool name, so
 * it can be held against the MCP endpoint's copy of the same string. Covers both
 * registration forms the extension uses.
 */
export const extractEmbeddedToolDescriptions = (
	source: string,
): Map<string, string> => {
	const byName = new Map<string, string>();
	for (const match of source.matchAll(EXTENSION_TOOL_PATTERN)) {
		byName.set(match[2], unescapeLiteral(match[6]));
	}
	for (const match of source.matchAll(EXTENSION_REGISTER_TOOL_PATTERN)) {
		byName.set(match[1], unescapeLiteral(match[3]));
	}
	return byName;
};

const TYPEBOX_OBJECT_OPEN = 'Type.Object({';
const QUOTES = new Set(["'", '"', '`']);
const OPENERS = new Set(['(', '[', '{']);
const CLOSERS = new Set([')', ']', '}']);

/**
 * Advances past a quoted string, honouring backslash escapes, so punctuation in
 * a description literal never reads as structure.
 * @param body - Source text being scanned.
 * @param start - Index of the opening quote.
 * @returns Index of the closing quote, or the end of the text when unterminated.
 */
const endOfQuoted = (body: string, start: number): number => {
	for (let index = start + 1; index < body.length; index += 1) {
		if (body[index] === '\\') {
			index += 1;
		} else if (body[index] === body[start]) {
			return index;
		}
	}
	return body.length;
};

/**
 * Collects the property names declared at the top level of a TypeBox object
 * body, skipping anything nested inside a call, an array, a further object, or a
 * string. Written as a scanner rather than a regex because the parameter schemas
 * nest objects several deep and carry description strings full of punctuation.
 * @param body - Source text starting just after the object's opening brace.
 * @returns The keys in declaration order.
 */
const topLevelKeys = (body: string): readonly string[] => {
	const keys: string[] = [];
	let depth = 0;
	let token = '';
	for (let index = 0; index < body.length; index += 1) {
		const char = body[index];
		if (QUOTES.has(char)) {
			index = endOfQuoted(body, index);
		} else if (OPENERS.has(char)) {
			depth += 1;
		} else if (CLOSERS.has(char)) {
			if (depth === 0) {
				break;
			}
			depth -= 1;
		} else if (depth > 0 || char === ',') {
			token = '';
		} else if (char === ':') {
			if (token.trim()) {
				keys.push(token.trim());
			}
			token = '';
		} else {
			token += char;
		}
	}
	return keys;
};

/**
 * Reads the parameter keys of one registration, given the source that follows
 * its captured leading arguments. The zero-argument tools pass the shared
 * `empty` schema rather than an inline object.
 * @param rest - Extension source starting at the comma before the schema argument.
 * @returns The schema's top-level keys.
 */
const parseParamKeys = (rest: string): readonly string[] => {
	const head = rest.replace(/^\s*,\s*/, '');
	if (head.startsWith('empty')) {
		return [];
	}
	if (!head.startsWith(TYPEBOX_OBJECT_OPEN)) {
		throw new Error(`Unrecognized parameter schema: ${head.slice(0, 40)}`);
	}
	return topLevelKeys(head.slice(TYPEBOX_OBJECT_OPEN.length));
};

/**
 * Reads the parameter keys every tool the Pi extension registers accepts, keyed
 * by tool name. `ensemblr_exit_plan_mode` registers through `pi.registerTool`
 * rather than the `tool` helper, so its `parameters:` block is read separately.
 */
export const extractEmbeddedToolParamKeys = (
	source: string,
): Map<string, readonly string[]> => {
	const byName = new Map<string, readonly string[]>();
	for (const match of source.matchAll(EXTENSION_TOOL_PATTERN)) {
		const rest = source.slice((match.index ?? 0) + match[0].length);
		byName.set(match[2], parseParamKeys(rest));
	}
	for (const match of source.matchAll(
		/name: '(ensemblr_[a-z_0-9]+)',[\s\S]*?parameters: Type\.Object\(\{/g,
	)) {
		byName.set(
			match[1],
			topLevelKeys(source.slice((match.index ?? 0) + match[0].length)),
		);
	}
	return byName;
};
