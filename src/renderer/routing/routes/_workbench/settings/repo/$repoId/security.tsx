import { createFileRoute } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';

import { PermissionModeRow } from '@/renderer/components/settings/permission-mode-row';
import { SettingsSection } from '@/renderer/components/settings/settings-section';
import { useRepoSettings } from '@/renderer/hooks/use-repo-settings';
import { useRepoSettingsWriter } from '@/renderer/hooks/use-repo-settings-writer';
import {
	DEFAULT_PERMISSION_MODE,
	isPermissionMode,
} from '@/shared/permissions';

/** Route for a repository's Security settings; renders the agent permission-mode panel keyed by the `repoId` path param. */
export const Route = createFileRoute(
	'/_workbench/settings/repo/$repoId/security',
)({
	component: RepoSecuritySettings,
});

/** Repository-scoped Security settings panel for the agent permission mode workspaces of this repo run under. */
function RepoSecuritySettings() {
	const { t } = useTranslation();
	const { repoId } = Route.useParams();
	const { resolved, project } = useRepoSettings(repoId);
	const save = useRepoSettingsWriter(repoId, project);

	const snapshot = resolved('security.permissionMode');
	const mode = isPermissionMode(snapshot?.value)
		? snapshot.value
		: DEFAULT_PERMISSION_MODE;

	return (
		<SettingsSection
			description={t(
				'settings:repo.security.description',
				'How much an agent may do on its own in this repository. Applies to every workspace of the repo, and to the tools agents reach over the control server.',
			)}
			title={t('settings:repo.security.title', 'Security')}
		>
			<PermissionModeRow
				mode={mode}
				onChange={(next) => save({ permissionMode: next })}
				onReset={() => save({ permissionMode: null })}
				source={snapshot?.source}
			/>

			<p className='py-3 text-muted-foreground text-xs'>
				{t(
					'settings:repo.security.scope-note',
					'This repository’s mode is the one Ensemblr enforces. Reset it and workspaces of this repo fall back to the app-wide default.',
				)}
			</p>
		</SettingsSection>
	);
}
