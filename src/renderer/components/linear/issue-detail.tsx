import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { ArrowLeftIcon, RefreshCwIcon } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { linearIssueQuery } from '@/renderer/api/ensemblr';
import { ChatMessageText } from '@/renderer/components/chat-message-text';
import { Badge } from '@/renderer/components/ui/badge';
import { Button } from '@/renderer/components/ui/button';
import { Skeleton } from '@/renderer/components/ui/skeleton';
import { describeLinearFailure } from '@/renderer/lib/linear';
import { formatRelativeTimestamp } from '@/renderer/lib/workbench/relative-time';
import type { LinearIssueWire } from '@/shared/ipc/contracts/linear';

import { LinearCommentComposer } from './comment-composer';
import { LinearIssueComments } from './issue-comments';
import { LinearIssueDetailHeader } from './issue-detail-header';
import { LinearIssueEditorDialog } from './issue-editor-dialog';
import { LinearIssueProperties } from './issue-properties';

/**
 * Linear issue detail. A fixed command bar sits over a scrolling two-column
 * body: the issue reads down the left as title, description, and thread, while
 * its properties stay in a rail on the right where each one is editable in
 * place. Below the two-column breakpoint the rail moves under the title, so the
 * status of an issue is still the first thing after its name.
 */
export function LinearIssueDetail({ issueId }: { issueId: string }) {
	const { t } = useTranslation();
	const [editorOpen, setEditorOpen] = useState(false);
	const {
		data: result,
		isFetching,
		isLoading,
		refetch,
	} = useQuery(linearIssueQuery(issueId));

	if (isLoading) {
		return <IssueDetailSkeleton />;
	}

	if (!result || result.status === 'error') {
		return (
			<div className='flex flex-1 flex-col items-center justify-center gap-3 py-12 text-center'>
				<p className='text-muted-foreground text-sm'>
					{result
						? describeLinearFailure(result.failure)
						: t(
								'linear:issue-detail.load-failed',
								'This Linear issue could not be loaded.',
							)}
				</p>
				<div className='flex items-center gap-2'>
					<Button asChild size='sm' variant='ghost'>
						<Link to='/linear'>
							<ArrowLeftIcon />{' '}
							{t('linear:issue-detail.back', 'Back to issues')}
						</Link>
					</Button>
					<Button onClick={() => void refetch()} size='sm' variant='outline'>
						<RefreshCwIcon /> {t('common:actions.retry', 'Retry')}
					</Button>
				</div>
			</div>
		);
	}

	const { issue } = result;

	return (
		<>
			<LinearIssueDetailHeader
				isRefreshing={isFetching}
				issue={issue}
				onEdit={() => setEditorOpen(true)}
				onRefresh={() => void refetch()}
			/>
			<div className='min-h-0 flex-1 overflow-y-auto px-6 py-6'>
				<div className='mx-auto grid w-full max-w-5xl grid-cols-1 gap-x-10 gap-y-6 lg:grid-cols-[minmax(0,1fr)_15rem]'>
					<div className='flex min-w-0 flex-col gap-2 lg:col-span-2'>
						<h1 className='font-semibold text-foreground text-xl leading-snug tracking-tight'>
							{issue.title}
						</h1>
						<IssueTimeline issue={issue} />
					</div>
					<div className='order-2 flex min-w-0 flex-col gap-8 lg:order-none'>
						<IssueDescription description={issue.description} />
						<LinearIssueComments comments={result.comments} />
						<LinearCommentComposer issueId={issueId} />
					</div>
					<div className='order-1 lg:order-none'>
						<LinearIssueProperties issue={issue} />
					</div>
				</div>
			</div>
			<LinearIssueEditorDialog
				issue={issue}
				onOpenChange={setEditorOpen}
				open={editorOpen}
			/>
		</>
	);
}

/** When the issue last changed, plus the archived marker that outranks it. */
function IssueTimeline({ issue }: { issue: LinearIssueWire }) {
	const { t } = useTranslation();

	return (
		<div className='flex flex-wrap items-center gap-2 text-muted-foreground text-xxs'>
			{issue.updatedAt ? (
				<time dateTime={issue.updatedAt}>
					{t('linear:issue-detail.updated', 'Updated {{when}}', {
						when: formatRelativeTimestamp(issue.updatedAt),
					})}
				</time>
			) : null}
			{issue.archivedAt ? (
				<Badge variant='secondary'>
					{t('linear:issue-badges.archived', 'Archived')}
				</Badge>
			) : null}
		</div>
	);
}

/** The issue body as markdown, or a note that Linear holds none. */
function IssueDescription({ description }: { description: string | null }) {
	const { t } = useTranslation();

	if (!description || description.trim().length === 0) {
		return (
			<p className='text-muted-foreground text-xs italic'>
				{t('linear:issue-detail.no-description', 'No description.')}
			</p>
		);
	}

	return <ChatMessageText className='text-sm' text={description} />;
}

/** Placeholder shaped like the loaded page, so the layout does not jump on arrival. */
function IssueDetailSkeleton() {
	return (
		<div className='flex flex-1 flex-col gap-6 px-6 py-6'>
			<div className='mx-auto flex w-full max-w-5xl flex-col gap-4'>
				<Skeleton className='h-7 w-2/3' />
				<Skeleton className='h-4 w-32' />
				<Skeleton className='h-32 w-full' />
				<Skeleton className='h-16 w-full' />
			</div>
		</div>
	);
}
