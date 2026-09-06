import { atom, useSetAtom, useStore } from 'jotai';
import { useCallback, useEffect, useRef } from 'react';
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

/**
 * Each mounted workspace's dock expander, keyed by workspace id. Selecting a
 * dock tab is not the same as showing one: a user who collapsed the terminal
 * area sees nothing at all when something focuses a tab behind it. The collapse
 * state lives inside the workbench layout provider, while the surfaces that
 * focus a terminal — the agent-control focus bridge among them — sit above it,
 * so they reach it the same way {@link dockTerminalOpenersAtom} is reached.
 */
const dockExpandersAtom = atom<Readonly<Record<string, () => void>>>({});

/**
 * Returns a stable callback that reveals one workspace's terminal area, opening
 * whichever of the enclosing panels the user has collapsed. A workspace with no
 * mounted dock is a no-op: there is nothing on screen to reveal, and the caller
 * has already done the part that matters by selecting the tab.
 */
export function useExpandDockPanel(): (workspaceId: string) => void {
	const store = useStore();

	return useCallback(
		(workspaceId: string) => {
			store.get(dockExpandersAtom)[workspaceId]?.();
		},
		[store],
	);
}

/**
 * Registers this workspace's dock as the target for expand requests aimed at it,
 * for as long as the dock is mounted. The registration is held through a ref, so
 * a caller composing layout actions that are rebuilt each render still registers
 * once per workspace rather than rewriting the atom on every dock re-render.
 * @param workspaceId - Workspace whose dock is being offered.
 * @param expand - Reveals the terminal area, opening every panel enclosing it that the user has collapsed.
 */
export function useProvideDockExpander(
	workspaceId: string,
	expand: () => void,
): void {
	const setExpanders = useSetAtom(dockExpandersAtom);
	const expandRef = useRef(expand);
	useEffect(() => {
		expandRef.current = expand;
	});

	useEffect(() => {
		const reveal = () => expandRef.current();
		setExpanders((current) => ({ ...current, [workspaceId]: reveal }));

		return () => {
			setExpanders((current) => {
				const { [workspaceId]: removed, ...rest } = current;
				return rest;
			});
		};
	}, [setExpanders, workspaceId]);
}
