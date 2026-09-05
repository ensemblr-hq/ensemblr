import { queryOptions } from '@tanstack/react-query';

import { profileElectronIpcCall } from '@/renderer/lib/instrumentation';
import type { GetArchitectureSnapshotResult } from '@/shared/ipc/contracts/architecture';

import { ensemblrQueryKeys, getEnsemblrApi } from './query-keys';

/**
 * Query options for a workspace's stored architecture snapshot and the one
 * before it. It returns whatever an agent last stored and derives nothing, so
 * opening the panel is cheap.
 */
export function architectureSnapshotQuery(workspaceId: string | null) {
	return queryOptions({
		enabled: Boolean(workspaceId),
		queryFn: (): Promise<GetArchitectureSnapshotResult> =>
			profileElectronIpcCall(
				{ channel: 'ensemblr:get-architecture-snapshot', usesDatabase: true },
				() =>
					getEnsemblrApi().getArchitectureSnapshot({
						workspaceId: workspaceId ?? '',
					}),
			),
		queryKey: ensemblrQueryKeys.architectureSnapshot(workspaceId ?? ''),
		staleTime: 5000,
	});
}
