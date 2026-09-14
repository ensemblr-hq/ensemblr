import { useTranslation } from 'react-i18next';

import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from '@/renderer/components/ui/tooltip';

/**
 * Sidebar status dot: blue, lit while any Claude Code background task
 * (backgrounded `Bash`, async subagent) is still live in the workspace. Sits
 * beside the terminal activity dot so a workspace can carry both signals at
 * once, and paints only when the count is at least one.
 *
 * The count is the whole payload, so it is announced rather than hidden: the
 * dot carries an `sr-only` label and a tooltip, the way `WorkspaceUnreadDot`
 * does. The neighbouring `DockActivityDot` is `aria-hidden` instead, which costs
 * it nothing because its label is static and carries no number.
 */
export function ClaudeBackgroundDot({ count }: { count: number }) {
	const { t } = useTranslation();

	if (count <= 0) {
		return null;
	}

	const label = t('workbench:workspace-item.claude-background', {
		count,
		defaultValue_one: '{{count}} background task running',
		defaultValue_other: '{{count}} background tasks running',
	});

	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<span
					className='size-2 rounded-full bg-accent-strong ring-2 ring-sidebar'
					data-workspace-claude-background='running'
					data-workspace-claude-background-count={count}
				>
					<span className='sr-only'>{label}</span>
				</span>
			</TooltipTrigger>
			<TooltipContent>{label}</TooltipContent>
		</Tooltip>
	);
}
