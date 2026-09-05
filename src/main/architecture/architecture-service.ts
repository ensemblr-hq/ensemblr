/**
 * Stores and reads a workspace's architecture diagram.
 *
 * Nothing here derives a diagram. The document is authored entirely by an agent
 * through the control op and lives at `.ensemblr/architecture.json`; a workspace
 * that has never been drawn simply has none, and every surface says so rather
 * than filling the gap with a tree walk. A generated seed only ever had to be
 * rewritten by an agent to be worth reading, so producing one bought a diff full
 * of directory names and no time saved.
 *
 * The file is tracked, so a stored document this build cannot read stops every
 * path instead of being written over.
 */
import { existsSync } from 'node:fs';
import type { DatabaseSync } from 'node:sqlite';

import type { ArchitectureIR } from '../../shared/architecture-diagram.ts';
import { selectWorkspaceWithRepositoryById } from '../storage/repositories/workspace-repository.ts';

import {
	ARCHITECTURE_FILE_RELATIVE_PATH,
	type ArchitectureFileContents,
	readArchitectureFile,
	writeArchitectureFile,
} from './architecture-file.ts';

/** Why an architecture request could not be served. */
export type ArchitectureFailureCode =
	| 'diagram-unreadable'
	| 'workspace-missing';

/** Typed error thrown by the architecture service for IPC translation. */
export class ArchitectureServiceError extends Error {
	readonly code: ArchitectureFailureCode;

	constructor({
		code,
		message,
	}: {
		code: ArchitectureFailureCode;
		message: string;
	}) {
		super(message);
		this.code = code;
		this.name = 'ArchitectureServiceError';
	}
}

/** The stored diagram plus the one this session's last write replaced. */
export interface ArchitectureReadResult {
	current: ArchitectureFileContents | null;
	/**
	 * Set when a document is stored that this build cannot read, which is the
	 * one case where `current: null` does not mean "there is none".
	 */
	error?: { code: ArchitectureFailureCode; message: string };
	/**
	 * What the last write in this app session replaced, which is what the delta
	 * badges are computed against. Null after a restart: nothing has moved since
	 * the user last looked, so nothing should be badged.
	 */
	previous: ArchitectureIR | null;
}

/** Public surface of the architecture service. */
export interface ArchitectureService {
	/** Reads the workspace's committed diagram. */
	readDiagram: (input: {
		workspaceId: string;
	}) => Promise<ArchitectureReadResult>;
	/**
	 * Stores an agent-authored IR, which is the only way a diagram comes to
	 * exist or changes.
	 *
	 * Refuses with `diagram-unreadable` over a stored document this build cannot
	 * parse. Overwriting one anyway is how a hand edit disappears as an
	 * ordinary-looking update.
	 */
	storeRefinedIr: (input: {
		ir: ArchitectureIR;
		workspaceId: string;
	}) => Promise<ArchitectureFileContents>;
}

/** Where a workspace's diagram goes. */
interface ArchitectureWorkspace {
	cwd: string;
}

/**
 * Narrows the joined workspace row to the one column this concern reads.
 * @param row - Whatever the workspace repository returned
 * @returns The workspace, or null when there is no usable row
 */
function toArchitectureWorkspace(row: unknown): ArchitectureWorkspace | null {
	if (typeof row !== 'object' || row === null) {
		return null;
	}
	const candidate = row as { path?: unknown };
	if (typeof candidate.path !== 'string' || candidate.path.length === 0) {
		return null;
	}
	return { cwd: candidate.path };
}

/**
 * Builds the service.
 * @param now - Clock, overridable in tests
 * @param requireDatabase - Resolves the open database, throwing when there is none
 * @returns The architecture service
 */
export function createArchitectureService({
	now = () => new Date(),
	requireDatabase,
}: {
	now?: () => Date;
	requireDatabase: () => DatabaseSync;
}): ArchitectureService {
	/** What the last write replaced, per workspace, for the delta badges. */
	const replacedByWrite = new Map<string, ArchitectureIR>();

	/**
	 * Resolves a workspace, refusing one the database does not know.
	 * @param workspaceId - Workspace to resolve
	 * @returns Its directory
	 */
	const requireWorkspace = (workspaceId: string): ArchitectureWorkspace => {
		const workspace = toArchitectureWorkspace(
			selectWorkspaceWithRepositoryById({
				database: requireDatabase(),
				workspaceId,
			}),
		);
		if (!workspace) {
			throw new ArchitectureServiceError({
				code: 'workspace-missing',
				message: `No workspace with id ${workspaceId}.`,
			});
		}
		return workspace;
	};

	/**
	 * Wraps an unreadable stored document in the envelope every surface reports.
	 * @param problem - What stopped the read
	 * @returns The failure envelope
	 */
	const unreadableError = (
		problem: string,
	): { code: ArchitectureFailureCode; message: string } => ({
		code: 'diagram-unreadable',
		message: `${ARCHITECTURE_FILE_RELATIVE_PATH} could not be read: ${problem}`,
	});

	return {
		readDiagram: async ({ workspaceId }) => {
			const read = await readArchitectureFile(
				requireWorkspace(workspaceId).cwd,
			);
			const previous = replacedByWrite.get(workspaceId) ?? null;
			if (read.status === 'unreadable') {
				return {
					current: null,
					error: unreadableError(read.problem),
					previous,
				};
			}
			return {
				current: read.status === 'stored' ? read.contents : null,
				previous,
			};
		},

		storeRefinedIr: async ({ ir, workspaceId }) => {
			const workspace = requireWorkspace(workspaceId);
			const read = await readArchitectureFile(workspace.cwd);
			// The file is tracked, so an unparseable document is a hand edit or a
			// merge conflict sitting in somebody's diff, not a stale cache.
			if (read.status === 'unreadable') {
				throw new ArchitectureServiceError({
					code: 'diagram-unreadable',
					message: unreadableError(read.problem).message,
				});
			}
			if (!existsSync(workspace.cwd)) {
				throw new ArchitectureServiceError({
					code: 'workspace-missing',
					message: `Workspace ${workspaceId} is no longer on disk at ${workspace.cwd}.`,
				});
			}
			const contents = { generatedAt: now().toISOString(), ir };
			writeArchitectureFile({ contents, workspaceCwd: workspace.cwd });
			const previous = read.status === 'stored' ? read.contents.ir : null;
			// Cleared rather than left alone when this write replaced nothing: a
			// diagram the user deleted has no predecessor, and the entry a write
			// before it left behind would badge the new document against a snapshot
			// two writes old.
			if (previous) {
				replacedByWrite.set(workspaceId, previous);
			} else {
				replacedByWrite.delete(workspaceId);
			}
			return { ...contents, relativePath: ARCHITECTURE_FILE_RELATIVE_PATH };
		},
	};
}
