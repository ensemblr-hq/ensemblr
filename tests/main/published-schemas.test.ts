import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { dump } from 'js-toml';
import { afterEach, describe, expect, test } from 'vitest';
import { z } from 'zod';

import {
	ALLOWED_TOP_LEVEL_KEYS,
	loadEnsemblrConfig,
} from '../../src/main/config/config-loader';
import { resolveSettings } from '../../src/main/config/config-resolution';
import {
	loadRepositoryConfig,
	REPOSITORY_CONFIG_KEYS,
} from '../../src/main/config/repository-config';
import { SUBAGENT_MECHANISMS } from '../../src/shared/agent-control/subagent-mechanism';
import { appSettingsPatchSchema } from '../../src/shared/config';
import {
	parseWorkspaceScriptSettings,
	RUN_SCRIPT_ICON_NAMES,
} from '../../src/shared/scripts';

// biome-ignore lint/suspicious/noExplicitAny: the test walks arbitrary JSON Schema shapes.
type JsonSchema = Record<string, any>;

const created: string[] = [];

function readSchema(name: string): JsonSchema {
	return JSON.parse(
		readFileSync(
			fileURLToPath(new URL(`../../schemas/${name}`, import.meta.url)),
			'utf8',
		),
	);
}

const configSchema = readSchema('config.schema.json');
const settingsSchema = readSchema('settings.schema.json');

function tmpDirectory(prefix: string): string {
	const directory = mkdtempSync(path.join(tmpdir(), prefix));
	created.push(directory);
	return directory;
}

function writeConfigJson(config: unknown): string {
	const configPath = path.join(tmpDirectory('ensemblr-schema-'), 'config.json');
	writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
	return configPath;
}

function writeRepositorySettings(settings: Record<string, unknown>): string {
	const repositoryPath = tmpDirectory('ensemblr-repo-');
	mkdirSync(path.join(repositoryPath, '.ensemblr'));
	writeFileSync(
		path.join(repositoryPath, '.ensemblr', 'settings.toml'),
		dump(settings),
		'utf8',
	);
	return repositoryPath;
}

function resolveRef(schema: JsonSchema, root: JsonSchema): JsonSchema {
	const ref = schema.$ref;
	if (typeof ref !== 'string') {
		return schema;
	}
	const name = ref.replace('#/$defs/', '');
	return { ...root.$defs[name], ...schema, $ref: undefined };
}

/** Dotted paths of every leaf a schema declares, recursing through objects and $refs. */
function schemaKeyPaths(
	schema: JsonSchema,
	root: JsonSchema,
	prefix = '',
): string[] {
	const resolved = resolveRef(schema, root);
	const properties = resolved.properties;
	if (!properties) {
		return prefix ? [prefix] : [];
	}
	return Object.entries(properties).flatMap(([key, value]) =>
		schemaKeyPaths(
			value as JsonSchema,
			root,
			prefix ? `${prefix}.${key}` : key,
		),
	);
}

/** Reads a dotted path off a fixture, so a schema key can be checked for coverage. */
function valueAtPath(record: unknown, dottedPath: string): unknown {
	return dottedPath.split('.').reduce<unknown>((value, key) => {
		return value && typeof value === 'object'
			? (value as Record<string, unknown>)[key]
			: undefined;
	}, record);
}

const appSchema = resolveRef(configSchema.properties.app, configSchema);
const zodAppSchema = z.toJSONSchema(appSettingsPatchSchema, {
	io: 'input',
}) as JsonSchema;

const emptyConfig = {
	app: {},
	environment: {},
	managed: {},
	repositoryDefaults: {},
	repositoryRules: [],
	schemaVersion: 1 as const,
	security: {},
	ui: {},
};

afterEach(() => {
	for (const directory of created.splice(0)) {
		rmSync(directory, { force: true, recursive: true });
	}
});

describe('config.schema.json', () => {
	test('declares every top-level key the loader accepts, and no others', () => {
		const declared = Object.keys(configSchema.properties);
		const config = Object.fromEntries(
			declared.map((key) => {
				if (key === '$schema') {
					return [key, 'https://www.ensemblr.dev/schemas/config.schema.json'];
				}
				if (key === 'schemaVersion') {
					return [key, 1];
				}
				return [key, key === 'repositoryRules' ? [] : {}];
			}),
		);

		const { snapshot } = loadEnsemblrConfig({
			configPath: writeConfigJson(config),
		});

		expect(snapshot.status).toBe('ok');
		expect(snapshot.diagnostics).toEqual([]);
	});

	// The other direction of the same parity. Both schemas are
	// `additionalProperties: false`, so a key the loader gained without a schema
	// entry is red-underlined in every user's editor while the app accepts it.
	test('declares every top-level key the loader accepts', () => {
		const declared = new Set(Object.keys(configSchema.properties));

		expect(
			[...ALLOWED_TOP_LEVEL_KEYS].filter((key) => !declared.has(key)),
		).toEqual([]);
	});

	test('a key the schema does not declare is reported by the loader', () => {
		const { snapshot } = loadEnsemblrConfig({
			configPath: writeConfigJson({ schemaVersion: 1, notASection: {} }),
		});

		expect(snapshot.diagnostics).toContainEqual(
			expect.objectContaining({
				code: 'unknown-top-level-key',
				fieldPath: '$.notASection',
			}),
		);
	});

	test('app sections match the app settings schema', () => {
		expect(Object.keys(appSchema.properties).sort()).toEqual(
			Object.keys(zodAppSchema.properties).sort(),
		);
	});

	test.each(Object.keys(zodAppSchema.properties))(
		'app.%s fields, enums and defaults match the app settings schema',
		(section) => {
			const published = appSchema.properties[section];
			const authoritative = zodAppSchema.properties[section];

			expect(Object.keys(published.properties).sort()).toEqual(
				Object.keys(authoritative.properties).sort(),
			);

			for (const [field, definition] of Object.entries<JsonSchema>(
				authoritative.properties,
			)) {
				const publishedField = published.properties[field];
				expect(publishedField.default).toEqual(definition.default);
				expect(publishedField.enum).toEqual(definition.enum);
				expect(publishedField.minimum).toEqual(definition.minimum);
				expect(publishedField.maximum).toEqual(definition.maximum);
			}
		},
	);

	test('claudeSubagentMode lists every delegation mechanism', () => {
		expect(
			appSchema.properties.providers.properties.claudeSubagentMode.enum,
		).toEqual([...SUBAGENT_MECHANISMS]);
	});

	test('repository settings cover every repository-scope built-in default', () => {
		const declared = new Set(
			schemaKeyPaths(configSchema.$defs.repositorySettings, configSchema),
		);
		const resolved = resolveSettings({
			config: emptyConfig,
			repository: { repositoryId: 'repo' },
		});

		const missing = (resolved.repository?.settings ?? [])
			.map((setting) => setting.key)
			.filter((key) => !declared.has(key));

		expect(missing).toEqual([]);
	});

	test.each(configSchema.$defs.permissionMode.enum as string[])(
		'permission mode %s resolves rather than being rejected',
		(mode) => {
			const resolved = resolveSettings({
				config: {
					...emptyConfig,
					repositoryDefaults: { security: { permissionMode: mode } },
				},
				repository: { repositoryId: 'repo' },
			});

			expect(
				resolved.repository?.settings.find(
					(setting) => setting.key === 'security.permissionMode',
				),
			).toMatchObject({ source: 'user-default', value: mode });
		},
	);

	test('an unlisted permission mode is rejected', () => {
		const resolved = resolveSettings({
			config: {
				...emptyConfig,
				repositoryDefaults: { security: { permissionMode: 'anything-goes' } },
			},
			repository: { repositoryId: 'repo' },
		});

		expect(
			resolved.repository?.settings.find(
				(setting) => setting.key === 'security.permissionMode',
			),
		).toMatchObject({ source: 'built-in-default' });
	});

	test('run script icons match the curated vocabulary', () => {
		expect(configSchema.$defs.runScriptIcon.enum).toEqual([
			...RUN_SCRIPT_ICON_NAMES,
		]);
	});
});

/** One value per declared key, so the fixture below can be checked for coverage. */
const settingsFixture = {
	amp_executable_path: '/usr/local/bin/amp',
	claude_executable_path: '/usr/local/bin/claude',
	codex_executable_path: '/usr/local/bin/codex',
	copilot_executable_path: '/usr/local/bin/copilot',
	enterprise_data_privacy: true,
	environment_variables: { API_BASE: 'https://example.test' },
	file_include_globs: ['.env*'],
	gemini_executable_path: '/usr/local/bin/gemini',
	open_code_executable_path: '/usr/local/bin/opencode',
	opencode_executable_path: '/usr/local/bin/opencode',
	pi_executable_path: '/usr/local/bin/pi',
	spotlight_testing: { enabled: true },
	git: {
		archive_after_merge: true,
		branchPrefix: 'legacy/',
		branch_from: 'develop',
		branch_prefix: 'feat/',
		delete_local_branch_on_archive: true,
		reclaim_disk_on_archive: true,
		remote_origin: 'origin',
		set_upstream_on_push: true,
	},
	infisical: {
		environment: 'dev',
		path: '/',
		project_id: 'project-id',
		project_name: 'ensemblr',
		recursive: false,
		site_url: 'https://app.infisical.com',
	},
	prompts: {
		branchNaming: 'a',
		branchRename: 'b',
		branch_naming: 'c',
		branch_rename: 'd',
		codeReview: 'e',
		code_review: 'f',
		createPr: 'g',
		create_pr: 'h',
		fixCheckErrors: 'i',
		fixErrors: 'j',
		fix_check_errors: 'k',
		fix_errors: 'l',
		general: 'm',
		resolveConflicts: 'n',
		resolve_conflicts: 'o',
		review: 'p',
	},
	scripts: {
		archive: 'rm -rf node_modules',
		auto_run_after_setup: true,
		run_mode: 'nonconcurrent',
		setup: 'npm ci',
		run: {
			demo: {
				available_in: ['local'],
				command: 'npm run dev',
				default: true,
				icon: 'play',
			},
		},
	},
};

describe('settings.schema.json', () => {
	test('the coverage fixture exercises every key the schema declares', () => {
		const declared = schemaKeyPaths(settingsSchema, settingsSchema);

		expect(
			declared.filter((key) => valueAtPath(settingsFixture, key) === undefined),
		).toEqual([]);
	});

	// The other direction of the same parity. The schema is
	// `additionalProperties: false` on the document and on each of these blocks,
	// so a key the TOML loader gained without a schema entry is red-underlined in
	// every user's editor while the app accepts it happily.
	test.each([
		['top-level', settingsSchema, REPOSITORY_CONFIG_KEYS.topLevel],
		['[git]', settingsSchema.properties.git, REPOSITORY_CONFIG_KEYS.git],
		[
			'[prompts]',
			settingsSchema.properties.prompts,
			REPOSITORY_CONFIG_KEYS.prompts,
		],
		[
			'[scripts]',
			settingsSchema.properties.scripts,
			REPOSITORY_CONFIG_KEYS.scripts,
		],
	] as const)(
		'declares every %s key the loader accepts',
		(_block, block, accepted) => {
			const declared = new Set(
				Object.keys(resolveRef(block, settingsSchema).properties ?? {}),
			);

			expect(accepted.filter((key) => !declared.has(key))).toEqual([]);
		},
	);

	test('every key the schema declares loads without a diagnostic', () => {
		const { snapshot } = loadRepositoryConfig({
			repositoryPath: writeRepositorySettings(settingsFixture),
		});

		expect(snapshot.diagnostics).toEqual([]);
	});

	test('the legacy run string loads without a diagnostic', () => {
		const { snapshot } = loadRepositoryConfig({
			repositoryPath: writeRepositorySettings({
				scripts: { run: 'npm run dev' },
			}),
		});

		expect(snapshot.diagnostics).toEqual([]);
	});

	test('a key the schema does not declare is reported', () => {
		const { snapshot } = loadRepositoryConfig({
			repositoryPath: writeRepositorySettings({ not_a_setting: true }),
		});

		expect(snapshot.diagnostics).toContainEqual(
			expect.objectContaining({
				code: 'unsupported-repository-config-field',
				fieldPath: '$.not_a_setting',
			}),
		);
	});

	test('run script icons match the curated vocabulary', () => {
		expect(settingsSchema.$defs.runScript.properties.icon.enum).toEqual([
			...RUN_SCRIPT_ICON_NAMES,
		]);
	});

	test.each(
		settingsSchema.properties.scripts.properties.run_mode.enum as string[],
	)('run mode %s survives the settings parser', (mode) => {
		expect(
			parseWorkspaceScriptSettings([{ key: 'runScriptMode', value: mode }])
				.runScriptMode,
		).toBe(mode);
	});
});
