import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { KeyboardEvent } from 'react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
	createLinearComment,
	ensemblrQueryKeys,
} from '@/renderer/api/ensemblr';
import { Button } from '@/renderer/components/ui/button';
import { Textarea } from '@/renderer/components/ui/textarea';
import { describeLinearFailure } from '@/renderer/lib/linear';

/**
 * Inline composer that posts a comment to a Linear issue. ⌘↵ submits from inside
 * the textarea, matching the issue editor and the chat composer, so a comment
 * written from the keyboard never needs a trip to the mouse; plain ↵ stays a
 * newline, because a Linear comment is markdown and multi-paragraph by default.
 */
export function LinearCommentComposer({ issueId }: { issueId: string }) {
	const { t } = useTranslation();
	const queryClient = useQueryClient();
	const [body, setBody] = useState('');
	const [error, setError] = useState<string | null>(null);

	const mutation = useMutation({
		mutationFn: () => createLinearComment({ body: body.trim(), issueId }),
		onError: () => {
			setError(
				t(
					'linear:comment-composer.post-failed',
					'Posting the comment failed. Check your connection and try again.',
				),
			);
		},
		onSuccess: async (result) => {
			if (result.status === 'error') {
				setError(describeLinearFailure(result.failure));
				return;
			}
			setBody('');
			setError(null);
			await queryClient.invalidateQueries({
				queryKey: ensemblrQueryKeys.linearIssueAll(issueId),
			});
		},
	});

	const canSubmit = body.trim().length > 0 && !mutation.isPending;

	/**
	 * Posts the comment on ⌘↵ (⌃↵ on a non-Apple keyboard) from inside the
	 * textarea, leaving plain ↵ to insert a newline.
	 * @param event - Key event from the textarea
	 */
	const onSubmitShortcut = (event: KeyboardEvent<HTMLTextAreaElement>) => {
		if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
			event.preventDefault();
			if (canSubmit) {
				mutation.mutate();
			}
		}
	};

	return (
		<div className='flex flex-col gap-1 rounded-lg border border-border bg-card/40 p-1.5 transition-colors focus-within:border-ring/60'>
			<Textarea
				aria-label={t('linear:comment-composer.label', 'Add a comment')}
				className='max-h-64 min-h-20 resize-none overflow-y-auto px-1.5 py-1 text-sm focus-visible:ring-0'
				onChange={(event) => setBody(event.target.value)}
				onKeyDown={onSubmitShortcut}
				placeholder={t('linear:comment-composer.placeholder', 'Add a comment…')}
				value={body}
				variant='bare'
			/>
			{error ? (
				<p className='px-1.5 text-status-danger text-xs' role='alert'>
					{error}
				</p>
			) : null}
			<div className='flex items-center justify-between gap-2 px-1.5'>
				<span className='text-muted-foreground text-xxs'>
					{t('linear:comment-composer.markdown-hint', 'Markdown supported')}
				</span>
				<Button
					disabled={!canSubmit}
					onClick={() => mutation.mutate()}
					size='xs'
				>
					{mutation.isPending
						? t('linear:comment-composer.posting', 'Posting…')
						: t('linear:comment-composer.submit', 'Comment')}
					{mutation.isPending ? null : (
						// i18next-instrument-ignore
						<kbd className='ml-1 font-sans text-primary-foreground/70'>⌘↵</kbd>
					)}
				</Button>
			</div>
		</div>
	);
}
