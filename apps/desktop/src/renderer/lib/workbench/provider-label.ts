import { i18n } from '@/renderer/lib/i18n';
import type { ProviderMarkKind } from '@/renderer/types/components';

/** Maps a {@link ProviderMarkKind} to a short display label. */
export function getProviderLabel(provider: ProviderMarkKind) {
	if (provider === 'github') {
		return 'GitHub';
	}

	// i18next-instrument-ignore -- product name
	if (provider === 'github-actions') {
		return 'GitHub Actions';
	}

	if (provider === 'vercel') {
		return 'Vercel';
	}

	if (provider === 'netlify') {
		return 'Netlify';
	}

	if (provider === 'linear') {
		return 'Linear';
	}

	if (provider === 'local') {
		return i18n.t('workbench:provider.local', 'Local');
	}

	return i18n.t('workbench:provider.preview', 'Preview');
}
