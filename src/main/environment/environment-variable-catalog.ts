import type { EnvironmentVariableCatalogEntrySnapshot, EnvironmentVariableCategory, EnvironmentVariableScope, EnvironmentVariableValueKind } from '../../shared/ipc/contracts/environment';
import { isSensitiveKeyName } from '../config/json-utils.ts';

/** Built-in catalog of environment variables Ensemble understands out-of-the-box. */
export const BUILT_IN_ENVIRONMENT_VARIABLE_CATALOG: readonly EnvironmentVariableCatalogEntrySnapshot[] =
	[
		{
			category: 'pi',
			description:
				'Optional Pi agent directory override. Leave unset to preserve the normal Pi user environment.',
			key: 'PI_CODING_AGENT_DIR',
			required: false,
			reserved: false,
			scope: 'app',
			title: 'Pi agent directory',
			valueKind: 'plain',
		},
		{
			category: 'proxy',
			description:
				'HTTP proxy used by tools that honor standard proxy environment variables.',
			key: 'HTTP_PROXY',
			required: false,
			reserved: false,
			scope: 'app',
			title: 'HTTP proxy',
			valueKind: 'secret',
		},
		{
			category: 'proxy',
			description:
				'HTTPS proxy used by tools that honor standard proxy environment variables.',
			key: 'HTTPS_PROXY',
			required: false,
			reserved: false,
			scope: 'app',
			title: 'HTTPS proxy',
			valueKind: 'secret',
		},
		{
			category: 'proxy',
			description: 'Fallback proxy used by tools that support ALL_PROXY.',
			key: 'ALL_PROXY',
			required: false,
			reserved: false,
			scope: 'app',
			title: 'All-protocol proxy',
			valueKind: 'secret',
		},
		{
			category: 'proxy',
			description:
				'Comma-separated hosts that should bypass configured proxy variables.',
			key: 'NO_PROXY',
			required: false,
			reserved: false,
			scope: 'app',
			title: 'Proxy bypass list',
			valueKind: 'plain',
		},
		...[
			'OPENAI_API_KEY',
			'ANTHROPIC_API_KEY',
			'GOOGLE_API_KEY',
			'GEMINI_API_KEY',
			'GROQ_API_KEY',
			'MISTRAL_API_KEY',
			'OPENROUTER_API_KEY',
			'VERCEL_AI_GATEWAY_API_KEY',
		].map((key) =>
			createCatalogEntry({
				category: 'provider',
				description:
					'Optional Ensemble-owned provider credential. Pi-owned provider credentials should stay in the Pi user environment unless explicitly overridden here.',
				key,
				title: formatEnvironmentVariableTitle(key),
				valueKind: 'secret',
			}),
		),
		createCatalogEntry({
			category: 'generic',
			description:
				'Generic debug selector for tools and scripts that honor DEBUG.',
			key: 'DEBUG',
			title: 'Debug selector',
			valueKind: 'plain',
		}),
		createCatalogEntry({
			category: 'generic',
			description:
				'Generic CI flag for tools and scripts that alter behavior in continuous-integration mode.',
			key: 'CI',
			title: 'CI mode',
			valueKind: 'plain',
		}),
		...[
			'ENSEMBLE_WORKSPACE_NAME',
			'ENSEMBLE_WORKSPACE_PATH',
			'ENSEMBLE_ROOT_PATH',
			'ENSEMBLE_DEFAULT_BRANCH',
			'ENSEMBLE_PORT',
			'CONDUCTOR_WORKSPACE_NAME',
			'CONDUCTOR_WORKSPACE_PATH',
			'CONDUCTOR_ROOT_PATH',
			'CONDUCTOR_DEFAULT_BRANCH',
			'CONDUCTOR_PORT',
		].map((key) =>
			createCatalogEntry({
				category: 'runtime',
				description:
					'Reserved workspace runtime variable populated by later workspace environment injection.',
				key,
				reserved: true,
				scope: 'workspace',
				title: formatEnvironmentVariableTitle(key),
				valueKind: 'runtime',
			}),
		),
	];

/**
 * Builds a catalog entry with defaults applied.
 * @param input - Catalog fields.
 * @returns A fully-populated catalog snapshot.
 */
export function createCatalogEntry({
	category,
	description,
	key,
	required = false,
	reserved = false,
	scope = 'app',
	title,
	valueKind,
}: {
	category: EnvironmentVariableCategory;
	description: string;
	key: string;
	required?: boolean;
	reserved?: boolean;
	scope?: EnvironmentVariableScope;
	title: string;
	valueKind: EnvironmentVariableValueKind;
}): EnvironmentVariableCatalogEntrySnapshot {
	return {
		category,
		description,
		key,
		required,
		reserved,
		scope,
		title,
		valueKind,
	};
}

/**
 * Returns a deep-cloned `key -> catalog entry` map seeded from the built-in catalog.
 * @returns A fresh catalog map.
 */
export function createCatalogMap(): Map<
	string,
	EnvironmentVariableCatalogEntrySnapshot
> {
	return new Map(
		BUILT_IN_ENVIRONMENT_VARIABLE_CATALOG.map((entry) => [
			entry.key,
			{ ...entry },
		]),
	);
}

/**
 * Returns the catalog entry for `key`, manufacturing a custom entry if absent.
 * @param key - Variable name.
 * @param catalogByKey - Active catalog map.
 * @returns The catalog entry.
 */
export function getCatalogEntryForKey(
	key: string,
	catalogByKey: Map<string, EnvironmentVariableCatalogEntrySnapshot>,
): EnvironmentVariableCatalogEntrySnapshot {
	return catalogByKey.get(key) ?? createCustomCatalogEntry(key);
}

/**
 * Builds a custom catalog entry for a user-defined variable, classifying it
 * as secret when the name looks sensitive.
 * @param key - Variable name.
 * @returns A custom catalog entry.
 */
export function createCustomCatalogEntry(
	key: string,
): EnvironmentVariableCatalogEntrySnapshot {
	return createCatalogEntry({
		category: 'custom',
		description:
			'User-defined environment variable prepared for future settings and process environment flows.',
		key,
		title: formatEnvironmentVariableTitle(key),
		valueKind: isSensitiveEnvironmentVariableName(key) ? 'secret' : 'plain',
	});
}

/**
 * Comparator that sorts catalog entries by `category:key`.
 * @param left - First entry.
 * @param right - Second entry.
 * @returns Standard comparator number.
 */
export function compareCatalogEntries(
	left: EnvironmentVariableCatalogEntrySnapshot,
	right: EnvironmentVariableCatalogEntrySnapshot,
): number {
	return `${left.category}:${left.key}`.localeCompare(
		`${right.category}:${right.key}`,
	);
}

/**
 * Tests whether a variable name contains a sensitive substring (e.g. `TOKEN`).
 * @param key - Variable name.
 * @returns True when the normalised name matches a sensitive part.
 */
export function isSensitiveEnvironmentVariableName(key: string): boolean {
	return isSensitiveKeyName(key);
}

/**
 * Renders a variable name as a Title-Case label for catalog display.
 * @param key - Variable name.
 * @returns A user-facing title.
 */
export function formatEnvironmentVariableTitle(key: string): string {
	return key
		.split('_')
		.filter(Boolean)
		.map((part) =>
			part.length <= 3
				? part.toUpperCase()
				: `${part[0]?.toUpperCase() ?? ''}${part.slice(1).toLowerCase()}`,
		)
		.join(' ');
}
