import { ChevronDownIcon } from 'lucide-react';

import { Button } from '@/renderer/components/ui/button';
import { useOpenTargets } from '@/renderer/hooks/workbench-shell/use-open-targets';

import { OpenInFileMenu } from './open-in-file-menu';

/**
 * "Open in" control for the file and diff viewer toolbars, handing the file on
 * screen to one of the detected apps. Wears the same ghost, `h-6` shape as the
 * other controls sharing that header rather than the bordered split button the
 * workbench header uses, and stays hidden until detection finds a target so the
 * toolbar never carries an empty menu.
 */
export function OpenInToolbarMenu({
	filePath,
	workspaceId,
}: {
	/** Workspace-relative path of the file the toolbar is showing. */
	filePath: string;
	workspaceId: string;
}) {
	const { copyTarget, invokeTarget, openInTargets } = useOpenTargets({
		workspaceId,
	});

	if (!openInTargets.length && !copyTarget) {
		return null;
	}

	return (
		<OpenInFileMenu
			copyTarget={copyTarget}
			filePath={filePath}
			invokeTarget={invokeTarget}
			openInTargets={openInTargets}
		>
			<Button className='h-6 px-1.5 text-xs' size='xs' variant='ghost'>
				Open in
				<ChevronDownIcon data-icon='inline-end' />
			</Button>
		</OpenInFileMenu>
	);
}
