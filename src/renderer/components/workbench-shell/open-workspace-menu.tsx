import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

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
	const { t } = useTranslation();
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
			menuAriaLabel={t(
				'workbench:open-workspace-menu.options',
				'Open current workspace app options',
			)}
			onInvoke={(target) => void invokeTarget(target)}
			onOpenChange={setMenuOpen}
			open={isMenuOpen}
			openTargets={openTargets}
			primaryAriaLabel={t(
				'workbench:open-workspace-menu.primary',
				'Open current workspace in {{target}}',
				{ target: primaryTarget.label },
			)}
			primaryTarget={primaryTarget}
		/>
	);
}
