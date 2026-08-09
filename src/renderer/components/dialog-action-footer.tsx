import { useTranslation } from 'react-i18next';
import { Button } from '@/renderer/components/ui/button';

/**
 * Renders the sticky footer shared by the create/rename dialogs: an optional
 * retry button while the last attempt is failing, plus the primary submit
 * button and its ⌘↵ hint.
 */
export function DialogActionFooter({
	onRetry,
	onSubmit,
	submitDisabled,
	submitLabel,
}: {
	/** Retry handler shown only while the dialog is in its failure stage. */
	onRetry: (() => void) | null;
	onSubmit: () => void;
	submitDisabled: boolean;
	submitLabel: string;
}) {
	const { t } = useTranslation();
	return (
		<div className='-mx-4 -mb-4 flex justify-end gap-2 rounded-b-xl border-border border-t bg-muted/40 px-4 py-3'>
			{onRetry ? (
				<Button
					className='h-8'
					onClick={onRetry}
					type='button'
					variant='outline'
				>
					{t('common:actions.try-again', 'Try again')}
				</Button>
			) : null}
			<Button
				className='h-8 gap-2'
				disabled={submitDisabled}
				onClick={onSubmit}
				type='button'
			>
				{submitLabel}
				{/* i18next-instrument-ignore */}
				<span
					aria-hidden='true'
					className='ml-1 inline-flex items-center gap-0.5 text-[0.6875rem] opacity-70'
				>
					⌘↵
				</span>
			</Button>
		</div>
	);
}
