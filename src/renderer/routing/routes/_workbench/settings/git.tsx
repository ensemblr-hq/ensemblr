import { createFileRoute } from '@tanstack/react-router';
import { useAtom } from 'jotai';
import { useTranslation } from 'react-i18next';

import { SettingRow } from '@/renderer/components/settings/setting-row';
import { SettingsSection } from '@/renderer/components/settings/settings-section';
import { Input } from '@/renderer/components/ui/input';
import {
	RadioGroup,
	RadioGroupItem,
} from '@/renderer/components/ui/radio-group';
import { Switch } from '@/renderer/components/ui/switch';
import {
	archiveOnMergeAtom,
	branchPrefixCustomAtom,
	branchPrefixSourceAtom,
	coAuthorEnsemblrAtom,
	deleteBranchOnArchiveAtom,
	renameWorkspaceOnBranchAtom,
	setUpstreamOnPushAtom,
} from '@/renderer/state/preferences';
import { ENSEMBLR_CO_AUTHOR_TRAILER } from '@/shared/co-author';
import { DEFAULT_APP_SETTINGS } from '@/shared/config';

/** Route for the Git settings section; renders the git-settings panel. */
export const Route = createFileRoute('/_workbench/settings/git')({
	component: GitSettings,
});

/** Factory defaults; a row shows its "modified" accent when its value differs. */
const DEFAULTS = DEFAULT_APP_SETTINGS.git;

/** Git settings panel for workspace branch-name prefix defaults and merge/archive lifecycle behavior. */
function GitSettings() {
	const { t } = useTranslation();
	const [prefixSource, setPrefixSource] = useAtom(branchPrefixSourceAtom);
	const [customPrefix, setCustomPrefix] = useAtom(branchPrefixCustomAtom);
	const [renameOnBranch, setRenameOnBranch] = useAtom(
		renameWorkspaceOnBranchAtom,
	);
	const [deleteBranch, setDeleteBranch] = useAtom(deleteBranchOnArchiveAtom);
	const [archiveOnMerge, setArchiveOnMerge] = useAtom(archiveOnMergeAtom);
	const [setUpstream, setSetUpstream] = useAtom(setUpstreamOnPushAtom);
	const [coAuthor, setCoAuthor] = useAtom(coAuthorEnsemblrAtom);

	const branchPrefixModified =
		prefixSource !== DEFAULTS.branchPrefixSource ||
		(prefixSource === 'custom' && customPrefix !== DEFAULTS.branchPrefixCustom);

	return (
		<SettingsSection
			description={t(
				'settings:git.description',
				'Workspace branch defaults and lifecycle behavior. Repository-scope overrides win when set.',
			)}
			title={t('settings:git.title', 'Git')}
		>
			<SettingRow
				description={t(
					'settings:git.branch-prefix.description',
					'Prefix for new workspace branch names.',
				)}
				label={t('settings:git.branch-prefix.label', 'Branch name prefix')}
				modified={branchPrefixModified}
				onReset={() => {
					setPrefixSource(DEFAULTS.branchPrefixSource);
					setCustomPrefix(DEFAULTS.branchPrefixCustom);
				}}
				stack
			>
				<RadioGroup
					className='flex flex-col gap-2'
					onValueChange={(v) => setPrefixSource(v as typeof prefixSource)}
					value={prefixSource}
				>
					<div className='flex h-7 items-center gap-2 text-sm'>
						<RadioGroupItem id='branch-prefix-gh' value='github-username' />
						<label className='cursor-pointer' htmlFor='branch-prefix-gh'>
							{t(
								'settings:git.branch-prefix.github-username',
								'GitHub username (resolved via `gh`)',
							)}
						</label>
					</div>
					<div className='flex h-7 items-center gap-2 text-sm'>
						<RadioGroupItem id='branch-prefix-custom' value='custom' />
						<label className='cursor-pointer' htmlFor='branch-prefix-custom'>
							{t('settings:git.branch-prefix.custom', 'Custom')}
						</label>
						<Input
							aria-label={t(
								'settings:git.branch-prefix.custom-aria-label',
								'Custom branch prefix',
							)}
							className='h-7 w-40 font-mono text-xs'
							disabled={prefixSource !== 'custom'}
							onChange={(e) => setCustomPrefix(e.target.value)}
							placeholder='feature'
							value={customPrefix}
						/>
					</div>
					<div className='flex h-7 items-center gap-2 text-sm'>
						<RadioGroupItem id='branch-prefix-none' value='none' />
						<label className='cursor-pointer' htmlFor='branch-prefix-none'>
							{t('settings:git.branch-prefix.none', 'None')}
						</label>
					</div>
				</RadioGroup>
			</SettingRow>

			<SettingRow
				control={
					<Switch
						checked={renameOnBranch}
						onCheckedChange={setRenameOnBranch}
					/>
				}
				description={t(
					'settings:git.rename-workspace.description',
					'Ask the agent to rename a workspace from its placeholder composer name, and its git branch to match, once it knows what the work is. Off leaves the placeholder name in place.',
				)}
				label={t(
					'settings:git.rename-workspace.label',
					'Let agents name the workspace and branch',
				)}
				modified={renameOnBranch !== DEFAULTS.renameWorkspaceOnBranch}
				onReset={() => setRenameOnBranch(DEFAULTS.renameWorkspaceOnBranch)}
			/>

			<SettingRow
				control={
					<Switch checked={deleteBranch} onCheckedChange={setDeleteBranch} />
				}
				description={t(
					'settings:git.delete-branch.description',
					'Remove the worktree and delete the local branch whenever a workspace is archived, from the archive dialog and after a merge alike. To delete the remote branch, configure it on GitHub.',
				)}
				label={t(
					'settings:git.delete-branch.label',
					'Delete branch on archive',
				)}
				modified={deleteBranch !== DEFAULTS.deleteLocalBranchOnArchive}
				onReset={() => setDeleteBranch(DEFAULTS.deleteLocalBranchOnArchive)}
			/>

			<SettingRow
				control={
					<Switch
						checked={archiveOnMerge}
						onCheckedChange={setArchiveOnMerge}
					/>
				}
				description={t(
					'settings:git.archive-on-merge.description',
					'Automatically archive a workspace after merging its PR.',
				)}
				label={t('settings:git.archive-on-merge.label', 'Archive on merge')}
				modified={archiveOnMerge !== DEFAULTS.archiveAfterMerge}
				onReset={() => setArchiveOnMerge(DEFAULTS.archiveAfterMerge)}
			/>

			<SettingRow
				control={
					<Switch checked={setUpstream} onCheckedChange={setSetUpstream} />
				}
				description={t(
					'settings:git.set-upstream.description',
					'Configure new Ensemblr workspaces so plain `git push` sets a branch upstream. Turning this off avoids writing Git worktree config, but PR info may be less reliable until branches have an upstream.',
				)}
				label={t(
					'settings:git.set-upstream.label',
					'Set upstream on plain `git push`',
				)}
				modified={setUpstream !== DEFAULTS.setUpstreamOnPush}
				onReset={() => setSetUpstream(DEFAULTS.setUpstreamOnPush)}
			/>

			<SettingRow
				control={<Switch checked={coAuthor} onCheckedChange={setCoAuthor} />}
				description={t(
					'settings:git.co-author.description',
					"Ask agents to end every commit they make with `{{trailer}}`. GitHub credits the trailer to the Ensemblr account, so it appears alongside you in the repository's contributors.",
					{ trailer: ENSEMBLR_CO_AUTHOR_TRAILER },
				)}
				label={t(
					'settings:git.co-author.label',
					'Credit Ensemblr as a commit co-author',
				)}
				modified={coAuthor !== DEFAULTS.coAuthorEnsemblr}
				onReset={() => setCoAuthor(DEFAULTS.coAuthorEnsemblr)}
			/>
		</SettingsSection>
	);
}
