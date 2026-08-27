import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { icons as logosIcons } from '@iconify-json/logos';
import { icons as vscodeIcons } from '@iconify-json/vscode-icons';
import { describe, expect, it, vi } from 'vitest';

import { registerIconCollections } from '@/renderer/lib/workbench/icon-collections';

const registeredPrefixes = vi.hoisted(() => [] as string[]);

vi.mock('@iconify/react', () => ({
	addCollection: (collection: { prefix: string }) => {
		registeredPrefixes.push(collection.prefix);
	},
}));

const BUNDLED_COLLECTIONS = {
	logos: logosIcons,
	'vscode-icons': vscodeIcons,
};

type BundledPrefix = keyof typeof BUNDLED_COLLECTIONS;

const ICON_REFERENCE = /(?<![\w-])(vscode-icons|logos):([a-z0-9][a-z0-9-]*)/g;

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
const sourceRoot = join(repoRoot, 'src');

function listSourceFiles(): string[] {
	return readdirSync(sourceRoot, { recursive: true, withFileTypes: true })
		.filter((entry) => entry.isFile() && /\.tsx?$/.test(entry.name))
		.map((entry) => join(entry.parentPath, entry.name));
}

function collectIconReferences() {
	return listSourceFiles().flatMap((filePath) =>
		[...readFileSync(filePath, 'utf8').matchAll(ICON_REFERENCE)].map(
			(match) => ({
				file: relative(repoRoot, filePath),
				name: match[2] as string,
				prefix: match[1] as BundledPrefix,
			}),
		),
	);
}

function resolves(prefix: BundledPrefix, name: string): boolean {
	const collection = BUNDLED_COLLECTIONS[prefix];
	return Boolean(collection.icons[name] ?? collection.aliases?.[name]);
}

describe('registerIconCollections', () => {
	it('registers every collection the app bundles', () => {
		registeredPrefixes.length = 0;

		registerIconCollections();

		expect([...registeredPrefixes].sort()).toEqual(['logos', 'vscode-icons']);
	});

	it('runs from the renderer entry before the first render', () => {
		const entry = readFileSync(join(sourceRoot, 'renderer/main.tsx'), 'utf8');

		expect(entry).toMatch(/^registerIconCollections\(\);$/m);
	});
});

describe('icon references in src', () => {
	const references = collectIconReferences();

	it('finds the glyph names the app draws', () => {
		expect(references.length).toBeGreaterThan(0);
	});

	it('resolves every referenced glyph in its bundled collection', () => {
		const unresolved = references.filter(
			(reference) => !resolves(reference.prefix, reference.name),
		);

		expect(unresolved).toEqual([]);
	});
});
