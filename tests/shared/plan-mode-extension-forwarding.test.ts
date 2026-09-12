import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { evaluatePlanModeTool } from '@/shared/plan-mode';

const EXTENSION_PATH = fileURLToPath(
	new URL(
		'../../resources/pi-extensions/ensemblr-control.mts',
		import.meta.url,
	),
);

/** Reads the shipped Pi extension, which cannot import from `src/` at runtime. */
function readExtensionSource(): string {
	return readFileSync(EXTENSION_PATH, 'utf8');
}

/**
 * Reads a `new Set([...])` of string literals out of the extension source.
 * @param source - The extension's text.
 * @param name - The const the set is bound to.
 * @returns Its members, sorted.
 */
function embeddedSet(source: string, name: string): string[] {
	const match = new RegExp(`const ${name} = new Set\\(\\[([^\\]]*)\\]\\)`).exec(
		source,
	);
	expect(match, `${name} not found in the extension`).not.toBeNull();
	return [...(match?.[1] ?? '').matchAll(/'([^']+)'/g)]
		.map((entry) => entry[1] as string)
		.sort();
}

// The hook used to filter on a union of eight literal tool names before asking
// the app, so a write tool from an MCP server or another installed extension was
// never forwarded and no policy ever saw it. The posture is now the bash
// classifier's: answer locally only for names known to read, forward the rest,
// and let the app refuse what it cannot vouch for.
describe('the Pi extension forwards by default rather than by name', () => {
	it('answers locally only for tools the shared classifier also clears', () => {
		for (const tool of embeddedSet(
			readExtensionSource(),
			'UNFORWARDED_TOOLS',
		)) {
			expect(evaluatePlanModeTool({ tool })).toEqual({ blocked: false });
		}
	});

	it('holds nothing the shared classifier would have blocked', () => {
		const unforwarded = embeddedSet(readExtensionSource(), 'UNFORWARDED_TOOLS');
		expect(unforwarded).not.toContain('bash');
		expect(unforwarded).not.toContain('edit');
		expect(unforwarded).not.toContain('write');
		expect(unforwarded).not.toContain('powershell');
	});

	it('forwards a tool neither policy names', () => {
		const source = readExtensionSource();
		expect(source).toMatch(
			/UNFORWARDED_TOOLS\.has\(toolName\) \|\|\s*toolName\.startsWith\(CONTROL_TOOL_PREFIX\)/,
		);
		expect(source).toMatch(
			/if \(!GUARDED_TOOLS\.has\(event\.toolName\)\) \{\s*if \(answersWithoutTheApp\(event\.toolName\)\) \{\s*return;/,
		);
	});

	it('uses the same control-tool prefix the shared classifier exempts', () => {
		expect(readExtensionSource()).toContain(
			"const CONTROL_TOOL_PREFIX = 'ensemblr_'",
		);
		expect(
			evaluatePlanModeTool({ tool: 'ensemblr_get_workspace_diff' }),
		).toEqual({ blocked: false });
	});
});
