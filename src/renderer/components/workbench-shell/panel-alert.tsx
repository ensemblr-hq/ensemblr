import { TriangleAlertIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { CommandFailureCopy } from '@/renderer/types/workbench';

/**
 * Inline failure banner for a panel whose remaining content still works, such as
 * a GitHub sync error above an otherwise usable checks list. The headline says
 * what failed, `message` explains it in the reader's language, and `detail`
 * carries the command's own output in a demoted block so raw stderr never
 * stands in for the explanation.
 *
 * Only the headline and explanation live inside the `alert` live region — a
 * screen reader announcing a failure should hear what went wrong, not have a
 * stderr dump read at it. The output block is focusable so its clipped tail
 * stays reachable without a pointer.
 */
export function PanelAlert({
	detail,
	message,
	title,
}: CommandFailureCopy & { title: string }) {
	const { t } = useTranslation();

	return (
		<div className='flex min-w-0 flex-col gap-2 rounded-lg border border-status-danger/25 bg-status-danger/8 px-3 py-2.5'>
			<div className='flex min-w-0 items-start gap-2' role='alert'>
				<TriangleAlertIcon
					aria-hidden='true'
					className='mt-0.5 size-3.5 shrink-0 text-status-danger'
					strokeWidth={2}
				/>
				<div className='flex min-w-0 flex-col gap-0.5'>
					<p className='font-medium text-foreground text-xs leading-5'>
						{title}
					</p>
					<p className='min-w-0 text-muted-foreground text-xs leading-5'>
						{message}
					</p>
				</div>
			</div>
			{detail ? (
				<section
					aria-label={t('workbench:panel-alert.output', 'Command output')}
					className='max-h-28 min-w-0 overflow-y-auto rounded-md border border-border/60 bg-pane/70 px-2 py-1.5'
					// biome-ignore lint/a11y/noNoninteractiveTabindex: a scroll container has to take focus or its clipped tail is unreachable without a pointer (WCAG 2.1.1); the rule models interactivity, not scrollability.
					tabIndex={0}
				>
					<pre className='whitespace-pre-wrap break-words font-mono text-muted-foreground text-xxs leading-4'>
						{detail}
					</pre>
				</section>
			) : null}
		</div>
	);
}
