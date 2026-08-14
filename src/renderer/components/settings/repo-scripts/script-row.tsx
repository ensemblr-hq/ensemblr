import { SettingRow } from '@/renderer/components/settings/setting-row';
import { Textarea } from '@/renderer/components/ui/textarea';

/** One script command editor, cleared by the row's revert control. */
export function ScriptRow({
	description,
	label,
	onChange,
	onReset,
	placeholder,
	value,
}: {
	description: string;
	label: string;
	onChange: (next: string) => void;
	onReset: () => void;
	placeholder: string;
	value: string;
}) {
	return (
		<SettingRow
			description={description}
			label={label}
			modified={value.trim().length > 0}
			onReset={onReset}
			stack
		>
			<Textarea
				aria-label={label}
				className='min-h-18 font-mono text-xs'
				onChange={(event) => onChange(event.target.value)}
				placeholder={placeholder}
				value={value}
			/>
		</SettingRow>
	);
}
