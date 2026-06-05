export const PERMISSION_MODES = [
	'workspace-trusted',
	'approval-required',
	'read-only',
] as const;

export type PermissionMode = (typeof PERMISSION_MODES)[number];

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

export type PermissionBoundary =
	| 'allowed'
	| 'blocked'
	| 'confirmation-required';

export interface PermissionBoundarySnapshot {
	action: PermissionActionKind;
	boundary: PermissionBoundary;
	mode: PermissionMode;
	reason: string;
}

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

export function isPermissionMode(value: unknown): value is PermissionMode {
	return (
		typeof value === 'string' &&
		PERMISSION_MODES.includes(value as PermissionMode)
	);
}

export function normalizePermissionMode(value: unknown): PermissionMode {
	return isPermissionMode(value) ? value : DEFAULT_PERMISSION_MODE;
}

export function getInvalidPermissionModeReason(value: unknown): string | null {
	if (isPermissionMode(value)) {
		return null;
	}

	const formattedValue =
		typeof value === 'string' ? `"${value}"` : typeof value;

	return `Invalid permission mode ${formattedValue}. Expected one of: ${PERMISSION_MODES.join(', ')}.`;
}

export function getPermissionModeLabel(mode: PermissionMode): string {
	return PERMISSION_MODE_LABELS[mode];
}

export function getPermissionBoundaryLabel(
	boundary: PermissionBoundary,
): string {
	return PERMISSION_BOUNDARY_LABELS[boundary];
}

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

function createBoundary(
	snapshot: PermissionBoundarySnapshot,
): PermissionBoundarySnapshot {
	return snapshot;
}
