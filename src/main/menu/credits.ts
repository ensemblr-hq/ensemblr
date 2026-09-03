/**
 * Formats the credits the native About panel shows: the author, every direct
 * dependency with its license, and the project Ensemblr takes its inspiration
 * from.
 *
 * Electron splits this across two platform-exclusive fields — `authors` is
 * Linux-only and `credits` is macOS-only — and the two render text very
 * differently, so each gets its own link treatment. GTK turns an
 * angle-bracketed URL on its credits page into a link; macOS takes a plain
 * `NSAttributedString` and shows the brackets verbatim, where 82 unclickable
 * URLs wrap to three lines apiece and bury the names they belong to.
 */

import type { AboutPanelStrings } from './about-panel-strings';

/** One credited project: what it is called, what it is licensed under, where it lives. */
export interface CreditPackage {
	name: string;
	license: string;
	url: string;
	kind: 'runtime' | 'development';
}

/** How a credits surface renders a project link. */
type LinkStyle = 'linkified' | 'omitted';

/** The project whose design Ensemblr takes its inspiration from. */
const INSPIRATION = { name: 'Conductor', url: 'https://conductor.build' };

/** Divider drawn under a group heading to break the list into scannable blocks. */
const SECTION_RULE = '─'.repeat(28);

/**
 * Renders a URL for a surface that linkifies it, or drops it for one that would
 * only show the raw text.
 * @param url - Project page to link to
 * @param style - How the target surface treats links
 * @returns The link suffix, empty when the surface cannot linkify
 */
function linkSuffix(url: string, style: LinkStyle): string {
	return style === 'linkified' ? ` <${url}>` : '';
}

/**
 * Renders the heading, divider, and entries for one dependency group, or
 * nothing when the group is empty.
 * @param heading - Localized group heading
 * @param packages - Credit entries in that group
 * @param style - How the target surface treats links
 * @returns The group's lines, preceded by a blank separator line
 */
function creditSection(
	heading: string,
	packages: readonly CreditPackage[],
	style: LinkStyle,
): string[] {
	if (packages.length === 0) return [];
	return [
		'',
		heading,
		SECTION_RULE,
		...packages.map(
			(entry) =>
				`${entry.name} — ${entry.license}${linkSuffix(entry.url, style)}`,
		),
	];
}

/**
 * Renders the inspiration credit, which closes the panel because it credits a
 * peer rather than something Ensemblr is built out of.
 *
 * It keeps its address on the surface that cannot linkify, where `linkSuffix`
 * drops every package's: one bare host costs a single line, where the package
 * list's would wrap the macOS column three times over apiece.
 * @param strings - Localized headings for the active language
 * @param style - How the target surface treats links
 * @returns The credit's lines, preceded by a blank separator line
 */
function inspirationSection(
	strings: AboutPanelStrings,
	style: LinkStyle,
): string[] {
	const credit = strings.inspiredBy.replace('{{name}}', INSPIRATION.name);
	if (style === 'linkified') {
		return ['', SECTION_RULE, `${credit} <${INSPIRATION.url}>`];
	}
	const host = INSPIRATION.url.replace(/^https:\/\//, '');
	return ['', SECTION_RULE, `${credit} (${host})`];
}

/**
 * Builds the credits document, one line per array entry.
 * @param strings - Localized headings for the active language
 * @param packages - Every direct dependency, in display order
 * @param author - Name of the app's author
 * @param style - How the target surface treats links
 * @returns The credits as lines
 */
function creditDocument(
	strings: AboutPanelStrings,
	packages: readonly CreditPackage[],
	author: string,
	style: LinkStyle,
): string[] {
	return [
		author,
		...creditSection(
			strings.coreProjects,
			packages.filter((entry) => entry.kind === 'runtime'),
			style,
		),
		...creditSection(
			strings.developmentTools,
			packages.filter((entry) => entry.kind === 'development'),
			style,
		),
		...inspirationSection(strings, style),
	];
}

/**
 * Builds the credits for Electron's Linux-only `authors` field, which GTK
 * renders one entry per line and linkifies.
 * @param strings - Localized headings for the active language
 * @param packages - Every direct dependency, in display order
 * @param author - Name of the app's author
 * @returns The credits as lines
 */
export function creditLines(
	strings: AboutPanelStrings,
	packages: readonly CreditPackage[],
	author: string,
): string[] {
	return creditDocument(strings, packages, author, 'linkified');
}

/**
 * Builds the credits for Electron's macOS-only `credits` field, which takes one
 * plain string in a narrow column and cannot linkify.
 * @param strings - Localized headings for the active language
 * @param packages - Every direct dependency, in display order
 * @param author - Name of the app's author
 * @returns The credits as a single newline-joined string
 */
export function creditsText(
	strings: AboutPanelStrings,
	packages: readonly CreditPackage[],
	author: string,
): string {
	return creditDocument(strings, packages, author, 'omitted').join('\n');
}
