import { readFileSync } from 'node:fs';
import path from 'node:path';

// happy-dom replaces the global `URL` constructor with one that ignores a
// `file:` base and resolves against `window.location`, so the module's own
// directory is the only base a DOM test can resolve a path from.
const STYLESHEET = readFileSync(
	path.join(import.meta.dirname, '../../../src/renderer/styles/index.css'),
	'utf8',
).replace(/\/\*[\s\S]*?\*\//g, '');

/**
 * Reads one top-level rule out of the renderer stylesheet Ensemblr ships, so a
 * test asserts against the CSS the app actually loads rather than a copy of it.
 * Comments are stripped first, so one sitting between two selectors cannot end
 * up in the selector list handed back.
 * @param anchor - The rule's first selector, written as the stylesheet writes it.
 * @returns The rule's whole selector list, whitespace-collapsed so it can be
 * handed to `Element.matches`, alongside its declarations — or null when the
 * stylesheet carries no such rule.
 */
export function readStyleRule(
	anchor: string,
): { selectors: string; declarations: string } | null {
	const escaped = anchor.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	const rule = new RegExp(`\\n\\t${escaped}([^{}]*)\\{([^{}]*)\\}`).exec(
		STYLESHEET,
	);

	if (!rule) {
		return null;
	}

	return {
		selectors: `${anchor}${rule[1]}`.replace(/\s+/g, ' ').trim(),
		declarations: rule[2],
	};
}
