import type { MenuContext } from '../../shared/menu-commands';
import type { DescribedMenuItem, MenuItemFactory } from './menu-item';
import type { MenuLabels } from './menu-strings';

/**
 * Builds the Chat menu: the composer controls and the chat-tab lifecycle.
 *
 * Tabs live here rather than under Window because an Ensemblr tab is a
 * conversation inside a workspace, not a document window — filing them under
 * Window would collide with real windows the moment the app grows a second one.
 * @param labels - Native menu labels for the active language
 * @param items - Factory for the command items in this menu
 * @param context - The last context the renderer reported, or null
 * @returns The Chat menu
 */
export function buildChatMenu(
	labels: MenuLabels,
	items: MenuItemFactory,
	context: MenuContext | null,
): DescribedMenuItem {
	return {
		label: labels.chat,
		submenu: [
			items.command('composer.focus', labels.focusComposer),
			items.command('composer.submit', labels.sendMessage),
			{ type: 'separator' },
			items.command('composer.togglePlanMode', labels.planMode, {
				checkbox: true,
			}),
			items.command('composer.cycleThinking', labels.cycleThinking),
			items.command('composer.toggleModelPicker', labels.chooseModel),
			{ type: 'separator' },
			items.command('tab.next', labels.nextChat),
			items.command('tab.prev', labels.previousChat),
			items.submenu(
				'tab.selectByIndex',
				labels.goToChat,
				context?.chatTabs ?? [],
				labels.noOpenChats,
			),
			items.command('tab.keepOpen', labels.keepChatOpen),
		],
	};
}
