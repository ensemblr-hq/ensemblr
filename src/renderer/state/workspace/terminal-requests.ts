import { atom, useAtom, useSetAtom } from 'jotai';
import { useCallback, useEffect } from 'react';

/** A pending ask to open a dock terminal on a command, tagged for de-dup. */
interface DockTerminalRequest {
	command: string;
	requestId: number;
	title: string;
	workspaceId: string;
}

/**
 * The dock terminal a surface elsewhere in the workspace wants opened, or null
 * when none is pending. Surfaces that need a real TTY — an MCP server that has
 * to be authorised through the runtime's own prompt — set it; the workspace's
 * dock actions consume it, spawn the terminal, and focus its tab. The
 * incrementing `requestId` makes back-to-back asks for the same command distinct
 * so the consuming effect re-fires.
 */
const dockTerminalRequestAtom = atom<DockTerminalRequest | null>(null);

/** Returns a stable callback that queues a dock terminal for a command. */
export function useRequestDockTerminal(): (request: {
	command: string;
	title: string;
	workspaceId: string;
}) => void {
	const setRequest = useSetAtom(dockTerminalRequestAtom);
	return useCallback(
		(request: { command: string; title: string; workspaceId: string }) => {
			setRequest((current) => ({
				...request,
				requestId: (current?.requestId ?? 0) + 1,
			}));
		},
		[setRequest],
	);
}

/**
 * Open the requested dock terminal when a pending request targets this
 * workspace, then clear it so it fires once.
 * @param workspaceId - Workspace whose dock is consuming requests.
 * @param open - Spawns the terminal and focuses its tab.
 */
export function useConsumeDockTerminalRequests(
	workspaceId: string,
	open: (request: { command: string; title: string }) => void,
): void {
	const [request, setRequest] = useAtom(dockTerminalRequestAtom);

	useEffect(() => {
		if (request?.workspaceId !== workspaceId) {
			return;
		}
		open({ command: request.command, title: request.title });
		setRequest(null);
	}, [open, request, setRequest, workspaceId]);
}
