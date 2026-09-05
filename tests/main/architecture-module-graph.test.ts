import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { irFromModuleGraph } from '../../src/main/architecture/ir-from-graph.ts';
import {
	extractSpecifiers,
	moduleIdForFile,
	SCAN_LIMITS,
	scanModuleGraph,
} from '../../src/main/architecture/module-graph.ts';
import {
	type ArchitectureIR,
	parseArchitectureIrResult,
} from '../../src/shared/architecture-diagram.ts';

const roots: string[] = [];

/**
 * Seeds an IR from a throwaway tree, the way the service does.
 * @param root - Absolute root of the tree
 * @param repositoryName - Repository the workspace was cut from, when named
 * @returns The seeded IR
 */
async function seedIr(
	root: string,
	repositoryName?: string,
): Promise<ArchitectureIR> {
	return irFromModuleGraph(await scanModuleGraph(root), {
		repositoryName,
		workspaceCwd: root,
	});
}

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
		const ir = await seedIr(writeRepository(BASE_REPOSITORY));
		expect(parseArchitectureIrResult(ir)).toEqual({ ir, ok: true });
	});

	it('names no placement and gives every connection an id', async () => {
		const ir = await seedIr(writeRepository(BASE_REPOSITORY));
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
		const ir = await seedIr(writeRepository(BASE_REPOSITORY));
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
		const ir = await seedIr(writeRepository(BASE_REPOSITORY));
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
		const ir = await seedIr(root);
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
		const ir = await seedIr(writeRepository(BASE_REPOSITORY));
		const byId = new Map(ir.components.map((c) => [c.id, c]));
		expect(byId.get('src-main-storage')?.type).toBe('database');
		expect(byId.get('src-renderer-components')?.type).toBe('frontend');
		expect(byId.get('src-main-ipc')?.type).toBe('messagebus');
	});
});

describe('extractSpecifiers: the static import clause', () => {
	it('reads a multi-line braced import', () => {
		expect(
			extractSpecifiers("import {\n\ta,\n\tb,\n} from './wide.ts';\n"),
		).toContain('./wide.ts');
	});

	it('reads a type-only import and a type-only re-export', () => {
		const specifiers = extractSpecifiers(
			[
				"import type { A } from './a.ts';",
				"export type { B } from './b.ts';",
				"import { type C, d } from './cd.ts';",
			].join('\n'),
		);
		expect(specifiers).toEqual(
			expect.arrayContaining(['./a.ts', './b.ts', './cd.ts']),
		);
	});

	it('reads a namespace import and a namespace re-export', () => {
		const specifiers = extractSpecifiers(
			["import * as ns from './ns.ts';", "export * from './all.ts';"].join(
				'\n',
			),
		);
		expect(specifiers).toEqual(expect.arrayContaining(['./ns.ts', './all.ts']));
	});

	// The clause used to be `[\s\S]*?`, which let one `export` reach across
	// every statement between it and the next quoted `from` anywhere in the
	// file — quadratic on a file with many of them, and wrong here.
	it('cannot reach a `from` in a later, unrelated statement', () => {
		expect(
			extractSpecifiers(
				[
					'export const first = 1',
					'export const second = 2',
					'const note = "this one was copied from \'./ghost.ts\'"',
				].join('\n'),
			),
		).not.toContain('./ghost.ts');
	});

	it('stops at the next import or export keyword', () => {
		expect(
			extractSpecifiers(
				['export { Alpha }', "export { Beta } from './beta.ts'"].join('\n'),
			),
		).toEqual(['./beta.ts']);
	});

	// Each of those 20,000 `export` tokens used to re-scan to end-of-file
	// looking for a `from`, and the last one in the file is inside a string
	// literal — so the old pattern both cost O(n²) and answered wrong.
	it('finds nothing in a file of `export` tokens that never say `from`', () => {
		expect(
			extractSpecifiers(
				`${'export { Aaaa }\n'.repeat(20_000)}const note = "copied from './ghost.ts'"`,
			),
		).toEqual([]);
	});
});

describe('scanModuleGraph: the limits', () => {
	it('reports the directories dropped past maxNodes', async () => {
		const overflowing = Object.fromEntries(
			Array.from({ length: SCAN_LIMITS.maxNodes + 6 }, (_, index) => [
				`pkg/mod${index}/index.ts`,
				'export const value = 1;\n',
			]),
		);
		const graph = await scanModuleGraph(writeRepository(overflowing));
		expect(graph.nodes.length).toBe(SCAN_LIMITS.maxNodes);
		expect(graph.omittedNodeCount).toBe(6);
	});

	it('counts a file past maxFileBytes but never reads its imports', async () => {
		const oversized = `${"import { x } from '../src/main/storage/rows.ts';\n"}${'// '.repeat(SCAN_LIMITS.maxFileBytes)}\n`;
		const graph = await scanModuleGraph(
			writeRepository({ ...BASE_REPOSITORY, 'lib/bundle.ts': oversized }),
		);
		expect(oversized.length).toBeGreaterThan(SCAN_LIMITS.maxFileBytes);
		expect(graph.nodes.find((node) => node.id === 'lib')?.fileCount).toBe(1);
		expect(graph.edges.map((edge) => edge.from)).not.toContain('lib');
	});

	it('scans an empty repository into an empty graph', async () => {
		const graph = await scanModuleGraph(writeRepository({}));
		expect(graph.nodes).toEqual([]);
		expect(graph.edges).toEqual([]);
		expect(graph.scannedFileCount).toBe(0);
		expect(graph.fingerprint.length).toBeGreaterThan(0);
	});

	it('resolves relative imports in a repository with no tsconfig.json', async () => {
		const graph = await scanModuleGraph(
			writeRepository({
				'src/main/ipc/handlers.ts':
					"import { readRow } from '../storage/rows.ts';\n",
				'src/main/storage/rows.ts': 'export const readRow = () => 1;\n',
			}),
		);
		expect(graph.edges.map((edge) => `${edge.from}>${edge.to}`)).toEqual([
			'src/main/ipc>src/main/storage',
		]);
	});
});

describe('scanModuleGraph: an alias that points out of the workspace', () => {
	it('drops it rather than naming a node above the root', async () => {
		const graph = await scanModuleGraph(
			writeRepository({
				'src/app/main.ts': "import { shared } from '@/thing.ts';\n",
				'tsconfig.json':
					'{ "compilerOptions": { "paths": { "@/*": ["../shared/*"] } } }',
			}),
		);
		expect(graph.nodes.map((node) => node.id)).toEqual(['src/app']);
		expect(graph.edges).toEqual([]);
	});
});

describe('irFromModuleGraph: component ids', () => {
	// `componentIdForModule` folds case and collapses every non-alphanumeric
	// run, so distinct directories can land on one id — and the compiler indexes
	// components into a Map where the last wins.
	const COLLIDING_REPOSITORY = {
		'packages/ui-kit/index.ts': "import '../ui/kit/index.ts';\n",
		'packages/ui/kit/index.ts': 'export const kit = 1;\n',
		'src/entry.ts': "import '../src/日本語/unicode.ts';\n",
		'src/日本語/unicode.ts': 'export const value = 2;\n',
	};

	it('gives two directories that fold to one slug distinct ids', async () => {
		const ir = await seedIr(writeRepository(COLLIDING_REPOSITORY));
		const ids = ir.components.map((component) => component.id);
		expect(new Set(ids).size).toBe(ids.length);
		expect(ids).toEqual(expect.arrayContaining(['packages-ui-kit', 'src']));
		expect(ids.filter((id) => id.startsWith('packages-ui-kit'))).toHaveLength(
			2,
		);
	});

	it('points every connection and every wraps entry at the assigned id', async () => {
		const ir = await seedIr(writeRepository(COLLIDING_REPOSITORY));
		const declared = new Set(ir.components.map((component) => component.id));
		for (const connection of ir.connections ?? []) {
			expect(declared.has(connection.from)).toBe(true);
			expect(declared.has(connection.to)).toBe(true);
		}
		for (const boundary of ir.boundaries ?? []) {
			for (const wrapped of boundary.wraps) {
				expect(declared.has(wrapped)).toBe(true);
			}
		}
		expect(parseArchitectureIrResult(ir).ok).toBe(true);
	});

	it('resolves a collision the same way on every scan', async () => {
		const first = await seedIr(writeRepository(COLLIDING_REPOSITORY));
		const second = await seedIr(writeRepository(COLLIDING_REPOSITORY));
		expect(second.components.map((component) => component.id)).toEqual(
			first.components.map((component) => component.id),
		);
	});
});

describe('irFromModuleGraph: the title', () => {
	it('names the repository rather than the worktree it was scanned in', async () => {
		const root = writeRepository(BASE_REPOSITORY);
		const ir = await seedIr(root, 'ensemblr');
		expect(ir.meta.title).toBe('ensemblr');
		expect(ir.meta.title).not.toBe(path.basename(root));
	});

	it('falls back to the directory when no repository is named', async () => {
		const root = writeRepository(BASE_REPOSITORY);
		expect((await seedIr(root)).meta.title).toBe(path.basename(root));
	});
});

describe('irFromModuleGraph: boundary labels', () => {
	it('keeps a role lens apart from a directory of the same name', async () => {
		const ir = await seedIr(
			writeRepository({
				'frontend/one/view.ts': "import '../../shared/util.ts';\n",
				'frontend/two/view.ts': "import '../../shared/util.ts';\n",
				'shared/util.ts': 'export const util = 1;\n',
				'ui/panel.ts': "import '../shared/util.ts';\n",
				'view/screen.ts': "import '../shared/util.ts';\n",
			}),
		);
		const byLabel = new Map(
			(ir.boundaries ?? []).map((boundary) => [boundary.label, boundary.wraps]),
		);
		expect(byLabel.get('frontend')).toEqual(['frontend-one', 'frontend-two']);
		expect(byLabel.get('@frontend')).toEqual([
			'frontend-one',
			'frontend-two',
			'ui',
			'view',
		]);
		const keys = (ir.boundaries ?? []).map(
			(boundary) => `${boundary.kind}:${boundary.label}`,
		);
		expect(new Set(keys).size).toBe(keys.length);
		expect(parseArchitectureIrResult(ir).ok).toBe(true);
	});
});
