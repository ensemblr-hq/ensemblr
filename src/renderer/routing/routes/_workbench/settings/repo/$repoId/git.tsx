import { createFileRoute } from '@tanstack/react-router';
import { Trans, useTranslation } from 'react-i18next';

import { BranchPicker } from '@/renderer/components/git/branch-picker';
import { SettingRow } from '@/renderer/components/settings/setting-row';
import { SettingsSection } from '@/renderer/components/settings/settings-section';
import { SourceBadge } from '@/renderer/components/settings/source-badge';
import { Input } from '@/renderer/components/ui/input';
import { Switch } from '@/renderer/components/ui/switch';
import { useRepoSettings } from '@/renderer/hooks/use-repo-settings';
import { useRepoSettingsWriter } from '@/renderer/hooks/use-repo-settings-writer';
import { originQualifiedRef } from '@/shared/branch-ref';
import type { RepositorySettingsPatch } from '@/shared/ipc/contracts/repository-settings';
import type { ResolvedSettingSnapshot } from '@/shared/ipc/contracts/settings-resolution';

/** True when a resolved setting is currently supplied by a personal (SQLite) override. */
function isPersonalOverride(
	resolved: ResolvedSettingSnapshot | undefined,
): boolean {
	return resolved?.source === 'sqlite';
}

/**
 * Reads a resolved setting as a string, since the resolver types values as
 * `unknown` and a malformed config row must not reach a string-only consumer.
 * @param resolved - The resolved setting snapshot, if the key resolved at all.
 * @returns The string value, or undefined when it is absent or another type.
 */
function stringValue(
	resolved: ResolvedSettingSnapshot | undefined,
): string | undefined {
	return typeof resolved?.value === 'string' ? resolved.value : undefined;
}

/** Route for a repository's Git settings; renders the repo-scoped git-defaults panel keyed by the `repoId` path param. */
export const Route = createFileRoute('/_workbench/settings/repo/$repoId/git')({
	component: RepoGitSettings,
});

/** Repository-scoped Git settings panel for branch-from, remote origin, and archive defaults that override user-scope git settings. */
function RepoGitSettings() {
	const { t } = useTranslation();
	const { repoId } = Route.useParams();
	const { resolved, project } = useRepoSettings(repoId);
	const save = useRepoSettingsWriter(repoId, project);

	return (
		<SettingsSection
			description={t(
				'settings:repo.git.description',
				'Per-repository git defaults. These override your user-scope git settings for this repo only.',
			)}
			title={t('settings:repo.git.title', 'Git')}
		>
			<BranchFromSetting
				repoId={repoId}
				resolved={resolved('branchFrom')}
				save={save}
			/>

			<RemoteOriginSetting resolved={resolved('remoteOrigin')} />

			<SettingRow
				control={
					<Switch
						checked={Boolean(resolved('deleteLocalBranchOnArchive')?.value)}
						onCheckedChange={(checked) =>
							save({ deleteLocalBranchOnArchive: checked })
						}
					/>
				}
				description={t(
					'settings:repo.delete-branch.description',
					'Delete the local branch when archiving a workspace. Overrides your user-scope default for this repo.',
				)}
				label={
					<span className='flex items-center gap-2'>
						{t('settings:repo.delete-branch.label', 'Delete branch on archive')}
						<SourceBadge
							source={resolved('deleteLocalBranchOnArchive')?.source}
						/>
					</span>
				}
				modified={isPersonalOverride(resolved('deleteLocalBranchOnArchive'))}
				onReset={() => save({ deleteLocalBranchOnArchive: null })}
			/>

			<SettingRow
				control={
					<Switch
						checked={Boolean(resolved('archiveAfterMerge')?.value)}
						onCheckedChange={(checked) => save({ archiveAfterMerge: checked })}
					/>
				}
				description={t(
					'settings:repo.archive-on-merge.description',
					'Automatically archive a workspace after merging its PR. Overrides your user-scope default for this repo.',
				)}
				label={
					<span className='flex items-center gap-2'>
						{t('settings:repo.archive-on-merge.label', 'Archive on merge')}
						<SourceBadge source={resolved('archiveAfterMerge')?.source} />
					</span>
				}
				modified={isPersonalOverride(resolved('archiveAfterMerge'))}
				onReset={() => save({ archiveAfterMerge: null })}
			/>

			<p className='py-3 text-muted-foreground text-xs'>
				<Trans
					components={{ file: <code className='font-mono' /> }}
					defaults='Committed <file>.ensemblr/settings.toml</file> values shared with the team still win over these personal overrides.'
					i18nKey='settings:repo.git.committed-note'
				/>
			</p>
		</SettingsSection>
	);
}

/**
 * Read-only display of the remote every git operation targets. Editable once a
 * configurable remote lands; until then it exists so the resolved value and its
 * source are visible rather than implied.
 */
function RemoteOriginSetting({
	resolved,
}: {
	resolved: ResolvedSettingSnapshot | undefined;
}) {
	const { t } = useTranslation();

	return (
		<SettingRow
			control={
				<Input
					aria-label={t('settings:repo.remote-origin.label', 'Remote origin')}
					className='h-8 w-44 font-mono text-xs'
					disabled
					value={stringValue(resolved) || 'origin'}
				/>
			}
			description={t(
				'settings:repo.remote-origin.description',
				'Where Ensemblr pushes, pulls, and opens PRs. Read-only for now — runtime honors the git "origin" remote; a configurable remote is planned.',
			)}
			label={
				<span className='flex items-center gap-2'>
					{t('settings:repo.remote-origin.label', 'Remote origin')}
					<SourceBadge source={resolved?.source} />
				</span>
			}
		/>
	);
}

/**
 * Repo-scoped picker for the branch new workspaces fork from. Choosing
 * "Repository default" clears the personal SQLite row so the setting falls back
 * to the next resolver source rather than pinning the probed default. Typed refs
 * are stored verbatim, keeping non-GitHub repositories, other remotes, and tags
 * reachable now that the list itself comes from `gh`.
 */
function BranchFromSetting({
	repoId,
	resolved,
	save,
}: {
	repoId: string;
	resolved: ResolvedSettingSnapshot | undefined;
	save: (patch: RepositorySettingsPatch) => Promise<void>;
}) {
	const { t } = useTranslation();
	const clear = () => save({ branchFrom: null });
	const repositoryDefault = t(
		'settings:repo.branch-from.repository-default',
		'Repository default',
	);

	return (
		<SettingRow
			control={
				<BranchPicker
					className='max-w-48'
					fallbackOption={{
						isActive: !isPersonalOverride(resolved),
						label: repositoryDefault,
						onSelect: clear,
					}}
					onSelect={(branchName) =>
						save({ branchFrom: originQualifiedRef(branchName) })
					}
					onSelectCustomRef={(ref) => save({ branchFrom: ref })}
					placeholder={repositoryDefault}
					repositoryId={repoId}
					searchPlaceholder={t(
						'settings:repo.branch-from.search-placeholder',
						'Search or enter a ref…',
					)}
					value={stringValue(resolved)}
				/>
			}
			description={t(
				'settings:repo.branch-from.description',
				'Each workspace is an isolated copy of your codebase. Set the upstream branch new workspaces fork from.',
			)}
			label={
				<span className='flex items-center gap-2'>
					{t('settings:repo.branch-from.label', 'Branch new workspaces from')}
					<SourceBadge source={resolved?.source} />
				</span>
			}
			modified={isPersonalOverride(resolved)}
			onReset={clear}
		/>
	);
}
