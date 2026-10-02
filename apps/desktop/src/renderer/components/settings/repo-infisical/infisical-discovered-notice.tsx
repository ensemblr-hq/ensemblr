import { useTranslation } from 'react-i18next';

import type { InfisicalLinkSnapshot } from '@/shared/ipc/contracts/infisical';

/**
 * Explains a link Ensemblr read out of the repository's `.infisical.json`
 * rather than out of its own settings. That file belongs to the Infisical CLI
 * and is never written back, so the notice says what is already resolving, what
 * is still missing, and what saving would add.
 */
export function InfisicalDiscoveredNotice({
	link,
}: {
	link: InfisicalLinkSnapshot | null;
}) {
	const { t } = useTranslation();

	if (link?.origin !== 'infisical-cli') {
		return null;
	}

	return (
		<div className='space-y-1.5 rounded-xl border border-accent-strong/30 bg-accent-strong/5 px-4 py-3'>
			<p className='font-medium text-foreground text-xs'>
				{t(
					'settings:repo.infisical.discovered.title',
					'Found in this repository’s .infisical.json',
				)}
			</p>
			<p className='text-muted-foreground text-xs leading-relaxed'>
				{link.environmentSlug
					? t(
							'settings:repo.infisical.discovered.resolving',
							'Ensemblr reads this project through whichever of your accounts can reach it. Nothing has been written to .ensemblr/settings.toml — save below to commit the link so everyone who clones this repository inherits it.',
						)
					: t(
							'settings:repo.infisical.discovered.needs-environment',
							'That file names a project but no environment, so nothing resolves yet. Pick one below, then save to commit the link to .ensemblr/settings.toml.',
						)}
			</p>
		</div>
	);
}
