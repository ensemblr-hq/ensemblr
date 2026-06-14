import {
	GitBranchIcon,
	GitMergeIcon,
	GitPullRequestIcon,
	MessageSquareTextIcon,
	SparklesIcon,
	WrenchIcon,
} from 'lucide-react';

import { Button } from '@/renderer/components/ui/button';
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuTrigger,
} from '@/renderer/components/ui/dropdown-menu';
import type { AgentActionKind } from '@/renderer/lib/workbench/agent-actions';

import { useReviewActions } from './review-actions-context';

const ACTION_ITEMS: Array<{
	icon: typeof SparklesIcon;
	kind: AgentActionKind;
	label: string;
}> = [
	{ icon: MessageSquareTextIcon, kind: 'review', label: 'Review changes' },
	{
		icon: GitPullRequestIcon,
		kind: 'create-pr',
		label: 'Draft PR description',
	},
	{ icon: WrenchIcon, kind: 'fix-check-errors', label: 'Fix check failures' },
	{ icon: GitMergeIcon, kind: 'resolve-conflicts', label: 'Resolve conflicts' },
	{ icon: GitBranchIcon, kind: 'branch-naming', label: 'Suggest branch name' },
];

/**
 * Agent-assisted review actions (ENS-059). Each action resolves its
 * instruction template from settings/ensemble.json and inserts the generated
 * prompt into the composer for inspection — nothing auto-submits.
 */
export function AgentActionsMenu() {
	const reviewActions = useReviewActions();

	if (!reviewActions) {
		return null;
	}

	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button className='h-6 px-1.5 text-xs' size='xs' variant='subtle'>
					<SparklesIcon data-icon='inline-start' />
					Agent actions
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align='end' className='w-56'>
				<DropdownMenuLabel className='text-muted-foreground text-xs'>
					Inserts an editable prompt into chat
				</DropdownMenuLabel>
				{ACTION_ITEMS.map((item) => (
					<DropdownMenuItem
						key={item.kind}
						onSelect={() => reviewActions.runAgentAction(item.kind)}
					>
						<item.icon aria-hidden='true' />
						{item.label}
					</DropdownMenuItem>
				))}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
