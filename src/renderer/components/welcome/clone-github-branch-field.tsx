import { useTranslation } from 'react-i18next';

import { BranchPicker } from '@/renderer/components/git/branch-picker';
import { Label } from '@/renderer/components/ui/label';
import type { CloneBranchSelection } from '@/renderer/types/welcome';
import { originQualifiedRef } from '@/shared/branch-ref';

/**
 * Picks the branch the clone checks out and that new workspaces will fork from —
 * the same choice as the repository's "Branch new workspaces from" setting, made
 * before the repository exists. Leaving it on the repository default writes no
 * setting, so the repository keeps tracking whatever GitHub's default branch is.
 */
export function CloneGithubBranchField({
	disabled,
	onChange,
	selection,
	url,
}: {
	disabled: boolean;
	onChange: (selection: CloneBranchSelection | null) => void;
	selection: CloneBranchSelection | null;
	url: string;
}) {
	const { t } = useTranslation();
	const repositoryDefault = t(
		'common:clone-dialog.branch-repository-default',
		'Repository default',
	);

	return (
		<div className='flex flex-col gap-1.5'>
			<Label className='text-xs' htmlFor='clone-github-branch'>
				{t('common:clone-dialog.branch-label', 'Branch new workspaces from')}
			</Label>
			<BranchPicker
				className='h-9 w-full justify-start border border-input bg-transparent px-3'
				disabled={disabled}
				fallbackOption={{
					isActive: selection === null,
					label: repositoryDefault,
					onSelect: () => onChange(null),
				}}
				id='clone-github-branch'
				onSelect={(branchName) =>
					onChange({
						cloneBranch: branchName,
						branchFrom: originQualifiedRef(branchName) ?? branchName,
					})
				}
				onSelectCustomRef={(ref) =>
					onChange({ branchFrom: ref, cloneBranch: null })
				}
				placeholder={repositoryDefault}
				searchPlaceholder={t(
					'common:clone-dialog.branch-search-placeholder',
					'Search or enter a ref…',
				)}
				source={{ kind: 'remote-url', url }}
				value={selection?.branchFrom ?? null}
			/>
		</div>
	);
}
