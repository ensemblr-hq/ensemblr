import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import type { EnsemblrConfigService } from '../../src/main/config';
import type { InfisicalEnvironmentResolver } from '../../src/main/environment/environment-variable-types';
import { createEnvironmentVariablesService } from '../../src/main/environment/environment-variables';
import { createMockSecretStore } from '../../src/main/secrets/mock-backend';
import { openEnsemblrDatabase } from '../../src/main/storage/database';

const SCOPE = { scope: 'repository' as const, scopeId: 'repo-1' };

let database: DatabaseSync;

/** Minimal config service: the Infisical layer only ever reads the app scope from it. */
function fakeConfigService(): EnsemblrConfigService {
	return {
		getConfig: () => ({ environment: {} }),
	} as unknown as EnsemblrConfigService;
}

/** Builds the service under test with an injected Infisical resolver. */
function buildService(resolveInfisical: InfisicalEnvironmentResolver | null) {
	return createEnvironmentVariablesService({
		configService: fakeConfigService(),
		database,
		resolveInfisical,
		secretStore: createMockSecretStore(),
	});
}

/** Resolver that always answers with the given values and no degradation. */
function resolverFor(values: Record<string, string>) {
	return vi.fn(async () => ({ degradedReason: null, values }));
}

beforeEach(() => {
	database = openEnsemblrDatabase({ databasePath: ':memory:' }).database;
});

afterEach(() => {
	database.close();
});

describe('the Infisical environment layer', () => {
	test('contributes its values to the assembled environment', async () => {
		const service = buildService(resolverFor({ DATABASE_URL: 'postgres://x' }));

		const assembly = await service.assembleEnvironment(SCOPE);

		expect(assembly.env.DATABASE_URL).toBe('postgres://x');
	});

	test('is overridden by an explicit local plain value', async () => {
		const service = buildService(resolverFor({ API_HOST: 'https://prod' }));
		await service.setPlainValue({
			...SCOPE,
			key: 'API_HOST',
			value: 'http://localhost:3000',
		});

		const assembly = await service.assembleEnvironment(SCOPE);

		expect(assembly.env.API_HOST).toBe('http://localhost:3000');
	});

	test('is overridden by an explicit local secret', async () => {
		const service = buildService(resolverFor({ API_KEY: 'from-infisical' }));
		await service.setSecretValue({
			...SCOPE,
			key: 'API_KEY',
			value: 'from-keychain',
		});

		const assembly = await service.assembleEnvironment(SCOPE);

		expect(assembly.env.API_KEY).toBe('from-keychain');
	});

	test('marks every resolved value for redaction from command output', async () => {
		const service = buildService(resolverFor({ TOKEN: 'super-secret' }));

		const assembly = await service.assembleEnvironment(SCOPE);

		expect(assembly.redactValues).toContain('super-secret');
	});

	test('is skipped entirely when secrets are excluded', async () => {
		const resolve = resolverFor({ TOKEN: 'super-secret' });
		const service = buildService(resolve);

		const assembly = await service.assembleEnvironment({
			...SCOPE,
			includeSecrets: false,
		});

		expect(assembly.env.TOKEN).toBeUndefined();
		expect(resolve).not.toHaveBeenCalled();
	});

	test('never reaches the resolver at app scope, which cannot be linked', async () => {
		const resolve = resolverFor({ TOKEN: 'super-secret' });
		const service = buildService(resolve);

		await service.assembleEnvironment({ scope: 'app' });

		expect(resolve).not.toHaveBeenCalled();
	});

	test('skips a secret whose name is not a valid variable, with a warning', async () => {
		const service = buildService(
			resolverFor({ GOOD_KEY: 'kept', 'not a var': 'dropped' }),
		);

		const assembly = await service.assembleEnvironment(SCOPE);

		expect(assembly.env.GOOD_KEY).toBe('kept');
		expect(assembly.env['not a var']).toBeUndefined();
		expect(
			assembly.diagnostics.some(
				(diagnostic) =>
					diagnostic.code === 'invalid-infisical-variable-key' &&
					diagnostic.severity === 'warning',
			),
		).toBe(true);
	});

	test('warns rather than fails when values came from a stale cache', async () => {
		const service = buildService(async () => ({
			degradedReason: 'stale-cache' as const,
			values: { TOKEN: 'cached' },
		}));

		const assembly = await service.assembleEnvironment(SCOPE);

		expect(assembly.env.TOKEN).toBe('cached');
		expect(
			assembly.diagnostics.some(
				(diagnostic) => diagnostic.code === 'infisical-cache-stale',
			),
		).toBe(true);
	});

	test('warns when no local account resolves the committed link', async () => {
		const service = buildService(async () => ({
			degradedReason: 'no-account' as const,
			values: {},
		}));

		const assembly = await service.assembleEnvironment(SCOPE);

		expect(
			assembly.diagnostics.some(
				(diagnostic) => diagnostic.code === 'infisical-account-unresolved',
			),
		).toBe(true);
	});

	// Infisical being unreachable must never be the reason a workspace cannot
	// open, so a throwing resolver has to degrade rather than propagate.
	test('degrades to a warning when the resolver throws', async () => {
		const service = buildService(async () => {
			throw new Error('socket hang up');
		});

		const assembly = await service.assembleEnvironment(SCOPE);

		expect(assembly.env).toBeDefined();
		expect(
			assembly.diagnostics.some(
				(diagnostic) =>
					diagnostic.code === 'infisical-unavailable' &&
					diagnostic.severity === 'warning',
			),
		).toBe(true);
	});

	test('assembles normally when no resolver is wired at all', async () => {
		const service = buildService(null);

		const assembly = await service.assembleEnvironment(SCOPE);

		expect(assembly.diagnostics).toEqual([]);
	});

	test('shows a resolved value in the snapshot as a masked Infisical row', async () => {
		const service = buildService(resolverFor({ DATABASE_URL: 'postgres://x' }));

		const snapshot = await service.getSnapshot(SCOPE);
		const variable = snapshot.variables.find(
			(entry) => entry.key === 'DATABASE_URL',
		);

		expect(variable?.source).toBe('infisical');
		expect(variable?.status).toBe('masked');
		expect(variable?.valueKind).toBe('secret');
		expect(variable?.displayValue).toBeUndefined();
	});

	test('satisfies a required variable rather than reporting it unset', async () => {
		const service = buildService(resolverFor({ REQUIRED_TOKEN: 'present' }));

		const snapshot = await service.getSnapshot({
			...SCOPE,
			requiredKeys: ['REQUIRED_TOKEN'],
		});

		expect(snapshot.missingRequiredCount).toBe(0);
	});
});
