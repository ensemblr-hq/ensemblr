import type { ComponentProps } from 'react';
import { defaultRehypePlugins, type Streamdown } from 'streamdown';

import {
	CONCIERGE_REFERENCE_SCHEME,
	parseConciergeReferenceHref,
} from '@/shared/concierge-references';
import { LINEAR_ASSET_SCHEME } from '@/shared/linear-assets';

/** The rehype chain Streamdown accepts, and one link in it. */
type RehypePlugins = NonNullable<
	ComponentProps<typeof Streamdown>['rehypePlugins']
>;
type RehypePlugin = RehypePlugins[number];

/** The one corner of `hast-util-sanitize`'s schema this module rewrites. */
interface ProtocolSchema {
	protocols?: Record<string, readonly string[]>;
}

/** As much of a hast node as the reference rewrite needs to walk and edit one. */
interface HastNode {
	children?: HastNode[];
	properties?: Record<string, unknown>;
	tagName?: string;
	type: string;
}

/** Element name a Concierge reference link is rewritten to. */
export const CONCIERGE_REFERENCE_ELEMENT = 'ensemblr-ref';

/** Attribute carrying the rewritten link's kind. */
export const CONCIERGE_REFERENCE_KIND_ATTRIBUTE = 'data-reference-kind';

/** Attribute carrying the rewritten link's id. */
export const CONCIERGE_REFERENCE_ID_ATTRIBUTE = 'data-reference-id';

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
	...Object.entries(defaultRehypePlugins).map(([name, plugin]) =>
		name === 'sanitize'
			? admitConciergeReferenceScheme(admitLinearAssetScheme(plugin))
			: plugin,
	),
	// Last, so the element it mints is one sanitize has already run past: an
	// unknown tag name would be stripped outright by the schema.
	rewriteConciergeReferences as RehypePlugin,
];
