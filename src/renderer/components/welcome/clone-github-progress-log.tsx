import { useEffect, useRef } from 'react';

import type { CloneGithubRepositoryProgressEvent } from '@/shared/ipc/contracts/clone';

/** Props for the live clone progress log. */
interface CloneGithubProgressLogProps {
	logs: CloneGithubRepositoryProgressEvent[];
}

/** Live, scrollable progress log used while the clone runs. */
export function CloneGithubProgressLog({ logs }: CloneGithubProgressLogProps) {
	const logRef = useRef<HTMLOListElement | null>(null);

	// biome-ignore lint/correctness/useExhaustiveDependencies: logs.length triggers the auto-scroll when new lines arrive.
	useEffect(() => {
		if (!logRef.current) {
			return;
		}
		logRef.current.scrollTop = logRef.current.scrollHeight;
	}, [logs.length]);

	return (
		<ol
			className='max-h-40 overflow-y-auto rounded-md border border-border bg-background/60 px-2 py-1.5 font-mono text-muted-foreground text-xxs'
			data-testid='clone-progress-log'
			ref={logRef}
		>
			{logs.map((event, index) => (
				<li
					className={
						event.kind === 'status'
							? 'text-foreground'
							: event.kind === 'stderr'
								? 'text-amber-500'
								: 'text-muted-foreground'
					}
					data-kind={event.kind}
					key={`${event.timestamp}-${index}`}
				>
					{event.text}
				</li>
			))}
		</ol>
	);
}
