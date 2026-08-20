import type { ComponentProps } from 'react';
import { defaultRehypePlugins, type Streamdown } from 'streamdown';

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
 * Streamdown's own rehype chain, with `<img>` sources allowed to name the
 * `ensemblr-linear-asset:` scheme.
 *
 * `hast-util-sanitize` ships `protocols.src: ['http', 'https']` and Streamdown
 * widens only `protocols.href`, so an image on any other scheme loses its source
 * and is replaced by the harden plugin's blocked-image badge before React sees
 * it — which leaves the authenticated Linear proxy unreachable from markdown.
 * Only that one entry moves: `javascript:` and every other scheme stay refused,
 * and the chain is derived from Streamdown's default rather than rebuilt, so its
 * order and any later additions to it keep applying.
 */
export const MARKDOWN_REHYPE_PLUGINS: RehypePlugins = Object.entries(
	defaultRehypePlugins,
).map(([name, plugin]) =>
	name === 'sanitize' ? admitLinearAssetScheme(plugin) : plugin,
);
