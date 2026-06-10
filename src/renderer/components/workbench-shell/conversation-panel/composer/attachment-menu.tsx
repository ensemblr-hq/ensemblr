import {
	FolderOpenIcon,
	LinkIcon,
	PaperclipIcon,
	PlusIcon,
} from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/renderer/components/ui/button';
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuShortcut,
	DropdownMenuTrigger,
} from '@/renderer/components/ui/dropdown-menu';
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from '@/renderer/components/ui/tooltip';

interface AttachmentMenuProps {
	disabled?: boolean;
	onAddAttachment: () => void;
}

/** Opens the composer attachment/link actions from the plus button. */
export function AttachmentMenu({
	disabled,
	onAddAttachment,
}: AttachmentMenuProps) {
	const [menuOpen, setMenuOpen] = useState(false);
	return (
		<DropdownMenu onOpenChange={setMenuOpen} open={menuOpen}>
			<Tooltip open={menuOpen ? false : undefined}>
				<TooltipTrigger asChild>
					<DropdownMenuTrigger asChild>
						<Button
							aria-label='Attachments'
							className='rounded-md'
							disabled={disabled}
							size='icon-sm'
							type='button'
							variant='subtle'
						>
							<PlusIcon />
						</Button>
					</DropdownMenuTrigger>
				</TooltipTrigger>
				<TooltipContent sideOffset={4}>
					Add attachments, link issues, and more
				</TooltipContent>
			</Tooltip>
			<DropdownMenuContent align='end' className='w-64 p-1.5' sideOffset={10}>
				<DropdownMenuGroup>
					<DropdownMenuItem
						className='gap-3 px-2 py-2 text-sm'
						onSelect={onAddAttachment}
					>
						<PaperclipIcon />
						<span className='flex-1'>Add attachment</span>
						<DropdownMenuShortcut>⌘U</DropdownMenuShortcut>
					</DropdownMenuItem>
					<DropdownMenuItem
						className='gap-3 px-2 py-2 text-sm'
						onSelect={() => toast.info('Linking issues is coming soon.')}
					>
						<LinkIcon />
						<span className='flex-1'>Link issue</span>
						<DropdownMenuShortcut>⌘I</DropdownMenuShortcut>
					</DropdownMenuItem>
					<DropdownMenuItem
						className='gap-3 px-2 py-2 text-sm'
						onSelect={() => toast.info('Linking workspaces is coming soon.')}
					>
						<FolderOpenIcon />
						<span className='flex-1'>Link workspaces</span>
					</DropdownMenuItem>
				</DropdownMenuGroup>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
