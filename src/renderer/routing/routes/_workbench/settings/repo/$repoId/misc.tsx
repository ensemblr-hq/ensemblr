import { useQueryClient } from '@tanstack/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { Trash2Icon } from 'lucide-react';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { invalidateWorkspaceListViews } from '@/renderer/api/ensemblr';
import { FilesToCopySetting } from '@/renderer/components/settings/repo-misc/files-to-copy-setting';
import { PreviewUrlsSetting } from '@/renderer/components/settings/repo-misc/preview-urls-setting';
import { SettingRow } from '@/renderer/components/settings/setting-row';
import { SettingsCodeValue } from '@/renderer/components/settings/settings-code-value';
import { SettingsSection } from '@/renderer/components/settings/settings-section';
import { Button } from '@/renderer/components/ui/button';
import { DeleteRepositoryDialog } from '@/renderer/components/workbench-shell/delete-repository-dialog';
import { useRepoSettings } from '@/renderer/hooks/use-repo-settings';
import { useRepoSettingsWriter } from '@/renderer/hooks/use-repo-settings-writer';
import type { RepositoryPreviewUrl } from '@/shared/ipc/contracts/repository-settings';
import type { ResolvedSettingSnapshot } from '@/shared/ipc/contracts/settings-resolution';

/** Reads the personal (SQLite) preview URL rows from a resolved snapshot. */
function personalPreviewUrls(
	resolved: ResolvedSettingSnapshot | undefined,
): RepositoryPreviewUrl[] {
	if (resolved?.source !== 'sqlite' || !Array.isArray(resolved.value)) {
		return [];
	}

	return resolved.value.filter(
		(entry): entry is RepositoryPreviewUrl =>
			typeof entry === 'object' && entry !== null,
	);
}

/** Reads the personal (SQLite) files-to-copy patterns as a newline string. */
function personalFilesToCopy(
	resolved: ResolvedSettingSnapshot | undefined,
): string {
	if (resolved?.source !== 'sqlite' || !Array.isArray(resolved.value)) {
		return '';
	}

	return resolved.value.filter((entry) => typeof entry === 'string').join('\n');
}

/** Route for a repository's Misc settings; renders the repo-scoped paths, preview URLs, and lifecycle panel keyed by the `repoId` path param. */
export const Route = createFileRoute('/_workbench/settings/repo/$repoId/misc')({
	component: RepoMiscSettings,
});

/** Repository-scoped Misc settings panel for root/workspace paths, preview URLs, files-to-copy globs, and repository deletion. */
function RepoMiscSettings() {
	const { t } = useTranslation();
	const { repoId } = Route.useParams();
	const { resolved, project } = useRepoSettings(repoId);
	const save = useRepoSettingsWriter(repoId, project);
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);

	const handleDeleted = useCallback(async () => {
		await invalidateWorkspaceListViews(queryClient);
		navigate({ to: '/settings/general' });
	}, [navigate, queryClient]);

	const seededPreviewUrls = personalPreviewUrls(resolved('previewUrls'));
	const seededFilesToCopy = personalFilesToCopy(resolved('filesToCopy'));

	return (
		<SettingsSection
			description={t(
				'settings:repo.misc.description',
				'Repository paths, preview URLs, files-to-copy patterns, and lifecycle.',
			)}
			title={t('settings:repo.misc.title', 'Misc')}
		>
			<SettingRow
				description={t(
					'settings:repo.root-path.description',
					'Do not move or delete this directory. Instead, delete the repository in Ensemblr.',
				)}
				label={t('settings:repo.root-path.label', 'Root path')}
				stack
			>
				<SettingsCodeValue value={project?.pathLabel ?? '—'} />
			</SettingRow>

			<SettingRow
				description={t(
					'settings:repo.workspaces-path.description',
					'Do not move or delete the workspace subdirectories. Instead, archive workspaces in Ensemblr.',
				)}
				label={t('settings:repo.workspaces-path.label', 'Workspaces path')}
				stack
			>
				<SettingsCodeValue
					value={project ? `${project.pathLabel} (workspaces)` : '—'}
				/>
			</SettingRow>

			<PreviewUrlsSetting
				modified={resolved('previewUrls')?.source === 'sqlite'}
				onSave={(urls) => save({ previewUrls: urls })}
				seed={seededPreviewUrls}
			/>

			<FilesToCopySetting
				modified={resolved('filesToCopy')?.source === 'sqlite'}
				onSave={(patterns) => save({ filesToCopy: patterns })}
				seed={seededFilesToCopy}
			/>

			<SettingRow
				control={
					<Button
						disabled={!project}
						onClick={() => setIsDeleteDialogOpen(true)}
						size='sm'
						variant='destructive'
					>
						<Trash2Icon aria-hidden='true' data-icon='inline-start' />
						{t('settings:repo.delete.trigger', 'Delete repository')}
					</Button>
				}
				description={t(
					'settings:repo.delete.row-description',
					'Drops this repository from Ensemblr and deletes every workspace worktree. You choose whether the repository folder itself is removed from disk.',
				)}
				label={t('settings:repo.delete.row-label', 'Delete repository')}
			/>

			<DeleteRepositoryDialog
				onDeleted={handleDeleted}
				onOpenChange={setIsDeleteDialogOpen}
				open={isDeleteDialogOpen}
				project={project ?? null}
			/>
		</SettingsSection>
	);
}
