import { queryOptions } from '@tanstack/react-query';

import { profileElectronIpcCall } from '@/renderer/lib/instrumentation';
import type { ListPiSlashCommandsRequest } from '@/shared/ipc/contracts/pi-session';

import { ensemblrQueryKeys, getEnsemblrApi } from './query-keys';

/**
 * Builds query options for the workspace-scoped Pi slash command catalog.
 * @param request - Optional workspace cwd for project-local Pi resources.
 * @returns TanStack Query options for slash command discovery.
 */
export function piSlashCommandsQuery(request?: ListPiSlashCommandsRequest) {
	return queryOptions({
		queryFn: () =>
			profileElectronIpcCall(
				{ channel: 'ensemblr:list-pi-slash-commands', usesDatabase: false },
				() => getEnsemblrApi().listPiSlashCommands(request),
			),
		queryKey: ensemblrQueryKeys.piSlashCommands(request?.cwd ?? ''),
		staleTime: 5 * 60_000,
	});
}
