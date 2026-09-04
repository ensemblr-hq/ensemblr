import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repositoryRoot = path.resolve(import.meta.dirname, '../..');

const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.mts']);

/**
 * Lists every source file under a directory, recursively.
 * @param directory - Absolute directory to walk.
 * @returns Absolute paths of the source files found.
 */
function sourceFilesIn(directory: string): string[] {
	const found: string[] = [];
	for (const entry of readdirSync(directory)) {
		const absolute = path.join(directory, entry);
		if (statSync(absolute).isDirectory()) {
			found.push(...sourceFilesIn(absolute));
			continue;
		}
		if (SOURCE_EXTENSIONS.has(path.extname(absolute))) {
			found.push(absolute);
		}
	}
	return found;
}

/**
 * Finds the files in a tree that import from a forbidden one.
 * @param treeName - Directory to scan, relative to the repository root.
 * @param forbidden - Import-specifier fragment that must not appear.
 * @returns Repository-relative paths of the offending files.
 */
function filesImporting(treeName: string, forbidden: string): string[] {
	const tree = path.join(repositoryRoot, treeName);
	return sourceFilesIn(tree)
		.filter((file) => {
			const source = readFileSync(file, 'utf8');
			return (
				source.includes(`from '${forbidden}`) ||
				source.includes(`from '../${forbidden}`) ||
				source.includes(`import('${forbidden}`)
			);
		})
		.map((file) => path.relative(repositoryRoot, file));
}

describe('demo mode isolation', () => {
	it('never lets the shipped app import demo mode', () => {
		expect(filesImporting('src', 'demo/')).toEqual([]);
		expect(filesImporting('src', '../demo')).toEqual([]);
	});

	it('never lets demo mode import the playground sandbox', () => {
		expect(filesImporting('demo', 'playground/')).toEqual([]);
		expect(filesImporting('demo', '../playground')).toEqual([]);
	});

	it('never lets the playground sandbox import demo mode', () => {
		expect(filesImporting('playground', 'demo/')).toEqual([]);
		expect(filesImporting('playground', '../demo')).toEqual([]);
	});
});
