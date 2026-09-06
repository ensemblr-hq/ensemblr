import { useCallback, useRef, useState } from 'react';
import type { PanelImperativeHandle } from 'react-resizable-panels';

/** Dock collapse state and handlers returned by {@link useDockController}. */
interface DockController {
	dockPanelRef: React.RefObject<PanelImperativeHandle | null>;
	expandDockPanel: () => void;
	handleDockResize: (collapsed: boolean) => void;
	isDockCollapsed: boolean;
	toggleDockPanel: () => void;
}

/** Owns the dock collapse state and its imperative panel ref. */
export function useDockController(): DockController {
	const dockPanelRef = useRef<PanelImperativeHandle | null>(null);
	const [isDockCollapsed, setIsDockCollapsed] = useState(false);

	const expandDockPanel = useCallback(() => {
		dockPanelRef.current?.expand();
		setIsDockCollapsed(false);
	}, []);
	const toggleDockPanel = () => {
		if (dockPanelRef.current?.isCollapsed() || isDockCollapsed) {
			expandDockPanel();
			return;
		}

		dockPanelRef.current?.collapse();
		setIsDockCollapsed(true);
	};
	const handleDockResize = (collapsed: boolean) => {
		setIsDockCollapsed(collapsed);
	};

	return {
		dockPanelRef,
		expandDockPanel,
		handleDockResize,
		isDockCollapsed,
		toggleDockPanel,
	};
}
