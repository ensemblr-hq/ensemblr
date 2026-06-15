import { useQuery, useQueryClient } from '@tanstack/react-query';
import { LockIcon, ShieldAlertIcon } from 'lucide-react';

import {
	ensembleQueryKeys,
	environmentVariablesQuery,
} from '@/renderer/api/ensemble';
import { Badge } from '@/renderer/components/ui/badge';
import { Button } from '@/renderer/components/ui/button';
import { Spinner } from '@/renderer/components/ui/spinner';
import { cn } from '@/renderer/lib/utils';
import type {
	EnvironmentVariableScope,
	EnvironmentVariableSnapshot,
	EnvironmentVariableStatus,
} from '@/shared/ipc/contracts/environment';

interface EnvironmentTableProps {
	scope: EnvironmentVariableScope;
	scopeId?: string;
	emptyHint?: string;
}

/** Read-only view of environment variables for one scope, sourced from IPC. */
export function EnvironmentTable({
	emptyHint,
	scope,
	scopeId,
}: EnvironmentTableProps) {
	const query = useQuery(environmentVariablesQuery);
	const queryClient = useQueryClient();

	if (query.isLoading) {
		return (
			<div className='flex items-center gap-2 py-6 text-muted-foreground text-sm'>
				<Spinner className='size-4' /> Reading environment…
			</div>
		);
	}

	if (query.error) {
		return (
			<div className='py-6 text-sm text-status-danger'>
				Failed to read environment: {String(query.error)}.
			</div>
		);
	}

	const all = query.data?.variables ?? [];
	const variables = all.filter(
		(variable) =>
			variable.scope === scope && (!scopeId || variable.scopeId === scopeId),
	);
	const missing = variables.filter(
		(variable) => variable.required && variable.status === 'unset',
	);

	return (
		<div className='space-y-3'>
			{missing.length > 0 ? (
				<MissingRequiredBanner count={missing.length} />
			) : null}
			{variables.length === 0 ? (
				<EmptyState
					hint={
						emptyHint ??
						'No variables set. Add one to make it available in this environment.'
					}
				/>
			) : (
				<ul className='divide-y divide-border rounded-md border bg-card/40'>
					{variables.map((variable) => (
						<EnvironmentRow key={variable.key} variable={variable} />
					))}
				</ul>
			)}
			<div className='flex items-center justify-between text-muted-foreground text-xs'>
				<span>
					{variables.length} variable{variables.length === 1 ? '' : 's'} from{' '}
					{scope}.
				</span>
				<Button
					disabled={query.isFetching}
					onClick={() =>
						queryClient.invalidateQueries({
							queryKey: ensembleQueryKeys.environmentVariables(),
						})
					}
					size='sm'
					variant='ghost'
				>
					{query.isFetching ? 'Refreshing…' : 'Refresh'}
				</Button>
			</div>
		</div>
	);
}

function MissingRequiredBanner({ count }: { count: number }) {
	return (
		<div className='flex items-start gap-3 rounded-md border border-status-danger/40 bg-status-danger/10 px-3 py-2 text-xs'>
			<ShieldAlertIcon
				aria-hidden='true'
				className='mt-0.5 size-4 text-status-danger'
			/>
			<p className='leading-relaxed'>
				{count} required variable{count === 1 ? '' : 's'} unset. Pi may refuse
				to start or fall back to defaults until resolved.
			</p>
		</div>
	);
}

function EmptyState({ hint }: { hint: string }) {
	return (
		<div className='rounded-md border border-dashed py-8 text-center text-muted-foreground text-sm'>
			<div className='font-medium text-foreground'>No variables set</div>
			<p className='mt-1'>{hint}</p>
		</div>
	);
}

function EnvironmentRow({
	variable,
}: {
	variable: EnvironmentVariableSnapshot;
}) {
	return (
		<li className='flex items-start gap-3 px-3 py-2 text-sm'>
			<div className='flex min-w-0 flex-1 flex-col gap-1'>
				<div className='flex items-center gap-2'>
					<code className='font-mono text-foreground text-xs'>
						{variable.key}
					</code>
					{variable.valueKind === 'secret' ? (
						<LockIcon
							aria-hidden='true'
							className='size-3 text-muted-foreground'
						/>
					) : null}
					{variable.required ? (
						<Badge className='text-[0.625rem]' variant='outline'>
							required
						</Badge>
					) : null}
					{variable.catalog.reserved ? (
						<Badge className='text-[0.625rem]' variant='outline'>
							reserved
						</Badge>
					) : null}
				</div>
				<p className='line-clamp-2 text-muted-foreground text-xs leading-snug'>
					{variable.catalog.description}
				</p>
			</div>
			<div className='flex shrink-0 flex-col items-end gap-1'>
				<StatusBadge status={variable.status} />
				{variable.maskedDisplay ? (
					<code className='font-mono text-muted-foreground text-xs'>
						{variable.maskedDisplay}
					</code>
				) : variable.displayValue ? (
					<code
						className={cn(
							'font-mono text-xs',
							variable.status === 'set'
								? 'text-foreground'
								: 'text-muted-foreground',
						)}
					>
						{truncateValue(variable.displayValue)}
					</code>
				) : null}
				{variable.source ? (
					<span className='text-[0.625rem] text-muted-foreground'>
						source: {variable.source}
					</span>
				) : null}
			</div>
		</li>
	);
}

function StatusBadge({ status }: { status: EnvironmentVariableStatus }) {
	switch (status) {
		case 'set':
			return <Badge variant='secondary'>set</Badge>;
		case 'masked':
			return <Badge variant='secondary'>secret</Badge>;
		case 'unset':
			return <Badge variant='outline'>unset</Badge>;
		case 'reserved':
			return <Badge variant='outline'>reserved</Badge>;
		case 'invalid':
			return <Badge variant='destructive'>invalid</Badge>;
		default:
			return null;
	}
}

function truncateValue(value: string): string {
	if (value.length <= 48) return value;
	return `${value.slice(0, 45)}…`;
}
