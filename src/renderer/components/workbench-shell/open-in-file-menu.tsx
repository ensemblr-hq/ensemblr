import { CopyIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from '@/renderer/components/ui/dropdown-menu';
import type {
	OpenTargetsState,
	WorkspaceOpenTarget,
} from '@/renderer/types/workbench';

import { OpenTargetIcon } from './open-target-icon';

/** Inputs for {@link OpenInFileMenu}: the file it acts on and the targets it lists. */
interface OpenInFileMenuProps {
	/** The control that opens the menu, wired to the dropdown trigger via `asChild`. */
	children: ReactNode;
	copyTarget: WorkspaceOpenTarget | undefined;
	/**
	 * Path handed to whichever target is picked: workspace-relative for a file
	 * in the tree, absolute for one the preview opened outside the root.
	 */
	filePath: string;
	invokeTarget: OpenTargetsState['invokeTarget'];
	onOpenChange?: (open: boolean) => void;
	openInTargets: readonly WorkspaceOpenTarget[];
}

/**
 * "Open in <app>" dropdown for a single file: one entry per detected app,
 * followed by Copy path when the registry exposes it. Shared by the changed-file
 * rows and the viewer toolbars so every surface lists the same targets in the
 * same order, with each caller supplying only the trigger its surface needs.
 */
export function OpenInFileMenu({
	children,
	copyTarget,
	filePath,
	invokeTarget,
	onOpenChange,
	openInTargets,
}: OpenInFileMenuProps) {
	const { t } = useTranslation();
	const invoke = (target: WorkspaceOpenTarget) =>
		void invokeTarget(target, {
			relativePath: filePath,
			relativePathKind: 'file',
		});

	return (
		<DropdownMenu onOpenChange={onOpenChange}>
			<DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
			<DropdownMenuContent align='end' className='w-56 bg-muted p-1'>
				{openInTargets.map((openTarget) => (
					<DropdownMenuItem
						className='min-h-8 gap-2.5 px-2 text-[0.8125rem]'
						key={openTarget.id}
						onSelect={() => invoke(openTarget)}
					>
						<OpenTargetIcon className='size-4' target={openTarget} />
						<span className='min-w-0 flex-1 truncate'>{openTarget.label}</span>
						<span className='w-3.5 shrink-0 text-right text-muted-foreground text-xs tabular-nums'>
							{openTarget.numberShortcutLabel}
						</span>
					</DropdownMenuItem>
				))}
				{copyTarget ? (
					<>
						{openInTargets.length ? (
							<DropdownMenuSeparator className='my-1' />
						) : null}
						<DropdownMenuItem
							className='min-h-8 gap-2.5 px-2 text-[0.8125rem]'
							onSelect={() => invoke(copyTarget)}
						>
							<CopyIcon
								aria-hidden='true'
								className='size-4 text-muted-foreground'
							/>
							<span className='min-w-0 flex-1'>
								{t('workbench:open-in.copy-path', 'Copy path')}
							</span>
						</DropdownMenuItem>
					</>
				) : null}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
