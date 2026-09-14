import { useTranslation } from 'react-i18next';

/**
 * Sidebar status dot: blue, lit while any Claude Code background task
 * (backgrounded `Bash`, async subagent) is still live in the workspace. Sits
 * beside the terminal activity dot so a workspace can carry both signals at
 * once, and paints only when the count is at least one.
 */
export function ClaudeBackgroundDot({ count }: { count: number }) {
	const { t } = useTranslation();

	if (count <= 0) {
		return null;
	}

	return (
		<span
			aria-hidden='true'
			className='size-2 rounded-full bg-accent-strong ring-2 ring-sidebar'
			data-workspace-claude-background='running'
			data-workspace-claude-background-count={count}
			title={t('workbench:workspace-item.claude-background', {
				count,
				defaultValue_one: '{{count}} background task running',
				defaultValue_other: '{{count}} background tasks running',
			})}
		/>
	);
}
