/**
 * Persisted record that a workspace's setup script completed for a given
 * dependency fingerprint. Written to `.context/setup.local.json` inside the
 * worktree so reopening a workspace can skip re-running setup when neither the
 * command nor any dependency lockfile has changed.
 */
export interface WorkspaceSetupState {
	/** The exact setup command that ran (e.g. `npm install`). */
	command: string;
	/** ISO-8601 timestamp of the successful completion. */
	completedAt: string;
	/** Hash of the setup command plus the worktree's dependency lockfiles. */
	fingerprint: string;
}

/**
 * Validates an unknown value (typically the result of `JSON.parse`) as a
 * {@link WorkspaceSetupState}.
 * @param value - Candidate value to validate.
 * @returns The validated setup state, or null when absent or malformed.
 */
export function parseSetupState(value: unknown): WorkspaceSetupState | null {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) {
		return null;
	}

	const record = value as Record<string, unknown>;

	if (
		typeof record.command !== 'string' ||
		typeof record.completedAt !== 'string' ||
		typeof record.fingerprint !== 'string'
	) {
		return null;
	}

	return {
		command: record.command,
		completedAt: record.completedAt,
		fingerprint: record.fingerprint,
	};
}
