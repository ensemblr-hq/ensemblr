import type { TFunction } from 'i18next';
import { useAtom } from 'jotai';
import { useTranslation } from 'react-i18next';

import { SettingRow } from '@/renderer/components/settings/setting-row';
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from '@/renderer/components/ui/select';
import { delegationInitiativeAtom } from '@/renderer/state/preferences';
import {
	DELEGATION_INITIATIVES,
	type DelegationInitiative,
	isDelegationInitiative,
} from '@/shared/agent-control';

/**
 * Picker label for each delegation initiative. Built from `t()` rather than a
 * module-scope table so a language change re-renders them and so
 * `i18next-cli extract` can see every key statically.
 * @param t - Translation function from `useTranslation`.
 * @returns The label for every initiative.
 */
function initiativeLabels(t: TFunction): Record<DelegationInitiative, string> {
	return {
		automatic: t(
			'settings:models.orchestration.initiative.automatic',
			'Delegate automatically',
		),
		'on-request': t(
			'settings:models.orchestration.initiative.on-request',
			'Only when I ask',
		),
	};
}

/**
 * Chooses whether an orchestrator may decide to delegate on its own. The row
 * says plainly that the limit is advisory and that an unattended run ignores it,
 * because both are things a user would otherwise discover by being surprised.
 */
export function DelegationInitiativeRow() {
	const { t } = useTranslation();
	const [initiative, setInitiative] = useAtom(delegationInitiativeAtom);
	const labels = initiativeLabels(t);

	return (
		<SettingRow
			control={
				<Select
					onValueChange={(next) => {
						if (isDelegationInitiative(next)) setInitiative(next);
					}}
					value={initiative}
				>
					<SelectTrigger
						aria-label={t(
							'settings:models.orchestration.initiative.aria-label',
							'Delegation initiative',
						)}
						className='w-48'
						size='sm'
					>
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						{DELEGATION_INITIATIVES.map((value) => (
							<SelectItem key={value} value={value}>
								{labels[value]}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			}
			description={t(
				'settings:models.orchestration.initiative.description',
				'“Only when I ask” tells agents to do the work in the conversation and wait for you to ask for a hand-off. It steers what they are told rather than which tools they hold, so asking for one mid-conversation still works. AFK runs ignore it — nobody is there to ask.',
			)}
			label={t(
				'settings:models.orchestration.initiative.label',
				'When to delegate',
			)}
		/>
	);
}
