import type { ComponentProps } from 'react';
import { defaultRehypePlugins, type Streamdown } from 'streamdown';

import {
	CONCIERGE_REFERENCE_SCHEME,
	parseConciergeReferenceHref,
} from '@/shared/concierge-references';
import { LINEAR_ASSET_SCHEME } from '@/shared/linear-assets';

import { isLocalFileReference } from './markdown-references';

/** The rehype chain Streamdown accepts, and one link in it. */
type RehypePlugins = NonNullable<
	ComponentProps<typeof Streamdown>['rehypePlugins']
>;
type RehypePlugin = RehypePlugins[number];

/** The one corner of `hast-util-sanitize`'s schema this module rewrites. */
interface ProtocolSchema {
	protocols?: Record<string, readonly string[]>;
}

/** As much of a hast node as the rewrites below need to walk and edit one. */
interface HastNode {
	children?: HastNode[];
	properties?: Record<string, unknown>;
	tagName?: string;
	type: string;
	value?: string;
}

/** Element name a Concierge reference link is rewritten to. */
export const CONCIERGE_REFERENCE_ELEMENT = 'ensemblr-ref';

/** Attribute carrying the rewritten link's kind. */
export const CONCIERGE_REFERENCE_KIND_ATTRIBUTE = 'data-reference-kind';

/** Attribute carrying the rewritten link's id. */
export const CONCIERGE_REFERENCE_ID_ATTRIBUTE = 'data-reference-id';

/** Element name a link to a workspace file is rewritten to. */
export const FILE_REFERENCE_ELEMENT = 'ensemblr-file-link';

/** Attribute carrying the rewritten link's destination, as the document wrote it. */
export const FILE_REFERENCE_HREF_ATTRIBUTE = 'data-file-href';

/** Element name an image sourced from a workspace file is rewritten to. */
export const FILE_IMAGE_ELEMENT = 'ensemblr-file-image';

/** Attribute carrying the rewritten image's source, as the document wrote it. */
export const FILE_IMAGE_SRC_ATTRIBUTE = 'data-file-src';

/** Table tags that hold cells rather than content of their own. */
const TABLE_STRUCTURE_TAGS = new Set(['thead', 'tr', 'th', 'td']);

/**
 * Add the Linear asset scheme to a sanitize step's `<img>` source allow-list.
 * @param sanitize - Streamdown's default sanitize plugin paired with its schema.
 * @returns The same plugin carrying a schema that also admits the proxy scheme.
 */
function admitLinearAssetScheme(sanitize: RehypePlugin): RehypePlugin {
	if (!Array.isArray(sanitize)) {
		return sanitize;
	}

	const [plugin, schema] = sanitize as [RehypePlugin, ProtocolSchema];
	const protocols = schema?.protocols ?? {};

	return [
		plugin,
		{
			...schema,
			protocols: {
				...protocols,
				src: [...(protocols.src ?? []), LINEAR_ASSET_SCHEME],
			},
		},
	] as RehypePlugin;
}

/**
 * Add the Concierge reference scheme to a sanitize step's `<a>` href allow-list.
 * @param sanitize - Streamdown's default sanitize plugin paired with its schema.
 * @returns The same plugin carrying a schema that also admits the scheme.
 */
function admitConciergeReferenceScheme(sanitize: RehypePlugin): RehypePlugin {
	if (!Array.isArray(sanitize)) {
		return sanitize;
	}

	const [plugin, schema] = sanitize as [RehypePlugin, ProtocolSchema];
	const protocols = schema?.protocols ?? {};

	return [
		plugin,
		{
			...schema,
			protocols: {
				...protocols,
				href: [...(protocols.href ?? []), CONCIERGE_REFERENCE_SCHEME],
			},
		},
	] as RehypePlugin;
}

/**
 * Rewrites every anchor whose destination is a Concierge reference into an
 * element only this app renders, carrying the kind and id as data attributes.
 *
 * Rewriting the element rather than overriding the `a` component is what keeps
 * ordinary links untouched: Streamdown draws those with its own link-safety
 * affordances, and replacing the anchor renderer wholesale would take those away
 * from every external link an agent writes to win a chip for the handful that
 * are references. It also means a reference can never reach `will-navigate` in
 * the main process, because by render time it is not a link at all.
 * @returns A rehype transform over the tree.
 */
function rewriteConciergeReferences(): (tree: HastNode) => void {
	return (tree) => rewriteReferenceAnchors(tree);
}

/**
 * Walks a hast subtree, replacing reference anchors in place.
 * @param node - The node to walk.
 */
function rewriteReferenceAnchors(node: HastNode): void {
	if (node.type === 'element' && node.tagName === 'a') {
		const reference = parseConciergeReferenceHref(
			typeof node.properties?.href === 'string' ? node.properties.href : '',
		);
		if (reference) {
			node.tagName = CONCIERGE_REFERENCE_ELEMENT;
			node.properties = {
				[CONCIERGE_REFERENCE_ID_ATTRIBUTE]: reference.id,
				[CONCIERGE_REFERENCE_KIND_ATTRIBUTE]: reference.kind,
			};
		}
	}
	for (const child of node.children ?? []) {
		rewriteReferenceAnchors(child);
	}
}

/**
 * Rewrites every link and image whose destination is a path rather than a URL
 * into an element only this app renders, carrying the destination as a data
 * attribute.
 *
 * A markdown document in a repository points at its neighbours — an ADR at the
 * ADR it supersedes, a guide page at the screenshot beside it — and those
 * destinations are relative paths. `rehype-harden` reads them as web URLs and
 * resolves them against an origin: `./images/a.png` comes out as
 * `/images/a.png`, which has lost the directory it was relative to, and a bare
 * `images/a.png` parses as nothing at all and is replaced by the blocked-image
 * badge. Either way the one file the reference cannot reach is the one it names.
 *
 * Taking those off the `a` and `img` tags before harden runs is what preserves
 * the path the author wrote. It costs nothing elsewhere: harden still weighs
 * every http destination, and the `a` renderer is untouched, so an external link
 * keeps Streamdown's own link-safety affordances.
 * @returns A rehype transform over the tree.
 */
function captureLocalFileReferences(): (tree: HastNode) => void {
	return (tree) => rewriteLocalReferences(tree);
}

/**
 * Walks a hast subtree, replacing path-destined links and images in place.
 * @param node - The node to walk.
 */
function rewriteLocalReferences(node: HastNode): void {
	if (node.type === 'element') {
		rewriteLocalAnchor(node);
		rewriteLocalImage(node);
	}
	for (const child of node.children ?? []) {
		rewriteLocalReferences(child);
	}
}

/**
 * Replaces an anchor pointing at a path with the app's own link element,
 * keeping the title the author wrote for it.
 * @param node - The element to weigh.
 */
function rewriteLocalAnchor(node: HastNode): void {
	if (node.tagName !== 'a') {
		return;
	}
	const href =
		typeof node.properties?.href === 'string' ? node.properties.href : '';
	if (!isLocalFileReference(href)) {
		return;
	}
	const { href: _href, ...properties } = node.properties ?? {};
	node.tagName = FILE_REFERENCE_ELEMENT;
	node.properties = { ...properties, [FILE_REFERENCE_HREF_ATTRIBUTE]: href };
}

/**
 * Replaces an image sourced from a path with the app's own image element,
 * keeping the alt text the author wrote for it.
 * @param node - The element to weigh.
 */
function rewriteLocalImage(node: HastNode): void {
	if (node.tagName !== 'img') {
		return;
	}
	const src =
		typeof node.properties?.src === 'string' ? node.properties.src : '';
	if (!isLocalFileReference(src)) {
		return;
	}
	const { src: _src, ...properties } = node.properties ?? {};
	node.tagName = FILE_IMAGE_ELEMENT;
	node.properties = { ...properties, [FILE_IMAGE_SRC_ATTRIBUTE]: src };
}

/**
 * Reports whether a table header subtree says anything at all.
 *
 * Only the structural tags are walked through: anything else the header holds —
 * an image, a line break, an inline chip — is content even when it carries no
 * text of its own.
 * @param node - The header node, or one of its descendants.
 * @returns True once a non-blank text node or a non-structural element is found.
 */
function hasHeaderContent(node: HastNode): boolean {
	if (node.type === 'text') {
		return (node.value ?? '').trim().length > 0;
	}
	if (node.type !== 'element') {
		return false;
	}
	if (!TABLE_STRUCTURE_TAGS.has(node.tagName ?? '')) {
		return true;
	}
	return (node.children ?? []).some(hasHeaderContent);
}

/**
 * Drops every `<thead>` whose cells are all empty, along with any table left
 * holding no rows once one goes.
 *
 * GFM has no headerless table: a pipe table only parses once a delimiter row
 * follows a header row, so an agent that wants a bare grid writes `|  |  |`
 * above the delimiter and the parser dutifully emits a header of empty cells.
 * Rendered, that is a labelled band over columns it does not label. Taking the
 * band away can empty the table outright — every headerless table passes through
 * that state mid-stream, between its delimiter row parsing and its first body
 * row arriving — and the answer's table frame would draw a border around
 * nothing. A header that labels its columns still stands on its own, so a
 * body-less `| Name | Age |` renders as it always has.
 * @returns A rehype transform over the tree.
 */
function dropEmptyTableParts(): (tree: HastNode) => void {
	return (tree) => pruneEmptyTableParts(tree);
}

/**
 * Walks a hast subtree, removing content-free table nodes in place.
 *
 * Depth-first, so a table is weighed after its own empty header has gone rather
 * than while it still counts as content.
 * @param node - The node to walk.
 */
function pruneEmptyTableParts(node: HastNode): void {
	if (!node.children) {
		return;
	}
	for (const child of node.children) {
		pruneEmptyTableParts(child);
	}
	node.children = node.children.filter(
		(child) => !isEmptyTableHeader(child) && !isEmptyTable(child),
	);
}

/**
 * Reports whether a node is a table header carrying nothing to show.
 * @param node - The candidate node.
 * @returns True for a `<thead>` with no content in any of its cells.
 */
function isEmptyTableHeader(node: HastNode): boolean {
	return (
		node.type === 'element' &&
		node.tagName === 'thead' &&
		!hasHeaderContent(node)
	);
}

/**
 * Reports whether a node is a table with nothing left to draw.
 * @param node - The candidate node.
 * @returns True for a `<table>` holding no row at all.
 */
function isEmptyTable(node: HastNode): boolean {
	return (
		node.type === 'element' && node.tagName === 'table' && !hasTableRows(node)
	);
}

/**
 * Reports whether a table subtree still holds a row.
 * @param node - The table node, or one of its descendants.
 * @returns True once a `<tr>` is found.
 */
function hasTableRows(node: HastNode): boolean {
	if (node.type !== 'element') {
		return false;
	}
	if (node.tagName === 'tr') {
		return true;
	}
	return (node.children ?? []).some(hasTableRows);
}

/**
 * Streamdown's own rehype chain, with `<img>` sources allowed to name the
 * `ensemblr-linear-asset:` scheme and `<a>` destinations the `ensemblr:` one.
 *
 * `hast-util-sanitize` ships `protocols.src: ['http', 'https']` and Streamdown
 * widens only `protocols.href`, so an image on any other scheme loses its source
 * and is replaced by the harden plugin's blocked-image badge before React sees
 * it — which leaves the authenticated Linear proxy unreachable from markdown.
 * Only that one entry moves: `javascript:` and every other scheme stay refused,
 * and the chain is derived from Streamdown's default rather than rebuilt, so its
 * order and any later additions to it keep applying.
 */
export const MARKDOWN_REHYPE_PLUGINS: RehypePlugins = [
	...Object.entries(defaultRehypePlugins).flatMap(([name, plugin]) =>
		name === 'sanitize'
			? [
					admitConciergeReferenceScheme(admitLinearAssetScheme(plugin)),
					// Between sanitize and harden: after the schema has run, so the
					// elements it mints are not stripped as unknown tags, and before
					// harden, which would have resolved every relative path away.
					captureLocalFileReferences as RehypePlugin,
				]
			: [plugin],
	),
	// After sanitize, so the element it mints is one the schema has already run
	// past: an unknown tag name would be stripped outright.
	rewriteConciergeReferences as RehypePlugin,
	// After the raw step, so a table an agent wrote as literal HTML is weighed as
	// elements rather than skipped as an unparsed string.
	dropEmptyTableParts as RehypePlugin,
];
