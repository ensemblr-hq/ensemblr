import { SettingsSection } from '@/renderer/components/settings/settings-section';

interface SettingsPlaceholderProps {
	title: string;
	hint?: string;
}

/** Empty-state for settings sections not yet implemented. */
export function SettingsPlaceholder({ hint, title }: SettingsPlaceholderProps) {
	return (
		<SettingsSection
			description={hint ?? 'This section is not connected yet.'}
			title={title}
		>
			<div className='py-12 text-center text-muted-foreground text-sm'>
				Coming soon.
			</div>
		</SettingsSection>
	);
}
