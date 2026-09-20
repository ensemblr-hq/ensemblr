import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';

import { updateFeedAssetName } from '../../src/main/updates/release-feed';

/** Platforms Ensemblr publishes a build for. */
const PLATFORMS: readonly NodeJS.Platform[] = ['darwin', 'linux'];

/** Architectures Ensemblr publishes a build for. */
const ARCHITECTURES: readonly string[] = ['x64', 'arm64'];

/** Every feed document name the resolver produces for a supported target. */
const PRODUCIBLE = new Set(
	PLATFORMS.flatMap((platform) =>
		ARCHITECTURES.map((arch) => updateFeedAssetName(platform, arch)),
	),
);

/** Any `update-<platform>-<arch>.json` literal, as a workflow writes it. */
const FEED_DOCUMENT_LITERAL = /update-[a-z0-9]+-[a-z0-9]+\.json/g;

/**
 * Reads every `update-*.json` literal present across the release workflows,
 * scanning whatever is there rather than a fixed list so the assertion holds
 * however the workflows are edited.
 * @returns The distinct feed-document names the workflows reference
 */
function feedDocumentLiteralsInWorkflows(): string[] {
	const directory = fileURLToPath(
		new URL('../../.github/workflows/', import.meta.url),
	);
	const found = new Set<string>();
	for (const entry of readdirSync(directory)) {
		if (!entry.endsWith('.yml') && !entry.endsWith('.yaml')) {
			continue;
		}
		const contents = readFileSync(join(directory, entry), 'utf8');
		for (const match of contents.matchAll(FEED_DOCUMENT_LITERAL)) {
			found.add(match[0]);
		}
	}
	return [...found];
}

describe('release workflow feed-document names', () => {
	test('every feed document a workflow attaches is one the resolver reads', () => {
		const literals = feedDocumentLiteralsInWorkflows();

		expect(literals.length).toBeGreaterThan(0);
		for (const literal of literals) {
			expect(
				PRODUCIBLE.has(literal),
				`${literal} is not produced by updateFeedAssetName for any supported target`,
			).toBe(true);
		}
	});
});
