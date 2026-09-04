/**
 * Builds, stores, and reads a workspace's architecture diagram.
 *
 * The seed is deterministic and model-free: scan the tree, build the IR, write
 * it to `.ensemblr/architecture.json`. It is scanned **once**, when the
 * workspace is created, and after that the document is the agent's to maintain
 * through the control op. Nothing re-scans behind the user's back: the file is
 * tracked, so a scan that replaced a refinement would undo work already sitting
 * in their diff.
 *
 * A scan therefore only ever runs where there is nothing to lose — a workspace
 * that has no diagram at all. When one is present but this build cannot read
 * it, every path stops and says so rather than scanning over it.
 */
import type { DatabaseSync } from 'node:sqlite';

import type { ArchitectureIR } from '../../shared/architecture-diagram.ts';
import { getWorkspacePathById } from '../storage/repositories/workspace-repository.ts';

import {
	ARCHITECTURE_FILE_RELATIVE_PATH,
	type ArchitectureFileContents,
	readArchitectureFile,
	writeArchitectureFile,
} from './architecture-file.ts';
import { irFromModuleGraph } from './ir-from-graph.ts';
import { scanModuleGraph } from './module-graph.ts';

/**
 * Why a scan produced no new diagram. `already-stored` is the ordinary answer
 * once a workspace has one — the seed is scanned once and then belongs to the
 * agent — and `diagram-unreadable` is the refusal to write over a document
 * this build cannot parse.
 */
export type ArchitectureScanSkipReason =
	| 'already-stored'
	| 'diagram-unreadable';

/** Outcome of a scan: either a written diagram, or why nothing was written. */
export type ArchitectureScanOutcome =
	| { diagram: ArchitectureFileContents; rebuilt: true }
	| { reason: ArchitectureScanSkipReason; rebuilt: false };

/** Why an architecture request could not be served. */
export type ArchitectureFailureCode =
	| 'diagram-unreadable'
	| 'scan-failed'
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
	 * Seeds a workspace that has no diagram yet, and leaves every workspace that
	 * has one exactly as it is. This is the only path that scans, and it is
	 * deliberately the only one: the file is tracked, so a scan that ran over a
	 * stored document would undo a refinement the user can already see in their
	 * diff.
	 */
	scanIfMissing: (input: {
		workspaceId: string;
	}) => Promise<ArchitectureScanOutcome>;
	/**
	 * Stores an agent-refined IR, which is how the diagram changes after the
	 * seed. Kept against the fingerprint the seed recorded, so the file still
	 * says which module graph it was drawn from.
	 */
	storeRefinedIr: (input: {
		ir: ArchitectureIR;
		workspaceId: string;
	}) => Promise<ArchitectureFileContents>;
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
	 * Resolves a workspace's working directory, refusing a workspace the
	 * database does not know.
	 * @param workspaceId - Workspace to resolve
	 * @returns Its absolute path
	 */
	const requireWorkspaceCwd = (workspaceId: string): string => {
		const cwd = getWorkspacePathById({
			database: requireDatabase(),
			workspaceId,
		});
		if (!cwd) {
			throw new ArchitectureServiceError({
				code: 'workspace-missing',
				message: `No workspace with id ${workspaceId}.`,
			});
		}
		return cwd;
	};

	/**
	 * Scans the tree and builds the seed IR from it.
	 * @param cwd - The workspace's working directory
	 * @returns The IR and the fingerprint of the graph it came from
	 */
	const scanSeed = async (
		cwd: string,
	): Promise<{ graphFingerprint: string; ir: ArchitectureIR }> => {
		try {
			const graph = await scanModuleGraph(cwd);
			return {
				graphFingerprint: graph.fingerprint,
				ir: irFromModuleGraph(graph, cwd),
			};
		} catch (error) {
			throw new ArchitectureServiceError({
				code: 'scan-failed',
				message:
					error instanceof Error
						? error.message
						: 'The workspace could not be scanned.',
			});
		}
	};

	/**
	 * Writes the diagram and records what it replaced, so the next read can
	 * badge what moved.
	 * @param contents - The diagram and its provenance
	 * @param previous - The document being replaced, if any
	 * @param workspaceCwd - Absolute path of the workspace root
	 * @param workspaceId - Workspace being written
	 * @returns The stored diagram, as a read would return it
	 */
	const store = ({
		contents,
		previous,
		workspaceCwd,
		workspaceId,
	}: {
		contents: Omit<ArchitectureFileContents, 'relativePath'>;
		previous: ArchitectureIR | null;
		workspaceCwd: string;
		workspaceId: string;
	}): ArchitectureFileContents => {
		writeArchitectureFile({ contents, workspaceCwd });
		if (previous) {
			replacedByWrite.set(workspaceId, previous);
		}
		return { ...contents, relativePath: ARCHITECTURE_FILE_RELATIVE_PATH };
	};

	return {
		readDiagram: async ({ workspaceId }) => {
			const read = await readArchitectureFile(requireWorkspaceCwd(workspaceId));
			const previous = replacedByWrite.get(workspaceId) ?? null;
			if (read.status === 'unreadable') {
				return {
					current: null,
					error: {
						code: 'diagram-unreadable',
						message: `${ARCHITECTURE_FILE_RELATIVE_PATH} could not be read: ${read.problem}`,
					},
					previous,
				};
			}
			return {
				current: read.status === 'stored' ? read.contents : null,
				previous,
			};
		},

		scanIfMissing: async ({ workspaceId }) => {
			const cwd = requireWorkspaceCwd(workspaceId);
			const read = await readArchitectureFile(cwd);
			if (read.status === 'stored') {
				return { reason: 'already-stored', rebuilt: false };
			}
			if (read.status === 'unreadable') {
				return { reason: 'diagram-unreadable', rebuilt: false };
			}

			const { graphFingerprint, ir } = await scanSeed(cwd);
			const diagram = store({
				contents: {
					generatedAt: now().toISOString(),
					graphFingerprint,
					ir,
					source: 'scan',
				},
				previous: null,
				workspaceCwd: cwd,
				workspaceId,
			});
			return { diagram, rebuilt: true };
		},

		storeRefinedIr: async ({ ir, workspaceId }) => {
			const cwd = requireWorkspaceCwd(workspaceId);
			const read = await readArchitectureFile(cwd);
			const stored = read.status === 'stored' ? read.contents : null;
			return store({
				contents: {
					generatedAt: now().toISOString(),
					graphFingerprint: stored?.graphFingerprint ?? '',
					ir,
					source: 'agent',
				},
				previous: stored?.ir ?? null,
				workspaceCwd: cwd,
				workspaceId,
			});
		},
	};
}
