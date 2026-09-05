import { describe, expect, it } from 'vitest';

import {
	ARCHITECTURE_DIAGRAM_LIMITS,
	ARCHITECTURE_LAYOUT_MAX_COLS,
	ARCHITECTURE_LAYOUT_MAX_ROWS,
	parseArchitectureIr,
	parseArchitectureIrResult,
} from '../../src/shared/architecture-diagram';

const minimal = () => ({
	components: [{ id: 'alpha', label: 'Alpha', type: 'backend' }],
	meta: { title: 'fixture' },
	schemaVersion: 1,
});

const pair = () => ({
	...minimal(),
	components: [
		{ id: 'alpha', label: 'Alpha', type: 'backend' },
		{ id: 'beta', label: 'Beta', type: 'backend' },
	],
});

const withSourcePath = (path: string) => ({
	...minimal(),
	components: [
		{ id: 'alpha', label: 'Alpha', sources: [{ path }], type: 'backend' },
	],
});

const problemsFor = (document: unknown): string[] => {
	const result = parseArchitectureIrResult(document);
	if (result.ok) {
		throw new Error('Expected the document to be rejected.');
	}
	return result.problems;
};

describe('parseArchitectureIr', () => {
	it('rejects a document with no title', () => {
		expect(parseArchitectureIr({ ...minimal(), meta: {} })).toBeNull();
	});

	it('rejects a component whose id is not identifier-like', () => {
		expect(
			parseArchitectureIr({
				...minimal(),
				components: [{ id: '9-lives', label: 'Alpha', type: 'backend' }],
			}),
		).toBeNull();
	});

	it('rejects a component type outside the legend', () => {
		expect(
			parseArchitectureIr({
				...minimal(),
				components: [{ id: 'alpha', label: 'Alpha', type: 'quantum' }],
			}),
		).toBeNull();
	});

	it('accepts an archify document and drops the fields this app has no use for', () => {
		const parsed = parseArchitectureIr({
			...minimal(),
			meta: {
				quality_profile: 'showcase',
				title: 'fixture',
				views: [{ id: 'a', label: 'A' }],
			},
			components: [
				{ brand: 'aws', id: 'alpha', label: 'Alpha', type: 'backend' },
			],
		});
		expect(parsed?.meta).toEqual({ title: 'fixture' });
		expect(parsed?.components[0]).toEqual({
			id: 'alpha',
			label: 'Alpha',
			type: 'backend',
		});
	});

	it('reads archify’s snake_case schema_version and source end_line', () => {
		const parsed = parseArchitectureIr({
			components: [
				{
					id: 'alpha',
					label: 'Alpha',
					sources: [{ end_line: 40, line: 10, path: 'src/alpha.ts' }],
					type: 'backend',
				},
			],
			meta: { title: 'fixture' },
			schema_version: 1,
		});
		expect(parsed?.schemaVersion).toBe(1);
		expect(parsed?.components[0]?.sources?.[0]).toEqual({
			endLine: 40,
			line: 10,
			path: 'src/alpha.ts',
		});
	});

	it('derives an id for a connection that carries none, stably from its endpoints', () => {
		const document = {
			...minimal(),
			components: [
				{ id: 'alpha', label: 'Alpha', type: 'backend' },
				{ id: 'beta', label: 'Beta', type: 'backend' },
			],
			connections: [{ from: 'alpha', to: 'beta' }],
		};
		expect(parseArchitectureIr(document)?.connections?.[0]?.id).toBe(
			'alpha-to-beta',
		);
		expect(
			parseArchitectureIr({
				...document,
				connections: [
					{ from: 'alpha', to: 'beta' },
					{ from: 'alpha', to: 'beta' },
				],
			})?.connections?.map((connection) => connection.id),
		).toEqual(['alpha-to-beta', 'alpha-to-beta-2']);
	});

	it('keeps an authored connection id rather than deriving over it', () => {
		expect(
			parseArchitectureIr({
				...pair(),
				connections: [{ from: 'alpha', id: 'authored', to: 'beta' }],
			})?.connections?.[0]?.id,
		).toBe('authored');
	});
});

describe('source paths', () => {
	it.each([
		['an absolute POSIX path', '/etc/passwd'],
		['a UNC path', '\\\\server\\share\\secrets'],
		['a Windows drive letter', 'C:\\Users\\me\\.gitconfig'],
		['a home-relative path', '~/.config/gh/hosts.yml'],
		['a bare parent prefix', '../../etc/passwd'],
		['a parent segment mid-path', 'a/../../etc/passwd'],
		['a parent segment behind a backslash', 'a\\..\\..\\etc'],
		['a home-relative path behind whitespace', '  ~/.config/gh/hosts.yml'],
	])('rejects %s', (_name, path) => {
		expect(problemsFor(withSourcePath(path))).toContainEqual(
			expect.stringContaining('components.0.sources.0.path'),
		);
	});

	it('accepts an ordinary workspace-relative path', () => {
		expect(
			parseArchitectureIr(withSourcePath('src/main/architecture/index.ts'))
				?.components[0]?.sources?.[0]?.path,
		).toBe('src/main/architecture/index.ts');
	});

	it('accepts a path whose own name merely starts with a dot', () => {
		expect(
			parseArchitectureIr(withSourcePath('.ensemblr/settings.toml')),
		).not.toBeNull();
	});
});

describe('grid placement bounds', () => {
	const placed = (cell: { col?: number; row?: number }) => ({
		...minimal(),
		components: [{ id: 'alpha', label: 'Alpha', type: 'backend', ...cell }],
	});

	it('rejects a col past the widest grid a document may declare', () => {
		expect(
			problemsFor(placed({ col: ARCHITECTURE_LAYOUT_MAX_COLS, row: 0 })),
		).toContainEqual(expect.stringContaining('components.0.col'));
	});

	it('rejects a row past the tallest grid a document may declare', () => {
		expect(
			problemsFor(placed({ col: 0, row: ARCHITECTURE_LAYOUT_MAX_ROWS })),
		).toContainEqual(expect.stringContaining('components.0.row'));
	});

	it('rejects the row that aborted the renderer out of memory', () => {
		expect(problemsFor(placed({ col: 0, row: 2_147_483_648 }))).toContainEqual(
			expect.stringContaining('components.0.row'),
		);
	});

	it('accepts the last cell of the largest grid', () => {
		const parsed = parseArchitectureIr(
			placed({
				col: ARCHITECTURE_LAYOUT_MAX_COLS - 1,
				row: ARCHITECTURE_LAYOUT_MAX_ROWS - 1,
			}),
		);
		expect(parsed?.components[0]).toMatchObject({
			col: ARCHITECTURE_LAYOUT_MAX_COLS - 1,
			row: ARCHITECTURE_LAYOUT_MAX_ROWS - 1,
		});
	});
});

// The control op enforces the same numbers, but `.ensemblr/architecture.json`
// is tracked, so a document also reaches the compiler straight off disk. The
// compiler routes every edge against every box, so an uncapped document is the
// renderer frozen for minutes rather than a diagram nobody can read.
describe('document size bounds', () => {
	const componentsNumbering = (count: number) =>
		Array.from({ length: count }, (_, index) => ({
			id: `c${index}`,
			label: `Node ${index}`,
			type: 'backend' as const,
		}));

	it('rejects more components than the compiler can route in a frame', () => {
		expect(
			problemsFor({
				...minimal(),
				components: componentsNumbering(
					ARCHITECTURE_DIAGRAM_LIMITS.maxComponents + 1,
				),
			}),
		).toContainEqual(expect.stringContaining('components'));
	});

	it('rejects more connections than the compiler can route in a frame', () => {
		expect(
			problemsFor({
				...minimal(),
				components: componentsNumbering(2),
				connections: Array.from(
					{ length: ARCHITECTURE_DIAGRAM_LIMITS.maxConnections + 1 },
					(_, index) => ({ from: 'c0', id: `e${index}`, to: 'c1' }),
				),
			}),
		).toContainEqual(expect.stringContaining('connections'));
	});

	it('rejects more boundaries than the document may frame', () => {
		expect(
			problemsFor({
				...minimal(),
				boundaries: Array.from(
					{ length: ARCHITECTURE_DIAGRAM_LIMITS.maxBoundaries + 1 },
					(_, index) => ({
						kind: 'region' as const,
						label: `r${index}`,
						wraps: ['alpha'],
					}),
				),
			}),
		).toContainEqual(expect.stringContaining('boundaries'));
	});

	it('accepts a document sitting exactly on every bound', () => {
		const parsed = parseArchitectureIr({
			...minimal(),
			components: componentsNumbering(
				ARCHITECTURE_DIAGRAM_LIMITS.maxComponents,
			),
			connections: Array.from(
				{ length: ARCHITECTURE_DIAGRAM_LIMITS.maxConnections },
				(_, index) => ({ from: 'c0', id: `e${index}`, to: 'c1' }),
			),
		});
		expect(parsed?.components).toHaveLength(
			ARCHITECTURE_DIAGRAM_LIMITS.maxComponents,
		);
	});
});

describe('text and list bounds', () => {
	it('rejects a component label long enough to bloat the tracked file', () => {
		expect(
			problemsFor({
				...minimal(),
				components: [
					{ id: 'alpha', label: 'A'.repeat(50_000), type: 'backend' },
				],
			}),
		).toContainEqual(expect.stringContaining('components.0.label'));
	});

	it('rejects an over-long connection label', () => {
		expect(
			problemsFor({
				...pair(),
				connections: [{ from: 'alpha', label: 'A'.repeat(50_000), to: 'beta' }],
			}),
		).toContainEqual(expect.stringContaining('connections.0.label'));
	});

	it('rejects an over-long via list', () => {
		expect(
			problemsFor({
				...pair(),
				connections: [
					{
						from: 'alpha',
						to: 'beta',
						via: Array.from({ length: 1_000 }, (_, index) => [index, index]),
					},
				],
			}),
		).toContainEqual(expect.stringContaining('connections.0.via'));
	});

	it('rejects more cards than a panel can show', () => {
		expect(
			problemsFor({
				...minimal(),
				cards: Array.from({ length: 500 }, (_, index) => ({
					dot: 'cyan',
					items: [],
					title: `Card ${index}`,
				})),
			}),
		).toContainEqual(expect.stringContaining('cards'));
	});

	it('rejects an over-long card item list', () => {
		expect(
			problemsFor({
				...minimal(),
				cards: [
					{
						dot: 'cyan',
						items: Array.from({ length: 500 }, (_, index) => `${index}`),
						title: 'Notes',
					},
				],
			}),
		).toContainEqual(expect.stringContaining('cards.0.items'));
	});
});

describe('identity and referential integrity', () => {
	it('rejects two components sharing an id, naming the later one', () => {
		expect(
			problemsFor({
				...minimal(),
				components: [
					{ id: 'api', label: 'Api', type: 'backend' },
					{ id: 'api', label: 'Api again', type: 'frontend' },
				],
			}),
		).toContainEqual(expect.stringContaining('components.1.id'));
	});

	it('rejects two explicit connection ids that collide', () => {
		expect(
			problemsFor({
				...pair(),
				connections: [
					{ from: 'alpha', id: 'edge', to: 'beta' },
					{ from: 'beta', id: 'edge', to: 'alpha' },
				],
			}),
		).toContainEqual(expect.stringContaining('connections.1.id'));
	});

	it('rejects two boundaries sharing a kind and label', () => {
		expect(
			problemsFor({
				...pair(),
				boundaries: [
					{ kind: 'region', label: 'src', wraps: ['alpha'] },
					{ kind: 'region', label: 'src', wraps: ['beta'] },
				],
			}),
		).toContainEqual(expect.stringContaining('boundaries.1.label'));
	});

	it('accepts two boundaries whose labels match under different kinds', () => {
		expect(
			parseArchitectureIr({
				...pair(),
				boundaries: [
					{ kind: 'region', label: 'security', wraps: ['alpha'] },
					{ kind: 'security-group', label: 'security', wraps: ['beta'] },
				],
			}),
		).not.toBeNull();
	});

	it('rejects a connection endpoint no component declares', () => {
		expect(
			problemsFor({
				...pair(),
				connections: [{ from: 'alpha', to: 'apiSevrice' }],
			}),
		).toContainEqual(expect.stringContaining('connections.0.to'));
	});

	it('rejects a boundary wrapping a component no one declares', () => {
		expect(
			problemsFor({
				...pair(),
				boundaries: [
					{ kind: 'region', label: 'src', wraps: ['alpha', 'ghost'] },
				],
			}),
		).toContainEqual(expect.stringContaining('boundaries.0.wraps.1'));
	});
});

describe('parseArchitectureIrResult', () => {
	it('names the document itself when the failure has no field path', () => {
		const result = parseArchitectureIrResult(null);
		expect(result.ok).toBe(false);
		expect(result.ok ? [] : result.problems).toContainEqual(
			expect.stringContaining('the document'),
		);
	});

	it('says how many further fields it did not name', () => {
		const result = parseArchitectureIrResult({
			...minimal(),
			components: Array.from({ length: 9 }, (_, index) => ({
				id: `n${index}`,
				label: 'Node',
				type: 'quantum',
			})),
		});
		if (result.ok) {
			throw new Error('Expected the document to be rejected.');
		}
		expect(result.problemCount).toBe(9);
		expect(result.problems).toHaveLength(7);
		expect(result.problems.at(-1)).toContain('3 further field(s)');
	});
});
