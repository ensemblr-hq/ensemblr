/**
 * Persisted record that a workspace's setup script completed for a given
 * dependency fingerprint. Stored under the `setup` key of a workspace's
 * `metadata_json` so an app restart can skip re-running setup when nothing that
 * affects it (the command or any dependency lockfile) has changed.
 */
export interface WorkspaceSetupState {
	/** The exact setup command that ran (e.g. `npm install`). */
	command: string;
	/** ISO-8601 timestamp of the successful completion. */
	completedAt: string;
	/** Hash of the setup command plus the worktree's dependency lockfiles. */
	fingerprint: string;
}

/** Metadata key under which {@link WorkspaceSetupState} is persisted. */
const SETUP_METADATA_KEY = 'setup';

/**
 * Reads the persisted setup state from a parsed workspace metadata record.
 * @param metadata - Parsed workspace `metadata_json` object.
 * @returns The stored setup state, or null when absent or malformed.
 */
export function readSetupState(
	metadata: Record<string, unknown>,
): WorkspaceSetupState | null {
	const value = metadata[SETUP_METADATA_KEY];

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

/**
 * Returns a new metadata record with the setup state merged in, leaving every
 * sibling key untouched.
 * @param metadata - Existing parsed workspace metadata record.
 * @param state - Setup state to persist.
 * @returns A new metadata record carrying the setup state.
 */
export function withSetupState(
	metadata: Record<string, unknown>,
	state: WorkspaceSetupState,
): Record<string, unknown> {
	return { ...metadata, [SETUP_METADATA_KEY]: state };
}
