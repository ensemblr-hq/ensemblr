import { useTranslation } from 'react-i18next';

import { StatusBadge } from '@/renderer/components/status-badge';
import type { RootDirectoryChangeApplyResult } from '@/shared/ipc/contracts/root-directory';

import { RootDirectoryDiagnostics } from './diagnostics';

/** Renders the outcome of a root-directory apply call (success/error/blocked). */
export function RootDirectoryApplyResult({
	result,
}: {
	result: RootDirectoryChangeApplyResult;
}) {
	const { t } = useTranslation();
	return (
		<section className='rounded-md border border-border bg-background/60 px-3 py-2 text-xs leading-5'>
			<div className='flex items-center gap-2'>
				<StatusBadge tone={getRootDirectoryApplyResultTone(result)}>
					{result.applied
						? t('common:root-directory.applied', 'Applied')
						: t('common:root-directory.not-applied', 'Not applied')}
				</StatusBadge>
				<span className='font-medium'>
					{t('common:root-directory.result-title', 'Root switch result')}
				</span>
			</div>
			{result.error ? (
				<p className='mt-1 text-status-danger'>{result.error}</p>
			) : null}
			{result.reconciliation ? (
				<p className='mt-1 text-muted-foreground'>
					{t(
						'common:root-directory.reconciliation',
						'Reconciliation scanned {{repositoryDirectories}} and {{workspaceDirectories}}.',
						{
							repositoryDirectories: t(
								'common:root-directory.repository-directory-count',
								{
									count: result.reconciliation.repositoryDirectoryCount,
									defaultValue_one: '{{count}} repository directory',
									defaultValue_other: '{{count}} repository directories',
								},
							),
							workspaceDirectories: t(
								'common:root-directory.workspace-directory-count',
								{
									count: result.reconciliation.workspaceDirectoryCount,
									defaultValue_one: '{{count}} workspace directory',
									defaultValue_other: '{{count}} workspace directories',
								},
							),
						},
					)}
				</p>
			) : null}
			{result.reconciliation?.diagnostics.length ? (
				<div className='mt-2'>
					<RootDirectoryDiagnostics
						diagnostics={result.reconciliation.diagnostics}
						emptyLabel={t(
							'common:root-directory.no-reconciliation-warnings',
							'No reconciliation warnings.',
						)}
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
