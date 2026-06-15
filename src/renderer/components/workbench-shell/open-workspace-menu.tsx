import { Icon } from '@iconify/react';
import {
	ChevronDownIcon,
	CopyIcon,
	FileCodeIcon,
	FolderIcon,
	GitBranchIcon,
	SquareTerminalIcon,
	WrenchIcon,
} from 'lucide-react';
import type { ComponentType, ReactNode } from 'react';
import { useCallback, useState } from 'react';

import { Button } from '@/renderer/components/ui/button';
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from '@/renderer/components/ui/dropdown-menu';
import { cn } from '@/renderer/lib/utils';
import type {
	WorkspaceOpenTarget,
	WorkspaceShellModel,
} from '@/renderer/types/workbench';
import type { WorkspaceOpenTargetIconName } from '@/shared/ipc/contracts/open-target';
import { useOpenTargetShortcuts } from './use-open-target-shortcuts';
import { useOpenTargets } from './use-open-targets';

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
		<div className='flex h-7 shrink-0 overflow-hidden rounded-md border border-border bg-background'>
			<Button
				aria-label={`Open current workspace in ${primaryTarget.label}`}
				className='size-7 rounded-none border-0 bg-transparent'
				onClick={() => void invokeTarget(primaryTarget)}
				size='icon-sm'
				type='button'
				variant='subtle'
			>
				<OpenTargetIcon className='size-4' target={primaryTarget} />
			</Button>
			<div className='my-1 w-px bg-border' />
			<DropdownMenu onOpenChange={setMenuOpen} open={isMenuOpen}>
				<DropdownMenuTrigger asChild>
					<Button
						aria-label='Open current workspace app options'
						className='size-7 rounded-none border-0 bg-transparent'
						size='icon-sm'
						type='button'
						variant='subtle'
					>
						<ChevronDownIcon aria-hidden='true' className='size-3.5' />
					</Button>
				</DropdownMenuTrigger>
				<DropdownMenuContent align='end' className='w-64 p-1'>
					{openTargets.map((target) => (
						<DropdownMenuItem
							className='h-8 gap-2.5 px-2 text-[0.8125rem]'
							key={target.id}
							onSelect={(event) => {
								event.preventDefault();
								setMenuOpen(false);
								void invokeTarget(target);
							}}
						>
							<OpenTargetIcon className='size-4' target={target} />
							<span className='min-w-0 flex-1 truncate'>{target.label}</span>
							{target.shortcutLabel ? (
								<span className='shrink-0 text-muted-foreground text-xs'>
									{target.shortcutLabel}
								</span>
							) : null}
							<span className='w-3.5 shrink-0 text-right text-muted-foreground text-xs tabular-nums'>
								{target.numberShortcutLabel}
							</span>
						</DropdownMenuItem>
					))}
				</DropdownMenuContent>
			</DropdownMenu>
		</div>
	);
}

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
function OpenTargetIcon({
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
