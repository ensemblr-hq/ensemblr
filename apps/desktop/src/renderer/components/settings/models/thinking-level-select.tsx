import { useTranslation } from 'react-i18next';

import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from '@/renderer/components/ui/select';
import { thinkingLevelLabel } from '@/renderer/lib/workbench/thinking-labels';
import type { AgentProviderId } from '@/shared/agent-provider';
import { getThinkingAxis } from '@/shared/agent-thinking';

/** Select dropdown for choosing a thinking level; renders nothing when the model exposes no levels. */
export function ThinkingLevelSelect({
	ariaLabel,
	levels,
	onChange,
	provider,
	value,
}: {
	ariaLabel: string;
	levels: readonly string[];
	onChange: (next: string | null) => void;
	/** Runtime whose vocabulary labels the levels; Claude's dial is effort, pi's is thinking. */
	provider: AgentProviderId;
	value: string | null | undefined;
}) {
	const { t } = useTranslation();

	if (levels.length === 0) {
		return null;
	}
	const placeholder =
		getThinkingAxis(provider) === 'effort'
			? t('settings:models.thinking.effort-placeholder', 'Effort level')
			: t('settings:models.thinking.thinking-placeholder', 'Thinking level');
	return (
		<Select
			onValueChange={(next) => onChange(next || null)}
			value={value ?? ''}
		>
			<SelectTrigger aria-label={ariaLabel} className='w-40' size='sm'>
				<SelectValue placeholder={placeholder} />
			</SelectTrigger>
			<SelectContent>
				{levels.map((level) => (
					<SelectItem key={level} value={level}>
						{thinkingLevelLabel(t, level)}
					</SelectItem>
				))}
			</SelectContent>
		</Select>
	);
}
