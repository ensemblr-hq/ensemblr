import { describe, expect, test } from 'vitest';

import type {
	ArchitectureComponent,
	ArchitectureIR,
} from '../../src/shared/architecture-diagram';
import { coverChangedPaths } from '../../src/shared/architecture-diagram';

function component(
	id: string,
	label: string,
	sources: readonly string[],
): ArchitectureComponent {
	return {
		id,
		label,
		sources: sources.map((path) => ({ path })),
		type: 'backend',
	};
}

function ir(components: readonly ArchitectureComponent[]): ArchitectureIR {
	return {
		boundaries: [],
		components: [...components],
		connections: [],
		meta: { title: 'repo' },
		schemaVersion: 1,
	};
}

const DIAGRAM = ir([
	component('storage', 'storage', ['src/main/storage']),
	component('renderer', 'renderer', ['src/renderer']),
	component('contracts', 'contracts', ['src/shared/ipc/channels.ts']),
]);

describe('coverChangedPaths', () => {
	test('reports nothing for an empty change set', () => {
		expect(coverChangedPaths(DIAGRAM, [])).toEqual({ labels: [], paths: [] });
	});

	test('claims a file inside a directory a component names', () => {
		const coverage = coverChangedPaths(DIAGRAM, ['src/main/storage/tx.ts']);

		expect(coverage.labels).toEqual(['storage']);
		expect(coverage.paths).toEqual(['src/main/storage/tx.ts']);
	});

	test('claims the directory itself', () => {
		expect(coverChangedPaths(DIAGRAM, ['src/main/storage']).labels).toEqual([
			'storage',
		]);
	});

	test('claims an exact file source', () => {
		expect(
			coverChangedPaths(DIAGRAM, ['src/shared/ipc/channels.ts']).labels,
		).toEqual(['contracts']);
	});

	// A prefix match would hand `src/main/storage` every path under a sibling
	// whose name merely starts with it, which is the whole drawing lighting up on
	// an unrelated edit.
	test('does not claim a sibling whose name only starts the same', () => {
		expect(
			coverChangedPaths(DIAGRAM, ['src/main/storage-legacy/tx.ts']).labels,
		).toEqual([]);
	});

	test('ignores a change outside every component', () => {
		expect(coverChangedPaths(DIAGRAM, ['docs/adr/0001.md']).labels).toEqual([]);
	});

	test('reports every component a change set lands in, in document order', () => {
		const coverage = coverChangedPaths(DIAGRAM, [
			'src/renderer/app.tsx',
			'src/main/storage/tx.ts',
		]);

		expect(coverage.labels).toEqual(['storage', 'renderer']);
	});

	test('reports a path claimed by two components only once', () => {
		const overlapping = ir([
			component('src', 'src', ['src']),
			component('storage', 'storage', ['src/main/storage']),
		]);

		expect(coverChangedPaths(overlapping, ['src/main/storage/tx.ts'])).toEqual({
			labels: ['src', 'storage'],
			paths: ['src/main/storage/tx.ts'],
		});
	});

	test('compares a source written with a leading or trailing separator', () => {
		const awkward = ir([component('storage', 'storage', ['./src/main/'])]);

		expect(coverChangedPaths(awkward, ['src/main/tx.ts']).labels).toEqual([
			'storage',
		]);
	});

	test('ignores a component with no sources at all', () => {
		const unsourced = ir([
			{ id: 'floating', label: 'floating', type: 'external' },
		]);

		expect(coverChangedPaths(unsourced, ['src/main/tx.ts']).labels).toEqual([]);
	});
});
