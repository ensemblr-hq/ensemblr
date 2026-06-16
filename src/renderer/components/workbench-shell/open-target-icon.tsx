import { Icon } from '@iconify/react';
import {
	CopyIcon,
	FileCodeIcon,
	FolderIcon,
	GitBranchIcon,
	SquareTerminalIcon,
	WrenchIcon,
} from 'lucide-react';
import type { ComponentType, ReactNode } from 'react';

import { cn } from '@/renderer/lib/utils';
import type { WorkspaceOpenTarget } from '@/renderer/types/workbench';
import type { WorkspaceOpenTargetIconName } from '@/shared/ipc/contracts/open-target';

type IconRenderer = ComponentType<{ className?: string }>;

const lucide = (Component: IconRenderer): IconRenderer =>
	function LucideGlyph({ className }) {
		return <Component aria-hidden='true' className={className} />;
	};

const iconify = (icon: string): IconRenderer =>
	function IconifyGlyph({ className }) {
		return <Icon aria-hidden='true' className={className} icon={icon} />;
	};

/**
 * Exhaustive map from icon-name literal to its concrete React renderer.
 * Adding a new variant to `WorkspaceOpenTargetIconName` without updating this
 * record is a TS error; adding to this record without extending the union is
 * also a TS error.
 */
const NAMED_ICON_RENDERERS: Record<WorkspaceOpenTargetIconName, IconRenderer> =
	{
		'lucide:copy': lucide(CopyIcon),
		'lucide:file-code': lucide(FileCodeIcon),
		'lucide:folder': lucide(FolderIcon),
		'lucide:github': lucide(GitBranchIcon),
		'lucide:square-terminal': lucide(SquareTerminalIcon),
		'lucide:wrench': lucide(WrenchIcon),
		'vscode-icons:file-type-vscode': iconify('vscode-icons:file-type-vscode'),
		'vscode-icons:folder-type-github': iconify(
			'vscode-icons:folder-type-github',
		),
	};

/**
 * Renders the icon for an open-in target. Prefers the real macOS app icon
 * (PNG data URL extracted by the main process); falls back to the renderer
 * registered for the target's named glyph.
 */
export function OpenTargetIcon({
	className,
	target,
}: {
	className?: string;
	target: WorkspaceOpenTarget;
}): ReactNode {
	const iconClassName = cn('shrink-0', className);

	if (target.iconDataUrl) {
		return (
			<img
				alt=''
				aria-hidden='true'
				className={cn(iconClassName, 'object-contain')}
				src={target.iconDataUrl}
			/>
		);
	}

	const Renderer = NAMED_ICON_RENDERERS[target.iconName];
	return <Renderer className={iconClassName} />;
}
