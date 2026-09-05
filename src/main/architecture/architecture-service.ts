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

/**
 * A seed attempt and the diagram that stands afterwards, in one answer. Mirrors
 * `ScanArchitectureSnapshotResult` on the wire, so the IPC handler forwards it
 * rather than assembling one from two calls.
 */
export interface ArchitectureScanAndReadResult extends ArchitectureReadResult {
	/** True when this call is what wrote the diagram it is returning. */
	rebuilt: boolean;
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
	 * Seeds a workspace that has no diagram and answers with the one that stands
	 * afterwards, which is what a panel opening on a fresh workspace needs.
	 *
	 * One call rather than a scan followed by a read: between two calls a second
	 * panel can seed the same workspace, and the first would then report
	 * `rebuilt` against a document its own scan did not write.
	 */
	scanIfMissingAndRead: (input: {
		workspaceId: string;
	}) => Promise<ArchitectureScanAndReadResult>;
	/**
	 * Stores an agent-refined IR, which is how the diagram changes after the
	 * seed. Kept against the fingerprint the seed recorded, so the file still
	 * says which module graph it was drawn from.
	 *
	 * Refuses with `diagram-unreadable` over a stored document this build cannot
	 * parse, the same way {@link ArchitectureService.scanIfMissing} does. Reading
	 * one only to salvage its fingerprint and writing over it anyway is how a
	 * hand edit disappears as an ordinary-looking regeneration.
	 */
	storeRefinedIr: (input: {
		ir: ArchitectureIR;
		workspaceId: string;
	}) => Promise<ArchitectureFileContents>;
}

/** Where a workspace's diagram goes, and what the diagram is named after. */
interface ArchitectureWorkspace {
	cwd: string;
	/** Name of the repository the worktree was cut from, not of the worktree. */
	repositoryName: string | null;
}

/**
 * Narrows the joined workspace row to the two columns this concern reads.
 * @param row - Whatever the workspace repository returned
 * @returns The workspace, or null when there is no usable row
 */
function toArchitectureWorkspace(row: unknown): ArchitectureWorkspace | null {
	if (typeof row !== 'object' || row === null) {
		return null;
	}
	const candidate = row as { path?: unknown; repositoryName?: unknown };
	if (typeof candidate.path !== 'string' || candidate.path.length === 0) {
		return null;
	}
	return {
		cwd: candidate.path,
		repositoryName:
			typeof candidate.repositoryName === 'string'
				? candidate.repositoryName
				: null,
	};
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
	 * The seed work already running for a workspace, so a second ask queues
	 * behind it rather than finding the file absent alongside the first and
	 * walking the same tree twice.
	 */
	const seeding = new Map<string, Promise<unknown>>();

	/**
	 * Resolves a workspace, refusing one the database does not know.
	 * @param workspaceId - Workspace to resolve
	 * @returns Its directory and the repository it belongs to
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
	 * Runs one workspace's seed work after whatever is already running for it.
	 * @param workspaceId - Workspace the work belongs to
	 * @param work - The work to run
	 * @returns Whatever the work resolved to
	 */
	const runExclusively = <Result>(
		workspaceId: string,
		work: () => Promise<Result>,
	): Promise<Result> => {
		const queued = (seeding.get(workspaceId) ?? Promise.resolve()).then(work);
		const settled = queued.then(
			() => undefined,
			() => undefined,
		);
		seeding.set(workspaceId, settled);
		void settled.then(() => {
			if (seeding.get(workspaceId) === settled) {
				seeding.delete(workspaceId);
			}
		});
		return queued;
	};

	/**
	 * Writes the diagram and records what it replaced, so the next read can
	 * badge what moved.
	 *
	 * The workspace is re-resolved immediately beforehand. A scan started at
	 * creation outlives a workspace deleted a second later, and the writer
	 * creates the directories it needs — so without this the finished walk
	 * recreates `.ensemblr/` inside a removed worktree, and the next
	 * `git worktree add` at that path fails on a directory nobody meant to keep.
	 * @param contents - The diagram and its provenance
	 * @param previous - The document being replaced, if any
	 * @param workspaceId - Workspace being written
	 * @returns The stored diagram, as a read would return it
	 */
	const store = ({
		contents,
		previous,
		workspaceId,
	}: {
		contents: Omit<ArchitectureFileContents, 'relativePath'>;
		previous: ArchitectureIR | null;
		workspaceId: string;
	}): ArchitectureFileContents => {
		const workspace = requireWorkspace(workspaceId);
		if (!existsSync(workspace.cwd)) {
			throw new ArchitectureServiceError({
				code: 'workspace-missing',
				message: `Workspace ${workspaceId} is no longer on disk at ${workspace.cwd}.`,
			});
		}
		writeArchitectureFile({ contents, workspaceCwd: workspace.cwd });
		if (previous) {
			replacedByWrite.set(workspaceId, previous);
		}
		return { ...contents, relativePath: ARCHITECTURE_FILE_RELATIVE_PATH };
	};

	/**
	 * Scans the tree, builds the seed IR, and writes it.
	 *
	 * Scan, build, validate, and write share one failure answer: each of them
	 * ends with no diagram for a caller that asked for one, and none of them is
	 * a reason to report the workspace missing.
	 * @param workspace - The workspace to scan
	 * @param workspaceId - Workspace being seeded
	 * @returns The stored seed
	 */
	const seed = async (
		workspace: ArchitectureWorkspace,
		workspaceId: string,
	): Promise<ArchitectureFileContents> => {
		try {
			const graph = await scanModuleGraph(workspace.cwd);
			return store({
				contents: {
					generatedAt: now().toISOString(),
					graphFingerprint: graph.fingerprint,
					ir: irFromModuleGraph(graph, {
						repositoryName: workspace.repositoryName,
						workspaceCwd: workspace.cwd,
					}),
					source: 'scan',
				},
				previous: null,
				workspaceId,
			});
		} catch (error) {
			if (error instanceof ArchitectureServiceError) {
				throw error;
			}
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
	 * Seeds a workspace that has none, and reports what stands afterwards
	 * whichever way it went.
	 * @param workspaceId - Workspace to seed
	 * @returns The diagram now stored, or why none was written
	 */
	const seedIfMissing = async (
		workspaceId: string,
	): Promise<
		| { contents: ArchitectureFileContents; rebuilt: boolean }
		| { problem: string; rebuilt: false }
	> => {
		const workspace = requireWorkspace(workspaceId);
		const read = await readArchitectureFile(workspace.cwd);
		if (read.status === 'stored') {
			return { contents: read.contents, rebuilt: false };
		}
		if (read.status === 'unreadable') {
			return { problem: read.problem, rebuilt: false };
		}
		return { contents: await seed(workspace, workspaceId), rebuilt: true };
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

		scanIfMissing: async ({ workspaceId }) =>
			runExclusively(workspaceId, async () => {
				const attempt = await seedIfMissing(workspaceId);
				if ('problem' in attempt) {
					return { reason: 'diagram-unreadable', rebuilt: false };
				}
				return attempt.rebuilt
					? { diagram: attempt.contents, rebuilt: true }
					: { reason: 'already-stored', rebuilt: false };
			}),

		scanIfMissingAndRead: async ({ workspaceId }) =>
			runExclusively(workspaceId, async () => {
				const attempt = await seedIfMissing(workspaceId);
				const previous = replacedByWrite.get(workspaceId) ?? null;
				if ('problem' in attempt) {
					return {
						current: null,
						error: unreadableError(attempt.problem),
						previous,
						rebuilt: false,
					};
				}
				return {
					current: attempt.contents,
					previous,
					rebuilt: attempt.rebuilt,
				};
			}),

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
			const stored = read.status === 'stored' ? read.contents : null;
			return store({
				contents: {
					generatedAt: now().toISOString(),
					graphFingerprint: stored?.graphFingerprint ?? '',
					ir,
					source: 'agent',
				},
				previous: stored?.ir ?? null,
				workspaceId,
			});
		},
	};
}
