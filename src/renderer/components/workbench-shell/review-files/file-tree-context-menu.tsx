import { ArrowUpRightIcon, CopyIcon } from 'lucide-react';
import { createContext, type ReactNode, useContext } from 'react';

import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuSub,
	ContextMenuSubContent,
	ContextMenuSubTrigger,
	ContextMenuTrigger,
} from '@/renderer/components/ui/context-menu';
import { OpenTargetIcon } from '@/renderer/components/workbench-shell/open-target-icon';
import type { OpenTargetsState } from '@/renderer/hooks/workbench-shell/use-open-targets';

/** Shared open-in targets + invoke action for every row in one file tree. */
export interface FileTreeMenuValue {
	invokeTarget: OpenTargetsState['invokeTarget'];
	openTargets: OpenTargetsState['openTargets'];
}

const FileTreeMenuContext = createContext<FileTreeMenuValue | null>(null);

/** Provides the open-in targets to every {@link FileTreeContextMenu} below it. */
export function FileTreeMenuProvider({
	children,
	value,
}: {
	children: ReactNode;
	value: FileTreeMenuValue;
}) {
	return (
		<FileTreeMenuContext.Provider value={value}>
			{children}
		</FileTreeMenuContext.Provider>
	);
}

/**
 * Wraps a file/folder row with a right-click menu offering "Open in <app>" for
 * every installed target plus "Copy path". Reuses the workspace header's
 * open-target logic, scoped to the row's path. Renders the row unchanged when
 * no targets are available (e.g. missing Electron bridge), so the menu degrades
 * gracefully.
 * @param children - The single row element to use as the right-click trigger.
 * @param relativePath - Workspace-relative path of this file or folder.
 * @param relativePathKind - Whether the row is a file or directory.
 */
export function FileTreeContextMenu({
	children,
	relativePath,
	relativePathKind,
}: {
	children: ReactNode;
	relativePath: string;
	relativePathKind: 'directory' | 'file';
}) {
	const menu = useContext(FileTreeMenuContext);
	const targets = menu?.openTargets ?? [];
	const openInTargets = targets.filter(
		(target) => target.behavior !== 'copy-path',
	);
	const copyTarget = targets.find((target) => target.behavior === 'copy-path');

	if (!menu || (openInTargets.length === 0 && !copyTarget)) {
		return children;
	}

	const invoke = (target: (typeof targets)[number]) =>
		void menu.invokeTarget(target, { relativePath, relativePathKind });

	return (
		<ContextMenu>
			<ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
			<ContextMenuContent
				aria-label={`${relativePath} actions`}
				className='w-44 bg-muted p-1'
			>
				{openInTargets.length ? (
					<ContextMenuSub>
						<ContextMenuSubTrigger className='h-8 gap-2 px-2 text-[0.8125rem]'>
							<ArrowUpRightIcon
								aria-hidden='true'
								className='text-muted-foreground'
							/>
							<span className='min-w-0 flex-1'>Open in</span>
						</ContextMenuSubTrigger>
						<ContextMenuSubContent className='w-60 bg-muted p-1'>
							{openInTargets.map((target) => (
								<ContextMenuItem
									className='h-8 gap-2.5 px-2 text-[0.8125rem]'
									key={target.id}
									onSelect={() => invoke(target)}
								>
									<OpenTargetIcon className='size-4' target={target} />
									<span className='min-w-0 flex-1 truncate'>
										{target.label}
									</span>
									<span className='w-3.5 shrink-0 text-right text-muted-foreground text-xs tabular-nums'>
										{target.numberShortcutLabel}
									</span>
								</ContextMenuItem>
							))}
						</ContextMenuSubContent>
					</ContextMenuSub>
				) : null}
				{copyTarget ? (
					<ContextMenuItem
						className='h-8 gap-2 px-2 text-[0.8125rem]'
						onSelect={() => invoke(copyTarget)}
					>
						<CopyIcon aria-hidden='true' className='text-muted-foreground' />
						<span className='min-w-0 flex-1'>Copy path</span>
					</ContextMenuItem>
				) : null}
			</ContextMenuContent>
		</ContextMenu>
	);
}
