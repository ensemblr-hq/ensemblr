import { createFileRoute } from '@tanstack/react-router';
import { useAtom } from 'jotai';

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
	deleteBranchOnArchiveAtom,
	renameWorkspaceOnBranchAtom,
	setUpstreamOnPushAtom,
} from '@/renderer/state/preferences';

export const Route = createFileRoute('/_workbench/settings/git')({
	component: GitSettings,
});

function GitSettings() {
	const [prefixSource, setPrefixSource] = useAtom(branchPrefixSourceAtom);
	const [customPrefix, setCustomPrefix] = useAtom(branchPrefixCustomAtom);
	const [renameOnBranch, setRenameOnBranch] = useAtom(
		renameWorkspaceOnBranchAtom,
	);
	const [deleteBranch, setDeleteBranch] = useAtom(deleteBranchOnArchiveAtom);
	const [archiveOnMerge, setArchiveOnMerge] = useAtom(archiveOnMergeAtom);
	const [setUpstream, setSetUpstream] = useAtom(setUpstreamOnPushAtom);

	return (
		<SettingsSection
			description='Workspace branch defaults and lifecycle behavior. Repository-scope overrides win when set.'
			title='Git'
		>
			<SettingRow
				description='Prefix for new workspace branch names.'
				label='Branch name prefix'
				stack
			>
				<RadioGroup
					className='mt-2 flex flex-col gap-2'
					onValueChange={(v) => setPrefixSource(v as typeof prefixSource)}
					value={prefixSource}
				>
					<div className='flex items-center gap-2 text-sm'>
						<RadioGroupItem id='branch-prefix-gh' value='github-username' />
						<label className='cursor-pointer' htmlFor='branch-prefix-gh'>
							GitHub username (resolved via `gh`)
						</label>
					</div>
					<div className='flex items-center gap-2 text-sm'>
						<RadioGroupItem id='branch-prefix-custom' value='custom' />
						<label className='cursor-pointer' htmlFor='branch-prefix-custom'>
							Custom:
						</label>
						<Input
							aria-label='Custom branch prefix'
							className='h-7 w-40'
							disabled={prefixSource !== 'custom'}
							onChange={(e) => setCustomPrefix(e.target.value)}
							placeholder='feature'
							value={customPrefix}
						/>
					</div>
					<div className='flex items-center gap-2 text-sm'>
						<RadioGroupItem id='branch-prefix-none' value='none' />
						<label className='cursor-pointer' htmlFor='branch-prefix-none'>
							None
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
				description='Automatically rename workspaces from their placeholder city name to the branch name generated from the first message.'
				label='Rename workspace when branch is named'
			/>

			<SettingRow
				control={
					<Switch checked={deleteBranch} onCheckedChange={setDeleteBranch} />
				}
				description='Delete the local branch when archiving a workspace. To delete the remote branch, configure it on GitHub.'
				label='Delete branch on archive'
			/>

			<SettingRow
				control={
					<Switch
						checked={archiveOnMerge}
						onCheckedChange={setArchiveOnMerge}
					/>
				}
				description='Automatically archive a workspace after merging its PR.'
				label='Archive on merge'
			/>

			<SettingRow
				control={
					<Switch checked={setUpstream} onCheckedChange={setSetUpstream} />
				}
				description='Configure new Ensemble workspaces so plain `git push` sets a branch upstream. Turning this off avoids writing Git worktree config, but PR info may be less reliable until branches have an upstream.'
				label='Set upstream on plain `git push`'
			/>
		</SettingsSection>
	);
}
