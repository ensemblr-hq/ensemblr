import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import {
	failurePresentation,
	finalPresentation,
	initialPresentation,
	runningPresentation,
} from './presenter.ts';

/** Adds a small searchable tool whose native Ensemblr view is owned by this extension. */
export default function extension(pi: ExtensionAPI) {
	pi.registerTool({
		name: 'example_search',
		label: 'Example search',
		description: 'Demonstrate extension-owned Ensemblr presentation snapshots.',
		parameters: Type.Object({
			query: Type.String({ description: 'Text to search for' }),
			fail: Type.Optional(
				Type.Boolean({
					description: 'Throw to demonstrate host error precedence',
				}),
			),
		}),
		async execute(_toolCallId, params, _signal, onUpdate) {
			onUpdate?.({
				content: [],
				details: { ensemblr: { presentation: initialPresentation() } },
			});
			await new Promise((resolve) => setTimeout(resolve, 150));

			onUpdate?.({
				content: [],
				details: {
					ensemblr: { presentation: runningPresentation(params.query, 1) },
				},
			});
			await new Promise((resolve) => setTimeout(resolve, 150));

			if (params.fail) {
				onUpdate?.({
					content: [],
					details: { ensemblr: { presentation: failurePresentation() } },
				});
				throw new Error('example_search failed deliberately');
			}

			const text = `Found one result for ${params.query}`;
			return {
				content: [{ type: 'text', text }],
				details: {
					ensemblr: { presentation: finalPresentation(params.query, 1) },
				},
			};
		},
	});
}
