/**
 * The `name="value"` grammar the prompt blocks share.
 *
 * Two block families carry attributes into a prompt and read them back out:
 * the Concierge reference blocks in `concierge-references.ts` and the
 * `<attached_file>` envelope in `prompt-scaffolding.ts`. Both scan their
 * attribute run as `[^>]*`, so both need the same escaping — and a second copy
 * of it is a block that survives one round trip and not the other.
 *
 * What they share is the escaping and the read, not the *write*. Only
 * `<attached_file>` uses {@link formatBlockAttributes}: a Concierge block writes
 * a fixed attribute list including its empty values, which the empty-skipping
 * formatter here would drop and change its bytes. Finishing that dedup is a
 * behaviour change, not a tidy-up.
 */

/** One `name="value"` pair inside a block's attribute run. */
const BLOCK_ATTRIBUTE = /([a-z][a-zA-Z]*)="([^"]*)"/g;

/**
 * Escapes every character that could end an attribute — or the whole block —
 * early. `>` matters as much as `"`: an attribute run is scanned as `[^>]*`, so
 * one in an agent-written chat title leaves the block unmatched and the prompt
 * renders its own markup as prose.
 * @param value - The raw attribute value.
 * @returns The value with its structural characters entity-escaped.
 */
export function escapeBlockAttribute(value: string): string {
	return value
		.replaceAll('&', '&amp;')
		.replaceAll('"', '&quot;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;');
}

/**
 * Reads an attribute value back, undoing {@link escapeBlockAttribute}. `&amp;` is
 * undone last so a value that spelled out `&quot;` comes back as those six
 * characters rather than as a quote.
 *
 * Private: callers read a whole run through {@link readBlockAttributes}, which
 * is what keeps the escape and the unescape from being paired up wrongly at a
 * call site.
 * @param value - The escaped attribute value.
 * @returns The original text.
 */
function unescapeBlockAttribute(value: string): string {
	return value
		.replaceAll('&quot;', '"')
		.replaceAll('&lt;', '<')
		.replaceAll('&gt;', '>')
		.replaceAll('&amp;', '&');
}

/**
 * Writes name/value pairs as a block's attribute run, skipping any whose value
 * is empty so an absent field costs no bytes in the prompt.
 * @param attributes - Name/value pairs, in the order they should be written.
 * @returns The space-joined run, or an empty string when nothing was written.
 */
export function formatBlockAttributes(
	attributes: readonly (readonly [string, string])[],
): string {
	return attributes
		.flatMap(([name, value]) =>
			value.length > 0 ? [`${name}="${escapeBlockAttribute(value)}"`] : [],
		)
		.join(' ');
}

/**
 * Reads a block's attribute run back into a lookup, unescaping each value.
 * @param rawAttributes - The block's attribute run.
 * @returns Attribute name to value.
 */
export function readBlockAttributes(
	rawAttributes: string,
): ReadonlyMap<string, string> {
	const values = new Map<string, string>();
	for (const match of rawAttributes.matchAll(BLOCK_ATTRIBUTE)) {
		values.set(match[1] ?? '', unescapeBlockAttribute(match[2] ?? ''));
	}
	return values;
}
