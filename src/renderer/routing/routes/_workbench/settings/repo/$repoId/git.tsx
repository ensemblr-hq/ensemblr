import { createFileRoute } from '@tanstack/react-router';

import { SettingRow } from '@/renderer/components/settings/setting-row';
import { SettingsSection } from '@/renderer/components/settings/settings-section';
import { SourceBadge } from '@/renderer/components/settings/source-badge';
import { Input } from '@/renderer/components/ui/input';
import { Switch } from '@/renderer/components/ui/switch';
import { useDebouncedSettingField } from '@/renderer/hooks/use-debounced-setting-field';
import { useRepoSettings } from '@/renderer/hooks/use-repo-settings';
import { useRepoSettingsWriter } from '@/renderer/hooks/use-repo-settings-writer';
import type { ResolvedSettingSnapshot } from '@/shared/ipc/contracts/settings-resolution';

/** Debounce window before a typed repo-git field is persisted to SQLite. */
const SAVE_DEBOUNCE_MS = 500;

/** Personal (SQLite) override value for a resolved setting, or `''` when it resolves from another source. */
function personalValue(resolved: ResolvedSettingSnapshot | undefined): string {
	return resolved?.source === 'sqlite' ? String(resolved.value ?? '') : '';
}

/** True when a resolved setting is currently supplied by a personal (SQLite) override. */
function isPersonalOverride(
	resolved: ResolvedSettingSnapshot | undefined,
): boolean {
	return resolved?.source === 'sqlite';
}

/** Route for a repository's Git settings; renders the repo-scoped git-defaults panel keyed by the `repoId` path param. */
export const Route = createFileRoute('/_workbench/settings/repo/$repoId/git')({
	component: RepoGitSettings,
});

/** Repository-scoped Git settings panel for branch-from, remote origin, and archive defaults that override user-scope git settings. */
function RepoGitSettings() {
	const { repoId } = Route.useParams();
	const { resolved, project } = useRepoSettings(repoId);
	const save = useRepoSettingsWriter(repoId, project);

	const branchFrom = resolved('branchFrom');
	const remoteOrigin = resolved('remoteOrigin');

	return (
		<SettingsSection
			description='Per-repository git defaults. These override your user-scope git settings for this repo only.'
			title='Git'
		>
			<TextSetting
				ariaLabel='Branch new workspaces from'
				description='Each workspace is an isolated copy of your codebase. Set the upstream branch new workspaces fork from.'
				label='Branch new workspaces from'
				modified={isPersonalOverride(branchFrom)}
				onReset={() => save({ branchFrom: null })}
				onSave={(value) => save({ branchFrom: value })}
				placeholder={(branchFrom?.value as string) || 'origin/master'}
				resolved={branchFrom}
				seed={personalValue(branchFrom)}
			/>

			<SettingRow
				control={
					<Input
						aria-label='Remote origin'
						className='h-8 w-44 font-mono text-xs'
						disabled
						value={(remoteOrigin?.value as string) || 'origin'}
					/>
				}
				description='Where Ensemblr pushes, pulls, and opens PRs. Read-only for now — runtime honors the git "origin" remote; a configurable remote is planned.'
				label={
					<span className='flex items-center gap-2'>
						Remote origin
						<SourceBadge source={remoteOrigin?.source} />
					</span>
				}
			/>

			<SettingRow
				control={
					<Switch
						checked={Boolean(resolved('deleteLocalBranchOnArchive')?.value)}
						onCheckedChange={(checked) =>
							save({ deleteLocalBranchOnArchive: checked })
						}
					/>
				}
				description='Delete the local branch when archiving a workspace. Overrides your user-scope default for this repo.'
				label={
					<span className='flex items-center gap-2'>
						Delete branch on archive
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
				description='Automatically archive a workspace after merging its PR. Overrides your user-scope default for this repo.'
				label={
					<span className='flex items-center gap-2'>
						Archive on merge
						<SourceBadge source={resolved('archiveAfterMerge')?.source} />
					</span>
				}
				modified={isPersonalOverride(resolved('archiveAfterMerge'))}
				onReset={() => save({ archiveAfterMerge: null })}
			/>

			<p className='py-3 text-muted-foreground text-xs'>
				Committed <code className='font-mono'>.ensemblr/settings.toml</code>{' '}
				values shared with the team still win over these personal overrides.
			</p>
		</SettingsSection>
	);
}

/**
 * A repo-git text setting whose personal SQLite value hydrates from the resolved
 * snapshot and persists on a debounce. A blank value clears the personal row so
 * the setting falls back to the next resolver source.
 */
function TextSetting({
	ariaLabel,
	description,
	label,
	modified,
	onReset,
	onSave,
	placeholder,
	resolved,
	seed,
}: {
	ariaLabel: string;
	description: string;
	label: string;
	modified: boolean;
	onReset: () => void;
	onSave: (value: string | null) => void;
	placeholder: string;
	resolved: ResolvedSettingSnapshot | undefined;
	seed: string;
}) {
	const { onChange, value } = useDebouncedSettingField(
		seed,
		(next) => {
			const trimmed = next.trim();
			onSave(trimmed || null);
			return trimmed;
		},
		SAVE_DEBOUNCE_MS,
	);

	return (
		<SettingRow
			control={
				<Input
					aria-label={ariaLabel}
					className='h-8 w-44 font-mono text-xs'
					onChange={(e) => onChange(e.target.value)}
					placeholder={placeholder}
					value={value}
				/>
			}
			description={description}
			label={
				<span className='flex items-center gap-2'>
					{label}
					<SourceBadge source={resolved?.source} />
				</span>
			}
			modified={modified}
			onReset={onReset}
		/>
	);
}
