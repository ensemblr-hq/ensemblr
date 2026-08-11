import { BellDotIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/renderer/components/ui/button';
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from '@/renderer/components/ui/tooltip';
import { useWorkbenchLayoutRouteModelOptional } from '@/renderer/components/workbench-shell/shell-contexts';
import { useNavigateToLastUnread } from '@/renderer/hooks/workbench-shell/composer/use-navigate-to-last-unread';
import { findWorkspaceSelectionById } from '@/renderer/lib/workbench';
import { useLastUnreadChat } from '@/renderer/state/unread';

/**
 * Pill that jumps to the newest chat waiting to be read, wherever in the app it
 * lives. Presentational so the playground and tests can drive it without a
 * router, a query cache, or a populated unread list.
 */
export function LastUnreadButton({
	onClick,
	workspaceName,
}: {
	onClick: () => void;
	/** Workspace the jump lands in, named in the tooltip when it is known. */
	workspaceName: string | null;
}) {
	const { t } = useTranslation();

	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<Button
					className='rounded-full shadow-panel'
					onClick={onClick}
					size='sm'
					type='button'
					variant='outline'
				>
					<BellDotIcon aria-hidden='true' />
					{t('workbench:composer.last-unread', 'Last unread')}
				</Button>
			</TooltipTrigger>
			<TooltipContent>
				{workspaceName
					? t(
							'workbench:composer.last-unread-tooltip',
							'Jump to the newest unread chat in {{workspace}}',
							{ workspace: workspaceName },
						)
					: t(
							'workbench:composer.last-unread-tooltip-generic',
							'Jump to the newest unread chat',
						)}
			</TooltipContent>
		</Tooltip>
	);
}

/**
 * Binds {@link LastUnreadButton} to the unread list, rendering nothing while
 * there is nothing to jump to — which is what keeps the composer's top edge
 * clear in the ordinary case.
 */
export function ConnectedLastUnreadButton() {
	const lastUnread = useLastUnreadChat();
	const layoutModel = useWorkbenchLayoutRouteModelOptional();
	const navigateToLastUnread = useNavigateToLastUnread();

	if (!lastUnread) {
		return null;
	}

	const selection = layoutModel
		? findWorkspaceSelectionById(
				layoutModel.displayProjects,
				lastUnread.workspaceId,
			)
		: null;

	return (
		<LastUnreadButton
			onClick={() => void navigateToLastUnread(lastUnread)}
			workspaceName={selection?.workspace.name ?? null}
		/>
	);
}
