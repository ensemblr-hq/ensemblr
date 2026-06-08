import { useQuery } from '@tanstack/react-query';
import { CircleDashedIcon } from 'lucide-react';

import { piSessionsForWorkspaceQuery } from '@/renderer/api/ensemble-queries';
import type {
	SessionTabModel,
	WorkspaceShellModel,
} from '@/renderer/types/workbench';

import { TimelineEventCard } from './timeline-event-card';
import { useTimelineEvents } from './use-timeline-events';

/**
 * Structured renderer for the Pi RPC event stream. Reads persisted events
 * from SQLite and overlays live events broadcast from the main process so
 * the conversation surface stays in sync without a refresh.
 */
export function PiSessionTimeline({
	activeSession: _activeSession,
	workspace,
}: {
	activeSession: SessionTabModel;
	workspace: WorkspaceShellModel;
}) {
	const sessionsQuery = useQuery(piSessionsForWorkspaceQuery(workspace.id));
	const activePiSession = sessionsQuery.data?.sessions[0];
	const branchId = activePiSession?.branchId ?? '';
	const piSessionId = activePiSession?.id ?? null;

	const { error, events, isLoading } = useTimelineEvents({
		branchId,
		sessionId: piSessionId,
	});

	if (!activePiSession) {
		return (
			<section
				aria-label='Pi session timeline'
				className='flex flex-col items-center gap-2 rounded-md border border-border border-dashed bg-pane/40 p-6 text-center text-muted-foreground text-xs'
				data-timeline-state='empty'
			>
				<CircleDashedIcon aria-hidden='true' className='size-4' />
				<p>
					Send the first prompt below to start a Pi session in this workspace.
				</p>
			</section>
		);
	}

	if (isLoading && events.length === 0) {
		return (
			<section
				aria-label='Pi session timeline'
				className='flex flex-col gap-2 text-muted-foreground text-xs'
				data-timeline-state='loading'
			>
				<p>Loading timeline…</p>
			</section>
		);
	}

	if (error) {
		return (
			<section
				aria-label='Pi session timeline'
				className='flex flex-col gap-2 rounded-md border border-status-warning/30 bg-status-warning/10 p-3 text-status-warning text-xs'
				data-timeline-state='errored'
			>
				<p>
					Could not load timeline events.{' '}
					{error instanceof Error ? error.message : null}
				</p>
			</section>
		);
	}

	if (events.length === 0) {
		return (
			<section
				aria-label='Pi session timeline'
				className='flex flex-col items-center gap-2 rounded-md border border-border border-dashed bg-pane/40 p-6 text-center text-muted-foreground text-xs'
				data-timeline-state='idle'
			>
				<p>Pi session is idle. Send a prompt to start the conversation.</p>
			</section>
		);
	}

	return (
		<section
			aria-label='Pi session timeline'
			className='flex flex-col gap-3'
			data-timeline-state='ready'
		>
			{events.map((event) => (
				<TimelineEventCard event={event} key={event.id} />
			))}
		</section>
	);
}
