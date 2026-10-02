/**
 * Scanner behind `npm run check:strings`, kept apart from the CLI so its
 * decisions — what counts as prose, how far an ignore directive reaches — are
 * unit-testable without walking the tree or exiting the process.
 */

/** Property names whose values are markup or styling, never user copy. */
const NON_COPY_KEYS = new Set([
	'className',
	'class',
	'fontFamily',
	'href',
	'id',
	'key',
	'src',
	'style',
	'to',
	'transition',
	'transform',
	'queryKey',
	'testId',
]);

/**
 * Call expressions whose arguments are never user copy: the translator itself
 * (its English default is what the extractor harvests), diagnostic logging, and
 * `Error` construction — a thrown message reaches a developer, and the surfaces
 * that do show one render a translated code instead.
 */
const MASKED_CALLS =
	/(^|[^.\w])(i18n\.t|t|console\.\w+|new Error|new TypeError)\s*\(/g;

const QUOTES = new Set(["'", '"', '`']);
const BRACKET_DEPTH = new Map([
	['(', 1],
	['[', 1],
	['{', 1],
	[')', -1],
	[']', -1],
	['}', -1],
]);
const PAREN_DEPTH = new Map([
	['(', 1],
	[')', -1],
]);

/**
 * Replaces a matched region with spaces so offsets and line numbers survive.
 * @param match - The source region to erase
 * @returns The same length of whitespace, newlines preserved
 */
function blankOut(match) {
	return match.replace(/[^\n]/g, ' ');
}

/**
 * Reads one character as part of a string or template literal, hiding the
 * escape and closing-delimiter rules from every scanner that has to step over
 * quoted text rather than read it.
 * @param character - Character under the cursor
 * @param quote - Delimiter of the literal already open, or null outside one
 * @returns The quote open afterwards and how far to advance, or null when the character is not quoted text
 */
function readQuoted(character, quote) {
	if (!quote) {
		return QUOTES.has(character) ? { quote: character, width: 1 } : null;
	}
	if (character === '\\') {
		return { quote, width: 2 };
	}
	return { quote: character === quote ? null : quote, width: 1 };
}

/**
 * Finds where the argument list opened at `openIndex` closes, stepping over
 * parentheses that sit inside string and template literals.
 * @param source - Source being scanned
 * @param openIndex - Index just past the opening parenthesis
 * @returns Index just past the matching closing parenthesis
 */
function findCallEnd(source, openIndex) {
	let cursor = openIndex;
	let depth = 1;
	let quote = null;
	while (cursor < source.length && depth > 0) {
		const quoted = readQuoted(source[cursor], quote);
		if (quoted) {
			quote = quoted.quote;
			cursor += quoted.width;
			continue;
		}
		depth += PAREN_DEPTH.get(source[cursor]) ?? 0;
		cursor += 1;
	}
	return cursor;
}

/**
 * Blanks every region the check must not read: comments, plus the full argument
 * list of every call in {@link MASKED_CALLS}.
 * @param source - Raw file contents
 * @returns The source with those regions replaced by whitespace
 */
export function maskTranslatedRegions(source) {
	const withoutComments = source
		.replace(/\/\*[\s\S]*?\*\//g, blankOut)
		.replace(/^[ \t]*\/\/[^\n]*/gm, blankOut);
	const characters = withoutComments.split('');
	MASKED_CALLS.lastIndex = 0;
	let match = MASKED_CALLS.exec(withoutComments);
	while (match) {
		const openIndex = match.index + match[0].length;
		const closeIndex = findCallEnd(withoutComments, openIndex);
		for (let index = openIndex; index < closeIndex; index += 1) {
			if (characters[index] !== '\n') {
				characters[index] = ' ';
			}
		}
		match = MASKED_CALLS.exec(withoutComments);
	}
	return characters.join('');
}

/**
 * Whether a literal reads as user-facing English rather than an identifier, a
 * path, a CSS value, or a class list.
 * @param value - Literal contents, interpolations already collapsed
 * @returns True when the literal should carry a translation key
 */
export function isUserFacingProse(value) {
	const trimmed = value.trim();
	if (trimmed.length < 8 || trimmed.length > 300) {
		return false;
	}
	if (/^https?:|^[./@]|[<>{}\\]/.test(trimmed)) {
		return false;
	}
	if (/^[a-z0-9:_\-[\]().,%\s]+$/.test(trimmed) && !/[.!?]\s*$/.test(trimmed)) {
		return false;
	}
	if (/(^|\s)(calc|var|min|max|translate[XY]|rgba?|oklch)\(/.test(trimmed)) {
		return false;
	}
	if (/@keyframes|@media|--[a-z-]+:/.test(trimmed)) {
		return false;
	}
	if (/^[MmLlHhVvCcSsQqTtAaZz\d.,\s-]+$/.test(trimmed)) {
		return false;
	}
	if (/\b(monospace|sans-serif|serif|ui-monospace|Nerd Font)\b/.test(trimmed)) {
		return false;
	}
	const words = trimmed.split(/\s+/);
	if (words.length < 2) {
		return false;
	}
	const alphabetic = trimmed.match(/[A-Za-z]{2,}/g) ?? [];
	if (alphabetic.length < 2) {
		return false;
	}
	return words.every((word) =>
		/^[A-Za-z0-9'’“”"(),.!?:;#%&+—–…-]+$|^\{\{[\w.]+\}\}[.,!?:;]?$/.test(word),
	);
}

/**
 * Advances the bracket depth across one line, ignoring brackets inside string
 * and template literals and reporting whether a template stays open at the end.
 * @param line - The line to scan
 * @param state - Depth carried in, and the quote character still open, if any
 * @returns The depth and open quote after the line
 */
function advanceBracketDepth(line, state) {
	let { depth, quote } = state;
	let index = 0;
	while (index < line.length) {
		const quoted = readQuoted(line[index], quote);
		if (quoted) {
			quote = quoted.quote;
			index += quoted.width;
			continue;
		}
		depth += BRACKET_DEPTH.get(line[index]) ?? 0;
		index += 1;
	}
	return { depth: Math.max(depth, 0), quote: quote === '`' ? quote : null };
}

/**
 * Lines covered by an `i18next-instrument-ignore` directive. A directive covers
 * the whole statement it introduces — a brand table, a multi-line template, an
 * `if` block — which is found by balancing brackets rather than by guessing
 * from indentation, so a block statement cannot silently swallow the rest of
 * the file. An unbalanced statement stops at end of file and the gate reports
 * what follows: imprecision here fails loud rather than passing prose through.
 * @param lines - The file's raw lines
 * @returns Set of 1-indexed line numbers the check must skip
 */
export function suppressedLines(lines) {
	const suppressed = new Set();
	lines.forEach((line, index) => {
		if (!line.includes('i18next-instrument-ignore')) {
			return;
		}
		suppressed.add(index + 1);
		let cursor = index + 1;
		while (cursor < lines.length) {
			const candidate = lines[cursor].trim();
			if (candidate.length > 0 && !candidate.startsWith('//')) {
				break;
			}
			suppressed.add(cursor + 1);
			cursor += 1;
		}
		let state = { depth: 0, quote: null };
		while (cursor < lines.length) {
			suppressed.add(cursor + 1);
			state = advanceBracketDepth(lines[cursor], state);
			if (state.depth === 0 && !state.quote) {
				return;
			}
			cursor += 1;
		}
	});
	return suppressed;
}

/**
 * Scans one source for prose literals the catalogues never saw.
 * @param relPath - Repo-relative path, used in the report
 * @param raw - Raw file contents, read for the ignore directive and context
 * @returns One finding per prose literal
 */
export function findingsForFile(relPath, raw) {
	const masked = maskTranslatedRegions(raw);
	const rawLines = raw.split('\n');
	const ignored = suppressedLines(rawLines);
	const findings = [];

	/**
	 * Records a finding unless its line opts out or names a non-copy property.
	 * @param offset - Index into the masked source where the literal starts
	 * @param value - The literal's contents
	 */
	const record = (offset, value) => {
		const line = masked.slice(0, offset).split('\n').length;
		const context = rawLines[line - 1] ?? '';
		if (ignored.has(line)) {
			return;
		}
		const literalStart = context.indexOf(value.slice(0, 12));
		if (literalStart > 0) {
			const propertyMatch = /([\w-]+)\s*[=:]\s*[`'"]?$/.exec(
				context.slice(0, literalStart),
			);
			if (propertyMatch && NON_COPY_KEYS.has(propertyMatch[1])) {
				return;
			}
		}
		findings.push({ file: relPath, line, value: value.trim().slice(0, 120) });
	};

	const quoted = /(['"])((?:\\.|(?!\1)[^\\\n])*)\1/g;
	let match = quoted.exec(masked);
	while (match) {
		const value = match[2].replace(/\\(['"])/g, '$1');
		if (isUserFacingProse(value)) {
			record(match.index, value);
		}
		match = quoted.exec(masked);
	}

	const templated = /`((?:\\.|\$\{[^{}]*\}|[^\\`])*)`/g;
	match = templated.exec(masked);
	while (match) {
		const value = match[1].replace(/\$\{[^{}]*\}/g, ' {{value}} ');
		if (isUserFacingProse(value)) {
			record(match.index, value);
		}
		match = templated.exec(masked);
	}

	// Only `.tsx` carries JSX; in a `.ts` file the same `>…<` shape is a
	// TypeScript generic, and every match would be a false positive.
	if (relPath.endsWith('.tsx')) {
		const jsxText = />\s*([^<>{}\n]{8,200}?)\s*</g;
		match = jsxText.exec(masked);
		while (match) {
			// A generic argument list closes with the same `>` a JSX tag does, so
			// `Record<string, unknown>` reads as text; TypeScript punctuation that
			// prose never carries is what tells the two apart.
			const looksLikeTypeSyntax = /[():]|\sas\s|=>/.test(match[1]);
			if (!looksLikeTypeSyntax && isUserFacingProse(match[1])) {
				record(match.index, match[1]);
			}
			match = jsxText.exec(masked);
		}
	}

	return findings;
}
