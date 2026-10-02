import { useTranslation } from 'react-i18next';

import { Label } from '@/renderer/components/ui/label';
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from '@/renderer/components/ui/select';
import { OwnerAvatar } from '@/renderer/components/welcome/owner-avatar';
import { ownerRestrictionText } from '@/renderer/lib/github-owner-text';
import type { GithubOwnerEntry } from '@/shared/ipc/contracts/quick-start';

/**
 * Picks the GitHub account a new quick-start project is published under.
 *
 * Renders a same-height placeholder row while `gh` is still answering, so the
 * dialog does not reflow under the user's cursor when the list lands; the
 * dialog blocks Create for as long as that row is showing. `loading` is set
 * only for a user whose last project went to an organization — anyone else
 * would resolve to the signed-in user anyway, so they are shown no row and
 * held for nothing. Once the answer is in, an empty `owners` means there was
 * no real choice to make (gh missing, unauthenticated, or no organizations)
 * and the field disappears, leaving a solo user's dialog exactly as it was
 * before the picker existed.
 */
export function QuickStartOwnerField({
	disabled,
	loading,
	onSelect,
	owners,
	value,
}: {
	disabled: boolean;
	loading: boolean;
	onSelect: (login: string) => void;
	owners: readonly GithubOwnerEntry[];
	value: string;
}) {
	const { t } = useTranslation();

	if (!loading && owners.length === 0) {
		return null;
	}

	return (
		<div className='flex flex-col gap-1.5'>
			<Label
				className='text-xs'
				htmlFor={loading ? undefined : 'quick-start-owner'}
			>
				{t('common:quick-start.owner-label', 'GitHub owner')}
			</Label>
			{loading ? (
				<div
					className='flex h-9 w-full items-center rounded-lg border border-input px-2.5 text-muted-foreground text-sm'
					role='status'
				>
					{t('common:quick-start.owner-loading', 'Reading GitHub accounts…')}
				</div>
			) : (
				<Select disabled={disabled} onValueChange={onSelect} value={value}>
					<SelectTrigger className='h-9 w-full' id='quick-start-owner'>
						<SelectValue
							placeholder={t(
								'common:quick-start.owner-placeholder',
								'Choose an account',
							)}
						/>
					</SelectTrigger>
					<SelectContent className='p-1'>
						{owners.map((owner) => (
							<SelectItem
								className='my-0.5 gap-2 py-2'
								disabled={!owner.canCreate}
								key={owner.login}
								value={owner.login}
							>
								<OwnerAvatar
									avatarUrl={owner.avatarUrl}
									ownerLogin={owner.login}
								/>
								<span>{owner.login}</span>
								<OwnerRowNote owner={owner} />
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			)}
		</div>
	);
}

/**
 * Muted trailing note on an owner row: a badge saying why a blocked
 * organization cannot be picked, or the organization's display name when it
 * can. Truncated, because the dropdown grows to fit its widest row.
 */
function OwnerRowNote({ owner }: { owner: GithubOwnerEntry }) {
	const { t } = useTranslation();
	const note = ownerRestrictionText(t, owner.restriction) ?? owner.displayName;

	if (!note) {
		return null;
	}

	return (
		<span className='max-w-40 truncate text-muted-foreground text-xxs'>
			{note}
		</span>
	);
}
