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
import { claudeSubagentModeAtom } from '@/renderer/state/preferences';
import {
	isSubagentMechanism,
	SUBAGENT_MECHANISMS,
	type SubagentMechanism,
} from '@/shared/agent-control';

/**
 * Picker label for each delegation mechanism. Built from `t()` rather than a
 * module-scope table so a language change re-renders them and so
 * `i18next-cli extract` can see every key statically.
 * @param t - Translation function from `useTranslation`.
 * @returns The label for every mechanism.
 */
function mechanismLabels(t: TFunction): Record<SubagentMechanism, string> {
	return {
		ensemblr: t(
			'settings:providers.subagent-mode.ensemblr',
			'Ensemblr chat tabs',
		),
		native: t(
			'settings:providers.subagent-mode.native',
			'Claude Code built-in',
		),
	};
}

/**
 * Picks which delegation mechanism a Claude Code chat runs on. The two are
 * mutually exclusive by construction — whichever the user does not pick is
 * withheld from the session's tool list — so the row says plainly that the
 * choice takes effect on the next chat rather than the open one.
 */
export function ClaudeSubagentModeRow() {
	const { t } = useTranslation();
	const [mode, setMode] = useAtom(claudeSubagentModeAtom);
	const labels = mechanismLabels(t);

	return (
		<SettingRow
			control={
				<Select
					onValueChange={(next) => {
						if (isSubagentMechanism(next)) setMode(next);
					}}
					value={mode}
				>
					<SelectTrigger className='w-40' size='sm'>
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						{SUBAGENT_MECHANISMS.map((mechanism) => (
							<SelectItem key={mechanism} value={mechanism}>
								{labels[mechanism]}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			}
			description={t(
				'settings:providers.subagent-mode.description',
				'Ensemblr chat tabs spawn each sub-agent into its own tab you can watch and steer, and Claude Code’s own sub-agent tool is denied. Built-in keeps sub-agents inside this conversation and withholds the spawn tools instead. Applies to chats started after the change.',
			)}
			label={t('settings:providers.subagent-mode.label', 'Sub-agents')}
		/>
	);
}
