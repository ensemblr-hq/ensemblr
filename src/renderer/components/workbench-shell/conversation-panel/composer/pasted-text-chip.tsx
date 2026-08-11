import { XIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

/**
 * Chip for a long paste the composer turned into a stored attachment. Wider
 * than a file chip and showing the opening of the text, because a paste has no
 * filename the user would recognise — the preview is the only thing that says
 * which paste this is. Given `onActivate` the preview opens the stored file.
 */
export function PastedTextChip({
	lineCount,
	onActivate,
	onRemove,
	preview,
}: {
	lineCount: number;
	onActivate?: () => void;
	onRemove: () => void;
	preview: string;
}) {
	const { t } = useTranslation();
	const summary = t('workbench:composer.pasted-text.summary', {
		count: lineCount,
		defaultValue_one: 'Pasted text · {{count}} line',
		defaultValue_other: 'Pasted text · {{count}} lines',
	});
	const previewClassName =
		'line-clamp-2 w-full whitespace-pre-wrap break-all px-1.5 pt-1 text-left font-mono text-muted-foreground text-xs leading-snug';

	return (
		<span className='group/chip inline-flex max-w-xs flex-col overflow-hidden rounded-md border border-border bg-background align-bottom'>
			{onActivate ? (
				<button
					aria-label={t('common:actions.open-named', 'Open {{label}}', {
						label: summary,
					})}
					className={`${previewClassName} cursor-pointer`}
					onClick={onActivate}
					title={preview}
					type='button'
				>
					{preview}
				</button>
			) : (
				<span className={previewClassName} title={preview}>
					{preview}
				</span>
			)}
			<span className='flex items-center gap-1.5 px-1.5 pb-1 text-muted-foreground text-xxs'>
				<span className='truncate font-medium'>{summary}</span>
				<button
					aria-label={t('common:actions.remove-named', 'Remove {{label}}', {
						label: summary,
					})}
					className='ml-auto inline-flex size-3.5 shrink-0 items-center justify-center rounded-sm transition-colors hover:bg-accent hover:text-foreground'
					onClick={onRemove}
					type='button'
				>
					<XIcon className='size-3' />
				</button>
			</span>
		</span>
	);
}
