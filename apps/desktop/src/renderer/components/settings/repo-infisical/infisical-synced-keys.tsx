import { useTranslation } from 'react-i18next';

/**
 * The variable names the last sync resolved, as one scannable block of chips.
 * Only names are ever shown — values stay in the main process and never cross
 * the bridge.
 */
export function InfisicalSyncedKeys({ keys }: { keys: string[] }) {
	const { t } = useTranslation();

	return (
		<div className='space-y-2 rounded-xl border border-border bg-card/40 px-3 py-2.5'>
			<p className='font-medium text-foreground text-xs'>
				{t(
					'settings:repo.infisical.resolved-keys',
					'{{count}} variable resolved',
					{
						count: keys.length,
						defaultValue_other: '{{count}} variables resolved',
					},
				)}
			</p>
			<ul className='flex max-h-40 flex-wrap gap-1 overflow-y-auto'>
				{keys.map((key) => (
					<li
						className='rounded-md bg-muted px-1.5 py-0.5 font-mono text-muted-foreground text-xxs'
						key={key}
					>
						{key}
					</li>
				))}
			</ul>
		</div>
	);
}
