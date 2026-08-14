import { useTranslation } from 'react-i18next';

import { SettingRow } from '@/renderer/components/settings/setting-row';
import { Textarea } from '@/renderer/components/ui/textarea';
import {
	SETTING_SAVE_DEBOUNCE_MS,
	useDebouncedSettingField,
} from '@/renderer/hooks/use-debounced-setting-field';

/**
 * Files-to-copy globs persisted to SQLite. Debounced; an empty value clears the
 * personal override so the built-in `.env*` default applies.
 */
export function FilesToCopySetting({
	modified,
	onSave,
	seed,
}: {
	modified: boolean;
	onSave: (patterns: string[] | null) => void;
	seed: string;
}) {
	const { t } = useTranslation();
	const { onChange, value } = useDebouncedSettingField(
		seed,
		(next) => {
			const patterns = next
				.split('\n')
				.map((line) => line.trim())
				.filter((line) => line.length > 0);
			onSave(patterns.length === 0 ? null : patterns);
			return patterns.join('\n');
		},
		SETTING_SAVE_DEBOUNCE_MS,
	);

	return (
		<SettingRow
			description={t(
				'settings:repo.files-to-copy.description',
				'Ensemblr will automatically copy these file paths into each new workspace. Supports gitignore-style globs.',
			)}
			label={t('settings:repo.files-to-copy.label', 'Files to copy')}
			modified={modified}
			onReset={() => onSave(null)}
			stack
		>
			{/* i18next-instrument-ignore */}
			<Textarea
				aria-label={t('settings:repo.files-to-copy.label', 'Files to copy')}
				className='min-h-18 font-mono text-xs'
				onChange={(e) => onChange(e.target.value)}
				placeholder='.env*'
				value={value}
			/>
		</SettingRow>
	);
}
