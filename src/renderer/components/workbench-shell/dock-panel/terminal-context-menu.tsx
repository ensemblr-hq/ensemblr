import { PaperclipIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import {
	ContextMenuContent,
	ContextMenuItem,
} from '@/renderer/components/ui/context-menu';
import { useAttachToChat } from '@/renderer/hooks/workbench-shell/composer/use-attach-to-chat';

/**
 * Right-click menu for a terminal surface: writes whatever the user has selected
 * into the workspace's attachment store and drops the chip into whichever
 * composer is mounted on that root. Disabled with nothing selected.
 *
 * `onCloseAutoFocus` is where the caller places keyboard focus once the menu
 * closes. Radix would otherwise focus the trigger element — the wrapper around
 * the terminal rather than the terminal inside it, and a wrapper carrying no
 * `tabIndex`, so focus falls through to `<body>` and the next Tab restarts from
 * the top of the document.
 */
export function TerminalContextMenuContent({
	onCloseAutoFocus,
	selection,
	terminalLabel,
	workspaceCwd,
}: {
	onCloseAutoFocus: (event: Event) => void;
	selection: string;
	/** What the pane calls itself, which names the chip and the stored file. */
	terminalLabel: string;
	workspaceCwd: string;
}) {
	const { t } = useTranslation();
	const { attachSelection } = useAttachToChat({ workspaceCwd });

	return (
		<ContextMenuContent
			aria-label={t('workbench:terminal.menu.actions', 'Terminal actions')}
			className='w-56 bg-muted p-1'
			onCloseAutoFocus={onCloseAutoFocus}
		>
			<ContextMenuItem
				className='h-8 gap-2 px-2 text-[0.8125rem]'
				disabled={selection.length === 0}
				onSelect={() => attachSelection(terminalLabel, selection)}
			>
				<PaperclipIcon aria-hidden='true' className='text-muted-foreground' />
				<span className='min-w-0 flex-1'>
					{t(
						'workbench:terminal.menu.attach-selection',
						'Attach selection to chat',
					)}
				</span>
			</ContextMenuItem>
		</ContextMenuContent>
	);
}
