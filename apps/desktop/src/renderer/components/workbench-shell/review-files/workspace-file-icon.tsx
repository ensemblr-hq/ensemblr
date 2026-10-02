import { Icon } from '@iconify/react';

import { getWorkspaceFileIconName } from '@/renderer/lib/workbench';
import type { WorkspaceFileSummary } from '@/renderer/types/workbench';

/** Renders the VSCode-style icon for a workspace file or folder. */
export function WorkspaceFileIcon({ file }: { file: WorkspaceFileSummary }) {
	return (
		<Icon
			aria-hidden='true'
			className='size-3.5 shrink-0'
			icon={getWorkspaceFileIconName(file)}
		/>
	);
}
