import { Maximize2Icon, Minimize2Icon } from 'lucide-react';
import type { ComponentProps, ReactNode } from 'react';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { extractTableDataFromElement, tableDataToMarkdown } from 'streamdown';
import { cn } from '@/renderer/lib/utils';
import { BlockControlButton, BlockControls } from './block-controls';
import { CopyResponseButton } from './copy-response-button';
import { Dialog, DialogContent, DialogTitle } from './ui/dialog';

/**
 * Reads a rendered table back as Markdown, standing a blank header row back up
 * for a table that has none.
 *
 * A GFM pipe table cannot be written without a header — `tableDataToMarkdown`
 * returns the empty string rather than a headerless one — but the renderer drops
 * a header whose cells are all empty. Restoring it at copy time reproduces what
 * the agent wrote instead of copying nothing at all.
 * @param table - The rendered table
 * @returns The table as GFM Markdown
 */
function tableMarkdown(table: HTMLTableElement): string {
	const { headers, rows } = extractTableDataFromElement(table);
	if (headers.length > 0) {
		return tableDataToMarkdown({ headers, rows });
	}
	const widest = rows.reduce(
		(columns, row) => Math.max(columns, row.length),
		0,
	);
	return tableDataToMarkdown({ headers: new Array(widest).fill(''), rows });
}

/**
 * Reads a rendered table back as clipboard content: Markdown for a plain-text
 * paste, and the table's own HTML so a paste into a document or a spreadsheet
 * lands as rows and columns rather than a wall of pipes.
 * @param table - The rendered table, or null before it mounts
 * @returns The clipboard payload for the copy control
 */
function tableClipboardPayload(table: HTMLTableElement | null) {
	if (!table) {
		return { text: '' };
	}
	return {
		html: table.outerHTML,
		text: tableMarkdown(table),
	};
}

/**
 * A table on the answer's framed, scrollable surface, with the copy control the
 * code panel uses and one caller-supplied control beside it.
 */
function TableFrame({
	children,
	className,
	sizeControl,
	viewportClassName,
}: {
	children: ReactNode;
	className?: string;
	/** Expand or collapse, depending on which side of the dialog this frame is on. */
	sizeControl: ReactNode;
	viewportClassName?: string;
}) {
	const { t } = useTranslation();
	const tableRef = useRef<HTMLTableElement>(null);

	return (
		<div className='group/block relative'>
			<div
				className={cn(
					'sleek-scrollbar overflow-auto rounded-md border border-border',
					viewportClassName,
				)}
			>
				<table className={className} data-streamdown='table' ref={tableRef}>
					{children}
				</table>
			</div>
			<BlockControls>
				<CopyResponseButton
					label={t('common:answer-table.copy', 'Copy table')}
					text={() => tableClipboardPayload(tableRef.current)}
				/>
				{sizeControl}
			</BlockControls>
		</div>
	);
}

/**
 * A markdown table in an assistant answer, framed like the code panel and
 * carrying the same hover-revealed controls.
 *
 * Replaces Streamdown's own table shell, which stacks a control bar above a
 * filled card and reads as an embedded widget rather than part of the answer.
 * Copy is the code panel's control verbatim; expand is the table's alone, for
 * the wide ones the conversation column has to clip.
 */
export function AnswerTable({ children, className }: ComponentProps<'table'>) {
	const { t } = useTranslation();
	const [expanded, setExpanded] = useState(false);

	return (
		<>
			<TableFrame
				className={className}
				sizeControl={
					<BlockControlButton
						label={t('common:answer-table.expand', 'Expand table')}
						onClick={() => setExpanded(true)}
					>
						<Maximize2Icon aria-hidden='true' className='size-3.5' />
					</BlockControlButton>
				}
			>
				{children}
			</TableFrame>
			<Dialog onOpenChange={setExpanded} open={expanded}>
				<DialogContent
					aria-describedby={undefined}
					className='max-w-6xl sm:max-w-6xl'
					showCloseButton={false}
				>
					<DialogTitle className='sr-only'>
						{t('common:answer-table.dialog-title', 'Table')}
					</DialogTitle>
					<div className='ensemblr-answer text-sm'>
						<TableFrame
							className={className}
							sizeControl={
								<BlockControlButton
									label={t('common:answer-table.collapse', 'Collapse table')}
									onClick={() => setExpanded(false)}
								>
									<Minimize2Icon aria-hidden='true' className='size-3.5' />
								</BlockControlButton>
							}
							viewportClassName='max-h-[75vh]'
						>
							{children}
						</TableFrame>
					</div>
				</DialogContent>
			</Dialog>
		</>
	);
}
