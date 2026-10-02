import type { DescribedMenuItem, MenuItemFactory } from './menu-item';
import type { MenuLabels } from './menu-strings';

/**
 * Builds the Changes menu — the review and git flow that is otherwise reachable
 * only by clicking inside the right sidebar.
 *
 * Nothing here carries an accelerator on purpose: these items exist to be found
 * and to feed the macOS Help search field, and minting bindings for operations
 * performed a handful of times a day would spend keyspace the composer needs.
 * @param labels - Native menu labels for the active language
 * @param items - Factory for the command items in this menu
 * @returns The Changes menu
 */
export function buildChangesMenu(
	labels: MenuLabels,
	items: MenuItemFactory,
): DescribedMenuItem {
	return {
		label: labels.changes,
		submenu: [
			items.command('review.review', labels.review),
			{ type: 'separator' },
			items.command('review.commitAndPush', labels.commitAndPush),
			items.command('review.pushBranch', labels.pushBranch),
			items.command('review.createPullRequest', labels.createPullRequest),
			items.command('review.mergePullRequest', labels.mergePullRequest),
			{ type: 'separator' },
			items.command('review.resolveConflicts', labels.resolveConflicts),
			items.command('review.fixCheckErrors', labels.fixCheckErrors),
			{ type: 'separator' },
			items.command('review.discardChanges', labels.discardChanges),
		],
	};
}
