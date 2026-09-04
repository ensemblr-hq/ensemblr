import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { irFromModuleGraph } from '../../src/main/architecture/ir-from-graph.ts';
import {
	extractSpecifiers,
	moduleIdForFile,
	scanModuleGraph,
} from '../../src/main/architecture/module-graph.ts';
import { parseArchitectureIr } from '../../src/shared/architecture-diagram.ts';

const roots: string[] = [];

/**
 * Materializes a throwaway repository from a path → contents map.
 * @param files - Workspace-relative path to file contents
 * @returns The absolute root of the new tree
 */
function writeRepository(files: Record<string, string>): string {
	const root = mkdtempSync(path.join(tmpdir(), 'ensemblr-module-graph-'));
	roots.push(root);
	for (const [relative, contents] of Object.entries(files)) {
		const absolute = path.join(root, relative);
		mkdirSync(path.dirname(absolute), { recursive: true });
		writeFileSync(absolute, contents, 'utf8');
	}
	return root;
}

const BASE_REPOSITORY = {
	'src/main/ipc/handlers.ts':
		"import { readRow } from '../storage/rows.ts';\nexport const handle = () => readRow();\n",
	'src/main/storage/rows.ts': 'export const readRow = () => 1;\n',
	'src/renderer/components/panel.tsx':
		"import { helper } from '../lib/helper.ts';\nexport const Panel = () => helper();\n",
	'src/renderer/lib/helper.ts': 'export const helper = () => 2;\n',
	'tsconfig.json': '{ "compilerOptions": { "paths": { "@/*": ["./src/*"] } } }',
};

afterEach(() => {
	while (roots.length > 0) {
		rmSync(roots.pop() as string, { force: true, recursive: true });
	}
});

describe('moduleIdForFile', () => {
	it('collapses a file to the directory that stands for it', () => {
		expect(moduleIdForFile('src/main/storage/rows.ts')).toBe(
			'src/main/storage',
		);
	});

	it('caps aggregation depth so a deep tree does not explode into nodes', () => {
		expect(moduleIdForFile('src/main/storage/repositories/nested/row.ts')).toBe(
			'src/main/storage',
		);
	});

	it('names a root-level file after the root', () => {
		expect(moduleIdForFile('forge.config.ts')).toBe('.');
	});
});

describe('extractSpecifiers', () => {
	it('reads every form a specifier appears in', () => {
		const specifiers = extractSpecifiers(
			[
				"import a from './a.ts';",
				"export { b } from './b.ts';",
				"import './side-effect.ts';",
				"const c = await import('./c.ts');",
				"const d = require('./d.ts');",
			].join('\n'),
		);
		expect(specifiers).toEqual(
			expect.arrayContaining([
				'./a.ts',
				'./b.ts',
				'./side-effect.ts',
				'./c.ts',
				'./d.ts',
			]),
		);
	});
});

describe('scanModuleGraph', () => {
	it('aggregates to directory-level nodes and edges', async () => {
		const graph = await scanModuleGraph(writeRepository(BASE_REPOSITORY));
		expect(graph.nodes.map((node) => node.id)).toEqual([
			'src/main/ipc',
			'src/main/storage',
			'src/renderer/components',
			'src/renderer/lib',
		]);
		expect(graph.edges.map((edge) => `${edge.from}>${edge.to}`).sort()).toEqual(
			[
				'src/main/ipc>src/main/storage',
				'src/renderer/components>src/renderer/lib',
			],
		);
	});

	it('resolves a tsconfig path alias to the directory it points at', async () => {
		const graph = await scanModuleGraph(
			writeRepository({
				...BASE_REPOSITORY,
				'src/renderer/lib/helper.ts':
					"import { readRow } from '@/main/storage/rows.ts';\nexport const helper = () => readRow();\n",
			}),
		);
		expect(graph.edges.map((edge) => `${edge.from}>${edge.to}`)).toContain(
			'src/renderer/lib>src/main/storage',
		);
	});

	it('never descends into node_modules or a dot-directory', async () => {
		const graph = await scanModuleGraph(
			writeRepository({
				...BASE_REPOSITORY,
				'.vite/build/bundle.js': "import './chunk.js';\n",
				'node_modules/left-pad/index.js': 'module.exports = 1;\n',
			}),
		);
		expect(
			graph.nodes
				.map((node) => node.id)
				.some((id) => id.includes('node_modules')),
		).toBe(false);
		expect(
			graph.nodes.map((node) => node.id).some((id) => id.startsWith('.vite')),
		).toBe(false);
	});
});

describe('scanModuleGraph: the fingerprint gate', () => {
	it('is stable across a body-only edit', async () => {
		const before = await scanModuleGraph(writeRepository(BASE_REPOSITORY));
		const after = await scanModuleGraph(
			writeRepository({
				...BASE_REPOSITORY,
				'src/main/storage/rows.ts':
					'export const readRow = () => {\n\treturn 1 + 1;\n};\n',
			}),
		);
		expect(after.fingerprint).toBe(before.fingerprint);
	});

	it('is stable when a file moves within the directory that stands for it', async () => {
		const before = await scanModuleGraph(writeRepository(BASE_REPOSITORY));
		const after = await scanModuleGraph(
			writeRepository({
				...BASE_REPOSITORY,
				'src/main/storage/repositories/rows.ts':
					'export const readRow = () => 1;\n',
			}),
		);
		expect(after.fingerprint).toBe(before.fingerprint);
	});

	it('moves when a new cross-module import appears', async () => {
		const before = await scanModuleGraph(writeRepository(BASE_REPOSITORY));
		const after = await scanModuleGraph(
			writeRepository({
				...BASE_REPOSITORY,
				'src/renderer/lib/helper.ts':
					"import { readRow } from '@/main/storage/rows.ts';\nexport const helper = () => readRow();\n",
			}),
		);
		expect(after.fingerprint).not.toBe(before.fingerprint);
	});

	it('moves when a new module directory appears', async () => {
		const before = await scanModuleGraph(writeRepository(BASE_REPOSITORY));
		const after = await scanModuleGraph(
			writeRepository({
				...BASE_REPOSITORY,
				'src/shared/contracts/ipc.ts': 'export const channel = "x";\n',
			}),
		);
		expect(after.fingerprint).not.toBe(before.fingerprint);
	});
});

describe('irFromModuleGraph', () => {
	it('seeds a document the IR schema accepts', async () => {
		const root = writeRepository(BASE_REPOSITORY);
		const ir = irFromModuleGraph(await scanModuleGraph(root), root);
		expect(parseArchitectureIr(ir)).not.toBeNull();
	});

	it('names no placement and gives every connection an id', async () => {
		const root = writeRepository(BASE_REPOSITORY);
		const ir = irFromModuleGraph(await scanModuleGraph(root), root);
		expect(ir.layout).toEqual({ mode: 'organic' });
		for (const component of ir.components) {
			expect(component.row).toBeUndefined();
			expect(component.col).toBeUndefined();
			expect(component.pos).toBeUndefined();
		}
		for (const connection of ir.connections ?? []) {
			expect(connection.id.length).toBeGreaterThan(0);
		}
	});

	it('nests a region inside the directory that encloses it', async () => {
		const root = writeRepository(BASE_REPOSITORY);
		const ir = irFromModuleGraph(await scanModuleGraph(root), root);
		const byLabel = new Map(
			(ir.boundaries ?? []).map((boundary) => [
				boundary.label,
				new Set(boundary.wraps),
			]),
		);
		const outer = byLabel.get('src');
		const inner = byLabel.get('src/main');
		expect(outer).toBeDefined();
		expect(inner).toBeDefined();
		for (const member of inner as ReadonlySet<string>) {
			expect((outer as ReadonlySet<string>).has(member)).toBe(true);
		}
		expect((outer as ReadonlySet<string>).size).toBeGreaterThan(
			(inner as ReadonlySet<string>).size,
		);
	});

	it('draws no region around a directory holding a single node', async () => {
		const root = writeRepository(BASE_REPOSITORY);
		const ir = irFromModuleGraph(await scanModuleGraph(root), root);
		for (const boundary of ir.boundaries ?? []) {
			expect(boundary.wraps.length).toBeGreaterThan(1);
		}
	});

	it('lets the renderer resolve every boundary member', async () => {
		const root = writeRepository({
			...BASE_REPOSITORY,
			'tests/renderer/a.test.ts':
				"import '../../src/renderer/lib/helper.ts';\n",
			'tests/shared/b.test.ts': "import '../../src/main/storage/rows.ts';\n",
		});
		const ir = irFromModuleGraph(await scanModuleGraph(root), root);
		const ids = new Set(ir.components.map((component) => component.id));
		for (const boundary of ir.boundaries ?? []) {
			for (const wrapped of boundary.wraps) {
				expect(ids.has(wrapped), `${boundary.label} wraps ${wrapped}`).toBe(
					true,
				);
			}
		}
	});

	it('infers a component type from the vocabulary in its path', async () => {
		const root = writeRepository(BASE_REPOSITORY);
		const ir = irFromModuleGraph(await scanModuleGraph(root), root);
		const byId = new Map(ir.components.map((c) => [c.id, c]));
		expect(byId.get('src-main-storage')?.type).toBe('database');
		expect(byId.get('src-renderer-components')?.type).toBe('frontend');
		expect(byId.get('src-main-ipc')?.type).toBe('messagebus');
	});
});
