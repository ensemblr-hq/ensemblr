import { ChevronDownIcon } from 'lucide-react';
import { useCallback, useState } from 'react';

import { Button } from '@/renderer/components/ui/button';
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from '@/renderer/components/ui/dropdown-menu';
import { useOpenTargetShortcuts } from '@/renderer/hooks/workbench-shell/use-open-target-shortcuts';
import { useOpenTargets } from '@/renderer/hooks/workbench-shell/use-open-targets';
import type { WorkspaceShellModel } from '@/renderer/types/workbench';

import { OpenTargetIcon } from './open-target-icon';

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
