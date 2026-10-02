import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * `docs/agent-control.md` is the reference an agent reads to pick a tool and its
 * arguments, and it is hand-maintained against three modules it cannot import.
 * Reading its source is the only guardrail there is against a wrong argument name
 * shipping as a failed tool call.
 */
export const readAgentControlDoc = (): string =>
	readFileSync(
		fileURLToPath(new URL('../../../docs/agent-control.md', import.meta.url)),
		'utf8',
	);

/**
 * One argument as a Tool reference row writes it: the name and type text of its
 * own backtick span, the `?` that span carries, and whether the row bolds it.
 * Both requiredness marks are kept so the parity test can hold them against each
 * other as well as against the schema.
 */
export interface DocArg {
	name: string;
	type: string;
	bolded: boolean;
	optionalMarked: boolean;
}

/** One row of a Tool reference table: the tool, its arguments, and its two policy columns. */
export interface DocTool {
	name: string;
	args: readonly DocArg[];
	gate: readonly string[];
	withheld: readonly string[];
}

const TABLE_HEADER = ['Tool', 'Arguments', 'Gate', 'Withheld from'];
const NO_ARGUMENTS = '*(none)*';
const EMPTY_LIST = '—';

/**
 * Matches one argument: a backtick span, optionally wrapped in `**`. One span per
 * argument is the format the tables keep, which is what makes the cell parseable
 * without splitting on commas that also appear inside nested object types and
 * inside the parenthetical limits that follow a span.
 */
const ARG_SPAN_PATTERN = /(\*\*)?`([^`]+)`(\*\*)?/g;

const ARG_PATTERN = /^([A-Za-z][A-Za-z0-9]*)(\?)?:\s+(.+)$/;

const TOOL_NAME_PATTERN = /^`(ensemblr_[a-z0-9_]+)`$/;

/**
 * Restores the characters a markdown table cell has to escape, so a type union
 * reads as `'setup' | 'run'` rather than carrying the pipe's backslash.
 * @param cell - Raw cell or span text.
 * @returns The text as it renders.
 */
const unescapeCell = (cell: string): string => cell.replace(/\\([|*])/g, '$1');

/**
 * Splits a table row into its cells on the pipes that are not escaped, so a pipe
 * inside a type union never reads as a column boundary.
 * @param line - One `| … | … |` row.
 * @returns The trimmed cells, without the leading and trailing empties.
 */
const splitRow = (line: string): readonly string[] =>
	line
		.trim()
		.replace(/^\|/, '')
		.replace(/\|$/, '')
		.split(/(?<!\\)\|/)
		.map((cell) => cell.trim());

/**
 * Reads every argument out of one Arguments cell.
 * @param cell - The cell text.
 * @param toolName - Tool the row documents, named in any parse failure.
 * @returns The arguments in the order the cell writes them.
 */
const parseArguments = (cell: string, toolName: string): readonly DocArg[] => {
	if (cell === NO_ARGUMENTS) {
		return [];
	}
	const args: DocArg[] = [];
	for (const match of cell.matchAll(ARG_SPAN_PATTERN)) {
		const bolded = Boolean(match[1]);
		if (bolded !== Boolean(match[3])) {
			throw new Error(
				`${toolName}: \`${match[2]}\` opens or closes bold without the other half.`,
			);
		}
		const parts = ARG_PATTERN.exec(unescapeCell(match[2]));
		if (!parts) {
			throw new Error(
				`${toolName}: \`${match[2]}\` is not written as \`name: type\`.`,
			);
		}
		args.push({
			name: parts[1],
			optionalMarked: Boolean(parts[2]),
			type: parts[3],
			bolded,
		});
	}
	if (args.length === 0) {
		throw new Error(
			`${toolName}: Arguments cell holds no argument span and is not ${NO_ARGUMENTS}.`,
		);
	}
	return args;
};

/**
 * Reads a comma-separated policy cell, treating the em dash as the empty list.
 * @param cell - The Gate or Withheld from cell.
 * @returns Its entries.
 */
const parseList = (cell: string): readonly string[] =>
	cell === EMPTY_LIST
		? []
		: cell.split(',').map((entry) => unescapeCell(entry).trim());

/**
 * Slices out one `##`/`###` section of the doc, up to the next `##` heading.
 * @param doc - The whole document.
 * @param heading - The heading line to start from, including its hashes.
 * @returns The section body.
 */
export const sectionOf = (doc: string, heading: string): string => {
	const start = doc.indexOf(`\n${heading}\n`);
	if (start < 0) {
		throw new Error(`docs/agent-control.md has no "${heading}" section.`);
	}
	const body = doc.slice(start + heading.length + 2);
	const end = body.search(/\n## /);
	return end < 0 ? body : body.slice(0, end);
};

/**
 * Splits text into paragraphs with each one's internal line wrapping collapsed,
 * so a claim can be matched whole rather than per wrapped line.
 * @param text - Document or section body.
 * @returns The paragraphs, whitespace-normalized.
 */
export const paragraphsIn = (text: string): readonly string[] =>
	text
		.split(/\n\s*\n/)
		.map((paragraph) => paragraph.replace(/\s+/g, ' ').trim())
		.filter(Boolean);

/**
 * Reads the contents of every backtick span in a stretch of prose, which is how
 * the doc spells an op name.
 * @param text - Prose to scan.
 * @returns The span contents in order.
 */
export const codeSpansIn = (text: string): readonly string[] =>
	[...text.matchAll(/`([^`]+)`/g)].map((match) => match[1]);

const UNITS = [
	'zero',
	'one',
	'two',
	'three',
	'four',
	'five',
	'six',
	'seven',
	'eight',
	'nine',
	'ten',
	'eleven',
	'twelve',
	'thirteen',
	'fourteen',
	'fifteen',
	'sixteen',
	'seventeen',
	'eighteen',
	'nineteen',
];

const TENS = [
	'',
	'',
	'twenty',
	'thirty',
	'forty',
	'fifty',
	'sixty',
	'seventy',
	'eighty',
	'ninety',
];

/**
 * Spells a count the way the doc's prose does, so a claim written in words can be
 * held against a set's size.
 * @param value - A count from 0 to 99.
 * @returns Its lowercase English spelling.
 */
export const numberWord = (value: number): string => {
	if (!Number.isInteger(value) || value < 0 || value > 99) {
		throw new Error(
			`No spelling for ${value}; the doc counts nothing that big.`,
		);
	}
	if (value < UNITS.length) {
		return UNITS[value];
	}
	const unit = value % 10;
	const tens = TENS[Math.floor(value / 10)];
	return unit === 0 ? tens : `${tens}-${UNITS[unit]}`;
};

/**
 * Reads every row of every table under `## Tool reference`. Throws rather than
 * skipping when a row is malformed: a row the parser cannot read is a row it
 * cannot guard, and silently dropping it would let the drift through.
 * @param doc - The whole document.
 * @returns One entry per documented tool, in document order.
 */
export const parseToolReference = (doc: string): readonly DocTool[] => {
	const tools: DocTool[] = [];
	let headers = 0;
	for (const line of sectionOf(doc, '## Tool reference').split('\n')) {
		if (!line.startsWith('|')) {
			continue;
		}
		const cells = splitRow(line);
		if (cells.length !== TABLE_HEADER.length) {
			throw new Error(
				`Tool reference row has ${cells.length} cells, expected ${TABLE_HEADER.length}: ${line}`,
			);
		}
		if (cells.every((cell) => /^-{3,}$/.test(cell))) {
			continue;
		}
		if (cells[0] === TABLE_HEADER[0]) {
			if (cells.join(' | ') !== TABLE_HEADER.join(' | ')) {
				throw new Error(`Tool reference table has unexpected columns: ${line}`);
			}
			headers += 1;
			continue;
		}
		const name = TOOL_NAME_PATTERN.exec(cells[0])?.[1];
		if (!name) {
			throw new Error(`Tool cell is not one \`ensemblr_*\` name: ${cells[0]}`);
		}
		tools.push({
			name,
			args: parseArguments(cells[1], name),
			gate: parseList(cells[2]),
			withheld: parseList(cells[3]),
		});
	}
	if (headers === 0) {
		throw new Error('The Tool reference section has no tables.');
	}
	return tools;
};
