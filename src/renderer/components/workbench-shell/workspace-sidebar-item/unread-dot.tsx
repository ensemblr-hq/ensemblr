import { useTranslation } from 'react-i18next';

import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from '@/renderer/components/ui/tooltip';

/**
 * Sidebar marker for a workspace holding chats the user has not read. The dot
 * stays a dot however many there are — a number here would compete with the
 * diff stats beside it — and the exact count lives in the tooltip.
 */
export function WorkspaceUnreadDot({ count }: { count: number }) {
	const { t } = useTranslation();
	const label = t('workbench:workspace-item.unread', {
		count,
		defaultValue_one: '{{count}} unread chat',
		defaultValue_other: '{{count}} unread chats',
	});

	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<span
					className='size-2 rounded-full bg-primary ring-2 ring-sidebar'
					data-workspace-unread-count={count}
				>
					<span className='sr-only'>{label}</span>
				</span>
			</TooltipTrigger>
			<TooltipContent>{label}</TooltipContent>
		</Tooltip>
	);
}
