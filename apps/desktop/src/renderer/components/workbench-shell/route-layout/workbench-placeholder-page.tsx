import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';

import { WorkbenchEmptyStateContent } from '@/renderer/components/workbench-empty-state';
import { useSetupDiagnostics } from '@/renderer/components/workbench-shell/shell-contexts';
import type { WorkbenchActiveView } from '@/renderer/types/workbench-shell';

/** Placeholder content for dashboard/history/settings views. */
export function WorkbenchPlaceholderPage({
	view,
}: {
	view: Exclude<WorkbenchActiveView, 'welcome' | 'workspace'>;
}) {
	const { t } = useTranslation();
	const { state: setupDiagnosticsState } = useSetupDiagnostics();

	return (
		<WorkbenchEmptyStateContent
			emptyState={getWorkbenchPlaceholderCopy({
				setupStatus: setupDiagnosticsState.setupDiagnostics?.status,
				t,
				view,
			})}
		/>
	);
}

/** Picks placeholder title + detail copy for non-workspace workbench views. */
function getWorkbenchPlaceholderCopy({
	setupStatus,
	t,
	view,
}: {
	setupStatus?: string;
	/** Translator from the calling component's `useTranslation`. */
	t: TFunction;
	view: Exclude<WorkbenchActiveView, 'welcome' | 'workspace'>;
}) {
	if (setupStatus === 'blocked') {
		return {
			detail: t(
				'workbench:placeholder.setup.detail',
				'Complete setup checks before creating or opening workspaces.',
			),
			title: t('workbench:placeholder.setup.title', 'Setup required'),
		};
	}

	switch (view) {
		case 'history':
			return {
				detail: t(
					'workbench:placeholder.history.detail',
					'Session history is not connected yet.',
				),
				title: t('workbench:placeholder.history.title', 'History'),
			};
		case 'settings':
			return {
				detail: t(
					'workbench:placeholder.settings.detail',
					'Settings are available from the settings route.',
				),
				title: t('workbench:placeholder.settings.title', 'Settings'),
			};
		case 'dashboard':
			return {
				detail: t(
					'workbench:placeholder.dashboard.detail',
					'Kanban board is not connected yet.',
				),
				title: t('workbench:placeholder.dashboard.title', 'Dashboard'),
			};
		case 'linear':
			return {
				detail: t(
					'workbench:placeholder.linear.detail',
					'Linear issues are available from the Linear route.',
				),
				title: t('workbench:placeholder.linear.title', 'Linear'),
			};
		default: {
			const exhaustive: never = view;
			return exhaustive;
		}
	}
}
