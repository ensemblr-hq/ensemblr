import { useTranslation } from 'react-i18next';

import { SettingRow } from '@/renderer/components/settings/setting-row';
import { Button } from '@/renderer/components/ui/button';
import { Input } from '@/renderer/components/ui/input';
import { usePiExecutableOverride } from '@/renderer/hooks/settings/use-pi-executable-override';

/**
 * Settings row for the custom Pi executable override: a debounced path field, a
 * native picker, and a reset back to the discovered system Pi.
 */
export function PiExecutableRow() {
	const { t } = useTranslation();
	const { clearPiPath, isPicking, onPiPathChange, piPath, pickPi } =
		usePiExecutableOverride();

	return (
		<SettingRow
			control={
				<div className='flex items-center gap-2'>
					<Button
						disabled={isPicking}
						onClick={pickPi}
						size='sm'
						variant='outline'
					>
						{isPicking
							? t('common:actions.picking', 'Picking…')
							: t('common:actions.browse', 'Browse')}
					</Button>
					<Button
						disabled={!piPath}
						onClick={clearPiPath}
						size='sm'
						variant='ghost'
					>
						{t('settings:advanced.pi-executable.use-bundled', 'Use bundled Pi')}
					</Button>
				</div>
			}
			description={t(
				'settings:advanced.pi-executable.description',
				'Override the bundled Pi executable with a custom one. Leave empty to use the discovered system Pi (recommended).',
			)}
			label={t('settings:advanced.pi-executable.label', 'Pi executable path')}
			stack
		>
			<Input
				aria-label={t(
					'settings:advanced.pi-executable.label',
					'Pi executable path',
				)}
				className='mt-2 h-8 font-mono text-xs'
				onChange={(e) => onPiPathChange(e.target.value)}
				placeholder='/opt/homebrew/bin/pi'
				value={piPath}
			/>
		</SettingRow>
	);
}
