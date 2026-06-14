import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import {
	ArrowLeftIcon,
	ExternalLinkIcon,
	FolderGit2Icon,
	PencilIcon,
	RefreshCwIcon,
} from 'lucide-react';
import { useState } from 'react';

import { linearIssueQuery } from '@/renderer/api/ensemble';
import { Button } from '@/renderer/components/ui/button';
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuTrigger,
} from '@/renderer/components/ui/dropdown-menu';
import { Separator } from '@/renderer/components/ui/separator';
import { Skeleton } from '@/renderer/components/ui/skeleton';
import { useCreateWorkspaceFromProject } from '@/renderer/components/workbench-shell/navigation-sidebar/use-project-navigation-actions';
import { useWorkbenchLayoutRouteModel } from '@/renderer/components/workbench-shell/shell-contexts';
import {
	buildWorkspaceSeedFromLinearIssue,
	describeLinearFailure,
} from '@/renderer/lib/linear';
import type { LinearCommentWire, LinearIssueWire } from '@/shared/ipc/contracts/linear';

import { LinearCommentComposer } from './comment-composer';
import { LinearIssueEditorDialog } from './issue-editor-dialog';
import { LinearIssueMetaBadges } from './issue-meta-badges';

/** Linear issue detail: metadata header, description, and comment thread. */
export function LinearIssueDetail({ issueId }: { issueId: string }) {
	const detail = useQuery(linearIssueQuery(issueId));
	const result = detail.data;

	if (detail.isLoading) {
		return (
			<div className='flex w-full flex-col gap-3'>
				<Skeleton className='h-8 w-2/3' />
				<Skeleton className='h-24 w-full' />
				<Skeleton className='h-16 w-full' />
			</div>
		);
	}

	if (!result || result.status === 'error') {
		return (
			<div className='flex w-full flex-col items-center gap-3 py-12 text-center'>
				<p className='text-muted-foreground text-sm'>
					{result
						? describeLinearFailure(result.failure)
						: 'This Linear issue could not be loaded.'}
				</p>
				<div className='flex items-center gap-2'>
					<Button asChild size='sm' variant='ghost'>
						<Link to='/linear'>
							<ArrowLeftIcon /> Back to issues
						</Link>
					</Button>
					<Button
						onClick={() => void detail.refetch()}
						size='sm'
						variant='outline'
					>
						<RefreshCwIcon /> Retry
					</Button>
				</div>
			</div>
		);
	}

	return (
		<div className='flex w-full flex-col gap-4'>
			<IssueDetailHeader
				issue={result.issue}
				isRefreshing={detail.isFetching}
				onRefresh={() => void detail.refetch()}
			/>
			{result.issue.description ? (
				<p className='whitespace-pre-wrap text-foreground text-sm leading-relaxed'>
					{result.issue.description}
				</p>
			) : (
				<p className='text-muted-foreground text-xs'>No description.</p>
			)}
			<Separator />
			<IssueComments comments={result.comments} />
			<LinearCommentComposer issueId={issueId} />
		</div>
	);
}

function IssueDetailHeader({
	isRefreshing,
	issue,
	onRefresh,
}: {
	isRefreshing: boolean;
	issue: LinearIssueWire;
	onRefresh: () => void;
}) {
	const [editorOpen, setEditorOpen] = useState(false);

	return (
		<div className='flex flex-col gap-2'>
			<div className='flex items-center gap-2'>
				<Button asChild size='icon-sm' variant='ghost'>
					<Link aria-label='Back to issues' to='/linear'>
						<ArrowLeftIcon />
					</Link>
				</Button>
				<span className='font-mono text-muted-foreground text-xs'>
					{issue.identifier}
				</span>
				{issue.teamName ? (
					<span className='text-muted-foreground text-xs'>
						{issue.teamName}
						{issue.projectName ? ` · ${issue.projectName}` : ''}
						{issue.cycleName ? ` · ${issue.cycleName}` : ''}
					</span>
				) : null}
				<span className='ml-auto flex items-center gap-1'>
					<Button
						aria-label='Refresh issue'
						disabled={isRefreshing}
						onClick={onRefresh}
						size='icon-sm'
						variant='ghost'
					>
						<RefreshCwIcon
							className={isRefreshing ? 'animate-spin' : undefined}
						/>
					</Button>
					<Button asChild size='icon-sm' variant='ghost'>
						<a
							aria-label='Open in Linear'
							href={issue.url}
							rel='noreferrer'
							target='_blank'
						>
							<ExternalLinkIcon />
						</a>
					</Button>
					<Button onClick={() => setEditorOpen(true)} size='sm' variant='ghost'>
						<PencilIcon /> Edit
					</Button>
					<CreateWorkspaceFromIssueButton issue={issue} />
				</span>
			</div>
			<h1 className='font-semibold text-foreground text-lg leading-snug'>
				{issue.title}
			</h1>
			<LinearIssueMetaBadges issue={issue} showLabels />
			<LinearIssueEditorDialog
				issue={issue}
				onOpenChange={setEditorOpen}
				open={editorOpen}
			/>
		</div>
	);
}

/**
 * Repository picker that creates a worktree workspace seeded from this issue
 * (name, branch, linked-issue metadata, composer context — ENS-048).
 */
function CreateWorkspaceFromIssueButton({ issue }: { issue: LinearIssueWire }) {
	const model = useWorkbenchLayoutRouteModel();
	const { create, isCreating } = useCreateWorkspaceFromProject({
		disableProjectReorderLayoutAnimation: () => {},
	});

	if (issue.archivedAt) {
		return null;
	}

	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button
					disabled={isCreating || model.displayProjects.length === 0}
					size='sm'
					variant='outline'
				>
					{isCreating ? 'Creating…' : 'Create workspace'}
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align='end' className='w-64 p-1'>
				<DropdownMenuLabel className='px-2 pt-1.5 pb-1 text-muted-foreground text-xs'>
					Create in repository
				</DropdownMenuLabel>
				{model.displayProjects.map((project) => (
					<DropdownMenuItem
						className='h-8 gap-2 px-2 text-[0.8125rem]'
						key={project.id}
						onSelect={() => {
							void create(project, buildWorkspaceSeedFromLinearIssue(issue));
						}}
					>
						<FolderGit2Icon
							aria-hidden='true'
							className='size-4 shrink-0 text-muted-foreground'
						/>
						<span className='min-w-0 flex-1 truncate'>{project.name}</span>
					</DropdownMenuItem>
				))}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

function IssueComments({ comments }: { comments: LinearCommentWire[] }) {
	if (comments.length === 0) {
		return <p className='text-muted-foreground text-xs'>No comments yet.</p>;
	}

	return (
		<ul className='flex flex-col gap-3'>
			{comments.map((comment) => (
				<li
					className='rounded-lg border border-border px-3 py-2.5'
					key={comment.id}
				>
					<div className='mb-1 flex items-center gap-2 text-muted-foreground text-xs'>
						<span className='font-medium text-foreground'>
							{comment.authorName ?? 'Unknown'}
						</span>
						{comment.createdAt ? (
							<span>{new Date(comment.createdAt).toLocaleString()}</span>
						) : null}
					</div>
					<p className='whitespace-pre-wrap text-sm leading-relaxed'>
						{comment.body}
					</p>
				</li>
			))}
		</ul>
	);
}
