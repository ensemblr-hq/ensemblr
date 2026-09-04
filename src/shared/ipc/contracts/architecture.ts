import type { ArchitectureIR } from '../../architecture-diagram.ts';

/** Request for a workspace's committed architecture diagram. */
export interface GetArchitectureSnapshotRequest {
	workspaceId: string;
}

/** Why an architecture request could not be served. */
export type ArchitectureFailureCode =
	| 'diagram-unreadable'
	| 'scan-failed'
	| 'workspace-missing';

/**
 * The diagram as it is stored at `.ensemblr/architecture.json`, plus the
 * provenance the panel's header needs.
 */
export interface ArchitectureDiagramWire {
	/** ISO timestamp of the write. */
	generatedAt: string;
	/** Hash of the module graph's topology when this was written. */
	graphFingerprint: string;
	ir: ArchitectureIR;
	/** Workspace-relative path of the file it came from. */
	relativePath: string;
	/** `scan` for the deterministic seed, `agent` once one has refined it. */
	source: 'agent' | 'scan';
}

/**
 * The workspace's diagram and the one this session's last write replaced.
 * `current` is null before the seed scan lands, which the panel answers by
 * asking for one; `previous` backs the delta badges and is null after a
 * restart.
 */
export interface GetArchitectureSnapshotResult {
	current: ArchitectureDiagramWire | null;
	error?: {
		code: ArchitectureFailureCode;
		message: string;
	};
	previous: ArchitectureIR | null;
}

/**
 * Request to seed a workspace that has no diagram. There is no request to
 * *re*-scan one: the seed is scanned once, at workspace creation, and after
 * that the document belongs to whichever agent refines it.
 */
export interface ScanArchitectureSnapshotRequest {
	workspaceId: string;
}

/**
 * Outcome of the seed scan. `rebuilt: false` with no error means the workspace
 * already had a diagram, which is the ordinary answer.
 */
export interface ScanArchitectureSnapshotResult {
	current: ArchitectureDiagramWire | null;
	error?: {
		code: ArchitectureFailureCode;
		message: string;
	};
	previous: ArchitectureIR | null;
	rebuilt: boolean;
}

/** Broadcast announcing that a workspace's diagram file changed. */
export interface ArchitectureSnapshotChangedBroadcast {
	workspaceId: string;
}

/** Architecture-diagram IPC surface. */
export interface ArchitectureApi {
	getArchitectureSnapshot: (
		request: GetArchitectureSnapshotRequest,
	) => Promise<GetArchitectureSnapshotResult>;
	/** Subscribe to diagram-change broadcasts; returns an unsubscribe callback. */
	onArchitectureSnapshotChanged: (
		listener: (event: ArchitectureSnapshotChangedBroadcast) => void,
	) => () => void;
	scanArchitectureSnapshot: (
		request: ScanArchitectureSnapshotRequest,
	) => Promise<ScanArchitectureSnapshotResult>;
}
