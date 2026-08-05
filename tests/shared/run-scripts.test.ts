import { describe, expect, test } from 'vitest';

import {
	DEFAULT_RUN_SCRIPT_ICON,
	formatRunScriptLabel,
	isRunScriptIconName,
	normalizeRunScripts,
	normalizeRunScriptTable,
	type RunScriptDefinition,
	type RunScriptIssue,
	resolveRunScript,
	selectAvailableRunScripts,
	selectDefaultRunScript,
} from '../../src/shared/scripts/run-scripts';

function definition(
	overrides: Partial<RunScriptDefinition> & { name: string },
): RunScriptDefinition {
	return {
		availableIn: null,
		command: `npm run ${overrides.name}`,
		icon: DEFAULT_RUN_SCRIPT_ICON,
		isDefault: false,
		...overrides,
	};
}

describe('normalizeRunScripts', () => {
	test('normalizes a well-formed list', () => {
		expect(
			normalizeRunScripts([
				{
					available_in: ['local'],
					command: 'PORT=$ENSEMBLR_PORT npm run dev',
					default: true,
					icon: 'calculator',
					name: 'dev',
				},
			]),
		).toEqual([
			{
				availableIn: ['local'],
				command: 'PORT=$ENSEMBLR_PORT npm run dev',
				icon: 'calculator',
				isDefault: true,
				name: 'dev',
			},
		]);
	});

	test('accepts the camelCase shape persisted to SQLite', () => {
		expect(
			normalizeRunScripts([
				{
					availableIn: null,
					command: 'npm test',
					icon: 'test-tube',
					isDefault: false,
					name: 'test',
				},
			]),
		).toEqual([
			definition({ command: 'npm test', icon: 'test-tube', name: 'test' }),
		]);
	});

	test('returns an empty list for non-array input', () => {
		expect(normalizeRunScripts(null)).toEqual([]);
		expect(normalizeRunScripts('npm run dev')).toEqual([]);
		expect(normalizeRunScripts({ dev: 'npm run dev' })).toEqual([]);
	});

	test('drops entries without a usable name or command', () => {
		expect(
			normalizeRunScripts([
				{ command: 'npm run dev' },
				{ name: 'dev' },
				{ command: '   ', name: 'blank' },
				{ command: 'npm run dev', name: '   ' },
				{ command: 42, name: 'typed' },
				'dev',
			]),
		).toEqual([]);
	});

	test('trims names and commands', () => {
		expect(
			normalizeRunScripts([{ command: '  npm run dev  ', name: ' dev ' }]),
		).toEqual([definition({ command: 'npm run dev', name: 'dev' })]);
	});

	test('falls back to the default icon for unknown or mistyped icons', () => {
		expect(
			normalizeRunScripts([
				{ command: 'npm run dev', icon: 'not-a-real-icon', name: 'dev' },
				{ command: 'npm test', icon: 7, name: 'test' },
			]).map((script) => script.icon),
		).toEqual([DEFAULT_RUN_SCRIPT_ICON, DEFAULT_RUN_SCRIPT_ICON]);
	});

	test('treats a non-boolean default as false', () => {
		expect(
			normalizeRunScripts([
				{ command: 'npm run dev', default: 'yes', name: 'dev' },
			])[0]?.isDefault,
		).toBe(false);
	});

	test('keeps only the first entry flagged as default', () => {
		expect(
			normalizeRunScripts([
				{ command: 'npm run dev', default: true, name: 'dev' },
				{ command: 'npm test', default: true, name: 'test' },
			]).map((script) => script.isDefault),
		).toEqual([true, false]);
	});

	test('keeps the first entry when names collide', () => {
		expect(
			normalizeRunScripts([
				{ command: 'npm run dev', name: 'dev' },
				{ command: 'npm run other', name: 'dev' },
			]),
		).toEqual([definition({ command: 'npm run dev', name: 'dev' })]);
	});

	test('drops a mistyped available_in rather than the whole entry', () => {
		expect(
			normalizeRunScripts([
				{ available_in: 'local', command: 'npm run dev', name: 'dev' },
				{ available_in: [1, 2], command: 'npm test', name: 'test' },
			]).map((script) => script.availableIn),
		).toEqual([null, null]);
	});
});

describe('normalizeRunScriptTable', () => {
	test('uses each table key as the script name', () => {
		expect(
			normalizeRunScriptTable({
				checks: { command: 'npm run check', icon: 'list-checks' },
				dev: { command: 'npm run dev', default: true },
			}),
		).toEqual([
			definition({
				command: 'npm run check',
				icon: 'list-checks',
				name: 'checks',
			}),
			definition({ command: 'npm run dev', isDefault: true, name: 'dev' }),
		]);
	});

	test('returns an empty list for a non-table value', () => {
		expect(normalizeRunScriptTable(null)).toEqual([]);
		expect(normalizeRunScriptTable([{ command: 'npm run dev' }])).toEqual([]);
	});

	test('reports a rejected field per entry without dropping the entry', () => {
		const issues: RunScriptIssue[] = [];
		const scripts = normalizeRunScriptTable(
			{
				dev: {
					available_in: 'local',
					command: 'npm run dev',
					default: 'yes',
					icon: 'not-a-real-icon',
					mystery: 1,
				},
			},
			issues,
		);

		expect(scripts).toEqual([
			definition({ command: 'npm run dev', name: 'dev' }),
		]);
		expect(issues).toEqual([
			{
				expected: 'one of the supported icon names',
				field: 'icon',
				kind: 'invalid',
				script: 'dev',
			},
			{ expected: 'boolean', field: 'default', kind: 'invalid', script: 'dev' },
			{
				expected: 'array of strings',
				field: 'available_in',
				kind: 'invalid',
				script: 'dev',
			},
			{ field: 'mystery', kind: 'unsupported', script: 'dev' },
		]);
	});

	test('reports an entry that is not a table', () => {
		const issues: RunScriptIssue[] = [];

		expect(normalizeRunScriptTable({ dev: 'npm run dev' }, issues)).toEqual([]);
		expect(issues).toEqual([
			{ expected: 'a table', field: null, kind: 'invalid', script: 'dev' },
		]);
	});

	test('reports a blank table key instead of yielding a nameless script', () => {
		const issues: RunScriptIssue[] = [];

		expect(
			normalizeRunScriptTable({ '  ': { command: 'npm run dev' } }, issues),
		).toEqual([]);
		expect(issues).toEqual([
			{
				expected: 'a non-empty script name',
				field: null,
				kind: 'invalid',
				script: '  ',
			},
		]);
	});

	test('reports the second script flagged as default and demotes it', () => {
		const issues: RunScriptIssue[] = [];
		const scripts = normalizeRunScriptTable(
			{
				dev: { command: 'npm run dev', default: true },
				test: { command: 'npm test', default: true },
			},
			issues,
		);

		expect(scripts.map((script) => script.isDefault)).toEqual([true, false]);
		expect(issues).toEqual([
			{
				expected: 'the only run script flagged as default',
				field: 'default',
				kind: 'invalid',
				script: 'test',
			},
		]);
	});
});

describe('selectAvailableRunScripts', () => {
	test('keeps entries that declare no environments', () => {
		const scripts = [definition({ name: 'dev' })];

		expect(selectAvailableRunScripts(scripts)).toEqual(scripts);
	});

	test('keeps entries that list the local environment', () => {
		const scripts = [
			definition({ availableIn: ['local', 'cloud'], name: 'dev' }),
		];

		expect(selectAvailableRunScripts(scripts)).toEqual(scripts);
	});

	test('drops entries restricted to environments Ensemblr does not run', () => {
		expect(
			selectAvailableRunScripts([
				definition({ availableIn: ['cloud'], name: 'remote' }),
				definition({ availableIn: [], name: 'nowhere' }),
			]),
		).toEqual([]);
	});
});

describe('selectDefaultRunScript', () => {
	test('returns null for an empty list', () => {
		expect(selectDefaultRunScript([])).toBeNull();
	});

	test('prefers the entry flagged as default', () => {
		const flagged = definition({ isDefault: true, name: 'test' });

		expect(selectDefaultRunScript([definition({ name: 'dev' }), flagged])).toBe(
			flagged,
		);
	});

	test('falls back to the first entry when none is flagged', () => {
		const first = definition({ name: 'dev' });

		expect(selectDefaultRunScript([first, definition({ name: 'test' })])).toBe(
			first,
		);
	});
});

describe('resolveRunScript', () => {
	const scripts = [
		definition({ name: 'dev' }),
		definition({ isDefault: true, name: 'test' }),
	];

	test('returns the named entry', () => {
		expect(resolveRunScript(scripts, 'dev')?.name).toBe('dev');
	});

	test('returns the default entry when no name is requested', () => {
		expect(resolveRunScript(scripts)?.name).toBe('test');
		expect(resolveRunScript(scripts, null)?.name).toBe('test');
	});

	test('returns null when an explicitly requested name is not configured', () => {
		expect(resolveRunScript(scripts, 'missing')).toBeNull();
	});
});

describe('icon and label helpers', () => {
	test('recognises curated icon names only', () => {
		expect(isRunScriptIconName('play')).toBe(true);
		expect(isRunScriptIconName('rocket-ship-9000')).toBe(false);
		expect(isRunScriptIconName(null)).toBe(false);
	});

	test('formats a script name for display', () => {
		expect(formatRunScriptLabel('calculator')).toBe('Calculator');
		expect(formatRunScriptLabel('dev-server')).toBe('Dev server');
		expect(formatRunScriptLabel('e2e_tests')).toBe('E2e tests');
	});
});
