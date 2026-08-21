import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import {
	ArrowLeftIcon,
	CheckIcon,
	CopyIcon,
	ExternalLinkIcon,
	FolderGit2Icon,
	PencilIcon,
	RefreshCwIcon,
} from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { linearIssueQuery, refreshLinearIssue } from '@/renderer/api/ensemblr';
import { Button } from '@/renderer/components/ui/button';
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuTrigger,
} from '@/renderer/components/ui/dropdown-menu';
import { SidebarTrigger } from '@/renderer/components/ui/sidebar';
import { useWorkbenchLayoutRouteModel } from '@/renderer/components/workbench-shell/shell-contexts';
import { useLinearRefresh } from '@/renderer/hooks/linear/use-linear-refresh';
import { useRefreshSpin } from '@/renderer/hooks/linear/use-refresh-spin';
import { useCopyToClipboard } from '@/renderer/hooks/use-copy-to-clipboard';
import { useCreateWorkspaceFromProject } from '@/renderer/hooks/workbench-shell/navigation-sidebar/use-project-navigation-actions';
import { buildWorkspaceSeedFromLinearIssue } from '@/renderer/lib/linear';
import type { LinearIssueWire } from '@/shared/ipc/contracts/linear';

import { LinearIssueEditorDialog } from './issue-editor-dialog';

/** How long the copy button stays in its confirmed state before reverting. */
const COPY_FEEDBACK_MS = 1500;

/**
 * The issue page's command bar: back out of the issue, the breadcrumb naming
 * where it lives, and every action that operates on the whole issue. It stays
 * put while the body scrolls, so the actions are reachable from the bottom of a
 * long comment thread.
 *
 * The bar renders above the connection gate and resolves the issue itself, so
 * the sidebar trigger and the way back out survive the states where there is no
 * issue to act on — loading, a failed load, and a Linear account that is not
 * connected. Its query shares the body's cache entry rather than fetching twice.
 */
export function LinearIssueDetailHeader({ issueId }: { issueId: string }) {
	const { t } = useTranslation();
	const queryClient = useQueryClient();
	const { data: result, isFetching } = useQuery(linearIssueQuery(issueId));
	const issue = result?.status === 'ok' ? result.issue : null;
	const refresh = useLinearRefresh(() =>
		refreshLinearIssue(queryClient, issueId, issue?.accountId),
	);

	return (
		<header className='native-toolbar flex h-12 shrink-0 items-center gap-2 border-border border-b px-3'>
			<SidebarTrigger className='sidebar-collapsed-trigger' />
			<Button asChild size='icon-sm' variant='ghost'>
				<Link
					aria-label={t('linear:issue-detail.back', 'Back to issues')}
					to='/linear'
				>
					<ArrowLeftIcon />
				</Link>
			</Button>
			{issue ? (
				<IssueCommands
					isRefreshing={isFetching || refresh.active}
					issue={issue}
					onRefresh={refresh.start}
				/>
			) : null}
		</header>
	);
}

/** Breadcrumb plus every command that needs a resolved issue to act on. */
function IssueCommands({
	isRefreshing,
	issue,
	onRefresh,
}: {
	isRefreshing: boolean;
	issue: LinearIssueWire;
	onRefresh: () => void;
}) {
	const { t } = useTranslation();
	const [editorOpen, setEditorOpen] = useState(false);

	return (
		<>
			<IssueBreadcrumb issue={issue} />
			<span className='ml-auto flex shrink-0 items-center gap-1'>
				<CopyIssueLinkButton url={issue.url} />
				<RefreshIssueButton isRefreshing={isRefreshing} onRefresh={onRefresh} />
				<Button asChild size='icon-sm' variant='ghost'>
					<a
						aria-label={t(
							'linear:issue-detail.open-external',
							'Open in Linear',
						)}
						href={issue.url}
						rel='noreferrer'
						target='_blank'
						title={t('linear:issue-detail.open-external', 'Open in Linear')}
					>
						<ExternalLinkIcon />
					</a>
				</Button>
				<Button onClick={() => setEditorOpen(true)} size='sm' variant='ghost'>
					<PencilIcon /> {t('common:actions.edit', 'Edit')}
				</Button>
				<CreateWorkspaceFromIssueButton issue={issue} />
			</span>
			<LinearIssueEditorDialog
				issue={issue}
				onOpenChange={setEditorOpen}
				open={editorOpen}
			/>
		</>
	);
}

/**
 * Identifier plus the organization, team, project, and cycle the issue sits in.
 * The organization leads the trail because an identifier like `ENG-1` is unique
 * only inside one, so two accounts' issues would otherwise read identically.
 */
function IssueBreadcrumb({ issue }: { issue: LinearIssueWire }) {
	const trail = [
		issue.organizationName,
		issue.teamName,
		issue.projectName,
		issue.cycleName,
	].filter((part) => part !== null);

	return (
		<span className='flex min-w-0 items-center gap-2 text-xs'>
			<span className='shrink-0 font-mono text-foreground tabular-nums'>
				{issue.identifier}
			</span>
			{trail.length > 0 ? (
				<span className='min-w-0 truncate text-muted-foreground'>
					{trail.join(' · ')}
				</span>
			) : null}
		</span>
	);
}

/** Ghost icon button carrying its label as both accessible name and hover title. */
function IconAction({
	disabled,
	icon,
	label,
	onClick,
}: {
	disabled?: boolean;
	icon: ReactNode;
	label: string;
	onClick: () => void;
}) {
	return (
		<Button
			aria-label={label}
			disabled={disabled}
			onClick={onClick}
			size='icon-sm'
			title={label}
			variant='ghost'
		>
			{icon}
		</Button>
	);
}

/** Refetches the issue, always completing one full turn of the icon. */
function RefreshIssueButton({
	isRefreshing,
	onRefresh,
}: {
	isRefreshing: boolean;
	onRefresh: () => void;
}) {
	const { t } = useTranslation();
	const { active, start } = useRefreshSpin(isRefreshing);

	return (
		<IconAction
			disabled={active}
			icon={<RefreshCwIcon className={active ? 'animate-spin' : undefined} />}
			label={t('linear:issue-detail.refresh', 'Refresh issue')}
			onClick={() => {
				start();
				onRefresh();
			}}
		/>
	);
}

/** Copies the issue's Linear URL, confirming in place rather than through a toast. */
function CopyIssueLinkButton({ url }: { url: string }) {
	const { t } = useTranslation();
	const { copied, copy } = useCopyToClipboard(COPY_FEEDBACK_MS);

	return (
		<IconAction
			icon={copied ? <CheckIcon className='text-status-ok' /> : <CopyIcon />}
			label={
				copied
					? t('linear:issue-detail.link-copied', 'Link copied')
					: t('linear:issue-detail.copy-link', 'Copy issue link')
			}
			onClick={() => {
				void copy(url);
			}}
		/>
	);
}

/**
 * Repository picker that creates a worktree workspace seeded from this issue
 * (name, branch, linked-issue metadata, composer context — ENS-048).
 */
function CreateWorkspaceFromIssueButton({ issue }: { issue: LinearIssueWire }) {
	const { t } = useTranslation();
	const model = useWorkbenchLayoutRouteModel();
	const { create, isCreating } = useCreateWorkspaceFromProject();

	if (issue.archivedAt) {
		return null;
	}

	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button
					disabled={model.displayProjects.length === 0}
					pending={isCreating}
					size='sm'
					variant='outline'
				>
					{t('linear:create-workspace.trigger', 'Create workspace')}
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align='end' className='w-64 p-1'>
				<DropdownMenuLabel className='px-2 pt-1.5 pb-1 text-muted-foreground text-xs'>
					{t('linear:create-workspace.menu-label', 'Create in repository')}
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
