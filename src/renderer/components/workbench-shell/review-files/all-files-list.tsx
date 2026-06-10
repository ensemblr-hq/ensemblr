import { Button } from '@/renderer/components/ui/button';
import { ScrollArea } from '@/renderer/components/ui/scroll-area';
import type { WorkspaceFileSummary } from '@/renderer/types/workbench';

import { WorkspaceFileIcon } from './workspace-file-icon';

/** Flat scrollable list of every workspace file (files tab). */
export function AllFilesList({ files }: { files: WorkspaceFileSummary[] }) {
	return (
		<ScrollArea className='h-full'>
			<ul className='flex flex-col gap-0.5 p-2.5'>
				{files.length ? (
					files.map((file) => (
						<li key={file.id}>
							<Button
								aria-label={getWorkspaceFileActionLabel(file)}
								className='h-auto min-h-7 w-full justify-start gap-2.5 rounded-md px-2 py-0.5 text-left font-normal'
								size='sm'
								variant='ghost'
							>
								<WorkspaceFileIcon file={file} />
								<span className='min-w-0 truncate font-mono text-xs leading-none'>
									{file.name}
								</span>
							</Button>
						</li>
					))
				) : (
					<li className='rounded-md border border-border bg-pane px-3 py-4 text-muted-foreground text-xs leading-5'>
						Repository files will appear here when the workspace file service is
						wired.
					</li>
				)}
			</ul>
		</ScrollArea>
	);
}

/** Computes the aria-label for an All-files row, branching on file vs. folder. */
function getWorkspaceFileActionLabel(file: WorkspaceFileSummary) {
	return file.kind === 'directory'
		? `Open ${file.name} directory`
		: `Open ${file.name} preview`;
}
