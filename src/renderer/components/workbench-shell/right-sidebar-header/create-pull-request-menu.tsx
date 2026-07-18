import { useAtomValue } from 'jotai';
import {
	ChevronDownIcon,
	ExternalLinkIcon,
	GitPullRequestCreateIcon,
	GitPullRequestDraftIcon,
} from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/renderer/components/ui/button';
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from '@/renderer/components/ui/dropdown-menu';
import { buildCreatePullRequestPrompt } from '@/renderer/lib/workbench/checks-pr-prompts';
import { buildGithubCompareUrl } from '@/renderer/lib/workbench/github-compare-url';
import { resolvePrDetails } from '@/renderer/lib/workbench/pr-details-draft';
import { useComposerSubmit } from '@/renderer/state/composer';
import {
	prDetailsDraftAtomFamily,
	prDetailsLiveDraftAtomFamily,
} from '@/renderer/state/preferences';
import type { WorkspaceShellModel } from '@/renderer/types/workbench';
import { useReviewActions } from '../review-actions/review-actions-context';

/**
 * Split-button + dropdown surfacing PR creation actions. Like the Checks panel,
 * the primary action hands the chore to the active chat agent rather than
 * calling the GitHub API directly; the dropdown adds a draft variant and an
 * escape hatch that opens GitHub's compare page in the browser.
 */
export function CreatePullRequestMenu({
	workspace,
}: {
	workspace: WorkspaceShellModel;
}) {
	const submitToComposer = useComposerSubmit();
	const reviewActions = useReviewActions();
	// Hand the agent the live title/description from the Checks tab (including
	// unsaved edits), falling back to the saved draft and then the open PR. Only
	// the draft variant still builds the prompt here; the primary action defers to
	// the shared agent-action runner so it attaches the composed PR prompt file.
	const liveDraft = useAtomValue(prDetailsLiveDraftAtomFamily(workspace.id));
	const savedDraft = useAtomValue(prDetailsDraftAtomFamily(workspace.id));
	const { description, title } = resolvePrDetails({
		live: liveDraft,
		saved: savedDraft,
		workspace,
	});

	const compareUrl = workspace.githubRepo
		? buildGithubCompareUrl({
				base: workspace.landingSummary?.branchSource.baseBranch,
				head: workspace.branchName,
				owner: workspace.githubRepo.owner,
				repo: workspace.githubRepo.repo,
			})
		: null;

	const createPullRequest = () => {
		reviewActions?.runAgentAction('create-pr');
		toast.success('Asked the agent to open a pull request.');
	};

	const createDraftPullRequest = () => {
		submitToComposer(
			buildCreatePullRequestPrompt({
				description,
				draft: true,
				title,
				workspace,
			}),
		);
		toast.success('Asked the agent to open a draft pull request.');
	};

	const openManually = () => {
		if (compareUrl) {
			void window.ensemblr?.openExternal(compareUrl);
		}
	};

	return (
		<div className='flex h-7 shrink-0 items-center overflow-hidden rounded-md border border-border bg-background'>
			<Button
				className='h-7 rounded-none border-0 bg-transparent px-2.5'
				onClick={createPullRequest}
				size='sm'
				variant='ghost'
			>
				<GitPullRequestCreateIcon data-icon='inline-start' />
				Create PR
			</Button>
			<span aria-hidden='true' className='h-4 w-px shrink-0 bg-border' />
			<DropdownMenu>
				<DropdownMenuTrigger asChild>
					<Button
						aria-label='Open create pull request options'
						className='size-7 rounded-none border-0 bg-transparent'
						size='icon-sm'
						variant='ghost'
					>
						<ChevronDownIcon aria-hidden='true' />
					</Button>
				</DropdownMenuTrigger>
				<DropdownMenuContent align='end' className='w-56'>
					<DropdownMenuItem onSelect={createDraftPullRequest}>
						<GitPullRequestDraftIcon aria-hidden='true' />
						Create draft PR
					</DropdownMenuItem>
					<DropdownMenuItem disabled={!compareUrl} onSelect={openManually}>
						<ExternalLinkIcon aria-hidden='true' />
						Create PR manually
					</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>
		</div>
	);
}
