import { useTranslation } from 'react-i18next';

import { StatusBadge } from '@/renderer/components/status-badge';
import { failureDetail, failureText } from '@/renderer/lib/failure-text';
import type { RootDirectoryChangePreview } from '@/shared/ipc/contracts/root-directory';

/** Renders the list of diagnostics surfaced by the root-directory preview. */
export function RootDirectoryDiagnostics({
	diagnostics,
	emptyLabel,
}: {
	diagnostics: RootDirectoryChangePreview['diagnostics'];
	emptyLabel: string;
}) {
	const { t } = useTranslation();
	if (!diagnostics.length) {
		return (
			<p className='text-muted-foreground text-xs leading-5'>{emptyLabel}</p>
		);
	}

	return (
		<div className='flex flex-col gap-1.5'>
			{diagnostics.map((diagnostic) => {
				const detail = failureDetail(t, diagnostic);
				return (
					<div
						className='rounded-md border border-border bg-muted px-2 py-1.5 text-xs leading-5'
						key={`${diagnostic.code}-${diagnostic.path ?? diagnostic.message}`}
					>
						<div className='flex flex-wrap items-center gap-1.5'>
							<StatusBadge
								tone={
									diagnostic.severity === 'error'
										? 'danger'
										: diagnostic.severity === 'warning'
											? 'warning'
											: 'info'
								}
							>
								{diagnostic.severity}
							</StatusBadge>
							<span className='font-medium'>{diagnostic.code}</span>
						</div>
						<p className='mt-1 text-muted-foreground'>
							{failureText(t, diagnostic)}
						</p>
						{detail ? (
							<p className='mt-1 text-muted-foreground opacity-80'>{detail}</p>
						) : null}
						{diagnostic.path ? (
							<code className='mt-1 block break-all text-muted-foreground'>
								{diagnostic.path}
							</code>
						) : null}
					</div>
				);
			})}
		</div>
	);
}
