import { useTranslation } from 'react-i18next';

import {
	Command,
	CommandDialog,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
} from '@/renderer/components/ui/command';
import { useReviewFilePreviewOpener } from '@/renderer/components/workbench-shell/conversation-panel/file-preview-context';
import type { WorkspaceFileSummary } from '@/renderer/types/workbench';

import { WorkspaceFileIcon } from './workspace-file-icon';

/** ⌘P-style file search dialog that opens a preview when a file is selected. */
export function AllFilesSearchDialog({
	files,
	onOpenChange,
	open,
}: {
	files: WorkspaceFileSummary[];
	onOpenChange: (open: boolean) => void;
	open: boolean;
}) {
	const { t } = useTranslation();
	const openFilePreview = useReviewFilePreviewOpener();
	const searchableFiles = files.filter((file) => file.kind === 'file');
	const closeSearch = () => {
		onOpenChange(false);
	};
	const selectFile = (filePath: string) => {
		openFilePreview?.(filePath);
		closeSearch();
	};

	return (
		<CommandDialog
			className='top-20 max-w-xl translate-y-0 shadow-2xl sm:max-w-xl'
			description={t(
				'workbench:all-files-search.description',
				'Open a repository file from the All files tab.',
			)}
			onOpenChange={onOpenChange}
			open={open}
			title={t('workbench:all-files-search.title', 'Search files')}
		>
			<Command className='rounded-xl border-0'>
				<CommandInput
					placeholder={t(
						'workbench:all-files-search.placeholder',
						'Search files',
					)}
				/>
				<CommandList className='max-h-80'>
					<CommandEmpty>
						{t(
							'workbench:all-files-search.empty',
							'No files match your search.',
						)}
					</CommandEmpty>
					<CommandGroup
						heading={t('workbench:all-files-search.group-files', 'Files')}
					>
						{searchableFiles.map((file) => (
							<CommandItem
								aria-label={t(
									'workbench:all-files.open-preview',
									'Open {{path}} preview',
									{ path: file.path },
								)}
								className='min-h-10'
								key={file.id}
								onSelect={() => selectFile(file.path)}
								value={`${file.name} ${file.path}`}
							>
								<WorkspaceFileIcon file={file} />
								<div className='min-w-0 flex-1'>
									<div className='truncate text-xs'>{file.name}</div>
									{file.path !== file.name ? (
										<div className='truncate text-muted-foreground text-xxs'>
											{file.path}
										</div>
									) : null}
								</div>
							</CommandItem>
						))}
					</CommandGroup>
				</CommandList>
			</Command>
		</CommandDialog>
	);
}
