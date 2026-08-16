import { CheckIcon, ChevronsUpDownIcon, FolderGit2Icon } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/renderer/components/ui/button';
import {
	Command,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
} from '@/renderer/components/ui/command';
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from '@/renderer/components/ui/popover';
import { ProjectAvatar } from '@/renderer/components/workbench-shell/project-avatar';
import type { ProjectShellModel } from '@/renderer/types/workbench';

/**
 * Searchable repository picker in a popover. Shared by the create-from-source
 * dialog, which uses it to narrow which repository's sources are listed, and by
 * the board's assign-issue dialog, which uses it to point a Linear issue — which
 * is not repo-scoped — at the repository its workspace is cut from.
 */
export function RepositoryPicker({
	onSelect,
	projects,
	selectedRepo,
}: {
	onSelect: (repoId: string) => void;
	projects: ProjectShellModel[];
	selectedRepo: ProjectShellModel | null;
}) {
	const { t } = useTranslation();
	const [open, setOpen] = useState(false);

	return (
		<Popover onOpenChange={setOpen} open={open}>
			<PopoverTrigger asChild>
				<Button
					className='h-7 shrink-0 gap-1.5 pr-1.5 pl-1 font-medium text-xs'
					size='sm'
					variant='ghost'
				>
					{selectedRepo ? (
						<ProjectAvatar project={selectedRepo} size='sm' />
					) : (
						<FolderGit2Icon
							aria-hidden='true'
							className='size-4 text-muted-foreground'
						/>
					)}
					<span className='max-w-32 truncate'>
						{selectedRepo?.name ??
							t(
								'workbench:create-workspace-source.repository.select',
								'Select repository',
							)}
					</span>
					<ChevronsUpDownIcon
						aria-hidden='true'
						className='size-3.5 text-muted-foreground'
					/>
				</Button>
			</PopoverTrigger>
			<PopoverContent align='end' className='w-64 overflow-hidden p-0'>
				<Command>
					<CommandInput
						placeholder={t(
							'workbench:create-workspace-source.repository.search',
							'Search repositories…',
						)}
					/>
					<CommandList>
						<CommandEmpty className='py-6 text-muted-foreground text-xs'>
							{t(
								'workbench:create-workspace-source.repository.empty',
								'No repositories found.',
							)}
						</CommandEmpty>
						<CommandGroup>
							{projects.map((candidate) => {
								const isSelected = candidate.id === selectedRepo?.id;
								return (
									<CommandItem
										className='gap-2'
										key={candidate.id}
										keywords={[candidate.name]}
										onSelect={() => {
											onSelect(candidate.id);
											setOpen(false);
										}}
										value={candidate.id}
									>
										<span className='flex w-4 shrink-0 items-center justify-center'>
											{isSelected ? (
												<CheckIcon aria-hidden='true' className='size-4' />
											) : null}
										</span>
										<ProjectAvatar project={candidate} size='sm' />
										<span className='min-w-0 flex-1 truncate text-[0.8125rem]'>
											{candidate.name}
										</span>
										{/* cmdk binds `aria-selected` to keyboard highlight rather
										    than to checked state, so the tick alone is silent. */}
										{isSelected ? (
											<span className='sr-only'>
												{t(
													'workbench:create-workspace-source.repository.selected',
													'Selected',
												)}
											</span>
										) : null}
									</CommandItem>
								);
							})}
						</CommandGroup>
					</CommandList>
				</Command>
			</PopoverContent>
		</Popover>
	);
}
