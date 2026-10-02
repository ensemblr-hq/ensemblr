import type { DatabaseSync } from 'node:sqlite';

import type {
	CreateLinearCommentRequest,
	CreateLinearCommentResult,
	CreateLinearIssueRequest,
	GetLinearIssueRequest,
	GetLinearIssueResult,
	GetLinearMetadataRequest,
	GetLinearMetadataResult,
	LinearAccountFailure,
	LinearAccountSnapshot,
	LinearMetadataWire,
	LinearResourceWire,
	ListLinearIssuesRequest,
	ListLinearIssuesResult,
	MutateLinearIssueResult,
	UpdateLinearIssueRequest,
} from '../../shared/ipc/contracts/linear';
import type { EnsemblrDatabaseService } from '../storage';
import { createLinearAccountResolver } from './linear-account-resolution.ts';
import {
	type LinearClient,
	type LinearIssueData,
	LinearServiceError,
} from './linear-client.ts';
import {
	createLinearStore,
	type LinearResourceKind,
	type LinearStore,
} from './linear-store.ts';
import { createLinearSyncCoordinator } from './linear-sync.ts';
import {
	type AccountTarget,
	accountFailure,
	commentDataToUpsert,
	commentDataToWire,
	commentRecordToWire,
	emptyMetadata,
	issueDataToUpsert,
	issueDataToWire,
	issueRecordToWire,
	organizationNames,
	resourceRecordToWire,
	toFailure,
} from './linear-wire.ts';

const DEFAULT_STALE_AFTER_MS = 5 * 60 * 1000;
const DEFAULT_MAX_SYNC_PAGES = 4;
const METADATA_KINDS: readonly LinearResourceKind[] = [
	'team',
	'project',
	'state',
	'label',
	'cycle',
	'user',
];

/**
 * A sync scope: the key its freshness is recorded under, and whether that
 * record belongs in `linear_sync_state`. A search scope's key is the text the
 * user typed, so it is not durable — the table has no eviction and would
 * otherwise grow a row for every term anyone ever searched.
 */
interface SyncScope {
	durable: boolean;
	key: string;
}

/** The scope each account's metadata sync is recorded under. */
const METADATA_SCOPE: SyncScope = { durable: true, key: 'metadata' };

/** Public surface of the Linear issue data service. */
export interface LinearService {
	createComment: (
		request: CreateLinearCommentRequest,
	) => Promise<CreateLinearCommentResult>;
	createIssue: (
		request: CreateLinearIssueRequest,
	) => Promise<MutateLinearIssueResult>;
	getIssue: (request: GetLinearIssueRequest) => Promise<GetLinearIssueResult>;
	getMetadata: (
		request?: GetLinearMetadataRequest,
	) => Promise<GetLinearMetadataResult>;
	listIssues: (
		request?: ListLinearIssuesRequest,
	) => Promise<ListLinearIssuesResult>;
	updateIssue: (
		request: UpdateLinearIssueRequest,
	) => Promise<MutateLinearIssueResult>;
}

/** Options for {@link createLinearService}. */
export interface CreateLinearServiceOptions {
	clientFactory: (accountId: string) => LinearClient;
	databaseService: EnsemblrDatabaseService;
	failureCooldownMs?: number;
	listAccounts: () => Promise<LinearAccountSnapshot[]>;
	maxSyncPages?: number;
	now?: () => Date;
	staleAfterMs?: number;
}

/**
 * Builds the Linear data service: cache-first reads backed by the SQLite store,
 * bounded remote syncs through per-account GraphQL clients, and mutations that
 * refresh the cache from Linear's response (Linear stays the source of truth).
 *
 * Several accounts may be connected at once. Reads with no `accountId` fan out
 * across every account and merge, reporting per-account failures alongside the
 * partial result so one rate-limited organization narrows the list rather than
 * blanking it. Writes resolve their account from the entity they name — the
 * cached issue, or the target team's owning account — so callers rarely have to
 * supply one.
 *
 * A read never blocks on the network when it has something to show: a stale
 * cache is served straight away and flagged `syncing` while the refresh runs
 * behind it. Only a cold cache waits.
 * @param options - Client factory, account lister, database, and freshness tuning.
 * @returns A fresh {@link LinearService}.
 */
export function createLinearService({
	clientFactory,
	databaseService,
	failureCooldownMs,
	listAccounts,
	maxSyncPages = DEFAULT_MAX_SYNC_PAGES,
	now = () => new Date(),
	staleAfterMs = DEFAULT_STALE_AFTER_MS,
}: CreateLinearServiceOptions): LinearService {
	const { locateIssueAccount, resolveTarget, resolveTargets } =
		createLinearAccountResolver({ clientFactory, listAccounts });
	const coordinator = createLinearSyncCoordinator({
		...(failureCooldownMs === undefined ? {} : { failureCooldownMs }),
		now,
		staleAfterMs,
	});
	/**
	 * Open a Linear store bound to the current database connection, throwing when
	 * the Ensemblr database is not open.
	 * @returns A store for the open database.
	 */
	function getStore(): LinearStore {
		const database: DatabaseSync | undefined =
			databaseService.getConnection()?.database;

		if (!database) {
			throw new LinearServiceError(
				'network',
				'The Ensemblr database is not open.',
			);
		}

		return createLinearStore({ database, now });
	}

	/**
	 * The sync scope a browse read belongs to. A search is its own scope because
	 * it is answered by a different Linear query than the paged list, and caching
	 * the two under one key would let a narrow search mark the whole list fresh.
	 * Its key is the search text, which is why it is not durable.
	 * @param term - Trimmed search text, empty when browsing.
	 * @param teamId - Team the read is narrowed to, if any.
	 * @returns The scope this read syncs under.
	 */
	function issueScope(term: string, teamId?: string): SyncScope {
		if (term) {
			return { durable: false, key: `search:${term}` };
		}

		return { durable: true, key: teamId ? `issues:${teamId}` : 'issues' };
	}

	/**
	 * The store a scope records its freshness in, which is none for a transient
	 * scope.
	 * @param store - Store backing the current database connection.
	 * @param scope - Scope being synced.
	 * @returns The store to persist sync state in, or undefined.
	 */
	function scopeStore(
		store: LinearStore,
		scope: SyncScope,
	): LinearStore | undefined {
		return scope.durable ? store : undefined;
	}

	/**
	 * Sync up to `maxSyncPages` of one account's issues into the store.
	 * @param store - Store to upsert issues and sync state into.
	 * @param target - Account and client to sync.
	 * @param scope - Sync scope to record the attempt under.
	 * @param teamId - Optional team to scope the sync to.
	 */
	function syncIssues(
		store: LinearStore,
		target: AccountTarget,
		scope: SyncScope,
		teamId?: string,
	): Promise<void> {
		return coordinator.runScopeSync({
			accountId: target.account.id,
			run: async () => {
				let cursor: string | null = null;

				for (let page = 0; page < maxSyncPages; page += 1) {
					const result = await target.client.listIssues({
						after: cursor,
						...(teamId ? { teamId } : {}),
					});
					store.upsertIssues(
						target.account.id,
						result.nodes.map(issueDataToUpsert),
					);
					cursor = result.endCursor;

					if (!result.hasNextPage) {
						break;
					}
				}

				return cursor;
			},
			scope: scope.key,
			store: scopeStore(store, scope),
		});
	}

	/**
	 * Search one account's issues on Linear and cache the hits, so a search reaches
	 * past the pages the browse sync happened to pull rather than filtering them.
	 * @param store - Store to upsert matched issues into.
	 * @param target - Account and client to search.
	 * @param term - Trimmed search text.
	 * @param scope - Sync scope to record the attempt under.
	 */
	function syncSearch(
		store: LinearStore,
		target: AccountTarget,
		term: string,
		scope: SyncScope,
	): Promise<void> {
		return coordinator.runScopeSync({
			accountId: target.account.id,
			run: async () => {
				const result = await target.client.searchIssues(term);
				store.upsertIssues(
					target.account.id,
					result.nodes.map(issueDataToUpsert),
				);

				return null;
			},
			scope: scope.key,
			store: scopeStore(store, scope),
		});
	}

	/**
	 * Sync one metadata kind's pages for an account into the store.
	 * @param store - Store to upsert resources into.
	 * @param target - Account and client to sync.
	 * @param kind - Resource kind to pull.
	 */
	async function syncMetadataKind(
		store: LinearStore,
		target: AccountTarget,
		kind: LinearResourceKind,
	): Promise<void> {
		let cursor: string | null = null;

		for (let page = 0; page < maxSyncPages; page += 1) {
			const result = await target.client.listMetadata(kind, cursor);
			store.upsertResources(
				target.account.id,
				result.nodes.map((node) => ({
					data: node.data,
					id: node.id,
					kind,
					name: node.name,
					teamId: node.teamId,
				})),
			);
			cursor = result.endCursor;

			if (!result.hasNextPage) {
				break;
			}
		}
	}

	/**
	 * Sync all metadata kinds (teams, projects, states, labels, cycles, users) for
	 * one account. The kinds run concurrently: they are six independent queries
	 * against one rate-limit bucket, and running them in series made the first
	 * metadata read of every freshness window cost the sum of all six.
	 * @param store - Store to upsert resources and sync state into.
	 * @param target - Account and client to sync.
	 */
	function syncMetadata(
		store: LinearStore,
		target: AccountTarget,
	): Promise<void> {
		return coordinator.runScopeSync({
			accountId: target.account.id,
			run: async () => {
				await Promise.all(
					METADATA_KINDS.map((kind) => syncMetadataKind(store, target, kind)),
				);

				return null;
			},
			scope: METADATA_SCOPE.key,
			store: scopeStore(store, METADATA_SCOPE),
		});
	}

	/**
	 * Read cached metadata across the given accounts into the wire shape. The
	 * reported `syncedAt` is the oldest account's, so the freshness the UI claims
	 * is one no account falls short of.
	 * @param store - Store to read cached resources from.
	 * @param targets - Accounts whose metadata to read.
	 * @returns The merged metadata plus its effective last-synced timestamp.
	 */
	function readMetadata(
		store: LinearStore,
		targets: AccountTarget[],
	): LinearMetadataWire {
		const names = organizationNames(targets);
		/**
		 * Read one resource kind across every target account.
		 * @param kind - Resource kind to read.
		 * @returns The merged wire resources for that kind.
		 */
		const read = (kind: LinearResourceKind): LinearResourceWire[] =>
			targets.flatMap((target) =>
				store
					.listResources(kind, { accountId: target.account.id })
					.map((record) => resourceRecordToWire(record, names)),
			);

		return {
			cycles: read('cycle'),
			labels: read('label'),
			projects: read('project'),
			states: read('state'),
			syncedAt: oldestSyncedAt(store, targets),
			teams: read('team'),
			users: read('user'),
		};
	}

	/**
	 * Reduce every target account's metadata sync time to the oldest one.
	 * @param store - Store holding the sync state.
	 * @param targets - Accounts to consider.
	 * @returns The oldest timestamp, or null when any account has never synced.
	 */
	function oldestSyncedAt(
		store: LinearStore,
		targets: AccountTarget[],
	): string | null {
		const stamps = targets.map(
			(target) =>
				store.getSyncState(target.account.id, 'metadata')?.syncedAt ?? null,
		);

		return stamps.includes(null)
			? null
			: (stamps
					.filter((stamp) => stamp !== null)
					.sort()
					.at(0) ?? null);
	}

	/**
	 * The accounts whose cache for one scope has to be refreshed before it is read.
	 * @param store - Store holding the sync state.
	 * @param targets - Accounts the read spans.
	 * @param scope - Sync scope being read.
	 * @param refresh - Whether the caller demanded a bypass of every freshness rule.
	 * @returns The subset needing a remote sync.
	 */
	function staleTargets(
		store: LinearStore,
		targets: AccountTarget[],
		scope: SyncScope,
		refresh: boolean,
	): AccountTarget[] {
		return targets.filter((target) =>
			coordinator.needsSync({
				accountId: target.account.id,
				refresh,
				scope: scope.key,
				store: scopeStore(store, scope),
			}),
		);
	}

	/**
	 * The failures still standing against a scope, so an answer served from cache
	 * says why it is not newer instead of looking merely quiet. An account whose
	 * last attempt failed keeps reporting it until one succeeds.
	 * @param targets - Accounts the read spans.
	 * @param scope - Sync scope being read.
	 * @returns The failures, one per account with an unresolved one.
	 */
	function recordedFailures(
		targets: AccountTarget[],
		scope: SyncScope,
	): LinearAccountFailure[] {
		return targets.flatMap((target) => {
			const error = coordinator.lastFailure(target.account.id, scope.key);

			return error === undefined ? [] : [accountFailure(target, error)];
		});
	}

	/**
	 * Syncs the given accounts concurrently and collects the ones that failed.
	 *
	 * Concurrent rather than serial because each account is a different Linear
	 * organization behind its own token and therefore its own rate-limit bucket,
	 * so a merged read costs the slowest account rather than the sum of them. The
	 * store writes underneath are synchronous `node:sqlite` statements, which
	 * cannot interleave across an await.
	 * @param targets - Accounts to sync.
	 * @param sync - Performs one account's sync.
	 * @returns The failures, one per account that could not be read.
	 */
	async function syncEachAccount(
		targets: AccountTarget[],
		sync: (target: AccountTarget) => Promise<void>,
	): Promise<LinearAccountFailure[]> {
		const outcomes = await Promise.all(
			targets.map(async (target) => {
				try {
					await sync(target);
					return null;
				} catch (error) {
					return accountFailure(target, error);
				}
			}),
		);

		return outcomes.filter((outcome) => outcome !== null);
	}

	/**
	 * Syncs the pending accounts and reports every failure the answer has to
	 * disclose. `pending` has already had the accounts a cooldown holds back
	 * filtered out of it, and those accounts are exactly the ones whose last
	 * attempt failed — so reporting only what this round raised would drop a
	 * standing failure the moment some other account happened to need a sync.
	 * @param targets - Accounts the read spans.
	 * @param pending - The subset being synced now.
	 * @param scope - Sync scope being read.
	 * @param sync - Performs one account's sync.
	 * @returns The failures this round raised, plus the ones still standing.
	 */
	async function syncPending(
		targets: AccountTarget[],
		pending: AccountTarget[],
		scope: SyncScope,
		sync: (target: AccountTarget) => Promise<void>,
	): Promise<LinearAccountFailure[]> {
		const syncing = new Set(pending);
		const heldBack = targets.filter((target) => !syncing.has(target));

		return [
			...recordedFailures(heldBack, scope),
			...(await syncEachAccount(pending, sync)),
		];
	}

	/**
	 * Starts a refresh behind an answer already being returned from cache. The
	 * failure is not dropped: the coordinator records it on the scope's sync-state
	 * row and holds the scope back for a cooldown, and the next read reports it.
	 * @param targets - Accounts to refresh.
	 * @param sync - Performs one account's sync.
	 */
	function syncInBackground(
		targets: AccountTarget[],
		sync: (target: AccountTarget) => Promise<void>,
	): void {
		for (const target of targets) {
			void sync(target).catch(() => undefined);
		}
	}

	/**
	 * Refreshes the cache from a mutation's own response and returns the wire
	 * result, so a create and an update converge on Linear's answer rather than
	 * on what the caller asked for.
	 * @param store - Store to upsert the returned issue into.
	 * @param target - Account the mutation ran against.
	 * @param issue - Issue as Linear reported it after the write.
	 * @returns The successful mutation result.
	 */
	function persistMutation(
		store: LinearStore,
		target: AccountTarget,
		issue: LinearIssueData,
	): MutateLinearIssueResult {
		store.upsertIssues(target.account.id, [issueDataToUpsert(issue)]);

		return {
			issue: issueDataToWire(issue, target.account, now().toISOString()),
			status: 'ok',
		};
	}

	return {
		createComment: async (request) => {
			try {
				const store = getStore();
				const accounts = await listAccounts();
				const target = await resolveTarget({
					accountId: request.accountId,
					describe: `Issue "${request.issueId}"`,
					fallbackAccountId: request.fallbackAccountId,
					locate: () => locateIssueAccount(store, accounts, request.issueId),
				});
				const comment = await target.client.createComment({
					body: request.body,
					issueId: request.issueId,
				});
				store.upsertComments(target.account.id, request.issueId, [
					commentDataToUpsert(request.issueId, comment),
				]);

				return { comment: commentDataToWire(comment), status: 'ok' };
			} catch (error) {
				return { failure: toFailure(error), status: 'error' };
			}
		},

		createIssue: async ({
			accountId,
			fallbackAccountId,
			teamId,
			...fields
		}) => {
			try {
				const store = getStore();
				const target = await resolveTarget({
					accountId,
					describe: `Team "${teamId}"`,
					fallbackAccountId,
					locate: () =>
						store.listResources('team').find((team) => team.id === teamId)
							?.accountId ?? null,
				});

				return persistMutation(
					store,
					target,
					await target.client.createIssue({ ...fields, teamId }),
				);
			} catch (error) {
				return { failure: toFailure(error), status: 'error' };
			}
		},

		getIssue: async ({ accountId, fallbackAccountId, id, refresh = false }) => {
			try {
				const store = getStore();
				const accounts = await listAccounts();
				const target = await resolveTarget({
					accountId,
					describe: `Issue "${id}"`,
					fallbackAccountId,
					locate: () => locateIssueAccount(store, accounts, id),
				});
				const names = organizationNames([target]);
				const cached = store.getIssue(id);

				if (
					cached &&
					!refresh &&
					!coordinator.isStale(cached.syncedAt) &&
					!coordinator.isStale(cached.commentsSyncedAt)
				) {
					return {
						comments: store.listComments(id).map(commentRecordToWire),
						issue: issueRecordToWire(cached, names),
						source: 'cache',
						status: 'ok',
					};
				}

				try {
					const result = await coordinator.share(
						`issue:${target.account.id}:${id}`,
						() => target.client.getIssue(id),
					);
					store.upsertIssues(target.account.id, [
						issueDataToUpsert(result.issue),
					]);
					store.upsertComments(
						target.account.id,
						result.issue.id,
						result.comments.nodes.map((comment) =>
							commentDataToUpsert(result.issue.id, comment),
						),
					);
					store.markCommentsSynced(result.issue.id);

					return {
						comments: result.comments.nodes.map(commentDataToWire),
						issue: issueDataToWire(
							result.issue,
							target.account,
							now().toISOString(),
						),
						source: 'remote',
						status: 'ok',
					};
				} catch (error) {
					if (cached) {
						return {
							comments: store.listComments(id).map(commentRecordToWire),
							issue: issueRecordToWire(cached, names),
							source: 'cache',
							status: 'ok',
						};
					}
					throw error;
				}
			} catch (error) {
				return { failure: toFailure(error), status: 'error' };
			}
		},

		getMetadata: async ({ accountId, refresh = false } = {}) => {
			try {
				const store = getStore();
				const targets = await resolveTargets(accountId);
				const pending = staleTargets(store, targets, METADATA_SCOPE, refresh);
				const sync = (target: AccountTarget) => syncMetadata(store, target);

				if (pending.length === 0) {
					return {
						accountFailures: recordedFailures(targets, METADATA_SCOPE),
						metadata: readMetadata(store, targets),
						status: 'ok',
					};
				}

				const cachedMetadata = readMetadata(store, targets);

				if (!refresh && cachedMetadata.teams.length > 0) {
					syncInBackground(pending, sync);

					return {
						accountFailures: recordedFailures(targets, METADATA_SCOPE),
						metadata: cachedMetadata,
						status: 'ok',
						syncing: true,
					};
				}

				return {
					accountFailures: await syncPending(
						targets,
						pending,
						METADATA_SCOPE,
						sync,
					),
					metadata: readMetadata(store, targets),
					status: 'ok',
				};
			} catch (error) {
				return {
					accountFailures: [],
					failure: toFailure(error),
					metadata: emptyMetadata(),
					status: 'error',
				};
			}
		},

		listIssues: async ({ accountId, query, refresh = false, teamId } = {}) => {
			try {
				const store = getStore();
				const targets = await resolveTargets(accountId);
				const term = query?.trim() ?? '';
				const scope = issueScope(term, teamId);
				const names = organizationNames(targets);
				const readCached = () =>
					store
						.listIssues({
							...(accountId ? { accountId } : {}),
							...(term ? { query: term } : {}),
							...(teamId ? { teamId } : {}),
						})
						.map((record) => issueRecordToWire(record, names));
				const pending = staleTargets(store, targets, scope, refresh);

				if (pending.length === 0) {
					return {
						accountFailures: recordedFailures(targets, scope),
						issues: readCached(),
						source: 'cache',
						status: 'ok',
					};
				}

				const sync = (target: AccountTarget) =>
					term
						? syncSearch(store, target, term, scope)
						: syncIssues(store, target, scope, teamId);
				const cachedIssues = readCached();

				if (!refresh && cachedIssues.length > 0) {
					syncInBackground(pending, sync);

					return {
						accountFailures: recordedFailures(targets, scope),
						issues: cachedIssues,
						source: 'cache',
						status: 'ok',
						syncing: true,
					};
				}

				return {
					accountFailures: await syncPending(targets, pending, scope, sync),
					issues: readCached(),
					source: 'remote',
					status: 'ok',
				};
			} catch (error) {
				return {
					accountFailures: [],
					failure: toFailure(error),
					issues: [],
					status: 'error',
				};
			}
		},

		updateIssue: async ({ accountId, fallbackAccountId, id, input }) => {
			try {
				const store = getStore();
				const accounts = await listAccounts();
				const target = await resolveTarget({
					accountId,
					describe: `Issue "${id}"`,
					fallbackAccountId,
					locate: () => locateIssueAccount(store, accounts, id),
				});
				return persistMutation(
					store,
					target,
					await target.client.updateIssue(id, input),
				);
			} catch (error) {
				return { failure: toFailure(error), status: 'error' };
			}
		},
	};
}
