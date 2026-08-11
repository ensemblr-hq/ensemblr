import {
	FolderSymlinkIcon,
	LinkIcon,
	PaperclipIcon,
	PlusIcon,
} from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
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

/** Opens the composer attachment/link actions from the plus button. */
export function AttachmentMenu({
	disabled,
	onAddAttachment,
	onLinkDirectory,
	onLinkIssue,
}: {
	disabled?: boolean;
	onAddAttachment: () => void;
	onLinkDirectory: () => void;
	onLinkIssue?: () => void;
}) {
	const { t } = useTranslation();
	const [menuOpen, setMenuOpen] = useState(false);
	return (
		<DropdownMenu onOpenChange={setMenuOpen} open={menuOpen}>
			<Tooltip open={menuOpen ? false : undefined}>
				<TooltipTrigger asChild>
					<DropdownMenuTrigger asChild>
						<Button
							aria-label={t(
								'workbench:attachment-menu.aria-label',
								'Attachments',
							)}
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
					{t(
						'workbench:attachment-menu.tooltip',
						'Add attachments, link issues, and more',
					)}
				</TooltipContent>
			</Tooltip>
			<DropdownMenuContent align='end' className='w-64 p-1.5' sideOffset={10}>
				<DropdownMenuGroup>
					<DropdownMenuItem
						className='gap-3 px-2 py-2 text-sm'
						onSelect={onAddAttachment}
					>
						<PaperclipIcon />
						<span className='flex-1'>
							{t('workbench:attachment-menu.add-attachment', 'Add attachment')}
						</span>
						<DropdownMenuShortcut>⌘U</DropdownMenuShortcut>
					</DropdownMenuItem>
					<DropdownMenuItem
						className='gap-3 px-2 py-2 text-sm'
						onSelect={() => {
							if (onLinkIssue) {
								onLinkIssue();
							} else {
								toast.info(
									t(
										'workbench:attachment-menu.link-issue-soon.title',
										'Linking issues is coming soon.',
									),
								);
							}
						}}
					>
						<LinkIcon />
						<span className='flex-1'>
							{t('workbench:attachment-menu.link-issue', 'Link issue')}
						</span>
						<DropdownMenuShortcut>⌘I</DropdownMenuShortcut>
					</DropdownMenuItem>
					<DropdownMenuItem
						className='gap-3 px-2 py-2 text-sm'
						onSelect={onLinkDirectory}
					>
						<FolderSymlinkIcon />
						<span className='flex-1'>
							{t('workbench:attachment-menu.link-directory', 'Link directory')}
						</span>
					</DropdownMenuItem>
				</DropdownMenuGroup>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
