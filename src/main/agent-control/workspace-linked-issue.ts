/**
 * Reads the remote issue a workspace was created from, off the workspace's own
 * persisted metadata.
 *
 * Two callers need the same three lines and would otherwise each parse the
 * metadata blob their own way: {@link makeLinearPort}, which defaults a Linear
 * write to the account the workspace came from, and the surfaces that render the
 * linked-issue directive. The metadata column is untyped JSON written by the
 * renderer, so every field is checked rather than asserted — a workspace created
 * before ADR 0052 carries no `accountId` at all, and a hand-edited row could
 * carry anything.
 */

import type { DatabaseSync } from 'node:sqlite';

import type { WorkspaceLinkedIssue } from '../../shared/agent-control.ts';
import type { EnsemblrDatabaseService } from '../storage';
import { parseMetadata } from '../storage/repositories/metadata-json.ts';
import { selectWorkspaceMetadataJson } from '../storage/repositories/workspace-repository.ts';

/** The `linkedIssue` blob as it sits on a workspace row, before validation. */
interface LinkedIssueBlob {
	accountId?: unknown;
	id?: unknown;
	identifier?: unknown;
	provider?: unknown;
	reference?: unknown;
	title?: unknown;
	url?: unknown;
}

/**
 * Reads a string field, or null when the blob carries something else.
 * @param value - The field as the metadata blob holds it.
 * @returns The string, or null.
 */
function text(value: unknown): string | null {
	return typeof value === 'string' && value.length > 0 ? value : null;
}

/**
 * Names the issue the way a branch and a pull request cite it. The renderer
 * persists the human key as `identifier` when it creates the workspace from a
 * Linear search result and as `reference` when it comes off the landing summary,
 * so both are read before giving up.
 * @param blob - The `linkedIssue` blob.
 * @returns The human identifier, or null when neither field carries one.
 */
function identifierOf(blob: LinkedIssueBlob): string | null {
	return text(blob.identifier) ?? text(blob.reference);
}

/**
 * Reads a workspace's metadata blob, treating any SQLite error as "no metadata".
 * Callers render a prompt block from this, and every one of them runs on a path
 * — writing a harness instruction file, answering a session brief — where a
 * missing directive beats failing the launch outright.
 * @param database - The open database connection.
 * @param workspaceId - The workspace whose metadata to read.
 * @returns The raw metadata JSON, or null when there is none to read.
 */
function readMetadataJson(
	database: DatabaseSync,
	workspaceId: string,
): string | null {
	try {
		return selectWorkspaceMetadataJson({ database, id: workspaceId }) ?? null;
	} catch {
		return null;
	}
}

/**
 * Reads the issue a workspace was created from.
 * @param input - The database service and the workspace to read.
 * @returns The linked issue, or null when the workspace has none, the database is
 * closed or erroring, or the persisted blob is missing the fields that identify
 * an issue.
 */
export function readWorkspaceLinkedIssue({
	databaseService,
	workspaceId,
}: {
	databaseService: EnsemblrDatabaseService;
	workspaceId: string;
}): WorkspaceLinkedIssue | null {
	const database = databaseService.getConnection()?.database;

	if (!database) {
		return null;
	}

	const metadataJson = readMetadataJson(database, workspaceId);

	if (!metadataJson) {
		return null;
	}

	const { linkedIssue } = parseMetadata(metadataJson) as {
		linkedIssue?: LinkedIssueBlob;
	};

	if (!linkedIssue) {
		return null;
	}

	const identifier = identifierOf(linkedIssue);
	const provider = text(linkedIssue.provider);

	if (!identifier || (provider !== 'linear' && provider !== 'github')) {
		return null;
	}

	return {
		accountId: text(linkedIssue.accountId),
		identifier,
		provider,
		title: text(linkedIssue.title) ?? identifier,
		url: text(linkedIssue.url),
	};
}
