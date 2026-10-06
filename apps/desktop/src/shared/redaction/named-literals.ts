/**
 * Exact-value redaction that names what it removed.
 *
 * The shape scanners in `../redaction.ts` guess at what *looks* like a secret;
 * this module replaces only values the caller already knows are secrets, and
 * labels each one with the variable it came from. It is the half of redaction
 * that can run over a conversation transcript: a guess there would blank prose
 * and code an agent needs to read, while a known value is never legitimate
 * output.
 */

/**
 * Shortest value worth redacting. Below it a match is as likely to be a flag or
 * a placeholder as a credential, and blanking it only costs readability.
 */
export const MINIMUM_VALUE_LENGTH = 4;

/**
 * Shortest line of a multi-line secret worth redacting on its own. Shorter
 * lines — braces, `"type": "service_account",` — are structure that would
 * blank unrelated output wherever it recurs.
 */
const MINIMUM_LINE_LITERAL_LENGTH = 16;

/** Any PEM armor line, which is public boilerplate rather than secret material. */
const PEM_ARMOR_LINE = /^-----(?:BEGIN|END) [A-Z ]+-----$/;

/** A `"key": value` member line of a JSON document, capturing the value. */
const JSON_MEMBER_LINE = /^"[^"]*"\s*:\s*(.*?)\s*,?$/;

/** A URL, which is an address rather than secret material even inside a secret. */
const URL_LINE = /^[a-z][a-z0-9+.-]*:\/\//i;

/** One known secret value and the name its placeholder carries. */
export interface NamedSecretValue {
	name: string;
	value: string;
}

/** Text after named redaction, and how many spans were replaced. */
export interface NamedRedactionResult {
	/** Number of replaced spans; 0 means `text` is the input unchanged. */
	redacted: number;
	text: string;
}

/** One occurrence of a literal in the text being redacted. */
interface LiteralMatch {
	end: number;
	/** Position of the literal in the longest-first table, for tie-breaking. */
	rank: number;
	start: number;
}

/**
 * The part of one line of a multi-line secret worth redacting on its own: a
 * JSON member's value rather than the whole member, and nothing for an armor
 * line, a URL, or anything too short to be distinctive.
 * @param line - One line of the secret.
 * @returns The literal to add, or null.
 */
export function lineLiteral(line: string): string | null {
	const trimmed = line.trim();
	if (PEM_ARMOR_LINE.test(trimmed)) {
		return null;
	}
	const member = JSON_MEMBER_LINE.exec(trimmed)?.[1];
	const candidate = member?.replace(/^"(.*)"$/, '$1') ?? trimmed;
	return candidate.length >= MINIMUM_LINE_LITERAL_LENGTH &&
		!URL_LINE.test(candidate)
		? candidate
		: null;
}

/**
 * The placeholder a named secret is replaced with.
 * @param name - Variable the secret came from.
 * @returns The placeholder text.
 */
function namedPlaceholder(name: string): string {
	return `[redacted:${name}]`;
}

/**
 * Expands each secret into the literals worth matching — the value itself and,
 * for a multi-line value, its distinctive lines under the same name — then drops
 * anything under the length floor, keeps the first name per value, and orders
 * the table longest first.
 * @param secrets - Known secret values with their names, in priority order.
 * @returns The literal table the matcher walks.
 */
function literalTable(
	secrets: readonly NamedSecretValue[],
): readonly NamedSecretValue[] {
	const byValue = new Map<string, string>();
	/**
	 * Records one literal under its name unless it is too short or already named.
	 * @param value - Literal to match.
	 * @param name - Variable the literal came from.
	 */
	const add = (value: string, name: string): void => {
		if (value.length >= MINIMUM_VALUE_LENGTH && !byValue.has(value)) {
			byValue.set(value, name);
		}
	};
	for (const { name, value } of secrets) {
		add(value, name);
		if (value.includes('\n')) {
			for (const line of value.split(/\r?\n/)) {
				const literal = lineLiteral(line);
				if (literal !== null) {
					add(literal, name);
				}
			}
		}
	}
	return Array.from(byValue, ([value, name]) => ({ name, value })).sort(
		(left, right) => right.value.length - left.value.length,
	);
}

/**
 * Finds every occurrence of every literal, overlapping ones included, so no
 * byte of a secret escapes because a different secret matched first.
 * @param text - Text to scan.
 * @param table - Longest-first literal table.
 * @returns The matches, ordered by start and then by length descending.
 */
function findMatches(
	text: string,
	table: readonly NamedSecretValue[],
): LiteralMatch[] {
	const matches: LiteralMatch[] = [];
	table.forEach(({ value }, rank) => {
		let index = text.indexOf(value);
		while (index !== -1) {
			matches.push({ end: index + value.length, rank, start: index });
			index = text.indexOf(value, index + 1);
		}
	});
	return matches.sort(
		(left, right) =>
			left.start - right.start ||
			right.end - left.end ||
			left.rank - right.rank,
	);
}

/**
 * Replaces every exact occurrence of a known secret with a placeholder naming
 * it. Overlapping occurrences merge into one span named after the longest
 * literal inside it, so a secret that contains another is reported once, under
 * its own name, with nothing of either left behind.
 * @param text - Text to redact.
 * @param secrets - Known secret values with their names; earlier entries win a shared value.
 * @returns The redacted text and the number of spans replaced.
 */
export function redactNamedSecrets(
	text: string,
	secrets: readonly NamedSecretValue[],
): NamedRedactionResult {
	const table = literalTable(secrets);
	const matches = findMatches(text, table);
	if (matches.length === 0) {
		return { redacted: 0, text };
	}
	const pieces: string[] = [];
	let cursor = 0;
	let redacted = 0;
	let index = 0;
	while (index < matches.length) {
		const first = matches[index] as LiteralMatch;
		let spanEnd = first.end;
		let named = first;
		index += 1;
		for (; index < matches.length; index += 1) {
			const next = matches[index] as LiteralMatch;
			if (next.start >= spanEnd) {
				break;
			}
			spanEnd = Math.max(spanEnd, next.end);
			named = next.rank < named.rank ? next : named;
		}
		pieces.push(
			text.slice(cursor, first.start),
			namedPlaceholder((table[named.rank] as NamedSecretValue).name),
		);
		cursor = spanEnd;
		redacted += 1;
	}
	pieces.push(text.slice(cursor));
	return { redacted, text: pieces.join('') };
}
