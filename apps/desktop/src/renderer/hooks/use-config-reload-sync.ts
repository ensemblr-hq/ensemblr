import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import {
	ensemblrQueryKeys,
	subscribeConfigChanged,
} from '@/renderer/api/ensemblr';

/**
 * Invalidates settings-resolution queries whenever `config.json` is reloaded
 * after an external edit, so repository defaults/rules and other non-App config
 * sections take effect live. Mount once at the app root.
 */
export function useConfigReloadSync(): void {
	const queryClient = useQueryClient();

	useEffect(
		() =>
			subscribeConfigChanged(() => {
				void queryClient.invalidateQueries({
					queryKey: [...ensemblrQueryKeys.all, 'settings-resolution'],
				});
			}),
		[queryClient],
	);
}
