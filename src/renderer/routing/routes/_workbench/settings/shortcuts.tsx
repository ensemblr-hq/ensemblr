import { createFileRoute } from '@tanstack/react-router';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';

import { SettingRow } from '@/renderer/components/settings/setting-row';
import { SettingsSection } from '@/renderer/components/settings/settings-section';
import {
	formatShortcut,
	type Scope,
	SHORTCUTS,
	type ShortcutId,
} from '@/shared/keymap';

/** Route for the Shortcuts settings section; renders the read-only keyboard reference. */
export const Route = createFileRoute('/_workbench/settings/shortcuts')({
	component: ShortcutsSettings,
});

/**
 * Rank each scope takes in the reference, widest surface first. A `Record` and
 * not an array so a scope added to the keymap fails to compile here rather than
 * silently rendering no group.
 */
const SCOPE_RANK: Record<Scope, number> = {
	global: 0,
	composer: 1,
	autocomplete: 2,
	modelPicker: 3,
	dialog: 4,
	menu: 5,
};

/** Scope order the reference lists groups in, widest surface first. */
const SCOPE_ORDER: readonly Scope[] = (Object.keys(SCOPE_RANK) as Scope[]).sort(
	(left, right) => SCOPE_RANK[left] - SCOPE_RANK[right],
);

/**
 * Names each shortcut scope for the group heading. Built from `t()` rather than
 * a module-scope table so a language change re-renders them and so
 * `i18next-cli extract` can see every key statically.
 * @param t - Translation function from `useTranslation`
 * @returns The display heading for every scope
 */
function scopeHeading(t: TFunction): Record<Scope, string> {
	return {
		autocomplete: t('settings:shortcuts.scope.autocomplete', 'Autocomplete'),
		composer: t('settings:shortcuts.scope.composer', 'Composer'),
		dialog: t('settings:shortcuts.scope.dialog', 'Dialogs'),
		global: t('settings:shortcuts.scope.global', 'Global'),
		menu: t('settings:shortcuts.scope.menu', 'Menus'),
		modelPicker: t('settings:shortcuts.scope.model-picker', 'Model picker'),
	};
}

/**
 * Names every shortcut for the reference list. `SHORTCUTS` carries bindings
 * only, so the prose lives here as literal `t()` calls the extractor can see —
 * one entry per {@link ShortcutId}, which the return type enforces.
 * @param t - Translation function from `useTranslation`
 * @returns The display name for every shortcut
 */
function shortcutName(t: TFunction): Record<ShortcutId, string> {
	return {
		'agents.open': t(
			'settings:shortcuts.name.agents-open',
			'Launch coding agent',
		),
		'autocomplete.confirm': t(
			'settings:shortcuts.name.autocomplete-confirm',
			'Confirm autocomplete selection',
		),
		'autocomplete.dismiss': t(
			'settings:shortcuts.name.autocomplete-dismiss',
			'Close autocomplete popover',
		),
		'autocomplete.next': t(
			'settings:shortcuts.name.autocomplete-next',
			'Next autocomplete entry',
		),
		'autocomplete.prev': t(
			'settings:shortcuts.name.autocomplete-prev',
			'Previous autocomplete entry',
		),
		'changes.uncommitted': t(
			'settings:shortcuts.name.changes-uncommitted',
			'Show uncommitted changes',
		),
		'composer.cycleThinking': t(
			'settings:shortcuts.name.composer-cycle-thinking',
			'Cycle thinking level',
		),
		'composer.focus': t(
			'settings:shortcuts.name.composer-focus',
			'Focus composer',
		),
		'composer.newline': t(
			'settings:shortcuts.name.composer-newline',
			'Insert newline in composer',
		),
		'composer.queue': t(
			'settings:shortcuts.name.composer-queue',
			'Queue message as a follow-up',
		),
		'composer.submit': t(
			'settings:shortcuts.name.composer-submit',
			'Send message',
		),
		'composer.submitWithMod': t(
			'settings:shortcuts.name.composer-submit-with-mod',
			'Send message',
		),
		'composer.toggleDictation': t(
			'settings:shortcuts.name.composer-toggle-dictation',
			'Start or stop dictation',
		),
		'composer.togglePlanMode': t(
			'settings:shortcuts.name.composer-toggle-plan-mode',
			'Toggle plan mode',
		),
		'composer.toggleModelPicker': t(
			'settings:shortcuts.name.composer-toggle-model-picker',
			'Toggle model picker',
		),
		'diffComment.submit': t(
			'settings:shortcuts.name.diff-comment-submit',
			'Submit diff comment',
		),
		'dialog.submit': t(
			'settings:shortcuts.name.dialog-submit',
			'Submit dialog form',
		),
		'files.search': t(
			'settings:shortcuts.name.files-search',
			'Open file search',
		),
		'help.shortcuts': t(
			'settings:shortcuts.name.help-shortcuts',
			'Open keyboard shortcuts',
		),
		'layout.toggleDock': t(
			'settings:shortcuts.name.layout-toggle-dock',
			'Toggle dock',
		),
		'layout.toggleRightSidebar': t(
			'settings:shortcuts.name.layout-toggle-right-sidebar',
			'Toggle right sidebar',
		),
		'modelPicker.selectByIndex': t(
			'settings:shortcuts.name.model-picker-select-by-index',
			'Select model by index (1-9)',
		),
		'palette.open': t(
			'settings:shortcuts.name.palette-open',
			'Open command palette',
		),
		'question.submit': t(
			'settings:shortcuts.name.question-submit',
			'Submit answers to an agent question',
		),
		'run.start': t(
			'settings:shortcuts.name.run-start',
			'Start or stop run script',
		),
		'settings.open': t(
			'settings:shortcuts.name.settings-open',
			'Open settings',
		),
		'sidebar.toggle': t(
			'settings:shortcuts.name.sidebar-toggle',
			'Toggle sidebar',
		),
		'tab.close': t('settings:shortcuts.name.tab-close', 'Close tab'),
		'tab.keepOpen': t(
			'settings:shortcuts.name.tab-keep-open',
			'Keep preview tab open',
		),
		'tab.new': t('settings:shortcuts.name.tab-new', 'New chat tab'),
		'tab.next': t('settings:shortcuts.name.tab-next', 'Next tab'),
		'tab.prev': t('settings:shortcuts.name.tab-prev', 'Previous tab'),
		'tab.selectByIndex': t(
			'settings:shortcuts.name.tab-select-by-index',
			'Select tab by index (⌘1–8, ⌘9 last)',
		),
		'terminal.new': t('settings:shortcuts.name.terminal-new', 'New terminal'),
		'toolCalls.toggleCollapse': t(
			'settings:shortcuts.name.tool-calls-toggle-collapse',
			'Expand or collapse all tool calls',
		),
		'workspace.new': t(
			'settings:shortcuts.name.workspace-new',
			'New workspace',
		),
	};
}

/**
 * Groups every shortcut id under its scope, preserving declaration order within
 * a scope so related bindings stay adjacent.
 * @returns Shortcut ids keyed by the scope they are active in
 */
function shortcutsByScope(): Record<Scope, ShortcutId[]> {
	const grouped: Record<Scope, ShortcutId[]> = {
		autocomplete: [],
		composer: [],
		dialog: [],
		global: [],
		menu: [],
		modelPicker: [],
	};

	for (const id of Object.keys(SHORTCUTS) as ShortcutId[]) {
		grouped[SHORTCUTS[id].scope].push(id);
	}

	return grouped;
}

/**
 * Read-only keyboard reference for every shortcut the app binds. Rebinding is
 * not offered: `SHORTCUTS` is a compile-time table shared with the main process
 * menu accelerators, so a custom binding needs a persisted keymap first.
 */
function ShortcutsSettings() {
	const { t } = useTranslation();
	const headings = scopeHeading(t);
	const names = shortcutName(t);
	const grouped = shortcutsByScope();

	return (
		<SettingsSection
			description={t(
				'settings:shortcuts.description',
				'Every keyboard shortcut Ensemblr binds, grouped by where it is active. Read-only — shortcuts are not rebindable yet.',
			)}
			title={t('settings:shortcuts.title', 'Shortcuts')}
		>
			{SCOPE_ORDER.map((scope) => (
				<SettingRow
					description={t('settings:shortcuts.count', '{{count}} shortcuts', {
						count: grouped[scope].length,
					})}
					key={scope}
					label={headings[scope]}
					stack
				>
					<ul className='divide-y divide-border overflow-hidden rounded-xl border border-border bg-card/40'>
						{grouped[scope].map((id) => (
							<li
								className='flex items-center justify-between gap-4 px-3 py-2'
								key={id}
							>
								<span className='min-w-0 truncate text-foreground text-xs'>
									{names[id]}
								</span>
								<kbd className='shrink-0 rounded-md border border-border bg-muted px-1.5 py-0.5 font-mono text-muted-foreground text-xxs'>
									{formatShortcut(id)}
								</kbd>
							</li>
						))}
					</ul>
				</SettingRow>
			))}
		</SettingsSection>
	);
}
