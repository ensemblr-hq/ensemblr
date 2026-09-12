import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { IconifyJSON } from '@iconify/react';

import { describe, expect, it, vi } from 'vitest';
import {
	getWorkspaceFileIconName,
	WORKSPACE_FILE_ICON_NAMES,
} from '@/renderer/lib/workbench/file-icons';
import { registerIconCollections } from '@/renderer/lib/workbench/icon-collections';
import { ICON_SUBSET } from '@/renderer/lib/workbench/icon-subset.gen';
// @ts-expect-error - the generator is a plain .mjs dev script with no typings.
import { buildIconSubset } from '../../scripts/generate-icon-subset.mjs';

const registeredPrefixes = vi.hoisted(() => [] as string[]);

vi.mock('@iconify/react', () => ({
	addCollection: (collection: { prefix: string }) => {
		registeredPrefixes.push(collection.prefix);
	},
}));

type BundledPrefix = keyof typeof ICON_SUBSET;

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
	const collection: IconifyJSON = ICON_SUBSET[prefix];
	return Boolean(collection.icons[name] ?? collection.aliases?.[name]);
}

describe('registerIconCollections', () => {
	it('registers every collection the app bundles', () => {
		registeredPrefixes.length = 0;

		registerIconCollections();

		expect([...registeredPrefixes].sort()).toEqual([
			'ensemblr',
			'logos',
			'vscode-icons',
		]);
	});

	it('runs from the renderer entry before the first render', () => {
		const entry = readFileSync(join(sourceRoot, 'renderer/main.tsx'), 'utf8');

		expect(entry).toMatch(/^registerIconCollections\(\);$/m);
	});
});

describe('icon subset', () => {
	it('matches what the generator produces from the bundled collections today', () => {
		expect(JSON.parse(JSON.stringify(ICON_SUBSET))).toEqual(buildIconSubset());
	});

	it('ships a fraction of the bundled collections', () => {
		const glyphs = Object.values(ICON_SUBSET).reduce(
			(total, collection) => total + Object.keys(collection.icons).length,
			0,
		);

		expect(glyphs).toBeGreaterThan(0);
		expect(glyphs).toBeLessThan(200);
	});
});

describe('icon references in src', () => {
	const references = collectIconReferences();

	it('finds the glyph names the app draws', () => {
		expect(references.length).toBeGreaterThan(0);
	});

	it('resolves every referenced glyph in the shipped subset', () => {
		const unresolved = references.filter(
			(reference) => !resolves(reference.prefix, reference.name),
		);

		expect(unresolved).toEqual([]);
	});
});

describe('workspace file icons', () => {
	it('resolves every name the file-icon tables can produce', () => {
		const unresolved = WORKSPACE_FILE_ICON_NAMES.filter(
			(name) => !resolves('vscode-icons', name),
		);

		expect(unresolved).toEqual([]);
	});

	it('resolves the expanded variant it falls back from', () => {
		expect(getWorkspaceFileIconName({ kind: 'directory', name: 'src' })).toBe(
			'vscode-icons:folder-type-src',
		);
		expect(
			getWorkspaceFileIconName(
				{ kind: 'directory', name: 'src' },
				{ isExpanded: true },
			),
		).toBe('vscode-icons:folder-type-src-opened');
		expect(
			getWorkspaceFileIconName(
				{ kind: 'directory', name: 'unmapped' },
				{ isExpanded: true },
			),
		).toBe('vscode-icons:default-folder-opened');
	});
});
