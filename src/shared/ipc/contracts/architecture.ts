import type { ArchitectureIR } from '../../architecture-diagram.ts';

/** Request for a workspace's committed architecture diagram. */
export interface GetArchitectureSnapshotRequest {
	workspaceId: string;
}

/** Why an architecture request could not be served. */
export type ArchitectureFailureCode =
	| 'diagram-unreadable'
	| 'workspace-missing';

/**
 * The diagram as it is stored at `.ensemblr/architecture.json`, plus what the
 * panel's header needs to name it.
 */
export interface ArchitectureDiagramWire {
	/** ISO timestamp of the write. */
	generatedAt: string;
	ir: ArchitectureIR;
	/** Workspace-relative path of the file it came from. */
	relativePath: string;
}

/**
 * The workspace's diagram and the one this session's last write replaced.
 * `current` is null for a workspace no agent has drawn yet, which the panel
 * answers with its empty state; `previous` backs the delta badges and is null
 * after a restart.
 */
export interface GetArchitectureSnapshotResult {
	current: ArchitectureDiagramWire | null;
	error?: {
		code: ArchitectureFailureCode;
		message: string;
	};
	previous: ArchitectureIR | null;
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
}
