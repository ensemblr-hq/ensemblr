/**
 * Mappers between Linear's GraphQL shapes, the SQLite cache records, and the
 * wire shapes the renderer reads.
 *
 * Split out of `linear-service.ts` so that file holds the service's behaviour —
 * resolution, cache policy, sync — rather than the flattening that behaviour
 * hands back. Nothing here reads the database or the network: every function is
 * a pure projection, which is what makes them safe to call from any of the
 * service's branches.
 */

import type {
	LinearAccountFailure,
	LinearAccountSnapshot,
	LinearCommentWire,
	LinearIssueWire,
	LinearMetadataWire,
	LinearResourceWire,
	LinearServiceFailure,
} from '../../shared/ipc/contracts/linear';
import {
	type LinearClient,
	type LinearCommentData,
	type LinearIssueData,
	LinearServiceError,
} from './linear-client.ts';
import type {
	LinearCommentRecord,
	LinearIssueRecord,
	LinearIssueUpsert,
	LinearResourceRecord,
} from './linear-store.ts';

/** An account plus the client bound to its own access token. */
export interface AccountTarget {
	account: LinearAccountSnapshot;
	client: LinearClient;
}

/**
 * Build the account-id to organization-name lookup the wire shapes badge with.
 * @param targets - Accounts in play for this operation.
 * @returns A map from account id to its organization name.
 */
export function organizationNames(
	targets: AccountTarget[],
): ReadonlyMap<string, string | null> {
	return new Map(
		targets.map((target) => [
			target.account.id,
			target.account.organizationName,
		]),
	);
}

/**
 * Wrap one account's sync error so a merged result can report it without losing
 * the accounts that did succeed.
 * @param target - Account that failed.
 * @param error - Error thrown by its sync.
 * @returns The per-account failure entry.
 */
export function accountFailure(
	target: AccountTarget,
	error: unknown,
): LinearAccountFailure {
	return {
		accountId: target.account.id,
		failure: toFailure(error),
		organizationName: target.account.organizationName,
	};
}

/**
 * Convert client issue data into the store's upsert shape.
 * @param issue - Issue data returned by the Linear client.
 * @returns The issue upsert record for the store.
 */
export function issueDataToUpsert(issue: LinearIssueData): LinearIssueUpsert {
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
 * @param account - Account the issue was read through.
 * @param syncedAt - Timestamp to stamp the wire record with.
 * @returns The wire issue for IPC.
 */
export function issueDataToWire(
	issue: LinearIssueData,
	account: LinearAccountSnapshot,
	syncedAt: string | null,
): LinearIssueWire {
	const assignee = flattenNamedRef(issue.assignee);
	const cycle = flattenNamedRef(issue.cycle);
	const project = flattenNamedRef(issue.project);

	return {
		accountId: account.id,
		archivedAt: issue.archivedAt,
		assigneeId: assignee.id,
		assigneeName: assignee.name,
		cycleId: cycle.id,
		cycleName: cycle.name,
		description: issue.description,
		dueDate: issue.dueDate,
		id: issue.id,
		identifier: issue.identifier,
		labels: issue.labels.map((label) => ({
			color: label.color,
			id: label.id,
			name: label.name,
		})),
		organizationName: account.organizationName,
		priority: issue.priority,
		projectId: project.id,
		projectName: project.name,
		...flattenState(issue.state),
		syncedAt,
		...flattenTeam(issue.team),
		title: issue.title,
		updatedAt: issue.updatedAt,
		url: issue.url,
	};
}

/**
 * Split an optional `{ id, name }` relation into the nullable id/name pair the
 * wire shape carries.
 * @param ref - Relation returned by the Linear client, if any
 * @returns The relation's id and name, each null when the relation is absent
 */
function flattenNamedRef(ref: { id: string; name: string } | null): {
	id: string | null;
	name: string | null;
} {
	return { id: ref?.id ?? null, name: ref?.name ?? null };
}

/**
 * Split an issue's workflow state into its four nullable wire columns.
 * @param state - Workflow state returned by the Linear client, if any
 * @returns The state columns, each null when the state is absent
 */
function flattenState(state: LinearIssueData['state']): {
	stateColor: string | null;
	stateId: string | null;
	stateName: string | null;
	stateType: string | null;
} {
	return {
		stateColor: state?.color ?? null,
		stateId: state?.id ?? null,
		stateName: state?.name ?? null,
		stateType: state?.type ?? null,
	};
}

/**
 * Split an issue's team into its three nullable wire columns.
 * @param team - Team returned by the Linear client, if any
 * @returns The team columns, each null when the team is absent
 */
function flattenTeam(team: LinearIssueData['team']): {
	teamId: string | null;
	teamKey: string | null;
	teamName: string | null;
} {
	return {
		teamId: team?.id ?? null,
		teamKey: team?.key ?? null,
		teamName: team?.name ?? null,
	};
}

/**
 * Convert a cached issue record into the renderer wire shape, decoding its
 * stored JSON relations.
 * @param record - Cached issue record from the store.
 * @param organizations - Account id to organization name lookup.
 * @returns The wire issue for IPC.
 */
export function issueRecordToWire(
	record: LinearIssueRecord,
	organizations: ReadonlyMap<string, string | null>,
): LinearIssueWire {
	const assignee = readEntity(record.data.assignee);
	const cycle = readEntity(record.data.cycle);
	const project = readEntity(record.data.project);
	const state = readEntity(record.data.state);
	const team = readEntity(record.data.team);
	const labels = Array.isArray(record.data.labels) ? record.data.labels : [];

	return {
		accountId: record.accountId,
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
		organizationName: organizations.get(record.accountId) ?? null,
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
export function commentDataToUpsert(
	issueId: string,
	comment: LinearCommentData,
) {
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
export function commentDataToWire(
	comment: LinearCommentData,
): LinearCommentWire {
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
export function commentRecordToWire(
	record: LinearCommentRecord,
): LinearCommentWire {
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
 * @param organizations - Account id to organization name lookup.
 * @returns The wire resource for IPC.
 */
export function resourceRecordToWire(
	record: LinearResourceRecord,
	organizations: ReadonlyMap<string, string | null>,
): LinearResourceWire {
	return {
		accountId: record.accountId,
		color: readString(record.data.color),
		id: record.id,
		key: readString(record.data.key) ?? readNumberAsString(record.data.number),
		kind: record.kind,
		name: record.name,
		organizationName: organizations.get(record.accountId) ?? null,
		teamId: record.teamId,
		type: readString(record.data.type),
	};
}

/**
 * Build an empty metadata wire payload for error fallbacks.
 * @returns Metadata with empty collections and no sync timestamp.
 */
export function emptyMetadata(): LinearMetadataWire {
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
 * Narrow an unknown value to a numeric short key. A cycle has no `key` of its
 * own, only the `number` Linear counts it by, and that number is what the
 * renderer names an unnamed cycle from.
 * @param value - Value decoded from stored JSON.
 * @returns The number as a string, or null when it is not a number.
 */
function readNumberAsString(value: unknown): string | null {
	return typeof value === 'number' ? String(value) : null;
}

/**
 * Map any thrown error onto a serializable {@link LinearServiceFailure}.
 * @param error - Error thrown by the client or store.
 * @returns The wire failure descriptor.
 */
export function toFailure(error: unknown): LinearServiceFailure {
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
