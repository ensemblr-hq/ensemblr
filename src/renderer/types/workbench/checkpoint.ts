/**
 * Pending restore request. Branch/session ids are captured at request time so
 * the async confirm never reads stale component state if the active session
 * changes between click and confirmation.
 */
export interface CheckpointRestoreTarget {
	branchId: string;
	label: string;
	piSessionId: string;
	turnId: string;
}
