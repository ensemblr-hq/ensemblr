import { atom, useSetAtom, useStore } from 'jotai';
import { useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

/** Spawns a dock terminal on a command and focuses its tab. */
type DockTerminalOpener = (request: { command: string; title: string }) => void;

/**
 * Each mounted workspace's dock, keyed by workspace id. Surfaces that need a
 * real TTY — an MCP server that has to be authorised through the runtime's own
 * prompt — look their workspace up here and call it. Registering the opener
 * rather than queueing a request means the ask either reaches a live dock now or
 * fails now; it cannot sit pending and surprise the user by spawning a terminal
 * when that workspace is next opened.
 */
const dockTerminalOpenersAtom = atom<
	Readonly<Record<string, DockTerminalOpener>>
>({});

/**
 * Returns a stable callback that opens a dock terminal in one workspace,
 * reporting a workspace with no mounted dock rather than dropping the ask.
 */
export function useRequestDockTerminal(): (request: {
	command: string;
	title: string;
	workspaceId: string;
}) => void {
	const store = useStore();
	const { t } = useTranslation();

	return useCallback(
		(request: { command: string; title: string; workspaceId: string }) => {
			const open = store.get(dockTerminalOpenersAtom)[request.workspaceId];
			if (!open) {
				toast.error(
					t(
						'errors:terminal.start-failed.title',
						'The terminal could not start.',
					),
				);
				return;
			}
			open({ command: request.command, title: request.title });
		},
		[store, t],
	);
}

/**
 * Registers this workspace's dock as the target for terminal requests aimed at
 * it, for as long as the dock is mounted.
 * @param workspaceId - Workspace whose dock is being offered.
 * @param open - Spawns the terminal and focuses its tab.
 */
export function useProvideDockTerminal(
	workspaceId: string,
	open: DockTerminalOpener,
): void {
	const setOpeners = useSetAtom(dockTerminalOpenersAtom);

	useEffect(() => {
		setOpeners((current) => ({ ...current, [workspaceId]: open }));

		return () => {
			setOpeners((current) => {
				const { [workspaceId]: removed, ...rest } = current;
				return rest;
			});
		};
	}, [open, setOpeners, workspaceId]);
}
