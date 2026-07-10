/**
 * Stable per-workspace port allocation.
 *
 * Every workspace gets one port from a dedicated range so setup/run scripts,
 * terminals, and preview templates can rely on `ENSEMBLR_PORT` without
 * colliding with sibling workspaces. Allocation is deterministic-first (a hash
 * of the workspace id picks the starting slot) with linear probing past ports
 * already held by other active workspaces, and the chosen port is persisted in
 * workspace metadata so it stays stable across app restarts.
 */

/** First port of the Ensemblr workspace range. */
export const WORKSPACE_PORT_RANGE_START = 41_000;

/** Number of ports in the Ensemblr workspace range. */
export const WORKSPACE_PORT_RANGE_SIZE = 1_000;

/** Metadata key under which the allocated port is persisted. */
export const WORKSPACE_PORT_METADATA_KEY = 'ensemblrPort';

/** Inputs for {@link pickWorkspacePort}. */
export interface PickWorkspacePortOptions {
	preferredPort?: number | null;
	usedPorts: ReadonlySet<number>;
	workspaceId: string;
}

/**
 * Returns true when `value` is a port inside the Ensemblr workspace range.
 * @param value - Candidate value (usually read from persisted metadata).
 */
export function isWorkspacePort(value: unknown): value is number {
	return (
		typeof value === 'number' &&
		Number.isInteger(value) &&
		value >= WORKSPACE_PORT_RANGE_START &&
		value < WORKSPACE_PORT_RANGE_START + WORKSPACE_PORT_RANGE_SIZE
	);
}

/**
 * Derives the deterministic starting slot for a workspace id. Stable across
 * processes so re-allocation lands on the same port when it is still free.
 * @param workspaceId - Workspace identifier.
 * @returns A port inside the workspace range.
 */
export function deriveWorkspacePortCandidate(workspaceId: string): number {
	// FNV-1a 32-bit: tiny, dependency-free, good dispersion for short ids.
	let hash = 0x811c9dc5;

	for (let index = 0; index < workspaceId.length; index += 1) {
		hash ^= workspaceId.charCodeAt(index);
		hash = Math.imul(hash, 0x01000193);
	}

	return (
		WORKSPACE_PORT_RANGE_START + ((hash >>> 0) % WORKSPACE_PORT_RANGE_SIZE)
	);
}

/**
 * Picks the port for a workspace: keeps a valid persisted port when it is not
 * held by another workspace, otherwise probes forward from the deterministic
 * candidate until a free slot is found.
 * @param options - Preferred (persisted) port, ports held by other active
 * workspaces, and the workspace id.
 * @returns The chosen port.
 */
export function pickWorkspacePort({
	preferredPort,
	usedPorts,
	workspaceId,
}: PickWorkspacePortOptions): number {
	if (isWorkspacePort(preferredPort) && !usedPorts.has(preferredPort)) {
		return preferredPort;
	}

	const start = deriveWorkspacePortCandidate(workspaceId);

	for (let offset = 0; offset < WORKSPACE_PORT_RANGE_SIZE; offset += 1) {
		const candidate =
			WORKSPACE_PORT_RANGE_START +
			((start - WORKSPACE_PORT_RANGE_START + offset) %
				WORKSPACE_PORT_RANGE_SIZE);

		if (!usedPorts.has(candidate)) {
			return candidate;
		}
	}

	// Range exhausted (1000+ active workspaces): fall back to the deterministic
	// candidate rather than failing the whole environment assembly.
	return start;
}
