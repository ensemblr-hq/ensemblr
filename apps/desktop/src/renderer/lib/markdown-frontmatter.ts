/** One key from a markdown document's frontmatter, as the header draws it. */
export interface FrontmatterEntry {
	key: string;
	value: string;
}

/**
 * A frontmatter block in the shape a header can draw: named entries when the
 * block is the flat key/value form frontmatter almost always takes, or the block
 * verbatim when it is anything else. Nothing here interprets YAML semantics — a
 * shape this cannot group by key is shown as written rather than guessed at.
 *
 * Entry keys are unique: a block repeating one falls to `raw`, which is what
 * lets a header key its rows by name.
 */
export type FrontmatterBlock =
	| { entries: FrontmatterEntry[]; kind: 'entries' }
	| { kind: 'raw'; text: string };

/** A markdown source split into its frontmatter block and the body below it. */
export interface MarkdownDocument {
	body: string;
	frontmatter: FrontmatterBlock | null;
}

/** A line pulled out of the block before its value has been assembled. */
interface FrontmatterGroup {
	continuations: string[];
	inline: string;
	key: string;
}

const FRONTMATTER_OPEN = /^---[ \t]*$/;
const FRONTMATTER_CLOSE = /^(?:---|\.\.\.)[ \t]*$/;
const FRONTMATTER_KEY = /^([A-Za-z0-9_][\w.$-]*)[ \t]*:(?:[ \t]+(.*))?$/;
const FRONTMATTER_COMMENT = /^#/;
const FRONTMATTER_LIST_ITEM = /^-[ \t]+(.*)$/;
const LEADING_BLANK_LINES = /^(?:[ \t]*\n)+/;
const LEADING_BOM = /^﻿/;
const QUOTED_SCALAR = /^(["'])(.*)\1$/;
const SINGLE_QUOTE_RUN = /'+/g;

/**
 * Splits a markdown source into its frontmatter block and the body below it.
 *
 * A frontmatter block is not markdown, but CommonMark reads it as some: the
 * opening `---` becomes a thematic break and the closing one turns every key
 * above it into a setext heading, so an unsplit document opens with its metadata
 * set as one run-on title. Taking the block out of the source is what lets the
 * header draw it and the body start at its real first heading.
 *
 * A document whose fences turn out to wrap prose rather than metadata is handed
 * back whole. Two thematic breaks look exactly like a frontmatter block from the
 * outside, and a preview that quietly moves the first section into a metadata
 * band shows a file that differs from the file.
 * @param source - The markdown file's full text.
 * @returns The body to render, and the frontmatter block when the file opens with one.
 */
export function splitMarkdownFrontmatter(source: string): MarkdownDocument {
	const lines = source.replace(LEADING_BOM, '').split(/\r?\n/);
	if (!FRONTMATTER_OPEN.test(lines.at(0) ?? '')) {
		return { body: source, frontmatter: null };
	}
	const closingIndex = lines.findIndex(
		(line, index) => index > 0 && FRONTMATTER_CLOSE.test(line),
	);
	if (closingIndex === -1) {
		return { body: source, frontmatter: null };
	}
	const block = lines.slice(1, closingIndex);
	const body = lines
		.slice(closingIndex + 1)
		.join('\n')
		.replace(LEADING_BLANK_LINES, '');
	if (block.every((line) => line.trim().length === 0)) {
		return { body, frontmatter: null };
	}
	const frontmatter = readFrontmatterBlock(block);
	return frontmatter
		? { body, frontmatter }
		: { body: source, frontmatter: null };
}

/**
 * Reads the lines between the fences as named entries, falling back to the block
 * verbatim as soon as one line does not fit the flat key/value form.
 *
 * What the block opens with decides how far that fallback reaches. A block whose
 * first line is a key is metadata whatever follows, so a nested shape is still
 * shown verbatim. A block opening with anything else — a `#`, which is a YAML
 * comment and a markdown heading both — is metadata only if every line under it
 * is a key, because the alternative reading is a heading fenced by two rules.
 * @param lines - The block's lines, fences excluded.
 * @returns The block in whichever of the two shapes it fits, or null when the
 *   fences are thematic breaks rather than a frontmatter block.
 */
function readFrontmatterBlock(lines: string[]): FrontmatterBlock | null {
	const opening = lines.find((line) => line.trim().length > 0) ?? '';
	const opensWithKey = FRONTMATTER_KEY.test(opening);
	if (!(opensWithKey || FRONTMATTER_COMMENT.test(opening))) {
		return null;
	}
	const groups = groupFrontmatterLines(lines);
	const entries = groups && entriesForGroups(groups);
	if (entries) {
		return { entries, kind: 'entries' };
	}
	return opensWithKey ? { kind: 'raw', text: lines.join('\n').trim() } : null;
}

/**
 * Assembles one entry per group, refusing the whole set when a group holds a
 * shape with no display value or when a key is written twice — a repeat has no
 * single reading, and two rows under one name claim it does.
 * @param groups - The block's groups, in the order they were written.
 * @returns One entry per group with a unique key, or null when the set is
 *   neither, which sends the block to its verbatim rendering.
 */
function entriesForGroups(
	groups: FrontmatterGroup[],
): FrontmatterEntry[] | null {
	const entries: FrontmatterEntry[] = [];
	const seen = new Set<string>();
	for (const group of groups) {
		const value = valueForGroup(group);
		if (value === null || seen.has(group.key)) {
			return null;
		}
		seen.add(group.key);
		entries.push({ key: group.key, value });
	}
	return entries;
}

/**
 * Groups the block's lines under the key each one belongs to, passing over the
 * blank lines and whole-line comments that carry no metadata of their own.
 * @param lines - The block's lines, fences excluded.
 * @returns One group per key, or null when a line belongs to no key.
 */
function groupFrontmatterLines(lines: string[]): FrontmatterGroup[] | null {
	const groups: FrontmatterGroup[] = [];
	for (const line of lines) {
		if (isSkippable(line)) {
			continue;
		}
		const opened = groupForKeyLine(line);
		if (opened) {
			groups.push(opened);
			continue;
		}
		const open = groups.at(-1);
		if (!open || !isContinuation(line)) {
			return null;
		}
		open.continuations.push(line.trim());
	}
	return groups.length > 0 ? groups : null;
}

/**
 * Whether a line carries no metadata of its own, sitting between keys rather
 * than under one.
 * @param line - A block line.
 * @returns True for a blank line or a whole-line comment.
 */
function isSkippable(line: string): boolean {
	return line.trim().length === 0 || FRONTMATTER_COMMENT.test(line);
}

/**
 * Opens a group for a line that names a key.
 * @param line - A block line.
 * @returns The group the key opens, or null when the line names none.
 */
function groupForKeyLine(line: string): FrontmatterGroup | null {
	const keyed = FRONTMATTER_KEY.exec(line);
	if (!keyed) {
		return null;
	}
	return {
		continuations: [],
		inline: keyed[2]?.trim() ?? '',
		key: keyed[1] ?? '',
	};
}

/**
 * Whether a line carries on the key above it rather than opening a new one.
 * @param line - A block line that did not parse as a key.
 * @returns True for an indented line or a list item at the block's own indent.
 */
function isContinuation(line: string): boolean {
	return /^[ \t]/.test(line) || FRONTMATTER_LIST_ITEM.test(line);
}

/**
 * Assembles one group's display value: a scalar written beside its key, or a
 * list written beneath it read back as a comma-separated line.
 * @param group - The key and the lines gathered under it.
 * @returns The value to display, or null when the group is neither shape.
 */
function valueForGroup(group: FrontmatterGroup): string | null {
	if (group.continuations.length === 0) {
		return unquote(group.inline);
	}
	if (group.inline.length > 0) {
		return null;
	}
	const items = group.continuations.map((line) =>
		FRONTMATTER_LIST_ITEM.exec(line)?.at(1),
	);
	if (items.some((item) => item === undefined)) {
		return null;
	}
	return items.map((item) => unquote(item ?? '')).join(', ');
}

/**
 * Reads a quoted scalar back as the text it stands for, dropping the quotes YAML
 * uses to protect it and the escapes it writes inside them. Ensemblr quotes its
 * own plan and summary frontmatter with `JSON.stringify`, so a title carrying an
 * apostrophe or a quotation mark reaches here escaped and would otherwise be
 * drawn with its backslashes showing.
 *
 * A value that merely opens and closes on a quote is not a quoted scalar, and is
 * handed back as written rather than truncated to what sits between the two.
 * @param value - A scalar as written in the block.
 * @returns The text the scalar stands for, or the scalar verbatim when the
 *   quotes around it do not enclose one.
 */
function unquote(value: string): string {
	const quoted = QUOTED_SCALAR.exec(value);
	if (!quoted) {
		return value;
	}
	const inner = quoted.at(2) ?? '';
	const decoded =
		quoted.at(1) === '"'
			? decodeDoubleQuoted(value)
			: decodeSingleQuoted(inner);
	return decoded ?? value;
}

/**
 * Decodes a double-quoted scalar through the JSON reader, which covers the
 * escapes both Ensemblr writers emit.
 * @param value - The scalar including its surrounding quotes.
 * @returns The decoded text, or null when the quotes enclose no valid scalar.
 */
function decodeDoubleQuoted(value: string): string | null {
	try {
		const parsed: unknown = JSON.parse(value);
		return typeof parsed === 'string' ? parsed : null;
	} catch {
		return null;
	}
}

/**
 * Decodes a single-quoted scalar, where YAML escapes a quote by doubling it and
 * has no other escape. An odd run of quotes cannot have been written that way,
 * which is what separates a scalar from a value that merely ends in a quote.
 * @param inner - The text between the surrounding quotes.
 * @returns The decoded text, or null when the quotes enclose no valid scalar.
 */
function decodeSingleQuoted(inner: string): string | null {
	const runs = inner.match(SINGLE_QUOTE_RUN) ?? [];
	if (runs.some((run) => run.length % 2 !== 0)) {
		return null;
	}
	return inner.replaceAll("''", "'");
}
