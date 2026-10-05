import type { TFunction } from 'i18next';
import { CircleUserRoundIcon, UserRoundIcon } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { FacetItem, FacetPopover } from '@/renderer/components/facet-popover';
import {
	LINEAR_ASSIGNEE_ME,
	LINEAR_ASSIGNEE_UNASSIGNED,
	type LinearAssigneeOption,
} from '@/renderer/lib/linear';
import type { FacetCollapse } from '@/renderer/types/components';
import { LinearAvatar } from './issue-avatar';

/**
 * Localized name of one selection entry, as its facet row and the trigger show it.
 * @param t - Translator bound to the active language
 * @param entry - A selection token or Linear user id
 * @param options - The person options, which name every selected id
 * @returns The entry's label
 */
function assigneeEntryLabel(
	t: TFunction,
	entry: string,
	options: readonly LinearAssigneeOption[],
): string {
	if (entry === LINEAR_ASSIGNEE_ME) {
		return t('linear:assignee-filter.me', 'Me');
	}
	if (entry === LINEAR_ASSIGNEE_UNASSIGNED) {
		return t('linear:issue-list.unassigned', 'Unassigned');
	}
	return personLabel(
		t,
		options.find((option) => option.id === entry),
	);
}

/**
 * Label of one person option, falling back for an id nothing names.
 * @param t - Translator bound to the active language
 * @param option - The person, if one is known for the id
 * @returns The person's name, or the unknown-member label
 */
function personLabel(
	t: TFunction,
	option: LinearAssigneeOption | undefined,
): string {
	return option?.name ?? t('linear:assignee-filter.unknown', 'Unknown member');
}

/**
 * What the trigger reads: the facet's name with nothing selected, the one
 * selected entry's own label, or a count once there are several.
 * @param t - Translator bound to the active language
 * @param selection - The selected tokens and user ids
 * @param options - The person options
 * @returns The trigger label
 */
function assigneeTriggerLabel(
	t: TFunction,
	selection: readonly string[],
	options: readonly LinearAssigneeOption[],
): string {
	const [only] = selection;
	if (only === undefined) {
		return t('linear:assignee-filter.label', 'Assignee');
	}
	if (selection.length === 1) {
		return assigneeEntryLabel(t, only, options);
	}
	return t('linear:assignee-filter.count', {
		count: selection.length,
		defaultValue_one: '{{count}} assignee',
		defaultValue_other: '{{count}} assignees',
	});
}

/**
 * The assignee facet every Linear issue surface shares: the user's own issues,
 * unassigned ones, then each person, any number of them at once. Choosing "Me"
 * and "Unassigned" together is how a surface drops everyone else's tickets.
 */
export function LinearAssigneeFacet({
	collapse,
	onToggle,
	options,
	selection,
}: {
	collapse?: FacetCollapse;
	onToggle: (entry: string) => void;
	options: readonly LinearAssigneeOption[];
	selection: readonly string[];
}) {
	const { t } = useTranslation();
	const selected = useMemo(() => new Set(selection), [selection]);

	return (
		<FacetPopover
			collapse={collapse}
			count={selection.length}
			icon={
				<UserRoundIcon
					aria-hidden='true'
					className='size-3.5 text-muted-foreground'
				/>
			}
			label={assigneeTriggerLabel(t, selection, options)}
			searchPlaceholder={t('linear:assignee-filter.search', 'Search people…')}
		>
			<FacetItem
				isSelected={selected.has(LINEAR_ASSIGNEE_ME)}
				label={assigneeEntryLabel(t, LINEAR_ASSIGNEE_ME, options)}
				onSelect={() => onToggle(LINEAR_ASSIGNEE_ME)}
				value={LINEAR_ASSIGNEE_ME}
			>
				<CircleUserRoundIcon
					aria-hidden='true'
					className='size-4 shrink-0 text-muted-foreground'
				/>
			</FacetItem>
			<FacetItem
				isSelected={selected.has(LINEAR_ASSIGNEE_UNASSIGNED)}
				label={assigneeEntryLabel(t, LINEAR_ASSIGNEE_UNASSIGNED, options)}
				onSelect={() => onToggle(LINEAR_ASSIGNEE_UNASSIGNED)}
				value={LINEAR_ASSIGNEE_UNASSIGNED}
			>
				<span aria-hidden='true' className='flex shrink-0'>
					<LinearAvatar className='size-4' name={null} />
				</span>
			</FacetItem>
			{options.map((option) => (
				<FacetItem
					isSelected={selected.has(option.id)}
					key={option.id}
					label={personLabel(t, option)}
					onSelect={() => onToggle(option.id)}
					value={option.id}
				>
					<span aria-hidden='true' className='flex shrink-0'>
						<LinearAvatar className='size-4' name={option.name} />
					</span>
				</FacetItem>
			))}
		</FacetPopover>
	);
}
