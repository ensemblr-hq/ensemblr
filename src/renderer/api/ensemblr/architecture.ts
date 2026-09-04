import { queryOptions } from '@tanstack/react-query';

import { profileElectronIpcCall } from '@/renderer/lib/instrumentation';
import type {
	GetArchitectureSnapshotResult,
	ScanArchitectureSnapshotRequest,
	ScanArchitectureSnapshotResult,
} from '@/shared/ipc/contracts/architecture';

import { ensemblrQueryKeys, getEnsemblrApi } from './query-keys';

/**
 * Query options for a workspace's stored architecture snapshot and the one
 * before it. The read never scans — it returns whatever main last stored — so
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

/**
 * Seeds a workspace that has no diagram. A workspace that already has one is
 * left alone — the seed scan runs once, at creation, and everything after that
 * is an agent's refinement.
 */
export function scanArchitectureSnapshot(
	request: ScanArchitectureSnapshotRequest,
): Promise<ScanArchitectureSnapshotResult> {
	return profileElectronIpcCall(
		{ channel: 'ensemblr:scan-architecture-snapshot', usesDatabase: true },
		() => getEnsemblrApi().scanArchitectureSnapshot(request),
	);
}
