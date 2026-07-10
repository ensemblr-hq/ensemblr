import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import {
	createLinearComment,
	ensemblrQueryKeys,
} from '@/renderer/api/ensemblr';
import { Button } from '@/renderer/components/ui/button';
import { Textarea } from '@/renderer/components/ui/textarea';
import { describeLinearFailure } from '@/renderer/lib/linear';

/** Inline composer that posts a comment to a Linear issue. */
export function LinearCommentComposer({ issueId }: { issueId: string }) {
	const queryClient = useQueryClient();
	const [body, setBody] = useState('');
	const [error, setError] = useState<string | null>(null);

	const mutation = useMutation({
		mutationFn: () => createLinearComment({ body: body.trim(), issueId }),
		onSuccess: async (result) => {
			if (result.status === 'error') {
				setError(describeLinearFailure(result.failure));
				return;
			}
			setBody('');
			setError(null);
			await queryClient.invalidateQueries({
				queryKey: ensemblrQueryKeys.linearIssue(issueId),
			});
		},
	});

	return (
		<div className='flex flex-col gap-2'>
			<Textarea
				aria-label='Add a comment'
				className='min-h-16'
				onChange={(event) => setBody(event.target.value)}
				placeholder='Add a comment…'
				value={body}
			/>
			{error ? (
				<p className='text-status-danger text-xs' role='alert'>
					{error}
				</p>
			) : null}
			<div className='flex justify-end'>
				<Button
					disabled={body.trim().length === 0 || mutation.isPending}
					onClick={() => mutation.mutate()}
					size='sm'
				>
					{mutation.isPending ? 'Posting…' : 'Comment'}
				</Button>
			</div>
		</div>
	);
}
