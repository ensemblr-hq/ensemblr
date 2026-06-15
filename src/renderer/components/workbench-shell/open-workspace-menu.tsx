import { Icon } from '@iconify/react';
import { useQuery } from '@tanstack/react-query';
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
import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';

import {
	getEnsembleApiOrNull,
	workspaceOpenTargetsQuery,
} from '@/renderer/api/ensemble';
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

/** Split button + dropdown to open the workspace in installed apps. */
export function OpenWorkspaceMenu({
	workspace,
}: {
	workspace: WorkspaceShellModel;
}) {
	const [isMenuOpen, setMenuOpen] = useState(false);
	const hasBridge = getEnsembleApiOrNull() !== null;
	const { data } = useQuery({
		...workspaceOpenTargetsQuery,
		enabled: hasBridge,
	});

	const openTargets = useMemo<WorkspaceOpenTarget[] | null>(() => {
		// Only render the menu once the real list (seeded from the preload
		// snapshot or fetched via IPC) is available. The workspace model carries
		// an empty list, never a placeholder, so the menu does not flash.
		const fromQuery = data?.targets ?? null;
		if (!fromQuery) {
			return workspace.openTargets.length > 0 ? workspace.openTargets : null;
		}
		return fromQuery.filter(
			(target) => target.installed || target.kind === 'utility',
		);
	}, [data?.targets, workspace.openTargets]);

	const primaryTarget = useMemo(() => {
		if (!openTargets) {
			return null;
		}
		return (
			openTargets.find((target) => target.isPrimary) ??
			openTargets.find((target) => target.kind !== 'utility') ??
			openTargets[0] ??
			null
		);
	}, [openTargets]);

	const invokeTarget = useCallback(
		async (target: WorkspaceOpenTarget) => {
			const ensemble = getEnsembleApiOrNull();
			if (!ensemble) {
				toast.error('Open in… is unavailable without the Electron bridge.');
				return;
			}
			const result = await ensemble.openWorkspaceInTarget({
				targetId: target.id,
				workspaceId: workspace.id,
			});
			if (!result.ok) {
				toast.error(`Failed to open in ${target.label}: ${result.error}`);
				return;
			}
			if (target.behavior === 'copy-path') {
				toast.success('Workspace path copied to clipboard.');
			}
		},
		[workspace.id],
	);

	useEffect(() => {
		if (!openTargets || openTargets.length === 0) {
			return undefined;
		}

		const handler = (event: KeyboardEvent) => {
			if (event.defaultPrevented) {
				return;
			}
			if (shouldIgnoreShortcut(event)) {
				return;
			}

			const commandKey = event.metaKey || event.ctrlKey;

			if (
				commandKey &&
				event.shiftKey &&
				!event.altKey &&
				event.key.toLowerCase() === 'c'
			) {
				const copyTarget = openTargets.find(
					(target) => target.behavior === 'copy-path',
				);
				if (copyTarget) {
					event.preventDefault();
					void invokeTarget(copyTarget);
				}
				return;
			}

			if (
				commandKey &&
				!event.shiftKey &&
				!event.altKey &&
				event.key.toLowerCase() === 'o'
			) {
				if (primaryTarget) {
					event.preventDefault();
					void invokeTarget(primaryTarget);
				}
				return;
			}

			if (
				isMenuOpen &&
				!commandKey &&
				!event.altKey &&
				!event.shiftKey &&
				/^[1-9]$/.test(event.key)
			) {
				const index = Number.parseInt(event.key, 10) - 1;
				const target = openTargets[index];
				if (target) {
					event.preventDefault();
					setMenuOpen(false);
					void invokeTarget(target);
				}
			}
		};

		window.addEventListener('keydown', handler);
		return () => {
			window.removeEventListener('keydown', handler);
		};
	}, [invokeTarget, isMenuOpen, openTargets, primaryTarget]);

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

/**
 * Skip the global open-in shortcuts when the user is typing in an editable
 * surface. ⌘O / ⌘⇧C are claimed for opening editors and copying the workspace
 * path; firing them inside an input would surprise users.
 */
function shouldIgnoreShortcut(event: KeyboardEvent): boolean {
	const target = event.target;
	if (!(target instanceof HTMLElement)) {
		return false;
	}
	if (target.isContentEditable) {
		return true;
	}
	const tag = target.tagName;
	return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
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
