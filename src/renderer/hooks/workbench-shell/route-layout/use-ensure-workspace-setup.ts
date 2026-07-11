import { useEffect, useRef } from 'react';

import { ensureWorkspaceSetup } from '@/renderer/api/ensemblr/workspace-scripts';

/**
 * Asks the main process, once per workspace open, to run the setup script only
 * when the workspace's dependency fingerprint is missing or stale. Keeps
 * reopening a workspace frictionless: unchanged dependencies skip setup while a
 * changed lockfile re-runs it automatically. The main process owns the
 * run/skip decision; this hook only signals the open. Fires at most once per
 * workspace id for the lifetime of the mounted route.
 * @param workspaceId - The id of the opened workspace.
 */
export function useEnsureWorkspaceSetup(workspaceId: string): void {
	const requestedIdRef = useRef<string | null>(null);

	useEffect(() => {
		if (requestedIdRef.current === workspaceId) {
			return;
		}

		requestedIdRef.current = workspaceId;
		void ensureWorkspaceSetup({ workspaceId }).catch(() => {});
	}, [workspaceId]);
}
