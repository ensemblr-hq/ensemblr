import { useAtom } from 'jotai';
import { useTranslation } from 'react-i18next';

import { SettingRow } from '@/renderer/components/settings/setting-row';
import { Input } from '@/renderer/components/ui/input';
import { terminalScrollbackMbAtom } from '@/renderer/state/preferences';
import { DEFAULT_APP_SETTINGS } from '@/shared/config';

/** Factory default for the terminal scrollback limit; drives the row's "modified" accent. */
const DEFAULT_SCROLLBACK_MB =
	DEFAULT_APP_SETTINGS.appearance.terminalScrollbackMb;

/**
 * Settings row for the per-pane terminal scrollback limit, in megabytes, with a
 * reset back to the factory default.
 */
export function TerminalScrollbackRow() {
	const { t } = useTranslation();
	const [scrollbackMb, setScrollbackMb] = useAtom(terminalScrollbackMbAtom);

	return (
		<SettingRow
			control={
				<div className='flex items-center gap-2 text-xs'>
					<Input
						aria-label={t(
							'settings:advanced.scrollback.aria-label',
							'Terminal scrollback limit in megabytes',
						)}
						className='h-8 w-20 text-right font-mono'
						max={200}
						min={1}
						onChange={(e) =>
							setScrollbackMb(Math.max(1, Number(e.target.value) || 1))
						}
						type='number'
						value={scrollbackMb}
					/>
					<span className='text-muted-foreground'>
						{t('common:units.mb', 'MB')}
					</span>
				</div>
			}
			description={t(
				'settings:advanced.scrollback.description',
				'Maximum size of each terminal pane scrollback buffer. Larger values keep more history at the cost of memory.',
			)}
			label={t(
				'settings:advanced.scrollback.label',
				'Terminal scrollback limit',
			)}
			modified={scrollbackMb !== DEFAULT_SCROLLBACK_MB}
			onReset={() => setScrollbackMb(DEFAULT_SCROLLBACK_MB)}
		/>
	);
}
