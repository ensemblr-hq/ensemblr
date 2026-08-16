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
 * @param options - Client factory, account lister, database, and freshness tuning.
 * @returns A fresh {@link LinearService}.
 */
export function createLinearService({
	clientFactory,
	databaseService,
	listAccounts,
	maxSyncPages = DEFAULT_MAX_SYNC_PAGES,
	now = () => new Date(),
	staleAfterMs = DEFAULT_STALE_AFTER_MS,
}: CreateLinearServiceOptions): LinearService {
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
	 * Resolve the accounts an operation reads from, refusing when Linear has no
	 * connected account at all or when a named one is unknown.
	 * @param accountId - Account to narrow to, or undefined to read every account.
	 * @returns The accounts to operate on, each with its own client.
	 */
	async function resolveTargets(accountId?: string): Promise<AccountTarget[]> {
		const accounts = await listAccounts();

		if (accounts.length === 0) {
			throw new LinearServiceError(
				'not-connected',
				'No Linear account is connected. Connect one in Settings → Integrations.',
			);
		}

		const selected = accountId
			? accounts.filter((account) => account.id === accountId)
			: accounts;

		if (selected.length === 0) {
			throw new LinearServiceError(
				'invalid-request',
				`No connected Linear account has the id "${accountId}".`,
			);
		}

		return selected.map((account) => ({
			account,
			client: clientFactory(account.id),
		}));
	}

	/**
	 * Resolve the single account a write belongs to, in the order ADR 0052 fixes:
	 * the account named, the account owning the entity, the caller's fallback,
	 * then the only connected account. The fallback sits *after* the entity so a
	 * caller-supplied default can never mask an entity that names another account,
	 * nor pre-empt the refusal an ambiguous identifier is supposed to raise.
	 * @param options - The named account, the entity lookup, the caller's fallback, and how to describe the entity.
	 * @returns The resolved account with its client.
	 */
	async function resolveTarget(options: {
		accountId: string | undefined;
		describe: string;
		fallbackAccountId?: string | undefined;
		locate: () => string | null;
	}): Promise<AccountTarget> {
		const { accountId, describe, fallbackAccountId, locate } = options;

		if (accountId) {
			const [target] = await resolveTargets(accountId);

			if (!target) {
				throw new LinearServiceError(
					'invalid-request',
					`No connected Linear account has the id "${accountId}".`,
				);
			}

			return target;
		}

		const located = locate() ?? fallbackAccountId ?? null;

		if (located) {
			return resolveTarget({
				accountId: located,
				describe,
				locate: () => null,
			});
		}

		const targets = await resolveTargets();

		if (targets.length === 1 && targets[0]) {
			return targets[0];
		}

		throw new LinearServiceError(
			'invalid-request',
			`${describe} is not in any connected account's cache, so the account could not be resolved. Name an accountId.`,
		);
	}

	/**
	 * Find the account owning an issue, by cached id first and then by identifier
	 * across accounts. `ENG-1` is unique inside an organization but not between
	 * two of them, so a match in more than one account is refused rather than
	 * guessed.
	 * @param store - Store to search.
	 * @param accounts - Accounts to consider.
	 * @param issueId - Issue UUID or human identifier.
	 * @returns The owning account id, or null when nothing matches.
	 */
	function locateIssueAccount(
		store: LinearStore,
		accounts: LinearAccountSnapshot[],
		issueId: string,
	): string | null {
		const cached = store.getIssue(issueId);

		if (cached) {
			return cached.accountId;
		}

		const matches = accounts.filter((account) =>
			store.getIssueByIdentifier(account.id, issueId),
		);

		if (matches.length > 1) {
			throw new LinearServiceError(
				'invalid-request',
				`"${issueId}" matches an issue in ${matches.length} connected Linear accounts (${matches
					.map((account) => account.organizationName ?? account.id)
					.join(', ')}). Name an accountId.`,
			);
		}

		return matches[0]?.id ?? null;
	}

	/**
	 * Decide whether a cached timestamp has aged past the staleness window.
	 * @param syncedAt - ISO timestamp of the last sync, if any.
	 * @returns True when the value is missing or older than the stale threshold.
	 */
	function isStale(syncedAt: string | null | undefined): boolean {
		if (!syncedAt) {
			return true;
		}

		return now().getTime() - Date.parse(syncedAt) > staleAfterMs;
	}

	/**
	 * Sync up to `maxSyncPages` of one account's issues into the store, recording
	 * sync-state transitions and re-throwing on failure.
	 * @param store - Store to upsert issues and sync state into.
	 * @param target - Account and client to sync.
	 * @param teamId - Optional team to scope the sync to.
	 */
	async function syncIssues(
		store: LinearStore,
		target: AccountTarget,
		teamId?: string,
	): Promise<void> {
		const accountId = target.account.id;
		const scope = teamId ? `issues:${teamId}` : 'issues';
		let cursor: string | null = null;

		store.setSyncState({
			accountId,
			cursor: null,
			errorCode: null,
			scope,
			status: 'syncing',
			syncedAt: store.getSyncState(accountId, scope)?.syncedAt ?? null,
		});

		try {
			for (let page = 0; page < maxSyncPages; page += 1) {
				const result = await target.client.listIssues({
					after: cursor,
					...(teamId ? { teamId } : {}),
				});
				store.upsertIssues(accountId, result.nodes.map(issueDataToUpsert));
				cursor = result.endCursor;

				if (!result.hasNextPage) {
					break;
				}
			}

			store.setSyncState({
				accountId,
				cursor,
				errorCode: null,
				scope,
				status: 'idle',
				syncedAt: now().toISOString(),
			});
		} catch (error) {
			store.setSyncState({
				accountId,
				cursor: null,
				errorCode: error instanceof LinearServiceError ? error.code : 'network',
				scope,
				status: 'error',
				syncedAt: store.getSyncState(accountId, scope)?.syncedAt ?? null,
			});
			throw error;
		}
	}

	/**
	 * Sync all metadata kinds (teams, projects, states, labels, cycles, users)
	 * for one account into the store, recording sync-state transitions.
	 * @param store - Store to upsert resources and sync state into.
	 * @param target - Account and client to sync.
	 */
	async function syncMetadata(
		store: LinearStore,
		target: AccountTarget,
	): Promise<void> {
		const accountId = target.account.id;

		store.setSyncState({
			accountId,
			cursor: null,
			errorCode: null,
			scope: 'metadata',
			status: 'syncing',
			syncedAt: store.getSyncState(accountId, 'metadata')?.syncedAt ?? null,
		});

		try {
			for (const kind of METADATA_KINDS) {
				let cursor: string | null = null;

				for (let page = 0; page < maxSyncPages; page += 1) {
					const result = await target.client.listMetadata(kind, cursor);
					store.upsertResources(
						accountId,
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

			store.setSyncState({
				accountId,
				cursor: null,
				errorCode: null,
				scope: 'metadata',
				status: 'idle',
				syncedAt: now().toISOString(),
			});
		} catch (error) {
			store.setSyncState({
				accountId,
				cursor: null,
				errorCode: error instanceof LinearServiceError ? error.code : 'network',
				scope: 'metadata',
				status: 'error',
				syncedAt: store.getSyncState(accountId, 'metadata')?.syncedAt ?? null,
			});
			throw error;
		}
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
	 * Syncs every stale account concurrently and collects the ones that failed.
	 *
	 * Concurrent rather than serial because each account is a different Linear
	 * organization behind its own token and therefore its own rate-limit bucket,
	 * so a merged read costs the slowest account rather than the sum of them. The
	 * store writes underneath are synchronous `node:sqlite` statements, which
	 * cannot interleave across an await.
	 * @param targets - Accounts the read spans.
	 * @param isStaleFor - Whether one account's cache needs a remote sync.
	 * @param sync - Performs one account's sync.
	 * @returns The failures, one per account that could not be read.
	 */
	async function syncEachAccount(
		targets: AccountTarget[],
		isStaleFor: (target: AccountTarget) => boolean,
		sync: (target: AccountTarget) => Promise<void>,
	): Promise<LinearAccountFailure[]> {
		const outcomes = await Promise.all(
			targets.map(async (target) => {
				if (!isStaleFor(target)) {
					return null;
				}

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

				if (cached && !refresh && !isStale(cached.syncedAt)) {
					return {
						comments: store.listComments(id).map(commentRecordToWire),
						issue: issueRecordToWire(cached, names),
						source: 'cache',
						status: 'ok',
					};
				}

				try {
					const result = await target.client.getIssue(id);
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
				const accountFailures = await syncEachAccount(
					targets,
					(target) =>
						refresh ||
						isStale(
							store.getSyncState(target.account.id, 'metadata')?.syncedAt,
						),
					(target) => syncMetadata(store, target),
				);

				return {
					accountFailures,
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
				const scope = teamId ? `issues:${teamId}` : 'issues';
				let source: 'cache' | 'remote' = 'cache';
				const accountFailures = await syncEachAccount(
					targets,
					(target) =>
						refresh ||
						isStale(store.getSyncState(target.account.id, scope)?.syncedAt),
					async (target) => {
						await syncIssues(store, target, teamId);
						source = 'remote';
					},
				);

				const names = organizationNames(targets);
				const issues = store
					.listIssues({
						...(accountId ? { accountId } : {}),
						...(query ? { query } : {}),
						...(teamId ? { teamId } : {}),
					})
					.map((record) => issueRecordToWire(record, names));

				return { accountFailures, issues, source, status: 'ok' };
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
