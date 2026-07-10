/**
 * Shared workspace name validation rules used by create and rename services.
 *
 * The function works on an already-trimmed string. Callers decide how to map
 * empty/missing input (some treat it as "use default", others as an error).
 */
type WorkspaceNameValidation =
	| { valid: true }
	| {
			code: 'name-required' | 'name-invalid';
			message: string;
			valid: false;
	  };

/** Maximum allowed length of a workspace display name. */
export const WORKSPACE_NAME_MAX_LENGTH = 100;

/** Characters allowed in a workspace name. */
export const WORKSPACE_NAME_PATTERN = /^[A-Za-z0-9 ._-]+$/;

/**
 * Validates a workspace name against the shared length / character / dot rules.
 * @param name - Already-trimmed candidate name.
 */
export function validateWorkspaceName(name: string): WorkspaceNameValidation {
	if (!name) {
		return {
			code: 'name-required',
			message: 'Workspace name cannot be empty.',
			valid: false,
		};
	}
	if (name.length > WORKSPACE_NAME_MAX_LENGTH) {
		return {
			code: 'name-invalid',
			message: `Workspace names must be ${WORKSPACE_NAME_MAX_LENGTH} characters or fewer.`,
			valid: false,
		};
	}
	if (name === '.' || name === '..' || name.startsWith('.')) {
		return {
			code: 'name-invalid',
			message: 'Workspace names cannot start with a dot.',
			valid: false,
		};
	}
	if (!WORKSPACE_NAME_PATTERN.test(name)) {
		return {
			code: 'name-invalid',
			message:
				'Workspace names may only contain letters, numbers, spaces, dots, dashes, or underscores.',
			valid: false,
		};
	}
	return { valid: true };
}
