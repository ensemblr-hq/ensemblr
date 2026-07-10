import type { DatabaseSync } from 'node:sqlite';

/** Kinds of cached non-issue Linear resources. */
export type LinearResourceKind =
	| 'cycle'
	| 'label'
	| 'project'
	| 'state'
	| 'team'
	| 'user';

/** Cached Linear issue row (mirror of the `linear_issues` table). */
export interface LinearIssueRecord {
	archivedAt: string | null;
	assigneeId: string | null;
	data: Record<string, unknown>;
	description: string | null;
	dueDate: string | null;
	id: string;
	identifier: string;
	priority: number | null;
	projectId: string | null;
	remoteUpdatedAt: string | null;
	stateId: string | null;
	syncedAt: string;
	teamId: string | null;
	title: string;
	url: string;
}

/** Cached Linear metadata resource row (`linear_resources`). */
export interface LinearResourceRecord {
	data: Record<string, unknown>;
	id: string;
	kind: LinearResourceKind;
	name: string;
	syncedAt: string;
	teamId: string | null;
}

/** Cached Linear comment row (`linear_comments`). */
export interface LinearCommentRecord {
	authorName: string | null;
	body: string;
	data: Record<string, unknown>;
	id: string;
	issueId: string;
	remoteCreatedAt: string | null;
	syncedAt: string;
}

/** Per-scope sync bookkeeping row (`linear_sync_state`). */
export interface LinearSyncStateRecord {
	cursor: string | null;
	errorCode: string | null;
	scope: string;
	status: 'error' | 'idle' | 'syncing';
	syncedAt: string | null;
}

/** Upsert payload for {@link LinearStore.upsertIssues}. */
export type LinearIssueUpsert = Omit<LinearIssueRecord, 'syncedAt'>;
/** Upsert payload for {@link LinearStore.upsertResources}. */
type LinearResourceUpsert = Omit<LinearResourceRecord, 'syncedAt'>;
/** Upsert payload for {@link LinearStore.upsertComments}. */
type LinearCommentUpsert = Omit<LinearCommentRecord, 'syncedAt'>;

/** Filter for {@link LinearStore.listIssues}. */
interface LinearIssueListFilter {
	includeArchived?: boolean;
	limit?: number;
	query?: string;
	teamId?: string;
}

/** SQLite-backed cache DAO for Linear issues, resources, and comments. */
export interface LinearStore {
	deleteIssue: (id: string) => void;
	getIssue: (id: string) => LinearIssueRecord | null;
	getIssueByIdentifier: (identifier: string) => LinearIssueRecord | null;
	getSyncState: (scope: string) => LinearSyncStateRecord | null;
	listComments: (issueId: string) => LinearCommentRecord[];
	listIssues: (filter?: LinearIssueListFilter) => LinearIssueRecord[];
	listResources: (
		kind: LinearResourceKind,
		teamId?: string,
	) => LinearResourceRecord[];
	setSyncState: (state: LinearSyncStateRecord) => void;
	upsertComments: (issueId: string, comments: LinearCommentUpsert[]) => void;
	upsertIssues: (issues: LinearIssueUpsert[]) => void;
	upsertResources: (resources: LinearResourceUpsert[]) => void;
}

/** Options for {@link createLinearStore}. */
export interface CreateLinearStoreOptions {
	database: DatabaseSync;
	now?: () => Date;
}

const DEFAULT_LIST_LIMIT = 100;

/**
 * Builds the SQLite cache DAO used by the Linear service. Every write is an
 * idempotent upsert keyed by the remote Linear id, so repeated syncs converge.
 * @param options - Open database handle and optional clock.
 * @returns A fresh {@link LinearStore}.
 */
export function createLinearStore({
	database,
	now = () => new Date(),
}: CreateLinearStoreOptions): LinearStore {
	/**
	 * Current time as an ISO-8601 string for stamping synced rows.
	 * @returns The current timestamp in ISO format.
	 */
	function timestamp(): string {
		return now().toISOString();
	}

	return {
		deleteIssue: (id) => {
			database
				.prepare('DELETE FROM linear_comments WHERE issue_id = ?')
				.run(id);
			database.prepare('DELETE FROM linear_issues WHERE id = ?').run(id);
		},

		getIssue: (id) => {
			const row = database
				.prepare('SELECT * FROM linear_issues WHERE id = ?')
				.get(id) as IssueRow | undefined;

			return row ? mapIssueRow(row) : null;
		},

		getIssueByIdentifier: (identifier) => {
			const row = database
				.prepare('SELECT * FROM linear_issues WHERE identifier = ?')
				.get(identifier) as IssueRow | undefined;

			return row ? mapIssueRow(row) : null;
		},

		getSyncState: (scope) => {
			const row = database
				.prepare('SELECT * FROM linear_sync_state WHERE scope = ?')
				.get(scope) as SyncStateRow | undefined;

			if (!row) {
				return null;
			}

			return {
				cursor: row.cursor,
				errorCode: row.error_code,
				scope: row.scope,
				status: row.status,
				syncedAt: row.synced_at,
			};
		},

		listComments: (issueId) => {
			const rows = database
				.prepare(
					`SELECT * FROM linear_comments WHERE issue_id = ?
					 ORDER BY remote_created_at ASC, id ASC`,
				)
				.all(issueId) as unknown as CommentRow[];

			return rows.map(mapCommentRow);
		},

		listIssues: (filter = {}) => {
			const clauses: string[] = [];
			const parameters: Array<number | string> = [];

			if (!filter.includeArchived) {
				clauses.push('archived_at IS NULL');
			}

			if (filter.teamId) {
				clauses.push('team_id = ?');
				parameters.push(filter.teamId);
			}

			if (filter.query) {
				clauses.push(
					"(identifier LIKE ? ESCAPE '\\' OR title LIKE ? ESCAPE '\\')",
				);
				const pattern = `%${escapeLikePattern(filter.query)}%`;
				parameters.push(pattern, pattern);
			}

			const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
			const rows = database
				.prepare(
					`SELECT * FROM linear_issues ${where}
					 ORDER BY remote_updated_at DESC, identifier ASC
					 LIMIT ?`,
				)
				.all(
					...parameters,
					filter.limit ?? DEFAULT_LIST_LIMIT,
				) as unknown as IssueRow[];

			return rows.map(mapIssueRow);
		},

		listResources: (kind, teamId) => {
			const rows = teamId
				? (database
						.prepare(
							`SELECT * FROM linear_resources
							 WHERE kind = ? AND (team_id = ? OR team_id IS NULL)
							 ORDER BY name ASC`,
						)
						.all(kind, teamId) as unknown as ResourceRow[])
				: (database
						.prepare(
							'SELECT * FROM linear_resources WHERE kind = ? ORDER BY name ASC',
						)
						.all(kind) as unknown as ResourceRow[]);

			return rows.map(mapResourceRow);
		},

		setSyncState: (state) => {
			database
				.prepare(
					`INSERT INTO linear_sync_state (scope, cursor, status, error_code, synced_at)
					 VALUES (?, ?, ?, ?, ?)
					 ON CONFLICT(scope) DO UPDATE SET
						cursor = excluded.cursor,
						status = excluded.status,
						error_code = excluded.error_code,
						synced_at = excluded.synced_at`,
				)
				.run(
					state.scope,
					state.cursor,
					state.status,
					state.errorCode,
					state.syncedAt,
				);
		},

		upsertComments: (issueId, comments) => {
			const statement = database.prepare(
				`INSERT INTO linear_comments
					(id, issue_id, author_name, body, remote_created_at, data_json, synced_at)
				 VALUES (?, ?, ?, ?, ?, ?, ?)
				 ON CONFLICT(id) DO UPDATE SET
					issue_id = excluded.issue_id,
					author_name = excluded.author_name,
					body = excluded.body,
					remote_created_at = excluded.remote_created_at,
					data_json = excluded.data_json,
					synced_at = excluded.synced_at`,
			);
			const syncedAt = timestamp();

			for (const comment of comments) {
				statement.run(
					comment.id,
					issueId,
					comment.authorName,
					comment.body,
					comment.remoteCreatedAt,
					JSON.stringify(comment.data),
					syncedAt,
				);
			}
		},

		upsertIssues: (issues) => {
			const statement = database.prepare(
				`INSERT INTO linear_issues
					(id, identifier, title, description, team_id, project_id, state_id,
					 assignee_id, priority, due_date, url, archived_at, remote_updated_at,
					 data_json, synced_at)
				 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
				 ON CONFLICT(id) DO UPDATE SET
					identifier = excluded.identifier,
					title = excluded.title,
					description = excluded.description,
					team_id = excluded.team_id,
					project_id = excluded.project_id,
					state_id = excluded.state_id,
					assignee_id = excluded.assignee_id,
					priority = excluded.priority,
					due_date = excluded.due_date,
					url = excluded.url,
					archived_at = excluded.archived_at,
					remote_updated_at = excluded.remote_updated_at,
					data_json = excluded.data_json,
					synced_at = excluded.synced_at`,
			);
			const syncedAt = timestamp();

			for (const issue of issues) {
				statement.run(
					issue.id,
					issue.identifier,
					issue.title,
					issue.description,
					issue.teamId,
					issue.projectId,
					issue.stateId,
					issue.assigneeId,
					issue.priority,
					issue.dueDate,
					issue.url,
					issue.archivedAt,
					issue.remoteUpdatedAt,
					JSON.stringify(issue.data),
					syncedAt,
				);
			}
		},

		upsertResources: (resources) => {
			const statement = database.prepare(
				`INSERT INTO linear_resources (id, kind, team_id, name, data_json, synced_at)
				 VALUES (?, ?, ?, ?, ?, ?)
				 ON CONFLICT(id) DO UPDATE SET
					kind = excluded.kind,
					team_id = excluded.team_id,
					name = excluded.name,
					data_json = excluded.data_json,
					synced_at = excluded.synced_at`,
			);
			const syncedAt = timestamp();

			for (const resource of resources) {
				statement.run(
					resource.id,
					resource.kind,
					resource.teamId,
					resource.name,
					JSON.stringify(resource.data),
					syncedAt,
				);
			}
		},
	};
}

/** Raw `linear_issues` table row (snake_case columns). */
interface IssueRow {
	archived_at: string | null;
	assignee_id: string | null;
	data_json: string;
	description: string | null;
	due_date: string | null;
	id: string;
	identifier: string;
	priority: number | null;
	project_id: string | null;
	remote_updated_at: string | null;
	state_id: string | null;
	synced_at: string;
	team_id: string | null;
	title: string;
	url: string;
}

/** Raw `linear_resources` table row (snake_case columns). */
interface ResourceRow {
	data_json: string;
	id: string;
	kind: LinearResourceKind;
	name: string;
	synced_at: string;
	team_id: string | null;
}

/** Raw `linear_comments` table row (snake_case columns). */
interface CommentRow {
	author_name: string | null;
	body: string;
	data_json: string;
	id: string;
	issue_id: string;
	remote_created_at: string | null;
	synced_at: string;
}

/** Raw `linear_sync_state` table row (snake_case columns). */
interface SyncStateRow {
	cursor: string | null;
	error_code: string | null;
	scope: string;
	status: 'error' | 'idle' | 'syncing';
	synced_at: string | null;
}

/**
 * Map a raw issue row into a {@link LinearIssueRecord}, decoding its JSON blob.
 * @param row - Raw `linear_issues` row.
 * @returns The cached issue record.
 */
function mapIssueRow(row: IssueRow): LinearIssueRecord {
	return {
		archivedAt: row.archived_at,
		assigneeId: row.assignee_id,
		data: parseJsonRecord(row.data_json),
		description: row.description,
		dueDate: row.due_date,
		id: row.id,
		identifier: row.identifier,
		priority: row.priority,
		projectId: row.project_id,
		remoteUpdatedAt: row.remote_updated_at,
		stateId: row.state_id,
		syncedAt: row.synced_at,
		teamId: row.team_id,
		title: row.title,
		url: row.url,
	};
}

/**
 * Map a raw resource row into a {@link LinearResourceRecord}, decoding its JSON blob.
 * @param row - Raw `linear_resources` row.
 * @returns The cached resource record.
 */
function mapResourceRow(row: ResourceRow): LinearResourceRecord {
	return {
		data: parseJsonRecord(row.data_json),
		id: row.id,
		kind: row.kind,
		name: row.name,
		syncedAt: row.synced_at,
		teamId: row.team_id,
	};
}

/**
 * Map a raw comment row into a {@link LinearCommentRecord}, decoding its JSON blob.
 * @param row - Raw `linear_comments` row.
 * @returns The cached comment record.
 */
function mapCommentRow(row: CommentRow): LinearCommentRecord {
	return {
		authorName: row.author_name,
		body: row.body,
		data: parseJsonRecord(row.data_json),
		id: row.id,
		issueId: row.issue_id,
		remoteCreatedAt: row.remote_created_at,
		syncedAt: row.synced_at,
	};
}

/**
 * Parse a stored JSON column into a record, falling back to an empty object on
 * malformed or non-object data.
 * @param json - Serialized JSON from a `data_json` column.
 * @returns The parsed record, or an empty object.
 */
function parseJsonRecord(json: string): Record<string, unknown> {
	try {
		const parsed = JSON.parse(json) as unknown;

		return typeof parsed === 'object' && parsed !== null
			? (parsed as Record<string, unknown>)
			: {};
	} catch {
		return {};
	}
}

/**
 * Escape SQL `LIKE` wildcards (`%` and `_`) so user queries match literally.
 * @param input - Raw search text.
 * @returns The input with wildcards backslash-escaped.
 */
function escapeLikePattern(input: string): string {
	return input.replaceAll(/[%_]/g, (match) => `\\${match}`);
}
