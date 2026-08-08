import { describe, expect, it } from 'vitest';

import { TOOL_DEFS } from '../../src/main/agent-control/index.ts';
import {
	canonicalEnsemblrToolName,
	ENSEMBLR_CONTROL_TOOL_NAMES,
} from '../../src/renderer/lib/agent-timeline/ensemblr-tool-presentation.ts';

// A control tool the timeline has no label for falls through to the generic
// extension row, which titles itself with the raw wire name and marks itself
// with the generic wrench — the exact row the labels exist to replace.
// Registering a tool and forgetting its label is silent otherwise, so this holds
// the two registries against each other.
describe('control tool timeline labels', () => {
	const registered = TOOL_DEFS.map((def) => def.name);

	it.each(registered)('resolves %s to a registered name', (toolName) => {
		expect(canonicalEnsemblrToolName(toolName)).toBe(toolName);
	});

	// The bookkeeping tools are hidden when they succeed rather than labelled, so
	// they resolve without carrying one.
	it('labels every control tool the timeline renders', () => {
		const labelled = new Set<string>(ENSEMBLR_CONTROL_TOOL_NAMES);

		expect(registered.filter((name) => !labelled.has(name)).sort()).toEqual([
			'ensemblr_set_branch_name',
			'ensemblr_set_name',
			'ensemblr_set_summary',
		]);
	});

	it('labels nothing the control surface no longer registers', () => {
		const known = new Set<string>(registered);

		expect(
			ENSEMBLR_CONTROL_TOOL_NAMES.filter((name) => !known.has(name)),
		).toEqual([]);
	});
});
