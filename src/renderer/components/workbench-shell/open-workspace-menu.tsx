import { useCallback, useState } from 'react';

import { useOpenTargetShortcuts } from '@/renderer/hooks/workbench-shell/use-open-target-shortcuts';
import { useOpenTargets } from '@/renderer/hooks/workbench-shell/use-open-targets';
import type { WorkspaceShellModel } from '@/renderer/types/workbench';

import { OpenTargetSplitButton } from './open-target-split-button';

/** Split button + dropdown to open the workspace in installed apps. */
export function OpenWorkspaceMenu({
	workspace,
}: {
	workspace: WorkspaceShellModel;
}) {
	const [isMenuOpen, setMenuOpen] = useState(false);
	const closeMenu = useCallback(() => setMenuOpen(false), []);
	const { invokeTarget, openTargets, primaryTarget } = useOpenTargets({
		workspaceId: workspace.id,
	});

	useOpenTargetShortcuts({
		closeMenu,
		invokeTarget: (target) => void invokeTarget(target),
		isMenuOpen,
		openTargets,
		primaryTarget,
	});

	if (!openTargets || !primaryTarget) {
		return null;
	}

	return (
		<OpenTargetSplitButton
			menuAriaLabel='Open current workspace app options'
			onInvoke={(target) => void invokeTarget(target)}
			onOpenChange={setMenuOpen}
			open={isMenuOpen}
			openTargets={openTargets}
			primaryAriaLabel={`Open current workspace in ${primaryTarget.label}`}
			primaryTarget={primaryTarget}
		/>
	);
}
