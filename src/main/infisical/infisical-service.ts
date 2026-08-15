import type {
	AddInfisicalAccountRequest,
	InfisicalAccountMutationResult,
	InfisicalAccountSnapshot,
	InfisicalAccountsResult,
	InfisicalFailure,
	InfisicalLinkResult,
	InfisicalLinkScope,
	InfisicalLinkSnapshot,
	InfisicalProjectSnapshot,
	InfisicalProjectsResult,
	InfisicalSyncResult,
	SetInfisicalLinkRequest,
} from '../../shared/ipc/contracts/infisical';
import type {
	InfisicalAccountRecord,
	InfisicalAccountStore,
} from './infisical-account-store.ts';
import { InfisicalApiError } from './infisical-api.ts';
import type { InfisicalCache } from './infisical-cache.ts';
import type { InfisicalClient } from './infisical-client.ts';
import type { InfisicalLinkStore } from './infisical-link-store.ts';
import {
	readInfisicalRepositoryConfig,
	writeInfisicalRepositoryConfig,
} from './infisical-repository-config.ts';

/** Resolved values for one scope, plus why they may be stale or missing. */
export interface InfisicalResolution {
	/** Locale-neutral reason the resolution is degraded, or null when it is clean. */
	degradedReason: 'no-account' | 'stale-cache' | 'unavailable' | null;
	values: Record<string, string>;
}

/** Public surface of the Infisical service. */
export interface InfisicalService {
	addAccount: (
		request: AddInfisicalAccountRequest,
	) => Promise<InfisicalAccountMutationResult>;
	clearLink: (request: {
		scope: InfisicalLinkScope;
		scopeId: string;
	}) => Promise<InfisicalLinkResult>;
	getLink: (request: {
		scope: InfisicalLinkScope;
		scopeId: string;
	}) => InfisicalLinkResult;
	listAccounts: () => Promise<InfisicalAccountsResult>;
	/**
	 * Lists every project reachable across every configured account at once, so
	 * the picker is one flat list rather than a choose-the-account step first.
	 */
	listProjects: () => Promise<InfisicalProjectsResult>;
	removeAccount: (request: {
		accountId: string;
	}) => Promise<InfisicalAccountMutationResult>;
	/**
	 * Resolves a scope's Infisical values for the environment layer. Never
	 * throws: a failure degrades to the cache, and an empty result is always a
	 * valid answer.
	 */
	resolveForScope: (request: {
		scope: InfisicalLinkScope;
		scopeId: string;
	}) => Promise<InfisicalResolution>;
	setLink: (request: SetInfisicalLinkRequest) => Promise<InfisicalLinkResult>;
	syncNow: (request: {
		scope: InfisicalLinkScope;
		scopeId: string;
	}) => Promise<InfisicalSyncResult>;
	testAccount: (request: {
		accountId: string;
	}) => Promise<InfisicalAccountMutationResult>;
}

/** Options for {@link createInfisicalService}. */
export interface CreateInfisicalServiceOptions {
	accountStore: InfisicalAccountStore;
	cache: InfisicalCache;
	client: InfisicalClient;
	linkStore: InfisicalLinkStore;
	now?: () => Date;
}

/**
 * Builds the Infisical service: the one surface both the IPC handlers and the
 * environment layer call. It owns the merge between a repository's committed
 * `[infisical]` block and the local account choice, and the cache policy that
 * keeps a workspace openable when Infisical is unreachable.
 * @param options - Stores, client, cache, and injectable clock.
 * @returns A fresh {@link InfisicalService}.
 */
export function createInfisicalService({
	accountStore,
	cache,
	client,
	linkStore,
	now = () => new Date(),
}: CreateInfisicalServiceOptions): InfisicalService {
	const inFlightResolutions = new Map<string, Promise<InfisicalResolution>>();

	/**
	 * Builds the IPC-safe view of an account, including the mask of its stored
	 * client secret.
	 * @param account - Persisted account record.
	 * @returns The snapshot.
	 */
	async function toAccountSnapshot(
		account: InfisicalAccountRecord,
	): Promise<InfisicalAccountSnapshot> {
		return {
			...account,
			maskedClientSecret: await accountStore.readMaskedClientSecret(account.id),
		};
	}

	/**
	 * Reads the committed `[infisical]` block behind a scope. Only a repository
	 * commits one; a workspace link is an explicit per-machine override.
	 * @param scope - Link scope.
	 * @param scopeId - Repository or workspace id.
	 * @returns The committed block, or null.
	 */
	function readCommittedBlock(scope: InfisicalLinkScope, scopeId: string) {
		if (scope !== 'repository') {
			return null;
		}

		const repositoryPath = linkStore.readRepositoryPath(scopeId);

		return repositoryPath
			? readInfisicalRepositoryConfig(repositoryPath)
			: null;
	}

	/**
	 * Picks the local account that resolves a committed link, by matching its
	 * instance URL. An ambiguous match is left unresolved so the user chooses
	 * rather than Ensemblr guessing which org's credentials to spend.
	 * @param siteUrl - Instance URL named by the committed block.
	 * @returns The account id, or null when there is no unambiguous match.
	 */
	function matchAccountBySiteUrl(siteUrl: string | null): string | null {
		if (!siteUrl) {
			return null;
		}

		const matches = accountStore
			.list()
			.filter((account) => account.siteUrl === siteUrl);

		return matches.length === 1 ? (matches.at(0)?.id ?? null) : null;
	}

	/**
	 * Merges the committed project half with the local account half into the one
	 * link every caller reads.
	 * @param scope - Link scope.
	 * @param scopeId - Repository or workspace id.
	 * @returns The effective link, or null when the scope is not linked.
	 */
	function resolveLink(
		scope: InfisicalLinkScope,
		scopeId: string,
	): InfisicalLinkSnapshot | null {
		const row = linkStore.rows({ scope, scopeId });
		const committed = readCommittedBlock(scope, scopeId);

		if (!row && !committed) {
			return null;
		}

		const projectId = row?.projectId || committed?.projectId || '';
		const siteUrl = row?.siteUrl ?? committed?.siteUrl ?? null;
		const accountId = row?.accountId ?? matchAccountBySiteUrl(siteUrl);

		if (!projectId) {
			return null;
		}

		return {
			accountId,
			accountLabel: accountId
				? (accountStore.get(accountId)?.label ?? null)
				: null,
			enabled: row?.enabled ?? true,
			environmentSlug: row?.environmentSlug || committed?.environmentSlug || '',
			fromRepositoryConfig: !row && Boolean(committed),
			lastSyncedAt: row?.lastSyncedAt ?? null,
			projectId,
			projectName: row?.projectName ?? committed?.projectName ?? null,
			recursive: row?.recursive ?? committed?.recursive ?? false,
			scope,
			scopeId,
			secretPath: row?.secretPath || committed?.secretPath || '/',
			siteUrl,
		};
	}

	/**
	 * Fetches a link's secrets, writing the result to the cache on success and
	 * falling back to it on failure.
	 * @param link - The link to resolve.
	 * @returns The resolved values and how degraded the answer is.
	 */
	async function fetchWithCacheFallback(
		link: InfisicalLinkSnapshot,
	): Promise<InfisicalResolution> {
		const scopeKey = { scope: link.scope, scopeId: link.scopeId };

		if (!link.accountId) {
			const cached = await cache.read(scopeKey);

			return {
				degradedReason: 'no-account',
				values: cached?.values ?? {},
			};
		}

		try {
			const secrets = await client.listSecrets({
				accountId: link.accountId,
				query: {
					environment: link.environmentSlug,
					projectId: link.projectId,
					recursive: link.recursive,
					secretPath: link.secretPath,
				},
			});
			const values = Object.fromEntries(
				secrets.map((secret) => [secret.key, secret.value]),
			);

			await cache.write({ ...scopeKey, values });
			linkStore.recordSync({ ...scopeKey, syncedAt: now().toISOString() });

			return { degradedReason: null, values };
		} catch {
			const cached = await cache.read(scopeKey);

			return {
				degradedReason: cached ? 'stale-cache' : 'unavailable',
				values: cached?.values ?? {},
			};
		}
	}

	/**
	 * Records the outcome of a login attempt against the account row, so the
	 * settings list can show which accounts are known-good.
	 * @param accountId - Account that was exercised.
	 * @param error - The failure, or null on success.
	 */
	function recordAccountOutcome(accountId: string, error: unknown): void {
		accountStore.recordVerification({
			accountId,
			errorCode: error === null ? null : toFailure(error).code,
		});
	}

	/**
	 * Lists one account's projects without throwing, tagging each with the
	 * account that reached it so an aggregated list stays attributable.
	 * @param account - The account to list projects for.
	 * @returns Its projects, or the failure that prevented listing them.
	 */
	async function listAccountProjects(account: InfisicalAccountRecord): Promise<{
		accountId: string;
		accountLabel: string;
		failure: InfisicalFailure | null;
		projects: InfisicalProjectSnapshot[];
	}> {
		try {
			const projects = await client.listProjects(account.id);

			recordAccountOutcome(account.id, null);

			return {
				accountId: account.id,
				accountLabel: account.label,
				failure: null,
				projects: projects.map((project) => ({
					accountId: account.id,
					accountLabel: account.label,
					environments: project.environments,
					id: project.id,
					name: project.name,
					slug: project.slug,
				})),
			};
		} catch (error) {
			recordAccountOutcome(account.id, error);

			return {
				accountId: account.id,
				accountLabel: account.label,
				failure: toFailure(error),
				projects: [],
			};
		}
	}

	return {
		addAccount: async (request) => {
			try {
				const account = await accountStore.create(request);

				try {
					await client.verify(account.id);
					recordAccountOutcome(account.id, null);
				} catch (error) {
					recordAccountOutcome(account.id, error);
				}

				const stored = accountStore.get(account.id) ?? account;

				return { account: await toAccountSnapshot(stored), failure: null };
			} catch (error) {
				return { account: null, failure: toFailure(error) };
			}
		},

		clearLink: async ({ scope, scopeId }) => {
			try {
				linkStore.clear({ scope, scopeId });
				await cache.clear({ scope, scopeId });

				if (scope === 'repository') {
					const repositoryPath = linkStore.readRepositoryPath(scopeId);

					if (repositoryPath) {
						writeInfisicalRepositoryConfig({ block: null, repositoryPath });
					}
				}

				return { failure: null, link: null };
			} catch (error) {
				return { failure: toFailure(error), link: null };
			}
		},

		getLink: ({ scope, scopeId }) => {
			try {
				return { failure: null, link: resolveLink(scope, scopeId) };
			} catch (error) {
				return { failure: toFailure(error), link: null };
			}
		},

		listAccounts: async () => {
			try {
				const accounts = await Promise.all(
					accountStore.list().map((account) => toAccountSnapshot(account)),
				);

				return { accounts, failure: null };
			} catch (error) {
				return { accounts: [], failure: toFailure(error) };
			}
		},

		listProjects: async () => {
			const listings = await Promise.all(
				accountStore.list().map((account) => listAccountProjects(account)),
			);
			const projects = listings
				.flatMap((listing) => listing.projects)
				.sort(compareProjects);
			const accountFailures = listings.flatMap((listing) =>
				listing.failure
					? [
							{
								accountId: listing.accountId,
								accountLabel: listing.accountLabel,
								failure: listing.failure,
							},
						]
					: [],
			);
			const nothingListed = projects.length === 0 && accountFailures.length > 0;

			return {
				accountFailures,
				failure: nothingListed
					? (accountFailures.at(0)?.failure ?? null)
					: null,
				projects,
			};
		},

		removeAccount: async ({ accountId }) => {
			try {
				client.invalidate(accountId);
				await accountStore.delete(accountId);

				return { account: null, failure: null };
			} catch (error) {
				return { account: null, failure: toFailure(error) };
			}
		},

		resolveForScope: async ({ scope, scopeId }) => {
			const empty: InfisicalResolution = { degradedReason: null, values: {} };
			let link: InfisicalLinkSnapshot | null;

			try {
				link = resolveLink(scope, scopeId);
			} catch {
				return empty;
			}

			if (!link?.enabled || !link.environmentSlug) {
				return empty;
			}

			const inFlightKey = `${scope}:${scopeId}`;
			const pending = inFlightResolutions.get(inFlightKey);

			if (pending) {
				return pending;
			}

			const resolution = fetchWithCacheFallback(link).finally(() => {
				inFlightResolutions.delete(inFlightKey);
			});

			inFlightResolutions.set(inFlightKey, resolution);

			return resolution;
		},

		setLink: async (request) => {
			try {
				const account = accountStore.get(request.accountId);

				if (!account) {
					throw new InfisicalApiError(
						'infisical-account-not-found',
						'That Infisical account is no longer configured.',
					);
				}

				if (!request.projectId.trim() || !request.environmentSlug.trim()) {
					throw new InfisicalApiError(
						'infisical-invalid-request',
						'A link needs both a project and an environment.',
					);
				}

				const secretPath = request.secretPath?.trim() || '/';
				const recursive = request.recursive ?? false;

				linkStore.write({
					accountId: request.accountId,
					enabled: request.enabled ?? true,
					environmentSlug: request.environmentSlug.trim(),
					projectId: request.projectId.trim(),
					projectName: request.projectName?.trim() || null,
					recursive,
					scope: request.scope,
					scopeId: request.scopeId,
					secretPath,
					siteUrl: account.siteUrl,
				});

				await cache.clear({ scope: request.scope, scopeId: request.scopeId });

				if (request.scope === 'repository') {
					const repositoryPath = linkStore.readRepositoryPath(request.scopeId);

					if (repositoryPath) {
						writeInfisicalRepositoryConfig({
							block: {
								environmentSlug: request.environmentSlug.trim(),
								projectId: request.projectId.trim(),
								projectName: request.projectName?.trim() || null,
								recursive,
								secretPath,
								siteUrl: account.siteUrl,
							},
							repositoryPath,
						});
					}
				}

				return {
					failure: null,
					link: resolveLink(request.scope, request.scopeId),
				};
			} catch (error) {
				return { failure: toFailure(error), link: null };
			}
		},

		syncNow: async ({ scope, scopeId }) => {
			const link = resolveLink(scope, scopeId);

			if (!link) {
				return {
					failure: {
						code: 'infisical-not-linked',
						message: 'This scope is not linked to an Infisical project.',
						retryAfterSeconds: null,
					},
					keys: [],
					syncedAt: null,
				};
			}

			if (!link.accountId) {
				return {
					failure: {
						code: 'infisical-account-not-found',
						message:
							'No Infisical account on this machine matches the linked instance.',
						retryAfterSeconds: null,
					},
					keys: [],
					syncedAt: null,
				};
			}

			try {
				await cache.clear({ scope, scopeId });
				const secrets = await client.listSecrets({
					accountId: link.accountId,
					query: {
						environment: link.environmentSlug,
						projectId: link.projectId,
						recursive: link.recursive,
						secretPath: link.secretPath,
					},
				});
				const values = Object.fromEntries(
					secrets.map((secret) => [secret.key, secret.value]),
				);
				const entry = await cache.write({ scope, scopeId, values });

				linkStore.recordSync({ scope, scopeId, syncedAt: entry.fetchedAt });
				recordAccountOutcome(link.accountId, null);

				return {
					failure: null,
					keys: Object.keys(values).sort(),
					syncedAt: entry.fetchedAt,
				};
			} catch (error) {
				recordAccountOutcome(link.accountId, error);

				return { failure: toFailure(error), keys: [], syncedAt: null };
			}
		},

		testAccount: async ({ accountId }) => {
			try {
				await client.verify(accountId);
				recordAccountOutcome(accountId, null);

				const account = accountStore.get(accountId);

				return {
					account: account ? await toAccountSnapshot(account) : null,
					failure: null,
				};
			} catch (error) {
				recordAccountOutcome(accountId, error);

				const account = accountStore.get(accountId);

				return {
					account: account ? await toAccountSnapshot(account) : null,
					failure: toFailure(error),
				};
			}
		},
	};
}

/**
 * Orders an aggregated project list by account, then by project name, so the
 * picker groups every account's projects together in a stable order.
 * @param left - First project to compare.
 * @param right - Second project to compare.
 * @returns Negative, zero, or positive per the `Array#sort` contract.
 */
function compareProjects(
	left: InfisicalProjectSnapshot,
	right: InfisicalProjectSnapshot,
): number {
	return (
		left.accountLabel.localeCompare(right.accountLabel) ||
		left.name.localeCompare(right.name)
	);
}

/**
 * Normalises any thrown value into the typed failure envelope the renderer
 * localizes, so nothing throws across the IPC boundary.
 * @param error - Thrown value.
 * @returns The failure envelope.
 */
export function toFailure(error: unknown): InfisicalFailure {
	if (error instanceof InfisicalApiError) {
		return {
			code: error.code,
			message: error.message,
			retryAfterSeconds: error.retryAfterSeconds,
		};
	}

	return {
		code: 'infisical-unknown',
		message:
			error instanceof Error
				? error.message
				: 'The Infisical operation failed.',
		retryAfterSeconds: null,
	};
}
