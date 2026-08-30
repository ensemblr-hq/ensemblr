import {
	AtSignIcon,
	FolderSymlinkIcon,
	LinkIcon,
	PaperclipIcon,
	PlusIcon,
} from 'lucide-react';
import { useRef, useState } from 'react';
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
import { formatChord } from '@/shared/keymap';

/**
 * Opens the composer attachment/link actions from the plus button.
 *
 * The mention row appears only where a surface supplies `onReference`, which
 * today is the Concierge alone: a workspace composer's `@` ranks against that
 * workspace's files, and an item promising projects and chats there would open a
 * menu that has none. Its label names no objects and carries no shortcut badge —
 * spelling out "project, workspace, or chat" wrapped the row onto two lines
 * against three single-line siblings, and there is no shorter phrasing that
 * survives Russian, where a workspace is always `рабочее пространство`.
 */
export function AttachmentMenu({
	disabled,
	onAddAttachment,
	onLinkDirectory,
	onLinkIssue,
	onReference,
}: {
	disabled?: boolean;
	onAddAttachment: () => void;
	onLinkDirectory: () => void;
	onLinkIssue?: () => void;
	/** Starts an `@` mention, for a composer whose `@` names app surfaces. */
	onReference?: () => void;
}) {
	const { t } = useTranslation();
	const [menuOpen, setMenuOpen] = useState(false);
	const referencePending = useRef(false);

	/** Records the mention pick, which is run once the menu has let focus go. */
	const startReference = () => {
		referencePending.current = true;
	};

	/**
	 * Returns focus to the plus button on close, except after a mention pick —
	 * which is run here instead, because this is the first moment its caret can
	 * survive.
	 *
	 * `onReference` writes the `@` and focuses the composer, and neither can
	 * happen from `onSelect`: the menu's focus trap pulls the caret straight back
	 * inside while it is still open, and this event then restores the trigger
	 * over it. Radix dispatches it after releasing the trap, so a pick made here
	 * keeps the caret and the `@` menu it just opened takes keys.
	 * @param event - The content's close-auto-focus event.
	 */
	const handleCloseAutoFocus = (event: Event) => {
		if (referencePending.current) {
			referencePending.current = false;
			event.preventDefault();
			onReference?.();
		}
	};

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
			<DropdownMenuContent
				align='end'
				className='w-64 p-1.5'
				onCloseAutoFocus={handleCloseAutoFocus}
				sideOffset={10}
			>
				<DropdownMenuGroup>
					{onReference ? (
						<DropdownMenuItem
							className='gap-3 px-2 py-2 text-sm'
							onSelect={startReference}
						>
							<AtSignIcon />
							<span className='flex-1'>
								{t('workbench:attachment-menu.mention', 'Mention…')}
							</span>
						</DropdownMenuItem>
					) : null}
					<DropdownMenuItem
						className='gap-3 px-2 py-2 text-sm'
						onSelect={onAddAttachment}
					>
						<PaperclipIcon />
						<span className='flex-1'>
							{t('workbench:attachment-menu.add-attachment', 'Add attachment')}
						</span>
						<DropdownMenuShortcut>
							{formatChord(['mod'], 'U')}
						</DropdownMenuShortcut>
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
						<DropdownMenuShortcut>
							{formatChord(['mod'], 'I')}
						</DropdownMenuShortcut>
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
