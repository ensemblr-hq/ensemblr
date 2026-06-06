import type { StoredWorkspaceSelection } from '@/renderer/lib/workbench';
import { LAST_WORKSPACE_SELECTION_STORAGE_KEY } from './atoms';

export function readStoredWorkspaceSelection(): StoredWorkspaceSelection | null {
	if (typeof window === 'undefined') {
		return null;
	}

	const rawSelection = window.localStorage.getItem(
		LAST_WORKSPACE_SELECTION_STORAGE_KEY,
	);

	if (!rawSelection) {
		return null;
	}

	try {
		const selection = JSON.parse(rawSelection) as unknown;

		return isStoredWorkspaceSelection(selection) ? selection : null;
	} catch {
		return null;
	}
}

function isStoredWorkspaceSelection(
	selection: unknown,
): selection is StoredWorkspaceSelection {
	return (
		typeof selection === 'object' &&
		selection !== null &&
		'projectId' in selection &&
		'workspaceId' in selection &&
		typeof selection.projectId === 'string' &&
		typeof selection.workspaceId === 'string'
	);
}
