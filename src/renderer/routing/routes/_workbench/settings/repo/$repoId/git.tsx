import { createFileRoute } from '@tanstack/react-router';

import { SettingRow } from '@/renderer/components/settings/setting-row';
import { SettingsSection } from '@/renderer/components/settings/settings-section';
import { SourceBadge } from '@/renderer/components/settings/source-badge';
import { Input } from '@/renderer/components/ui/input';
import { Switch } from '@/renderer/components/ui/switch';
import { useRepoSettings } from '@/renderer/hooks/use-repo-settings';

/** Route for a repository's Git settings; renders the repo-scoped git-defaults panel keyed by the `repoId` path param. */
export const Route = createFileRoute('/_workbench/settings/repo/$repoId/git')({
	component: RepoGitSettings,
});

/** Repository-scoped Git settings panel for branch-from, remote origin, and archive defaults that override user-scope git settings. */
function RepoGitSettings() {
	const { repoId } = Route.useParams();
	const { overrides, setOverrides, resolved } = useRepoSettings(repoId);

	return (
		<SettingsSection
			description='Per-repository git defaults. These override your user-scope git settings for this repo only.'
			title='Git'
		>
			<SettingRow
				control={
					<Input
						aria-label='Branch new workspaces from'
						className='h-8 w-44 font-mono text-xs'
						onChange={(e) =>
							setOverrides((prev) => ({
								...prev,
								branchFrom: e.target.value,
							}))
						}
						placeholder={
							(resolved('branchFrom')?.value as string) ?? 'origin/master'
						}
						value={overrides.branchFrom ?? ''}
					/>
				}
				description='Each workspace is an isolated copy of your codebase. Set the upstream branch new workspaces fork from.'
				label={
					<span className='flex items-center gap-2'>
						Branch new workspaces from
						<SourceBadge source={resolved('branchFrom')?.source} />
					</span>
				}
			/>

			<SettingRow
				control={
					<Input
						aria-label='Remote origin'
						className='h-8 w-44 font-mono text-xs'
						onChange={(e) =>
							setOverrides((prev) => ({
								...prev,
								remoteOrigin: e.target.value,
							}))
						}
						placeholder={
							(resolved('remoteOrigin')?.value as string) ?? 'origin'
						}
						value={overrides.remoteOrigin ?? ''}
					/>
				}
				description='Where Ensemblr pushes, pulls, and opens PRs.'
				label={
					<span className='flex items-center gap-2'>
						Remote origin
						<SourceBadge source={resolved('remoteOrigin')?.source} />
					</span>
				}
			/>

			<SettingRow
				control={
					<Switch
						checked={Boolean(resolved('deleteLocalBranchOnArchive')?.value)}
						disabled
					/>
				}
				description='Delete the local branch when archiving a workspace. Resolved from repository / user defaults.'
				label={
					<span className='flex items-center gap-2'>
						Delete branch on archive
						<SourceBadge
							source={resolved('deleteLocalBranchOnArchive')?.source}
						/>
					</span>
				}
			/>

			<SettingRow
				control={
					<Switch
						checked={Boolean(resolved('archiveAfterMerge')?.value)}
						disabled
					/>
				}
				description='Automatically archive a workspace after merging its PR. Resolved from repository / user defaults.'
				label={
					<span className='flex items-center gap-2'>
						Archive on merge
						<SourceBadge source={resolved('archiveAfterMerge')?.source} />
					</span>
				}
			/>

			<p className='py-3 text-muted-foreground text-xs'>
				Toggle defaults are currently read-only. Edit{' '}
				<code className='font-mono'>.ensemblr/settings.toml</code> to change
				shared values for the team.
			</p>
		</SettingsSection>
	);
}
