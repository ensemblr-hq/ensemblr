export type { CheckpointCapturePort } from './checkpoint-service.ts';
export {
	CheckpointServiceError,
	computeTurnDiff,
	createCheckpointCapture,
	isOrdinalHidden,
	listTurnCheckpoints,
	listWorkspaceCheckpoints,
	readHiddenEventRanges,
	restoreTurnCheckpoint,
} from './checkpoint-service.ts';
export {
	captureWorkspaceCheckpoint,
	restoreWorkspaceTo,
	sanitizeRefSegment,
	snapshotWorkingTree,
} from './git-checkpoint.ts';
