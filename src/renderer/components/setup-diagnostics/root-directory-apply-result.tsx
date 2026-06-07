import { StatusBadge } from '@/renderer/components/status-badge';
import type { RootDirectoryChangeApplyResult } from '@/shared/ipc';

import { RootDirectoryDiagnostics } from './root-directory-diagnostics';

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
