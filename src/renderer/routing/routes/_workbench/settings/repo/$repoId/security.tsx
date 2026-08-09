import { createFileRoute } from '@tanstack/react-router';
import type { TFunction } from 'i18next';
import { Trans, useTranslation } from 'react-i18next';

import { SettingRow } from '@/renderer/components/settings/setting-row';
import { SettingsSection } from '@/renderer/components/settings/settings-section';
import { SourceBadge } from '@/renderer/components/settings/source-badge';
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from '@/renderer/components/ui/select';
import { useRepoSettings } from '@/renderer/hooks/use-repo-settings';
import { useRepoSettingsWriter } from '@/renderer/hooks/use-repo-settings-writer';
import {
	DEFAULT_PERMISSION_MODE,
	isPermissionMode,
	PERMISSION_MODES,
	type PermissionMode,
} from '@/shared/permissions';

/** Route for a repository's Security settings; renders the agent permission-mode panel keyed by the `repoId` path param. */
export const Route = createFileRoute(
	'/_workbench/settings/repo/$repoId/security',
)({
	component: RepoSecuritySettings,
});

/**
 * Human-readable copy for each permission mode. Built from `t()` rather than a
 * module-scope table so a language change re-renders them and so
 * `i18next-cli extract` can see every key statically.
 * @param t - Translation function from `useTranslation`
 * @returns Label and description for every permission mode
 */
function permissionModeCopy(
	t: TFunction,
): Record<PermissionMode, { label: string; description: string }> {
	return {
		'approval-required': {
			description: t(
				'settings:repo.security.permission-mode.approval-required-description',
				'Every write, command, and app-control action asks you first.',
			),
			label: t(
				'settings:repo.security.permission-mode.approval-required',
				'Approval required',
			),
		},
		'read-only': {
			description: t(
				'settings:repo.security.permission-mode.read-only-description',
				'Agents may read the workspace but cannot write, run commands, or drive the app.',
			),
			label: t('settings:repo.security.permission-mode.read-only', 'Read only'),
		},
		'workspace-trusted': {
			description: t(
				'settings:repo.security.permission-mode.workspace-trusted-description',
				'Agents act freely inside the workspace; anything outside it still asks.',
			),
			label: t(
				'settings:repo.security.permission-mode.workspace-trusted',
				'Workspace trusted',
			),
		},
	};
}

/** Repository-scoped Security settings panel for the agent permission mode workspaces of this repo run under. */
function RepoSecuritySettings() {
	const { t } = useTranslation();
	const { repoId } = Route.useParams();
	const { resolved, project } = useRepoSettings(repoId);
	const save = useRepoSettingsWriter(repoId, project);
	const copy = permissionModeCopy(t);

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
			<SettingRow
				control={
					<Select
						onValueChange={(next) =>
							save({ permissionMode: next as PermissionMode })
						}
						value={mode}
					>
						<SelectTrigger className='w-48' size='sm'>
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{PERMISSION_MODES.map((candidate) => (
								<SelectItem key={candidate} value={candidate}>
									{copy[candidate].label}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				}
				description={copy[mode].description}
				label={
					<span className='flex items-center gap-2'>
						{t(
							'settings:repo.security.permission-mode.label',
							'Agent permission mode',
						)}
						<SourceBadge source={snapshot?.source} />
					</span>
				}
				modified={snapshot?.source === 'sqlite'}
				onReset={() => save({ permissionMode: null })}
			/>

			<p className='py-3 text-muted-foreground text-xs'>
				<Trans
					components={{ file: <code className='font-mono' /> }}
					defaults='A committed <file>.ensemblr/settings.toml</file> value shared with the team still wins over this personal override — a repository can raise its own floor and you cannot lower it locally.'
					i18nKey='settings:repo.security.committed-note'
				/>
			</p>
		</SettingsSection>
	);
}
