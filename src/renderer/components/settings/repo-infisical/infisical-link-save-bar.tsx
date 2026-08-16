import { useTranslation } from 'react-i18next';

import { Button } from '@/renderer/components/ui/button';

/** Props for the bar that commits or abandons unsaved link edits. */
interface InfisicalLinkSaveBarProps {
	canSave: boolean;
	onDiscard: () => void;
	onSave: () => void;
	saving: boolean;
	/** Whether the form differs from the saved link at all. */
	visible: boolean;
}

/**
 * Appears only once the form differs from the saved link, so a settled panel
 * carries no permanently disabled Save button and an edited one cannot be
 * mistaken for a saved one.
 */
export function InfisicalLinkSaveBar({
	canSave,
	onDiscard,
	onSave,
	saving,
	visible,
}: InfisicalLinkSaveBarProps) {
	const { t } = useTranslation();

	if (!visible) {
		return null;
	}

	return (
		<div className='flex flex-wrap items-center justify-between gap-3 rounded-xl border border-accent-strong/30 bg-accent-strong/5 px-3 py-2.5'>
			<p className='text-muted-foreground text-xs'>
				{canSave
					? t(
							'settings:repo.infisical.unsaved',
							'Unsaved changes to this link.',
						)
					: t(
							'settings:repo.infisical.unsaved-incomplete',
							'Pick a project and an environment to save this link.',
						)}
			</p>
			<div className='flex shrink-0 items-center gap-1.5'>
				<Button
					disabled={saving}
					onClick={onDiscard}
					size='sm'
					type='button'
					variant='ghost'
				>
					{t('common:actions.discard', 'Discard')}
				</Button>
				<Button
					disabled={!canSave || saving}
					onClick={onSave}
					size='sm'
					type='button'
				>
					{saving
						? t('settings:repo.infisical.saving', 'Saving…')
						: t('settings:repo.infisical.save', 'Save link')}
				</Button>
			</div>
		</div>
	);
}
