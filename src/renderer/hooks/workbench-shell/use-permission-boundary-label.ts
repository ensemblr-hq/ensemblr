import { useTranslation } from 'react-i18next';

import type { PermissionBoundary } from '@/shared/permissions';

/**
 * Screen-reader wording for what a permission boundary does to an action.
 * `classifyPermissionAction` runs in both processes and so returns a
 * locale-neutral code; the wording lives here, where the sentence it lands in
 * is translated too.
 * @param boundary - Boundary decision returned by `classifyPermissionAction`.
 * @returns The boundary label in the active language.
 */
export function usePermissionBoundaryLabel(
	boundary: PermissionBoundary,
): string {
	const { t } = useTranslation();

	if (boundary === 'allowed') {
		return t('workbench:permission-boundary.allowed', 'Allowed');
	}
	if (boundary === 'blocked') {
		return t('workbench:permission-boundary.blocked', 'Blocked');
	}
	return t(
		'workbench:permission-boundary.confirmation-required',
		'Requires confirmation',
	);
}
