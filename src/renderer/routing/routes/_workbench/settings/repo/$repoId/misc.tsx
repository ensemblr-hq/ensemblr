import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { Trash2Icon } from 'lucide-react';
import { useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';

import {
	getEnsemblrApi,
	invalidateWorkspaceListViews,
} from '@/renderer/api/ensemblr';
import { FilesToCopySetting } from '@/renderer/components/settings/repo-misc/files-to-copy-setting';
import { PreviewUrlsSetting } from '@/renderer/components/settings/repo-misc/preview-urls-setting';
import { SettingRow } from '@/renderer/components/settings/setting-row';
import { SettingsCodeValue } from '@/renderer/components/settings/settings-code-value';
import { SettingsSection } from '@/renderer/components/settings/settings-section';
import { Button } from '@/renderer/components/ui/button';
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from '@/renderer/components/ui/dialog';
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

/** Repository-scoped Misc settings panel for root/workspace paths, preview URLs, files-to-copy globs, and repository removal. */
function RepoMiscSettings() {
	const { t } = useTranslation();
	const { repoId } = Route.useParams();
	const { resolved, project } = useRepoSettings(repoId);
	const save = useRepoSettingsWriter(repoId, project);
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const [removeError, setRemoveError] = useState<string | null>(null);

	const remove = useMutation({
		mutationFn: () =>
			getEnsemblrApi().archiveRepository({ repositoryId: repoId }),
		onSuccess: async () => {
			await invalidateWorkspaceListViews(queryClient);
			navigate({ to: '/settings/general' });
		},
		onError: (error) =>
			setRemoveError(error instanceof Error ? error.message : String(error)),
	});

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
					'Do not move or delete this directory. Instead, remove the repository in Ensemblr.',
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
					<Dialog>
						<DialogTrigger asChild>
							<Button size='sm' variant='destructive'>
								<Trash2Icon aria-hidden='true' data-icon='inline-start' />
								{t('settings:repo.remove.trigger', 'Remove repository')}
							</Button>
						</DialogTrigger>
						<DialogContent>
							<DialogHeader>
								<DialogTitle>
									{t('settings:repo.remove.title', 'Remove this repository?')}
								</DialogTitle>
								<DialogDescription>
									<Trans
										components={{
											path: <code className='mx-1 font-mono text-xs' />,
										}}
										defaults='Removes the repository from Ensemblr. The on-disk directory at<path>{{path}}</path>is not deleted; delete it manually if you want it gone.'
										i18nKey='settings:repo.remove.description'
										values={{ path: project?.pathLabel ?? '' }}
									/>
								</DialogDescription>
							</DialogHeader>
							{removeError ? (
								<p className='text-status-danger text-xs'>{removeError}</p>
							) : null}
							<DialogFooter>
								<DialogClose asChild>
									<Button variant='ghost'>
										{t('common:actions.cancel', 'Cancel')}
									</Button>
								</DialogClose>
								<Button
									disabled={remove.isPending}
									onClick={() => remove.mutate()}
									variant='destructive'
								>
									{remove.isPending
										? t('common:actions.removing', 'Removing…')
										: t('common:actions.remove', 'Remove')}
								</Button>
							</DialogFooter>
						</DialogContent>
					</Dialog>
				}
				description={t(
					'settings:repo.remove.row-description',
					'Drops this repository from Ensemblr. Workspaces stop being tracked; nothing on disk is deleted.',
				)}
				label={t('settings:repo.remove.row-label', 'Remove repository')}
			/>
		</SettingsSection>
	);
}
