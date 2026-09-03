import type {
	AddInfisicalAccountRequest,
	InfisicalAccountMutationResult,
	InfisicalAccountSnapshot,
	InfisicalAccountsResult,
	InfisicalFailure,
	InfisicalLinkOrigin,
	InfisicalLinkResult,
	InfisicalLinkScope,
	InfisicalLinkSnapshot,
	InfisicalProjectSnapshot,
	InfisicalProjectsResult,
	InfisicalSyncResult,
	SetInfisicalLinkRequest,
} from '../../shared/ipc/contracts/infisical';
import { hasRepositorySettingsFile } from '../config';
import { createInfisicalAccountMatcher } from './infisical-account-match.ts';
import type {
	InfisicalAccountRecord,
	InfisicalAccountStore,
} from './infisical-account-store.ts';
import { InfisicalApiError } from './infisical-api.ts';
import type { InfisicalCache } from './infisical-cache.ts';
import {
	type InfisicalCliConfig,
	readInfisicalCliConfig,
} from './infisical-cli-config.ts';
import type { InfisicalClient } from './infisical-client.ts';
import type { InfisicalLinkStore } from './infisical-link-store.ts';
import {
	type InfisicalRepositoryConfigBlock,
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
	const accountMatcher = createInfisicalAccountMatcher({
		accountStore,
		client,
	});

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
	 * Reads the two repository-side sources of a link: the `[infisical]` block
	 * Ensemblr commits, and the `.infisical.json` the Infisical CLI writes.
	 * Only a repository has either; a workspace link is an explicit per-machine
	 * override with nothing on disk behind it.
	 * @param scope - Link scope.
	 * @param scopeId - Repository or workspace id.
	 * @returns Both sources, each null when the repository declares none.
	 */
	function readRepositorySources(scope: InfisicalLinkScope, scopeId: string) {
		const repositoryPath =
			scope === 'repository' ? linkStore.readRepositoryPath(scopeId) : null;

		if (!repositoryPath) {
			return { committed: null, discovered: null };
		}

		return {
			committed: readInfisicalRepositoryConfig(repositoryPath),
			discovered: readInfisicalCliConfig(repositoryPath),
		};
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
		const { committed, discovered } = readRepositorySources(scope, scopeId);
		const ensemblrProjectId = row?.projectId || committed?.projectId || '';
		const fallback = ensemblrProjectId
			? null
			: discoveryFallback({ discovered, scope, scopeId });
		const projectId = ensemblrProjectId || fallback?.projectId || '';

		if (!projectId) {
			return null;
		}

		const siteUrl =
			row?.siteUrl ?? committed?.siteUrl ?? fallback?.siteUrl ?? null;
		const accountId = row?.accountId ?? accountMatcher.matchBySiteUrl(siteUrl);

		return {
			accountId,
			accountLabel: accountId
				? (accountStore.get(accountId)?.label ?? null)
				: null,
			enabled: row?.enabled ?? true,
			environmentSlug:
				row?.environmentSlug ||
				committed?.environmentSlug ||
				fallback?.environmentSlug ||
				'',
			lastSyncedAt: row?.lastSyncedAt ?? null,
			origin: resolveOrigin({ committed, hasRow: Boolean(row) }),
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
	 * Decides whether the CLI's `.infisical.json` gets to supply this link. A
	 * scope the user has unlinked forfeits it, or unlinking a repository that ran
	 * `infisical init` would never take.
	 * @param input - The discovered config and the scope it was read for.
	 * @returns The discovered config, or null when the scope has refused it.
	 */
	function discoveryFallback({
		discovered,
		scope,
		scopeId,
	}: {
		discovered: InfisicalCliConfig | null;
		scope: InfisicalLinkScope;
		scopeId: string;
	}): InfisicalCliConfig | null {
		return linkStore.isDiscoveryDismissed({ scope, scopeId })
			? null
			: discovered;
	}

	/**
	 * Reads every secret a link points at, as one `key -> value` map.
	 * @param link - The link naming the account, project, environment, and path.
	 * @returns The resolved values.
	 */
	async function readLinkValues(
		link: InfisicalLinkSnapshot & { accountId: string },
	): Promise<Record<string, string>> {
		const secrets = await client.listSecrets({
			accountId: link.accountId,
			query: {
				environment: link.environmentSlug,
				projectId: link.projectId,
				recursive: link.recursive,
				secretPath: link.secretPath,
			},
		});

		return Object.fromEntries(
			secrets.map((secret) => [secret.key, secret.value]),
		);
	}

	/**
	 * Fills in the account half of a link no instance URL resolved on its own, by
	 * asking which of the accounts on that instance reach the project. This is
	 * what lets a link discovered in a `.infisical.json` resolve without the user
	 * opening Settings, and it is the same check that confirms the identity has
	 * access. Reached whenever the link carries no account — including a
	 * committed link whose instance hosts none or several of them.
	 * @param link - The link whose account half may be missing.
	 * @returns The link, with its account filled in when one unambiguously matches.
	 */
	async function withMatchedAccount(
		link: InfisicalLinkSnapshot,
	): Promise<InfisicalLinkSnapshot> {
		if (link.accountId) {
			return link;
		}

		const accountId = await accountMatcher.matchByProjectId({
			projectId: link.projectId,
			siteUrl: link.siteUrl,
		});

		if (!accountId) {
			return link;
		}

		return {
			...link,
			accountId,
			accountLabel: accountStore.get(accountId)?.label ?? null,
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
			const values = await readLinkValues({
				...link,
				accountId: link.accountId,
			});

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
	 * Rewrites the repository's committed `[infisical]` block, reporting a
	 * failure rather than swallowing it: a config that could not be written is a
	 * link nobody who clones the repository will inherit, and the local half has
	 * already saved by the time this runs. Clearing is skipped only when the
	 * repository has no settings file at all — unlinking a project discovered in
	 * a `.infisical.json` must not create one. A file that exists but does not
	 * parse still goes through the writer, so the failure is reported.
	 * @param repositoryId - Repository whose committed config is rewritten.
	 * @param block - The block to commit, or null to clear it.
	 * @returns The failure that stopped the write, or null.
	 */
	function commitRepositoryBlock(
		repositoryId: string,
		block: InfisicalRepositoryConfigBlock | null,
	): InfisicalFailure | null {
		const repositoryPath = linkStore.readRepositoryPath(repositoryId);

		if (!repositoryPath) {
			return null;
		}

		if (!block && !hasRepositorySettingsFile(repositoryPath)) {
			return null;
		}

		const result = writeInfisicalRepositoryConfig({ block, repositoryPath });

		return result.ok
			? null
			: {
					code: 'infisical-config-write-failed',
					message: result.message,
					retryAfterSeconds: null,
				};
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

				accountMatcher.invalidate();

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
				linkStore.dismissDiscovery({ scope, scopeId });
				await cache.clear({ scope, scopeId });

				return {
					failure:
						scope === 'repository'
							? commitRepositoryBlock(scopeId, null)
							: null,
					link: null,
				};
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
				accountMatcher.invalidate();

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

			const resolution = withMatchedAccount(link)
				.then(fetchWithCacheFallback)
				.finally(() => {
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

				linkStore.restoreDiscovery({
					scope: request.scope,
					scopeId: request.scopeId,
				});
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

				return {
					failure:
						request.scope === 'repository'
							? commitRepositoryBlock(request.scopeId, {
									environmentSlug: request.environmentSlug.trim(),
									projectId: request.projectId.trim(),
									projectName: request.projectName?.trim() || null,
									recursive,
									secretPath,
									siteUrl: account.siteUrl,
								})
							: null,
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
				const values = await readLinkValues({
					...link,
					accountId: link.accountId,
				});
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
				accountMatcher.invalidate();

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
 * Names where a link's project half came from. A saved row outranks the
 * committed block, which outranks the CLI's `.infisical.json` — the same order
 * the fields themselves resolve in.
 * @param sources - Whether a row was saved, and the committed block behind the link.
 * @returns The origin to report across the bridge.
 */
function resolveOrigin({
	committed,
	hasRow,
}: {
	committed: InfisicalRepositoryConfigBlock | null;
	hasRow: boolean;
}): InfisicalLinkOrigin {
	if (hasRow) {
		return 'local';
	}

	return committed ? 'repository-config' : 'infisical-cli';
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
