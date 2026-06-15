/** localStorage key for the per-workspace last-used "Open in…" target. */
const LAST_USED_OPEN_TARGET_STORAGE_KEY =
	'ensemble_workspace_open_target_last_used_v1';

type LastUsedMap = Readonly<Record<string, string>>;

/**
 * Reads the persisted target id last used to open the given workspace.
 * Returns `null` when missing, when storage is unavailable, or when the
 * stored payload is malformed.
 */
export function readLastUsedOpenTarget(workspaceId: string): string | null {
	const map = readMap();
	const targetId = map[workspaceId];
	return typeof targetId === 'string' && targetId.length > 0 ? targetId : null;
}

/**
 * Persists the target id last used to open `workspaceId`. Best-effort; silent
 * on quota / serialization failures since the menu still works without it.
 */
export function writeLastUsedOpenTarget(
	workspaceId: string,
	targetId: string,
): void {
	if (typeof window === 'undefined') {
		return;
	}
	const next = { ...readMap(), [workspaceId]: targetId };
	writeMap(next);
}

/**
 * Drops the last-used pointer for `workspaceId`. Should be called whenever a
 * workspace is deleted or archived so the per-workspace map does not grow
 * unbounded as workspaces accumulate.
 */
export function deleteLastUsedOpenTarget(workspaceId: string): void {
	if (typeof window === 'undefined') {
		return;
	}
	const current = readMap();
	if (!(workspaceId in current)) {
		return;
	}
	const next: Record<string, string> = {};
	for (const [key, value] of Object.entries(current)) {
		if (key !== workspaceId) {
			next[key] = value;
		}
	}
	writeMap(next);
}

function writeMap(map: LastUsedMap): void {
	try {
		window.localStorage.setItem(
			LAST_USED_OPEN_TARGET_STORAGE_KEY,
			JSON.stringify(map),
		);
	} catch {
		// localStorage write failures (quota, privacy mode) are non-fatal.
	}
}

function readMap(): LastUsedMap {
	if (typeof window === 'undefined') {
		return {};
	}
	const raw = window.localStorage.getItem(LAST_USED_OPEN_TARGET_STORAGE_KEY);
	if (!raw) {
		return {};
	}
	try {
		const parsed = JSON.parse(raw) as unknown;
		if (!isStringRecord(parsed)) {
			return {};
		}
		return parsed;
	} catch {
		return {};
	}
}

function isStringRecord(value: unknown): value is Record<string, string> {
	if (typeof value !== 'object' || value === null) {
		return false;
	}
	for (const entry of Object.values(value)) {
		if (typeof entry !== 'string') {
			return false;
		}
	}
	return true;
}
