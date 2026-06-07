/** Permission modes a workspace can run under, ordered from most to least permissive. */
export const PERMISSION_MODES = [
	'workspace-trusted',
	'approval-required',
	'read-only',
] as const;

/** A single permission mode selected from {@link PERMISSION_MODES}. */
export type PermissionMode = (typeof PERMISSION_MODES)[number];

/** Discrete action kinds whose blast radius drives permission classification. */
export type PermissionActionKind =
	| 'app-settings-change'
	| 'outside-workspace-write'
	| 'pi-global-config-change'
	| 'pull-request-merge'
	| 'repository-removal'
	| 'root-directory-change'
	| 'workspace-archive-delete'
	| 'workspace-command'
	| 'workspace-read'
	| 'workspace-write';

/** Resolution applied to a single action under a given permission mode. */
export type PermissionBoundary =
	| 'allowed'
	| 'blocked'
	| 'confirmation-required';

/** Permission boundary decision for one action, with explanatory reason. */
export interface PermissionBoundarySnapshot {
	action: PermissionActionKind;
	boundary: PermissionBoundary;
	mode: PermissionMode;
	reason: string;
}

/** Default permission mode applied to a workspace when no explicit mode is set. */
export const DEFAULT_PERMISSION_MODE: PermissionMode = 'workspace-trusted';

const PERMISSION_MODE_LABELS = {
	'approval-required': 'Approval required',
	'read-only': 'Read only',
	'workspace-trusted': 'Workspace trusted',
} satisfies Record<PermissionMode, string>;

const PERMISSION_BOUNDARY_LABELS = {
	allowed: 'Allowed',
	blocked: 'Blocked',
	'confirmation-required': 'Requires confirmation',
} satisfies Record<PermissionBoundary, string>;

const SENSITIVE_ACTIONS = new Set<PermissionActionKind>([
	'app-settings-change',
	'outside-workspace-write',
	'pi-global-config-change',
	'pull-request-merge',
	'repository-removal',
	'root-directory-change',
	'workspace-archive-delete',
]);

/**
 * Type guard that narrows an unknown value to a valid {@link PermissionMode}.
 * @param value - Candidate value to test.
 * @returns True when `value` is a recognised permission mode string.
 */
export function isPermissionMode(value: unknown): value is PermissionMode {
	return (
		typeof value === 'string' &&
		PERMISSION_MODES.includes(value as PermissionMode)
	);
}

/**
 * Coerces an unknown value into a valid {@link PermissionMode}, falling back to the default.
 * @param value - Candidate value to normalise.
 * @returns A valid permission mode, defaulting to {@link DEFAULT_PERMISSION_MODE} on mismatch.
 */
export function normalizePermissionMode(value: unknown): PermissionMode {
	return isPermissionMode(value) ? value : DEFAULT_PERMISSION_MODE;
}

/**
 * Builds a human-readable explanation for why a value is not a valid permission mode.
 * @param value - Candidate value previously rejected by {@link isPermissionMode}.
 * @returns Reason string, or `null` when the value is in fact a valid mode.
 */
export function getInvalidPermissionModeReason(value: unknown): string | null {
	if (isPermissionMode(value)) {
		return null;
	}

	const formattedValue =
		typeof value === 'string' ? `"${value}"` : typeof value;

	return `Invalid permission mode ${formattedValue}. Expected one of: ${PERMISSION_MODES.join(', ')}.`;
}

/**
 * Returns the user-facing label for a given permission mode.
 * @param mode - Mode whose label is requested.
 * @returns Display string suitable for UI rendering.
 */
export function getPermissionModeLabel(mode: PermissionMode): string {
	return PERMISSION_MODE_LABELS[mode];
}

/**
 * Returns the user-facing label for a given permission boundary outcome.
 * @param boundary - Boundary whose label is requested.
 * @returns Display string suitable for UI rendering.
 */
export function getPermissionBoundaryLabel(
	boundary: PermissionBoundary,
): string {
	return PERMISSION_BOUNDARY_LABELS[boundary];
}

/**
 * Classifies an action under a given permission mode, returning the boundary
 * decision and the rationale.
 * @param input - Action and active permission mode to classify.
 * @returns Snapshot describing whether the action is allowed, blocked, or requires confirmation.
 */
export function classifyPermissionAction({
	action,
	mode,
}: {
	action: PermissionActionKind;
	mode: PermissionMode;
}): PermissionBoundarySnapshot {
	if (action === 'workspace-read') {
		return createBoundary({
			action,
			boundary: 'allowed',
			mode,
			reason: 'Read/search/list-style actions are allowed in every mode.',
		});
	}

	if (SENSITIVE_ACTIONS.has(action)) {
		return createBoundary({
			action,
			boundary: 'confirmation-required',
			mode,
			reason:
				'This action can affect files outside the current workspace, app state, Pi global configuration, or externally visible project state.',
		});
	}

	if (mode === 'read-only') {
		return createBoundary({
			action,
			boundary: 'blocked',
			mode,
			reason:
				'Read-only mode restricts workspace write, shell, script, terminal, and tool execution where enforcement is available.',
		});
	}

	if (mode === 'approval-required') {
		return createBoundary({
			action,
			boundary: 'confirmation-required',
			mode,
			reason:
				'Approval-required mode pauses before detectable workspace writes and local command execution.',
		});
	}

	return createBoundary({
		action,
		boundary: 'allowed',
		mode,
		reason:
			'Workspace-trusted mode allows normal in-workspace coding actions without per-action approval.',
	});
}

/**
 * Pass-through helper that returns its boundary snapshot, kept as a single
 * construction site so the shape is easy to evolve.
 * @param snapshot - Snapshot to forward.
 * @returns The snapshot, unchanged.
 */
function createBoundary(
	snapshot: PermissionBoundarySnapshot,
): PermissionBoundarySnapshot {
	return snapshot;
}
