import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { createInfisicalAccountStore } from '../../src/main/infisical/infisical-account-store';
import type { InfisicalApiClient } from '../../src/main/infisical/infisical-api';
import { createInfisicalCache } from '../../src/main/infisical/infisical-cache';
import { createInfisicalClient } from '../../src/main/infisical/infisical-client';
import { createInfisicalLinkStore } from '../../src/main/infisical/infisical-link-store';
import {
	createInfisicalService,
	type InfisicalService,
} from '../../src/main/infisical/infisical-service';
import { createMockSecretStore } from '../../src/main/secrets/mock-backend';
import { openEnsemblrDatabase } from '../../src/main/storage/database';

let database: DatabaseSync;
let repositoryPath: string;
let service: InfisicalService;
let accountId: string;
let sharedSecretStore: ReturnType<typeof createMockSecretStore>;
// `infisical_accounts` is unique on (site_url, client_id), so every assembled
// service needs its own client id or the second one fails to add an account.
let accountCounter = 0;

/** API double whose project and secret answers each test can override. */
function fakeApi(
	overrides: Partial<InfisicalApiClient> = {},
): InfisicalApiClient {
	return {
		listProjects: vi.fn(async () => [
			{
				environments: [{ name: 'Development', slug: 'dev' }],
				id: 'proj_1',
				name: 'Backend',
				slug: 'backend',
			},
		]),
		listSecrets: vi.fn(async () => [
			{ key: 'DATABASE_URL', value: 'postgres://x' },
		]),
		login: vi.fn(async () => ({
			expiresAtMs: Date.now() + 60_000,
			token: 'tok',
		})),
		...overrides,
	};
}

/**
 * Assembles the service over a real in-memory database and a fake API. The
 * secret store is passed in when a test needs two services to share one cache.
 */
async function buildService(
	api: InfisicalApiClient = fakeApi(),
	secretStore = createMockSecretStore(),
) {
	const accountStore = createInfisicalAccountStore({ database, secretStore });
	const built = createInfisicalService({
		accountStore,
		cache: createInfisicalCache({ secretStore }),
		client: createInfisicalClient({ accountStore, api }),
		linkStore: createInfisicalLinkStore({ database }),
	});
	accountCounter += 1;
	const added = await built.addAccount({
		clientId: `client-${accountCounter}`,
		clientSecret: 'secret',
		label: 'Work',
		siteUrl: 'https://app.infisical.com',
	});

	return { accountId: added.account?.id ?? '', secretStore, service: built };
}

/** Inserts the repository row the link's committed half is written next to. */
function seedRepository(repoPath: string): string {
	database
		.prepare(
			`INSERT INTO repositories (id, slug, name, path)
			 VALUES ('repo-1', 'repo-1', 'Repo One', ?)`,
		)
		.run(repoPath);

	return 'repo-1';
}

beforeEach(async () => {
	accountCounter = 0;
	database = openEnsemblrDatabase({ databasePath: ':memory:' }).database;
	repositoryPath = mkdtempSync(path.join(tmpdir(), 'ensemblr-infisical-'));
	seedRepository(repositoryPath);

	const built = await buildService();
	service = built.service;
	accountId = built.accountId;
	sharedSecretStore = built.secretStore;
});

afterEach(() => {
	database.close();
	rmSync(repositoryPath, { force: true, recursive: true });
});

describe('createInfisicalService.setLink', () => {
	test('saves a link and reports no failure', async () => {
		const result = await service.setLink({
			accountId,
			environmentSlug: 'dev',
			projectId: 'proj_1',
			projectName: 'Backend',
			scope: 'repository',
			scopeId: 'repo-1',
		});

		expect(result.failure).toBeNull();
		expect(result.link).toMatchObject({
			environmentSlug: 'dev',
			projectId: 'proj_1',
			secretPath: '/',
		});
	});

	test('writes the project half into the committed .ensemblr/settings.toml', async () => {
		await service.setLink({
			accountId,
			environmentSlug: 'dev',
			projectId: 'proj_1',
			projectName: 'Backend',
			scope: 'repository',
			scopeId: 'repo-1',
		});

		const committed = readFileSync(
			path.join(repositoryPath, '.ensemblr', 'settings.toml'),
			'utf8',
		);

		expect(committed).toContain('proj_1');
		expect(committed).toContain('dev');
	});

	test('replaces an existing link rather than failing on the second save', async () => {
		const request = {
			accountId,
			environmentSlug: 'dev',
			projectId: 'proj_1',
			scope: 'repository' as const,
			scopeId: 'repo-1',
		};

		await service.setLink(request);
		const second = await service.setLink({
			...request,
			environmentSlug: 'prod',
		});

		expect(second.failure).toBeNull();
		expect(second.link?.environmentSlug).toBe('prod');
	});

	test('rejects an account that no longer exists', async () => {
		const result = await service.setLink({
			accountId: 'gone',
			environmentSlug: 'dev',
			projectId: 'proj_1',
			scope: 'repository',
			scopeId: 'repo-1',
		});

		expect(result.failure?.code).toBe('infisical-account-not-found');
	});

	test('keeps a custom secret path and the recursive flag', async () => {
		const result = await service.setLink({
			accountId,
			environmentSlug: 'dev',
			projectId: 'proj_1',
			recursive: true,
			scope: 'repository',
			scopeId: 'repo-1',
			secretPath: '/backend',
		});

		expect(result.link).toMatchObject({
			recursive: true,
			secretPath: '/backend',
		});
	});

	test('reports a committed config that could not be written, keeping the local half', async () => {
		mkdirSync(path.join(repositoryPath, '.ensemblr'), { recursive: true });
		writeFileSync(
			path.join(repositoryPath, '.ensemblr', 'settings.toml'),
			'this is not = = valid toml',
			'utf8',
		);

		const result = await service.setLink({
			accountId,
			environmentSlug: 'dev',
			projectId: 'proj_1',
			scope: 'repository',
			scopeId: 'repo-1',
		});

		expect(result.failure?.code).toBe('infisical-config-write-failed');
		expect(result.link?.projectId).toBe('proj_1');
		expect(
			service.getLink({ scope: 'repository', scopeId: 'repo-1' }).link,
		).not.toBeNull();
	});

	test('reports a committed config that could not be cleared', async () => {
		await service.setLink({
			accountId,
			environmentSlug: 'dev',
			projectId: 'proj_1',
			scope: 'repository',
			scopeId: 'repo-1',
		});
		writeFileSync(
			path.join(repositoryPath, '.ensemblr', 'settings.toml'),
			'this is not = = valid toml',
			'utf8',
		);

		const result = await service.clearLink({
			scope: 'repository',
			scopeId: 'repo-1',
		});

		expect(result.failure?.code).toBe('infisical-config-write-failed');
	});
});

describe('createInfisicalService.listProjects', () => {
	/**
	 * API double that answers per account. Each account is given its own
	 * instance URL, which is the half of the project call that identifies who is
	 * asking, so a test can hand one account projects and another a failure.
	 */
	function perAccountApi(
		projectsBySiteUrl: Record<
			string,
			{
				environments: { name: string; slug: string }[];
				id: string;
				name: string;
				slug: string;
			}[]
		>,
		failingSiteUrls: string[] = [],
	): InfisicalApiClient {
		return fakeApi({
			listProjects: vi.fn(async ({ siteUrl }: { siteUrl: string }) => {
				const key = siteUrl.replace(/\/+$/, '');

				if (failingSiteUrls.includes(key)) {
					throw new Error('unreachable');
				}

				return projectsBySiteUrl[key] ?? [];
			}),
		});
	}

	/**
	 * Replaces the shared fixture's single account with exactly the accounts a
	 * test names, so the aggregate under assertion is only this test's.
	 */
	async function buildAggregating(
		api: InfisicalApiClient,
		labels: string[],
	): Promise<InfisicalService> {
		database.prepare('DELETE FROM infisical_accounts').run();

		const secretStore = createMockSecretStore();
		const accountStore = createInfisicalAccountStore({ database, secretStore });
		const built = createInfisicalService({
			accountStore,
			cache: createInfisicalCache({ secretStore }),
			client: createInfisicalClient({ accountStore, api }),
			linkStore: createInfisicalLinkStore({ database }),
		});

		for (const [index, label] of labels.entries()) {
			await built.addAccount({
				clientId: `agg-${index + 1}`,
				clientSecret: 'secret',
				label,
				siteUrl: `https://${index + 1}.infisical.com`,
			});
		}

		return built;
	}

	test('aggregates every account, tagging each project with its origin', async () => {
		const api = perAccountApi({
			'https://1.infisical.com': [
				{
					environments: [{ name: 'Dev', slug: 'dev' }],
					id: 'p1',
					name: 'Zebra',
					slug: 'zebra',
				},
			],
			'https://2.infisical.com': [
				{
					environments: [{ name: 'Prod', slug: 'prod' }],
					id: 'p2',
					name: 'Alpha',
					slug: 'alpha',
				},
			],
		});
		const aggregating = await buildAggregating(api, ['Work', 'Acme']);

		const result = await aggregating.listProjects();

		expect(result.failure).toBeNull();
		expect(result.accountFailures).toEqual([]);
		expect(
			result.projects.map((project) => [project.accountLabel, project.name]),
		).toEqual([
			['Acme', 'Alpha'],
			['Work', 'Zebra'],
		]);
		expect(result.projects.at(0)?.accountId).not.toBe(
			result.projects.at(1)?.accountId,
		);
	});

	test('keeps a usable list when one account fails, naming the account that dropped out', async () => {
		const api = perAccountApi(
			{
				'https://1.infisical.com': [
					{
						environments: [{ name: 'Dev', slug: 'dev' }],
						id: 'p1',
						name: 'Backend',
						slug: 'backend',
					},
				],
			},
			['https://2.infisical.com'],
		);
		const aggregating = await buildAggregating(api, ['Work', 'Acme']);

		const result = await aggregating.listProjects();

		expect(result.failure).toBeNull();
		expect(result.projects.map((project) => project.name)).toEqual(['Backend']);
		expect(result.accountFailures).toHaveLength(1);
		expect(result.accountFailures.at(0)?.accountLabel).toBe('Acme');
	});

	test('reports a top-level failure when no account could be listed', async () => {
		const aggregating = await buildAggregating(
			perAccountApi({}, ['https://1.infisical.com']),
			['Work'],
		);

		const result = await aggregating.listProjects();

		expect(result.projects).toEqual([]);
		expect(result.failure?.code).toBe('infisical-unknown');
	});
});

describe('createInfisicalService.resolveForScope', () => {
	test('resolves a saved link to its secrets', async () => {
		await service.setLink({
			accountId,
			environmentSlug: 'dev',
			projectId: 'proj_1',
			scope: 'repository',
			scopeId: 'repo-1',
		});

		const resolution = await service.resolveForScope({
			scope: 'repository',
			scopeId: 'repo-1',
		});

		expect(resolution.values).toEqual({ DATABASE_URL: 'postgres://x' });
		expect(resolution.degradedReason).toBeNull();
	});

	test('serves the cache and flags it stale when the fetch fails', async () => {
		await service.setLink({
			accountId,
			environmentSlug: 'dev',
			projectId: 'proj_1',
			scope: 'repository',
			scopeId: 'repo-1',
		});
		await service.resolveForScope({ scope: 'repository', scopeId: 'repo-1' });

		const failing = await buildService(
			fakeApi({
				listSecrets: vi.fn(async () => {
					throw new Error('socket hang up');
				}),
			}),
			sharedSecretStore,
		);
		const resolution = await failing.service.resolveForScope({
			scope: 'repository',
			scopeId: 'repo-1',
		});

		expect(resolution.values).toEqual({ DATABASE_URL: 'postgres://x' });
		expect(resolution.degradedReason).toBe('stale-cache');
	});

	// Setup and run scripts spawn through the terminal service, which assembles
	// the environment on every launch. Serving a stored value while Infisical is
	// reachable would hand a script a credential that has already been rotated,
	// so the fallback is only ever read after a failed fetch.
	test('fetches live on every resolution rather than serving the stored values', async () => {
		const api = fakeApi();
		const built = await buildService(api);

		await built.service.setLink({
			accountId: built.accountId,
			environmentSlug: 'dev',
			projectId: 'proj_1',
			scope: 'repository',
			scopeId: 'repo-1',
		});

		await built.service.resolveForScope({
			scope: 'repository',
			scopeId: 'repo-1',
		});
		await built.service.resolveForScope({
			scope: 'repository',
			scopeId: 'repo-1',
		});
		await built.service.resolveForScope({
			scope: 'repository',
			scopeId: 'repo-1',
		});

		expect(api.listSecrets).toHaveBeenCalledTimes(3);
	});

	test('picks up a value rotated between two resolutions', async () => {
		let value = 'first';
		const api = fakeApi({
			listSecrets: vi.fn(async () => [{ key: 'TOKEN', value }]),
		});
		const built = await buildService(api);

		await built.service.setLink({
			accountId: built.accountId,
			environmentSlug: 'dev',
			projectId: 'proj_1',
			scope: 'repository',
			scopeId: 'repo-1',
		});

		await built.service.resolveForScope({
			scope: 'repository',
			scopeId: 'repo-1',
		});
		value = 'rotated';
		const second = await built.service.resolveForScope({
			scope: 'repository',
			scopeId: 'repo-1',
		});

		expect(second.values.TOKEN).toBe('rotated');
	});

	test('collapses concurrent resolutions of one scope into a single fetch', async () => {
		const api = fakeApi();
		const built = await buildService(api);

		await built.service.setLink({
			accountId: built.accountId,
			environmentSlug: 'dev',
			projectId: 'proj_1',
			scope: 'repository',
			scopeId: 'repo-1',
		});

		await Promise.all([
			built.service.resolveForScope({ scope: 'repository', scopeId: 'repo-1' }),
			built.service.resolveForScope({ scope: 'repository', scopeId: 'repo-1' }),
			built.service.resolveForScope({ scope: 'repository', scopeId: 'repo-1' }),
		]);

		expect(api.listSecrets).toHaveBeenCalledTimes(1);
	});

	test('resolves an unlinked scope to nothing', async () => {
		const resolution = await service.resolveForScope({
			scope: 'repository',
			scopeId: 'repo-1',
		});

		expect(resolution.values).toEqual({});
	});
});

describe('createInfisicalService.clearLink', () => {
	test('removes the link and its committed block', async () => {
		await service.setLink({
			accountId,
			environmentSlug: 'dev',
			projectId: 'proj_1',
			scope: 'repository',
			scopeId: 'repo-1',
		});

		const cleared = await service.clearLink({
			scope: 'repository',
			scopeId: 'repo-1',
		});

		expect(cleared.failure).toBeNull();
		expect(
			readFileSync(
				path.join(repositoryPath, '.ensemblr', 'settings.toml'),
				'utf8',
			),
		).not.toContain('proj_1');
	});
});
