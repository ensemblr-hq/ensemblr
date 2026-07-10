import type { DatabaseSync } from 'node:sqlite';

import type {
	CreateLinearCommentRequest,
	CreateLinearCommentResult,
	CreateLinearIssueRequest,
	GetLinearIssueRequest,
	GetLinearIssueResult,
	GetLinearMetadataRequest,
	GetLinearMetadataResult,
	LinearCommentWire,
	LinearIssueWire,
	LinearMetadataWire,
	LinearResourceWire,
	LinearServiceFailure,
	ListLinearIssuesRequest,
	ListLinearIssuesResult,
	MutateLinearIssueResult,
	UpdateLinearIssueRequest,
} from '../../shared/ipc/contracts/linear';
import type { EnsemblrDatabaseService } from '../storage/database';
import {
	type LinearClient,
	type LinearCommentData,
	type LinearIssueData,
	LinearServiceError,
} from './linear-client.ts';
import {
	createLinearStore,
	type LinearCommentRecord,
	type LinearIssueRecord,
	type LinearIssueUpsert,
	type LinearResourceKind,
	type LinearResourceRecord,
	type LinearStore,
} from './linear-store.ts';

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
	client: LinearClient;
	databaseService: EnsemblrDatabaseService;
	maxSyncPages?: number;
	now?: () => Date;
	staleAfterMs?: number;
}

/**
 * Builds the Linear data service: cache-first reads backed by the SQLite
 * store, bounded remote syncs through the GraphQL client, and mutations that
 * refresh the cache from Linear's response (Linear stays the source of truth).
 * @param options - Client, database, and freshness tuning.
 * @returns A fresh {@link LinearService}.
 */
export function createLinearService({
	client,
	databaseService,
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
	 * Sync up to `maxSyncPages` of issues from Linear into the store, recording
	 * sync-state transitions and re-throwing on failure.
	 * @param store - Store to upsert issues and sync state into.
	 * @param teamId - Optional team to scope the sync to.
	 */
	async function syncIssues(
		store: LinearStore,
		teamId?: string,
	): Promise<void> {
		const scope = teamId ? `issues:${teamId}` : 'issues';
		let cursor: string | null = null;

		store.setSyncState({
			cursor: null,
			errorCode: null,
			scope,
			status: 'syncing',
			syncedAt: store.getSyncState(scope)?.syncedAt ?? null,
		});

		try {
			for (let page = 0; page < maxSyncPages; page += 1) {
				const result = await client.listIssues({
					after: cursor,
					...(teamId ? { teamId } : {}),
				});
				store.upsertIssues(result.nodes.map(issueDataToUpsert));
				cursor = result.endCursor;

				if (!result.hasNextPage) {
					break;
				}
			}

			store.setSyncState({
				cursor,
				errorCode: null,
				scope,
				status: 'idle',
				syncedAt: now().toISOString(),
			});
		} catch (error) {
			store.setSyncState({
				cursor: null,
				errorCode: error instanceof LinearServiceError ? error.code : 'network',
				scope,
				status: 'error',
				syncedAt: store.getSyncState(scope)?.syncedAt ?? null,
			});
			throw error;
		}
	}

	/**
	 * Sync all metadata kinds (teams, projects, states, labels, cycles, users)
	 * from Linear into the store, recording sync-state transitions.
	 * @param store - Store to upsert resources and sync state into.
	 */
	async function syncMetadata(store: LinearStore): Promise<void> {
		store.setSyncState({
			cursor: null,
			errorCode: null,
			scope: 'metadata',
			status: 'syncing',
			syncedAt: store.getSyncState('metadata')?.syncedAt ?? null,
		});

		try {
			for (const kind of METADATA_KINDS) {
				let cursor: string | null = null;

				for (let page = 0; page < maxSyncPages; page += 1) {
					const result = await client.listMetadata(kind, cursor);
					store.upsertResources(
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
				cursor: null,
				errorCode: null,
				scope: 'metadata',
				status: 'idle',
				syncedAt: now().toISOString(),
			});
		} catch (error) {
			store.setSyncState({
				cursor: null,
				errorCode: error instanceof LinearServiceError ? error.code : 'network',
				scope: 'metadata',
				status: 'error',
				syncedAt: store.getSyncState('metadata')?.syncedAt ?? null,
			});
			throw error;
		}
	}

	/**
	 * Read all cached metadata resources into the wire shape.
	 * @param store - Store to read cached resources from.
	 * @returns The cached metadata plus its last-synced timestamp.
	 */
	function readMetadata(store: LinearStore): LinearMetadataWire {
		return {
			cycles: store.listResources('cycle').map(resourceRecordToWire),
			labels: store.listResources('label').map(resourceRecordToWire),
			projects: store.listResources('project').map(resourceRecordToWire),
			states: store.listResources('state').map(resourceRecordToWire),
			syncedAt: store.getSyncState('metadata')?.syncedAt ?? null,
			teams: store.listResources('team').map(resourceRecordToWire),
			users: store.listResources('user').map(resourceRecordToWire),
		};
	}

	return {
		createComment: async (request) => {
			try {
				const store = getStore();
				const comment = await client.createComment(request);
				store.upsertComments(request.issueId, [
					commentDataToUpsert(request.issueId, comment),
				]);

				return { comment: commentDataToWire(comment), status: 'ok' };
			} catch (error) {
				return { failure: toFailure(error), status: 'error' };
			}
		},

		createIssue: async (request) => {
			try {
				const store = getStore();
				const issue = await client.createIssue(request);
				store.upsertIssues([issueDataToUpsert(issue)]);

				return {
					issue: issueDataToWire(issue, now().toISOString()),
					status: 'ok',
				};
			} catch (error) {
				return { failure: toFailure(error), status: 'error' };
			}
		},

		getIssue: async ({ id, refresh = false }) => {
			try {
				const store = getStore();
				const cached = store.getIssue(id);

				if (cached && !refresh && !isStale(cached.syncedAt)) {
					return {
						comments: store.listComments(id).map(commentRecordToWire),
						issue: issueRecordToWire(cached),
						source: 'cache',
						status: 'ok',
					};
				}

				try {
					const result = await client.getIssue(id);
					store.upsertIssues([issueDataToUpsert(result.issue)]);
					store.upsertComments(
						id,
						result.comments.nodes.map((comment) =>
							commentDataToUpsert(id, comment),
						),
					);

					return {
						comments: result.comments.nodes.map(commentDataToWire),
						issue: issueDataToWire(result.issue, now().toISOString()),
						source: 'remote',
						status: 'ok',
					};
				} catch (error) {
					if (cached) {
						return {
							comments: store.listComments(id).map(commentRecordToWire),
							issue: issueRecordToWire(cached),
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

		getMetadata: async ({ refresh = false } = {}) => {
			try {
				const store = getStore();
				const syncState = store.getSyncState('metadata');

				if (refresh || isStale(syncState?.syncedAt)) {
					try {
						await syncMetadata(store);
					} catch (error) {
						return {
							failure: toFailure(error),
							metadata: readMetadata(store),
							status: 'error',
						};
					}
				}

				return { metadata: readMetadata(store), status: 'ok' };
			} catch (error) {
				return {
					failure: toFailure(error),
					metadata: emptyMetadata(),
					status: 'error',
				};
			}
		},

		listIssues: async ({ query, refresh = false, teamId } = {}) => {
			try {
				const store = getStore();
				const scope = teamId ? `issues:${teamId}` : 'issues';
				const syncState = store.getSyncState(scope);
				let failure: LinearServiceFailure | null = null;
				let source: 'cache' | 'remote' = 'cache';

				if (refresh || isStale(syncState?.syncedAt)) {
					try {
						await syncIssues(store, teamId);
						source = 'remote';
					} catch (error) {
						failure = toFailure(error);
					}
				}

				const issues = store
					.listIssues({
						...(query ? { query } : {}),
						...(teamId ? { teamId } : {}),
					})
					.map(issueRecordToWire);

				return failure
					? { failure, issues, status: 'error' }
					: { issues, source, status: 'ok' };
			} catch (error) {
				return { failure: toFailure(error), issues: [], status: 'error' };
			}
		},

		updateIssue: async ({ id, input }) => {
			try {
				const store = getStore();
				const issue = await client.updateIssue(id, input);
				store.upsertIssues([issueDataToUpsert(issue)]);

				return {
					issue: issueDataToWire(issue, now().toISOString()),
					status: 'ok',
				};
			} catch (error) {
				return { failure: toFailure(error), status: 'error' };
			}
		},
	};
}

/**
 * Convert client issue data into the store's upsert shape.
 * @param issue - Issue data returned by the Linear client.
 * @returns The issue upsert record for the store.
 */
function issueDataToUpsert(issue: LinearIssueData): LinearIssueUpsert {
	return {
		archivedAt: issue.archivedAt,
		assigneeId: issue.assignee?.id ?? null,
		data: {
			assignee: issue.assignee,
			cycle: issue.cycle,
			labels: issue.labels,
			project: issue.project,
			state: issue.state,
			team: issue.team,
		},
		description: issue.description,
		dueDate: issue.dueDate,
		id: issue.id,
		identifier: issue.identifier,
		priority: issue.priority,
		projectId: issue.project?.id ?? null,
		remoteUpdatedAt: issue.updatedAt,
		stateId: issue.state?.id ?? null,
		teamId: issue.team?.id ?? null,
		title: issue.title,
		url: issue.url,
	};
}

/**
 * Convert client issue data into the renderer wire shape.
 * @param issue - Issue data returned by the Linear client.
 * @param syncedAt - Timestamp to stamp the wire record with.
 * @returns The wire issue for IPC.
 */
function issueDataToWire(
	issue: LinearIssueData,
	syncedAt: string | null,
): LinearIssueWire {
	return {
		archivedAt: issue.archivedAt,
		assigneeId: issue.assignee?.id ?? null,
		assigneeName: issue.assignee?.name ?? null,
		cycleId: issue.cycle?.id ?? null,
		cycleName: issue.cycle?.name ?? null,
		description: issue.description,
		dueDate: issue.dueDate,
		id: issue.id,
		identifier: issue.identifier,
		labels: issue.labels.map((label) => ({
			color: label.color,
			id: label.id,
			name: label.name,
		})),
		priority: issue.priority,
		projectId: issue.project?.id ?? null,
		projectName: issue.project?.name ?? null,
		stateColor: issue.state?.color ?? null,
		stateId: issue.state?.id ?? null,
		stateName: issue.state?.name ?? null,
		stateType: issue.state?.type ?? null,
		syncedAt,
		teamId: issue.team?.id ?? null,
		teamKey: issue.team?.key ?? null,
		teamName: issue.team?.name ?? null,
		title: issue.title,
		updatedAt: issue.updatedAt,
		url: issue.url,
	};
}

/**
 * Convert a cached issue record into the renderer wire shape, decoding its
 * stored JSON relations.
 * @param record - Cached issue record from the store.
 * @returns The wire issue for IPC.
 */
function issueRecordToWire(record: LinearIssueRecord): LinearIssueWire {
	const assignee = readEntity(record.data.assignee);
	const cycle = readEntity(record.data.cycle);
	const project = readEntity(record.data.project);
	const state = readEntity(record.data.state);
	const team = readEntity(record.data.team);
	const labels = Array.isArray(record.data.labels) ? record.data.labels : [];

	return {
		archivedAt: record.archivedAt,
		assigneeId: record.assigneeId,
		assigneeName: readString(assignee?.name),
		cycleId: readString(cycle?.id),
		cycleName: readString(cycle?.name),
		description: record.description,
		dueDate: record.dueDate,
		id: record.id,
		identifier: record.identifier,
		labels: labels.flatMap((label) => {
			const entity = readEntity(label);
			const id = readString(entity?.id);
			const name = readString(entity?.name);

			return id && name ? [{ color: readString(entity?.color), id, name }] : [];
		}),
		priority: record.priority,
		projectId: record.projectId,
		projectName: readString(project?.name),
		stateColor: readString(state?.color),
		stateId: record.stateId,
		stateName: readString(state?.name),
		stateType: readString(state?.type),
		syncedAt: record.syncedAt,
		teamId: record.teamId,
		teamKey: readString(team?.key),
		teamName: readString(team?.name),
		title: record.title,
		updatedAt: record.remoteUpdatedAt,
		url: record.url,
	};
}

/**
 * Convert client comment data into the store's upsert shape.
 * @param issueId - ID of the issue the comment belongs to.
 * @param comment - Comment data returned by the Linear client.
 * @returns The comment upsert record for the store.
 */
function commentDataToUpsert(issueId: string, comment: LinearCommentData) {
	return {
		authorName: comment.authorName,
		body: comment.body,
		data: {},
		id: comment.id,
		issueId,
		remoteCreatedAt: comment.createdAt,
	};
}

/**
 * Convert client comment data into the renderer wire shape.
 * @param comment - Comment data returned by the Linear client.
 * @returns The wire comment for IPC.
 */
function commentDataToWire(comment: LinearCommentData): LinearCommentWire {
	return {
		authorName: comment.authorName,
		body: comment.body,
		createdAt: comment.createdAt,
		id: comment.id,
	};
}

/**
 * Convert a cached comment record into the renderer wire shape.
 * @param record - Cached comment record from the store.
 * @returns The wire comment for IPC.
 */
function commentRecordToWire(record: LinearCommentRecord): LinearCommentWire {
	return {
		authorName: record.authorName,
		body: record.body,
		createdAt: record.remoteCreatedAt,
		id: record.id,
	};
}

/**
 * Convert a cached resource record into the renderer wire shape.
 * @param record - Cached resource record from the store.
 * @returns The wire resource for IPC.
 */
function resourceRecordToWire(
	record: LinearResourceRecord,
): LinearResourceWire {
	return {
		color: readString(record.data.color),
		id: record.id,
		key: readString(record.data.key),
		kind: record.kind,
		name: record.name,
		teamId: record.teamId,
		type: readString(record.data.type),
	};
}

/**
 * Build an empty metadata wire payload for error fallbacks.
 * @returns Metadata with empty collections and no sync timestamp.
 */
function emptyMetadata(): LinearMetadataWire {
	return {
		cycles: [],
		labels: [],
		projects: [],
		states: [],
		syncedAt: null,
		teams: [],
		users: [],
	};
}

/**
 * Narrow an unknown value to a plain object, or null when it is not one.
 * @param value - Value decoded from stored JSON.
 * @returns The value as a record, or null.
 */
function readEntity(value: unknown): Record<string, unknown> | null {
	return typeof value === 'object' && value !== null
		? (value as Record<string, unknown>)
		: null;
}

/**
 * Narrow an unknown value to a string, or null when it is not one.
 * @param value - Value decoded from stored JSON.
 * @returns The value as a string, or null.
 */
function readString(value: unknown): string | null {
	return typeof value === 'string' ? value : null;
}

/**
 * Map any thrown error onto a serializable {@link LinearServiceFailure}.
 * @param error - Error thrown by the client or store.
 * @returns The wire failure descriptor.
 */
function toFailure(error: unknown): LinearServiceFailure {
	if (error instanceof LinearServiceError) {
		return {
			code: error.code,
			message: error.message,
			retryAfterSeconds: error.retryAfterSeconds,
		};
	}

	return {
		code: 'network',
		message: error instanceof Error ? error.message : String(error),
		retryAfterSeconds: null,
	};
}
