import {
	FolderIcon,
	FolderPlusIcon,
	GlobeIcon,
	type LucideIcon,
} from 'lucide-react';

import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuTrigger,
} from '@/renderer/components/ui/dropdown-menu';
import { SidebarGroupAction } from '@/renderer/components/ui/sidebar';
import type {
	AddProjectActionId,
	AddProjectMenuModel,
	RecentProject,
} from '@/renderer/types/workbench';

const COMING_SOON_REASON = 'Coming soon';

const addProjectActionIcons: Record<AddProjectActionId, LucideIcon> = {
	'open-github': GlobeIcon,
	'open-local': FolderIcon,
	'quick-start': FolderPlusIcon,
};

/** Dropdown that adds new projects via action items or selected recents. */
export function ProjectCreationMenu({
	model,
	onSelectAction,
	onSelectRecent,
}: {
	model: AddProjectMenuModel;
	onSelectAction?: (id: AddProjectActionId) => void;
	onSelectRecent?: (recent: RecentProject) => void;
}) {
	const actionsWired = Boolean(onSelectAction);
	const recentsWired = Boolean(onSelectRecent);
	const hasRecents = model.recents.length > 0;

	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<SidebarGroupAction
					aria-label='Open repository creation menu'
					className='top-2 size-6 [&>svg]:size-3.5'
					type='button'
				>
					<FolderPlusIcon aria-hidden='true' />
				</SidebarGroupAction>
			</DropdownMenuTrigger>
			<DropdownMenuContent
				align='end'
				className='w-80 p-1'
				data-menu-scope='project'
			>
				{model.actions.map((action) => {
					const Icon = addProjectActionIcons[action.id];
					const reason = resolveActionReason({
						action,
						wired: actionsWired,
					});
					const enabled = reason === null;

					return (
						<DropdownMenuItem
							className='min-h-9 flex-col items-stretch gap-0.5 px-2 py-1.5 text-sm'
							data-add-project-action={action.id}
							data-add-project-disabled-reason={reason ?? undefined}
							disabled={!enabled}
							key={action.id}
							onSelect={() => {
								if (enabled) {
									onSelectAction?.(action.id);
								}
							}}
							title={reason ?? undefined}
						>
							<span className='flex w-full min-w-0 items-center gap-2'>
								<Icon
									aria-hidden='true'
									className='size-4 shrink-0 text-muted-foreground'
								/>
								<span className='min-w-0 flex-1 truncate'>{action.label}</span>
							</span>
							{reason ? (
								<span className='pl-6 text-muted-foreground text-xxs leading-4'>
									{reason}
								</span>
							) : null}
						</DropdownMenuItem>
					);
				})}
				{hasRecents ? (
					<>
						<DropdownMenuLabel className='px-2 pt-3 pb-1 text-muted-foreground text-xs'>
							Recents
						</DropdownMenuLabel>
						{model.recents.map((recent) => (
							<DropdownMenuItem
								className='h-8 gap-2 px-2 text-[0.8125rem]'
								data-recent-project-path={recent.path}
								disabled={!recentsWired}
								key={recent.path}
								onSelect={() => {
									if (recentsWired) {
										onSelectRecent?.(recent);
									}
								}}
								title={recentsWired ? undefined : COMING_SOON_REASON}
							>
								<FolderIcon
									aria-hidden='true'
									className='size-4 shrink-0 text-muted-foreground'
								/>
								<span className='min-w-0 flex-1 truncate'>{recent.path}</span>
							</DropdownMenuItem>
						))}
					</>
				) : null}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

/** Picks the disabled-reason for an add-project action (or null when enabled). */
function resolveActionReason({
	action,
	wired,
}: {
	action: AddProjectMenuModel['actions'][number];
	wired: boolean;
}): string | null {
	if (!action.enabled) {
		return action.unavailableReason ?? COMING_SOON_REASON;
	}
	return wired ? null : COMING_SOON_REASON;
}
