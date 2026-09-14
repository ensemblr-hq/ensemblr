import { useAtomValue } from 'jotai';
import { LoaderCircleIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { claudeBackgroundTasksBySessionAtomFamily } from '@/renderer/state/workspace';

/**
 * The strip above the composer naming what this chat left running in the
 * background. It reads off the runtime's own live-task set, so it survives the
 * turn ending: the agent goes idle, every spinner in the app stops, and this
 * stays up for as long as the work does.
 *
 * That persistence is the point. A backgrounded shell or an async subagent
 * outlives the turn that started it, so without this the only trace is one
 * sentence in a transcript the user has already scrolled past — and closing the
 * tab or quitting the app takes the work with it unannounced.
 */
export function BackgroundTasksNotice({
	agentSessionId,
}: {
	agentSessionId: string | null;
}) {
	const { t } = useTranslation();
	const tasks = useAtomValue(
		claudeBackgroundTasksBySessionAtomFamily(agentSessionId ?? ''),
	);

	if (agentSessionId === null || tasks.length === 0) {
		return null;
	}

	return (
		<div
			className='flex flex-col gap-1 rounded-md border border-accent-strong/30 bg-accent-strong/5 px-2.5 py-2'
			data-role='background-tasks-notice'
		>
			<div className='flex items-center gap-1.5 text-accent-strong text-xs'>
				<LoaderCircleIcon
					aria-hidden='true'
					className='size-3 shrink-0 animate-spin'
				/>
				<span className='font-medium'>
					{t('workbench:composer.background-tasks', {
						count: tasks.length,
						defaultValue_one: '{{count}} background task still running',
						defaultValue_other: '{{count}} background tasks still running',
					})}
				</span>
			</div>
			<ul className='flex flex-col gap-0.5 pl-4.5'>
				{tasks.map((task) => (
					<li
						className='truncate text-muted-foreground text-xxs'
						key={task.taskId}
					>
						{task.description.trim() ||
							t(
								'workbench:composer.background-task-untitled',
								'Untitled background task',
							)}
					</li>
				))}
			</ul>
		</div>
	);
}
