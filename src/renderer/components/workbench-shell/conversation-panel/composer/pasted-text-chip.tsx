import type { TFunction } from 'i18next';
import { XIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { ComposerTextSource } from '@/renderer/types/workbench';

/**
 * What the chip's meta row reads, which is the only thing naming where a stored
 * block of text came from — its filename is a store detail the user never chose.
 * A terminal selection names its pane, so two chips off two panes are told apart
 * at a glance; a pane with no name yet falls back to naming the surface.
 * @param t - The caller's translation function, so the copy follows the UI language
 * @param lineCount - How many lines the stored block ran to
 * @param source - Which surface the block was taken off; unset for a clipboard paste
 * @returns The summary line in the active language
 */
function chipSummary(
	t: TFunction,
	lineCount: number,
	source?: ComposerTextSource,
): string {
	if (source?.label) {
		return t('workbench:composer.terminal-output.summary-named', {
			count: lineCount,
			defaultValue_one: '{{label}} · {{count}} line',
			defaultValue_other: '{{label}} · {{count}} lines',
			label: source.label,
		});
	}
	if (source) {
		return t('workbench:composer.terminal-output.summary', {
			count: lineCount,
			defaultValue_one: 'Terminal output · {{count}} line',
			defaultValue_other: 'Terminal output · {{count}} lines',
		});
	}
	return t('workbench:composer.pasted-text.summary', {
		count: lineCount,
		defaultValue_one: 'Pasted text · {{count}} line',
		defaultValue_other: 'Pasted text · {{count}} lines',
	});
}

/** Everything {@link PastedTextChip} renders one stored block of text from. */
interface PastedTextChipProps {
	lineCount: number;
	/** Opens the stored file in the preview; omitted where there is no opener. */
	onActivate?: () => void;
	onRemove: () => void;
	preview: string;
	/** Which surface the block was taken off; unset for a clipboard paste. */
	source?: ComposerTextSource;
}

/**
 * Chip for a stored block of text the composer holds — a long paste, or a
 * selection taken from a terminal. Wider than a file chip and showing the
 * opening of the text, because neither has a filename the user would recognise;
 * the preview is the only thing that says which block this is. Given
 * `onActivate` the preview opens the stored file.
 */
export function PastedTextChip({
	lineCount,
	onActivate,
	onRemove,
	preview,
	source,
}: PastedTextChipProps) {
	const { t } = useTranslation();
	const summary = chipSummary(t, lineCount, source);
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
