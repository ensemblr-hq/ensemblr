import { RefreshCwIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { StatusDot } from '@/renderer/components/status-badge';
import { Button } from '@/renderer/components/ui/button';
import { cn } from '@/renderer/lib/utils';
import type { SetupDiagnosticsSnapshot } from '@/shared/ipc/contracts/setup';

/** Semantic tone for the setup-diagnostics status indicator. */
type StatusTone = 'danger' | 'muted' | 'ok' | 'warning';

/** Props for the setup-diagnostics summary strip. */
interface SetupDiagnosticsSummaryProps {
	detail: string;
	isRetrying?: boolean;
	onRetry?: () => void;
	snapshot: SetupDiagnosticsSnapshot | null;
	title: string;
	tone: StatusTone;
}

/**
 * Single-line status strip: a tone dot, the overall state title, plain-text
 * counts, and the retry action. Replaces the old four-tile metric grid.
 */
export function SetupDiagnosticsSummary({
	detail,
	isRetrying = false,
	onRetry,
	snapshot,
	title,
	tone,
}: SetupDiagnosticsSummaryProps) {
	const { t } = useTranslation();
	return (
		<div className='flex items-center justify-between gap-4 rounded-lg border bg-card px-5 py-4'>
			<div className='flex min-w-0 items-center gap-3.5'>
				<StatusDot className='size-2 shrink-0' tone={tone} />
				<div className='flex min-w-0 flex-col gap-1'>
					<span className='truncate font-medium text-sm leading-none'>
						{title}
					</span>
					<span className='truncate text-muted-foreground text-xs'>
						{snapshot ? <SummaryCounts snapshot={snapshot} /> : detail}
					</span>
				</div>
			</div>
			<Button
				className='shrink-0'
				disabled={isRetrying}
				onClick={onRetry}
				size='sm'
				type='button'
				variant='outline'
			>
				<RefreshCwIcon
					aria-hidden='true'
					className={cn('size-4', isRetrying && 'animate-spin')}
				/>
				{isRetrying
					? t('common:setup-summary.retrying', 'Retrying')
					: t('common:setup-summary.retry', 'Retry checks')}
			</Button>
		</div>
	);
}

/** Plain-text count run-on for the summary strip. */
function SummaryCounts({ snapshot }: { snapshot: SetupDiagnosticsSnapshot }) {
	const { t } = useTranslation();
	// Three independent stats behind a styled separator, not one sentence: each
	// fragment is a complete noun phrase and no word order crosses between them.
	// i18next-instrument-ignore
	return (
		<>
			{t('common:setup-summary.passed-count', {
				count: snapshot.successCount,
				defaultValue_one: '{{count}} passed',
				defaultValue_other: '{{count}} passed',
			})}
			<CountSeparator />
			{t('common:setup-summary.warning-count', {
				count: snapshot.warningCount,
				defaultValue_one: '{{count}} warning',
				defaultValue_other: '{{count}} warnings',
			})}
			<CountSeparator />
			{t('common:setup-summary.blocked-count', {
				count: snapshot.blockedCount,
				defaultValue_one: '{{count}} blocked',
				defaultValue_other: '{{count}} blocked',
			})}
		</>
	);
}

/** Middle-dot separator between inline counts. */
function CountSeparator() {
	return <span className='mx-1.5 text-border'>·</span>;
}
