import { StatusBadge } from '@/renderer/components/status-badge';
import type {
	RootDirectoryChangeApplyResult,
	RootDirectoryChangePreview,
} from '@/shared/ipc';

/** Read-only preview block showing what a root-directory change will do. */
export function RootPathPreview({
	preview,
}: {
	preview: RootDirectoryChangePreview;
}) {
	return (
		<div className='grid gap-2 text-xs'>
			<div className='rounded-md border border-border bg-background/60 px-3 py-2'>
				<p className='font-medium'>Current root</p>
				<code className='mt-1 block break-all text-muted-foreground'>
					{preview.oldRoot?.path ?? 'No current root snapshot'}
				</code>
			</div>
			<div className='rounded-md border border-border bg-background/60 px-3 py-2'>
				<p className='font-medium'>Selected root</p>
				<code className='mt-1 block break-all text-muted-foreground'>
					{preview.newRoot.path}
				</code>
			</div>
		</div>
	);
}

/** Renders the list of diagnostics surfaced by the root-directory preview. */
export function RootDirectoryDiagnostics({
	diagnostics,
	emptyLabel,
}: {
	diagnostics: RootDirectoryChangePreview['diagnostics'];
	emptyLabel: string;
}) {
	if (!diagnostics.length) {
		return (
			<p className='text-muted-foreground text-xs leading-5'>{emptyLabel}</p>
		);
	}

	return (
		<div className='flex flex-col gap-1.5'>
			{diagnostics.map((diagnostic) => (
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
					<p className='mt-1 text-muted-foreground'>{diagnostic.message}</p>
					{diagnostic.path ? (
						<code className='mt-1 block break-all text-muted-foreground'>
							{diagnostic.path}
						</code>
					) : null}
				</div>
			))}
		</div>
	);
}

/** Renders the outcome of a root-directory apply call (success/error/blocked). */
export function RootDirectoryApplyResult({
	result,
}: {
	result: RootDirectoryChangeApplyResult;
}) {
	return (
		<section className='rounded-md border border-border bg-background/60 px-3 py-2 text-xs leading-5'>
			<div className='flex items-center gap-2'>
				<StatusBadge tone={getRootDirectoryApplyResultTone(result)}>
					{result.applied ? 'Applied' : 'Not applied'}
				</StatusBadge>
				<span className='font-medium'>Root switch result</span>
			</div>
			{result.error ? (
				<p className='mt-1 text-status-danger'>{result.error}</p>
			) : null}
			{result.reconciliation ? (
				<p className='mt-1 text-muted-foreground'>
					Reconciliation scanned{' '}
					{result.reconciliation.repositoryDirectoryCount} repository
					directories and {result.reconciliation.workspaceDirectoryCount}{' '}
					workspace directories.
				</p>
			) : null}
			{result.reconciliation?.diagnostics.length ? (
				<div className='mt-2'>
					<RootDirectoryDiagnostics
						diagnostics={result.reconciliation.diagnostics}
						emptyLabel='No reconciliation warnings.'
					/>
				</div>
			) : null}
		</section>
	);
}

/** Picks the surface tone for a root-directory apply-result panel. */
function getRootDirectoryApplyResultTone(
	result: RootDirectoryChangeApplyResult,
) {
	if (
		result.error ||
		!result.applied ||
		result.reconciliation?.status === 'error'
	) {
		return 'danger';
	}

	if (result.reconciliation?.status === 'warning') {
		return 'warning';
	}

	return 'ok';
}
