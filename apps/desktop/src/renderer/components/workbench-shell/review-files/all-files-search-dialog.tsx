import { useEffect, useRef, useState } from 'react';
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
import { useDebouncedValue } from '@/renderer/hooks/use-debounced-value';
import { useFileSearchMatches } from '@/renderer/hooks/workbench-shell/review-files/use-file-search-matches';
import type { WorkspaceFileSummary } from '@/renderer/types/workbench';

import { WorkspaceFileIcon } from './workspace-file-icon';

/**
 * How long the search box must hold still before the list is re-ranked. Short
 * enough to read as instant, long enough that a fast typist re-renders the rows
 * once per burst rather than once per character.
 */
const SEARCH_DEBOUNCE_MS = 80;

/**
 * The identity cmdk tracks a row by. cmdk trims whatever value it is handed, so
 * the selection is compared in trimmed form or a path carrying trailing
 * whitespace could never be selected.
 * @param file - Workspace file the row renders.
 * @returns The row's cmdk value.
 */
function rowValue(file: WorkspaceFileSummary): string {
	return file.path.trim();
}

/**
 * The row cmdk should hold selected. cmdk drops its own selection when the row
 * carrying it unmounts — which a new query does on every keystroke, leaving
 * Enter inert — so a selection the user moved to is kept while it still exists,
 * and the best match stands in whenever it does not.
 * @param matches - The ranked rows currently rendered.
 * @param selectedValue - The row value the user last moved to.
 * @returns The value to hand cmdk.
 */
function activeRowValue(
	matches: readonly WorkspaceFileSummary[],
	selectedValue: string,
): string {
	if (matches.some((file) => rowValue(file) === selectedValue)) {
		return selectedValue;
	}
	const topMatch = matches.at(0);
	return topMatch ? rowValue(topMatch) : '';
}

/**
 * ⌘P-style file search dialog that opens a preview when a file is selected.
 *
 * The search itself lives in a child the dialog mounts, so a closed dialog ranks
 * nothing and the next ⌘P opens on an empty box rather than the last search.
 */
export function AllFilesSearchDialog({
	files,
	onOpenChange,
	open,
}: {
	files: readonly WorkspaceFileSummary[];
	onOpenChange: (open: boolean) => void;
	open: boolean;
}) {
	const { t } = useTranslation();

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
			<FileSearchCommand files={files} onOpenChange={onOpenChange} />
		</CommandDialog>
	);
}

/**
 * The search box and its ranked result list.
 *
 * Ranking is ours rather than cmdk's (`shouldFilter={false}`). Letting cmdk
 * filter means handing it every file so it can score them, and it reorders the
 * items it holds by walking them through the DOM on each keystroke — which a
 * workspace-sized listing cannot absorb. Ranking here hands it a capped list
 * already in order, short enough to anchor and scroll predictably.
 */
function FileSearchCommand({
	files,
	onOpenChange,
}: {
	files: readonly WorkspaceFileSummary[];
	onOpenChange: (open: boolean) => void;
}) {
	const { t } = useTranslation();
	const openFilePreview = useReviewFilePreviewOpener();
	const [query, setQuery] = useState('');
	const [selectedValue, setSelectedValue] = useState('');
	const settledQuery = useDebouncedValue(query, SEARCH_DEBOUNCE_MS);
	const listRef = useRef<HTMLDivElement>(null);
	const rankedQueryRef = useRef(settledQuery);
	const matches = useFileSearchMatches(files, settledQuery);
	const activeValue = activeRowValue(matches, selectedValue);

	// cmdk rewinds the list only when the selected value changes, so a query
	// narrowing onto the same top match would keep the previous scroll offset.
	useEffect(() => {
		if (rankedQueryRef.current === settledQuery) {
			return;
		}
		rankedQueryRef.current = settledQuery;
		if (listRef.current) {
			listRef.current.scrollTop = 0;
		}
	}, [settledQuery]);

	const selectFile = (filePath: string) => {
		openFilePreview?.(filePath);
		onOpenChange(false);
	};

	return (
		<Command
			className='rounded-xl border-0'
			onValueChange={setSelectedValue}
			shouldFilter={false}
			value={activeValue}
		>
			<CommandInput
				onValueChange={setQuery}
				placeholder={t(
					'workbench:all-files-search.placeholder',
					'Search files',
				)}
				value={query}
			/>
			<CommandList className='max-h-80' ref={listRef}>
				<CommandEmpty>
					{t('workbench:all-files-search.empty', 'No files match your search.')}
				</CommandEmpty>
				{matches.length > 0 ? (
					<CommandGroup
						heading={t('workbench:all-files-search.group-files', 'Files')}
					>
						{matches.map((file) => (
							<CommandItem
								aria-label={t(
									'workbench:all-files.open-preview',
									'Open {{path}} preview',
									{ path: file.path },
								)}
								className='min-h-10'
								key={file.id}
								onSelect={() => selectFile(file.path)}
								value={rowValue(file)}
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
				) : null}
			</CommandList>
		</Command>
	);
}
