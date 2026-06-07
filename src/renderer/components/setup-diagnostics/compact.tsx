import type { ReactNode } from 'react';

import { StatusBadge } from '@/renderer/components/status-badge';
import type { SetupDiagnosticsSnapshot } from '@/shared/ipc';

/** Compact summary variant for the setup diagnostics, used in dense panels. */
export function SetupDiagnosticsCompact({
	snapshot,
}: {
	snapshot: SetupDiagnosticsSnapshot;
}) {
	const readyLabel =
		snapshot.status === 'ready'
			? 'Core workflows ready'
			: snapshot.status === 'checking'
				? 'Setup checks pending'
				: 'Core workflows blocked';

	return (
		<div className='grid grid-cols-2 gap-2 md:grid-cols-4'>
			<CompactMetric label='State' tone={getSnapshotTone(snapshot)}>
				{readyLabel}
			</CompactMetric>
			<CompactMetric label='Required' tone='muted'>
				{snapshot.requiredCount} checks
			</CompactMetric>
			<CompactMetric label='Blocked' tone='danger'>
				{snapshot.blockedCount}
			</CompactMetric>
			<CompactMetric label='Warnings' tone='warning'>
				{snapshot.warningCount}
			</CompactMetric>
		</div>
	);
}

/** Single metric tile used by the compact diagnostics variant. */
function CompactMetric({
	children,
	label,
	tone,
}: {
	children: ReactNode;
	label: string;
	tone: 'danger' | 'info' | 'muted' | 'ok' | 'warning';
}) {
	return (
		<div className='flex min-h-16 flex-col justify-between rounded-md border border-border bg-pane px-2.5 py-2'>
			<div className='flex items-center justify-between gap-2'>
				<span className='text-muted-foreground text-xxs uppercase tracking-wide'>
					{label}
				</span>
				<StatusBadge tone={tone}>{label}</StatusBadge>
			</div>
			<div className='mt-2 font-medium text-xs'>{children}</div>
		</div>
	);
}

/** Maps a setup snapshot to its overall surface tone. */
function getSnapshotTone(
	snapshot: SetupDiagnosticsSnapshot,
): 'danger' | 'ok' | 'warning' {
	if (snapshot.status === 'ready') {
		return 'ok';
	}

	if (snapshot.status === 'checking') {
		return 'warning';
	}

	return 'danger';
}
