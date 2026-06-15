import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
	EyeIcon,
	EyeOffIcon,
	LockIcon,
	PencilIcon,
	Trash2Icon,
} from 'lucide-react';
import { useState } from 'react';

import {
	ensembleQueryKeys,
	readEnvironmentVariableValue,
	unsetEnvironmentVariable,
} from '@/renderer/api/ensemble';
import { Button } from '@/renderer/components/ui/button';
import { Spinner } from '@/renderer/components/ui/spinner';
import type {
	EnvironmentVariableScope,
	EnvironmentVariableSnapshot,
} from '@/shared/ipc/contracts/environment';

interface EnvironmentVariableRowProps {
	variable: EnvironmentVariableSnapshot;
	scope: EnvironmentVariableScope;
	scopeId?: string;
	onEdit: (key: string) => void;
}

const MASK = '••••••••';

/** One configured variable: lock/key on the left, value + actions on the right. */
export function EnvironmentVariableRow({
	onEdit,
	scope,
	scopeId,
	variable,
}: EnvironmentVariableRowProps) {
	const queryClient = useQueryClient();
	const [revealed, setRevealed] = useState(false);
	const [revealedValue, setRevealedValue] = useState<string | null>(null);
	const [loading, setLoading] = useState(false);

	const isSecret = variable.valueKind === 'secret';

	const handleToggleReveal = async () => {
		if (revealed) {
			setRevealed(false);
			return;
		}

		// Always re-read on reveal so an edit made since the last reveal is
		// reflected — the row stays mounted across edits, so a cached value
		// would otherwise go stale.
		setLoading(true);
		try {
			const result = await readEnvironmentVariableValue({
				key: variable.key,
				scope,
				scopeId,
			});
			setRevealedValue(result.value ?? '');
			setRevealed(true);
		} finally {
			setLoading(false);
		}
	};

	const deleteMutation = useMutation({
		mutationFn: () =>
			unsetEnvironmentVariable({ key: variable.key, scope, scopeId }),
		onSuccess: async () => {
			await queryClient.invalidateQueries({
				queryKey: ensembleQueryKeys.environmentVariables(),
			});
		},
	});

	return (
		<div className='flex items-center gap-3 px-3 py-2.5 text-sm'>
			<div className='flex min-w-0 flex-1 items-center gap-2'>
				{isSecret ? (
					<LockIcon
						aria-hidden='true'
						className='size-3.5 shrink-0 text-muted-foreground'
					/>
				) : null}
				<code className='truncate font-mono text-foreground text-xs'>
					{variable.key}
				</code>
			</div>
			<div className='flex shrink-0 items-center gap-2'>
				<Button
					aria-label={revealed ? 'Hide value' : 'Show value'}
					disabled={loading}
					onClick={() => void handleToggleReveal()}
					size='icon-xs'
					variant='ghost'
				>
					{loading ? (
						<Spinner className='size-3.5' />
					) : revealed ? (
						<EyeIcon aria-hidden='true' className='size-3.5' />
					) : (
						<EyeOffIcon aria-hidden='true' className='size-3.5' />
					)}
				</Button>
				<code className='max-w-60 truncate font-mono text-muted-foreground text-xs'>
					{revealed ? (revealedValue ?? '') : MASK}
				</code>
			</div>
			<div className='flex shrink-0 items-center gap-1'>
				<Button
					aria-label='Edit variable'
					onClick={() => onEdit(variable.key)}
					size='icon-xs'
					variant='ghost'
				>
					<PencilIcon aria-hidden='true' className='size-3.5' />
				</Button>
				<Button
					aria-label='Delete variable'
					disabled={deleteMutation.isPending}
					onClick={() => deleteMutation.mutate()}
					size='icon-xs'
					variant='ghost'
				>
					<Trash2Icon aria-hidden='true' className='size-3.5' />
				</Button>
			</div>
		</div>
	);
}
