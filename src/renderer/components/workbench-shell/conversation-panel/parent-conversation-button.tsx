import { CornerUpLeftIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { SessionTabModel } from '@/renderer/types/workbench';

/** Floating control that returns from a sub-agent conversation to its parent. */
export function ParentConversationButton({
	parent,
	onNavigate,
}: {
	parent: SessionTabModel;
	onNavigate: () => void;
}) {
	const { t } = useTranslation();
	const label = parent.fullLabel ?? parent.label;

	return (
		<button
			aria-label={t(
				'workbench:session-tabs.parent-tab-aria',
				'Go to parent chat: {{label}}',
				{ label },
			)}
			className='absolute top-3 left-3 z-10 flex max-w-64 items-center gap-2 rounded-md bg-background px-3 py-2 text-muted-foreground text-xs shadow-panel ring-1 ring-border transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
			onClick={onNavigate}
			type='button'
		>
			<CornerUpLeftIcon aria-hidden='true' className='size-3.5 shrink-0' />
			<span className='truncate'>
				{t('workbench:session-tabs.parent-tab', 'Parent chat · {{label}}', {
					label,
				})}
			</span>
		</button>
	);
}
