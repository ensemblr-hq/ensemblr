import type { ReactNode } from 'react';
import {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useRef,
} from 'react';

type RegisterCloseAction = (handler: () => void) => () => void;

const CloseActionContext = createContext<RegisterCloseAction | null>(null);

/**
 * Single owner of the ⌘/Ctrl+W ("Close Tab") IPC broadcast. The application
 * menu owns the accelerator and broadcasts to the focused window; this provider
 * is the one renderer subscriber and dispatches to the close action registered
 * by the active view.
 *
 * Centralizing dispatch here (rather than letting each view subscribe and
 * self-guard) means correctness no longer depends on every handler's guard
 * being mutually exclusive — exactly one action runs, and views that register
 * nothing fall through to closing the window. That fallback preserves the
 * platform default on screens (loading, error, bare root) that mount no
 * specific handler, where the old per-view subscriptions left ⌘W dead.
 *
 * A stack (not a single slot) tolerates the brief overlap during route
 * transitions when an outgoing view has not yet unmounted as the incoming one
 * registers: the most recently registered action is always on top.
 */
export function CloseActionProvider({ children }: { children: ReactNode }) {
	const handlersRef = useRef<Array<() => void>>([]);

	const register = useCallback<RegisterCloseAction>((handler) => {
		handlersRef.current = [...handlersRef.current, handler];
		return () => {
			handlersRef.current = handlersRef.current.filter(
				(registered) => registered !== handler,
			);
		};
	}, []);

	useEffect(
		() =>
			window.ensemble?.onCloseActiveTabRequest(() => {
				const active = handlersRef.current.at(-1);
				if (active) {
					active();
					return;
				}
				void window.ensemble?.closeWindow();
			}),
		[],
	);

	return (
		<CloseActionContext.Provider value={register}>
			{children}
		</CloseActionContext.Provider>
	);
}

/**
 * Registers `handler` as the active ⌘/Ctrl+W close action while the calling
 * component is mounted. Pass a memoised `handler` so registration only re-runs
 * when its dependencies change. A no-op outside a {@link CloseActionProvider}.
 */
export function useRegisterCloseAction(handler: () => void): void {
	const register = useContext(CloseActionContext);
	useEffect(() => {
		if (!register) {
			return;
		}
		return register(handler);
	}, [register, handler]);
}
