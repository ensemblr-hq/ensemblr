import {
	ChevronDownIcon,
	ExternalLinkIcon,
	GitPullRequestCreateIcon,
	GitPullRequestDraftIcon,
} from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/renderer/components/ui/button';
import {
	Command,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
	CommandShortcut,
} from '@/renderer/components/ui/command';
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from '@/renderer/components/ui/popover';

/** Split-button + popover surfacing PR creation actions. */
export function CreatePullRequestMenu() {
	const [isOpen, setIsOpen] = useState(false);
	const closeMenu = () => setIsOpen(false);

	return (
		<div className='flex h-7 shrink-0 items-center overflow-hidden rounded-md border border-border bg-background'>
			<Button
				className='h-7 rounded-none border-0 bg-transparent px-2.5'
				size='sm'
				variant='ghost'
			>
				<GitPullRequestCreateIcon data-icon='inline-start' />
				Create PR
			</Button>
			<span aria-hidden='true' className='h-4 w-px shrink-0 bg-border' />
			<Popover onOpenChange={setIsOpen} open={isOpen}>
				<PopoverTrigger asChild>
					<Button
						aria-label='Open create pull request options'
						className='size-7 rounded-none border-0 bg-transparent'
						size='icon-sm'
						variant='ghost'
					>
						<ChevronDownIcon aria-hidden='true' />
					</Button>
				</PopoverTrigger>
				<PopoverContent
					align='end'
					className='w-64 overflow-hidden p-0'
					onOpenAutoFocus={(event) => event.preventDefault()}
				>
					<Command>
						<CommandInput placeholder='Create PR action...' />
						<CommandList>
							<CommandEmpty>No PR actions found.</CommandEmpty>
							<CommandGroup heading='Pull request'>
								<CommandItem onSelect={closeMenu} value='create draft pr'>
									<GitPullRequestDraftIcon aria-hidden='true' />
									<span>Create draft PR</span>
									<CommandShortcut>Draft</CommandShortcut>
								</CommandItem>
								<CommandItem onSelect={closeMenu} value='create pr manually'>
									<ExternalLinkIcon aria-hidden='true' />
									<span>Create PR manually</span>
									<CommandShortcut>Web</CommandShortcut>
								</CommandItem>
							</CommandGroup>
						</CommandList>
					</Command>
				</PopoverContent>
			</Popover>
		</div>
	);
}
