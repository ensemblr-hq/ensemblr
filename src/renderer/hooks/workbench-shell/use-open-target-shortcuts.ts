import { useEffect, useRef } from 'react';

import type { WorkspaceOpenTarget } from '@/renderer/types/workbench';

/** Menu state and target callbacks for the open-in shortcut hook. */
interface UseOpenTargetShortcutsOptions {
	closeMenu: () => void;
	invokeTarget: (target: WorkspaceOpenTarget) => void;
	isMenuOpen: boolean;
	openTargets: WorkspaceOpenTarget[] | null;
	primaryTarget: WorkspaceOpenTarget | null;
}

/**
 * Registers the global keyboard shortcuts that drive the open-in menu:
 *  - `⌘O`        — invoke the current primary target.
 *  - `⌘⇧C`       — invoke the copy-path utility.
 *  - `1`..`9`    — invoke the Nth target while the dropdown is open.
 *
 * The handler is intentionally a `window` listener so shortcuts fire from
 * anywhere in the renderer; an input-focus guard prevents the bindings from
 * clobbering typing in inputs / textareas / contenteditable.
 */
export function useOpenTargetShortcuts(
	options: UseOpenTargetShortcutsOptions,
): void {
	const optionsRef = useRef(options);
	useEffect(() => {
		optionsRef.current = options;
	});

	useEffect(() => {
		const handler = (event: KeyboardEvent) => {
			if (event.defaultPrevented || shouldIgnoreShortcut(event)) {
				return;
			}

			const {
				closeMenu,
				invokeTarget,
				isMenuOpen,
				openTargets,
				primaryTarget,
			} = optionsRef.current;
			if (!openTargets || openTargets.length === 0) {
				return;
			}

			const commandKey = event.metaKey || event.ctrlKey;

			if (
				commandKey &&
				event.shiftKey &&
				!event.altKey &&
				event.key.toLowerCase() === 'c'
			) {
				const copyTarget = openTargets.find(
					(target) => target.behavior === 'copy-path',
				);
				if (copyTarget) {
					event.preventDefault();
					invokeTarget(copyTarget);
				}
				return;
			}

			if (
				commandKey &&
				!event.shiftKey &&
				!event.altKey &&
				event.key.toLowerCase() === 'o'
			) {
				if (primaryTarget) {
					event.preventDefault();
					invokeTarget(primaryTarget);
				}
				return;
			}

			if (
				isMenuOpen &&
				!commandKey &&
				!event.altKey &&
				!event.shiftKey &&
				/^[1-9]$/.test(event.key)
			) {
				const index = Number.parseInt(event.key, 10) - 1;
				const target = openTargets[index];
				if (target) {
					event.preventDefault();
					closeMenu();
					invokeTarget(target);
				}
			}
		};

		window.addEventListener('keydown', handler);
		return () => {
			window.removeEventListener('keydown', handler);
		};
	}, []);
}

/**
 * Skip the global open-in shortcuts when the user is typing in an editable
 * surface. ⌘O / ⌘⇧C are claimed for opening editors and copying the workspace
 * path; firing them inside an input would surprise users.
 */
export function shouldIgnoreShortcut(event: KeyboardEvent): boolean {
	const target = event.target;
	if (!(target instanceof HTMLElement)) {
		return false;
	}
	if (target.isContentEditable) {
		return true;
	}
	const tag = target.tagName;
	return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}
