import { i18n } from '@/renderer/lib/i18n';
import type {
	ComposerModelOption,
	GroupedOptions,
	ModelPickerRow,
} from '@/renderer/types/workbench';
import type { AgentProviderId } from '@/shared/agent-provider';

/**
 * Group labels keyed by a model's *inference* provider. `claude-code` and
 * `openai-codex` are agent runtimes that also surface as provider ids; the
 * plain vendor ids beside them must stay vendor-named, or a Pi chat running an
 * Anthropic model lands in a group labelled after a runtime it is not using.
 */
const PROVIDER_DISPLAY_NAMES: Record<string, string> = {
	anthropic: 'Anthropic',
	'claude-code': 'Claude Code',
	codex: 'OpenAI Codex',
	composer: 'Cursor',
	lmstudio: 'LM Studio',
	ollama: 'Ollama',
	'nvidia-nim': 'Nvidia NIM',
	cursor: 'Cursor',
	gemini: 'Gemini',
	google: 'Gemini',
	openai: 'OpenAI',
	'openai-codex': 'OpenAI Codex',
};

const FAVOURITES_GROUP_KEY = '__favourites__';

/** Maps provider identifiers to the grouped label shown in the model picker. */
export function getProviderDisplayName(provider: string): string {
	const lowered = provider.toLowerCase();
	if (PROVIDER_DISPLAY_NAMES[lowered]) {
		return PROVIDER_DISPLAY_NAMES[lowered];
	}
	return provider
		.split(/[-_]/)
		.filter(Boolean)
		.map((part) => part.charAt(0).toUpperCase() + part.slice(1))
		.join(' ');
}

/**
 * Wraps a model in a picker row, marking it locked when the chat is already
 * pinned to a different agent runtime.
 * @param model - Catalog entry to wrap.
 * @param lockedProvider - Agent runtime the chat is pinned to, or null when new.
 * @returns The row the picker renders.
 */
function toRow(
	model: ComposerModelOption,
	lockedProvider: AgentProviderId | null,
): ModelPickerRow {
	return {
		locked: lockedProvider !== null && model.agentProvider !== lockedProvider,
		model,
	};
}

/** Groups picker rows by inference provider while preserving source order. */
function groupByProvider(rows: readonly ModelPickerRow[]): GroupedOptions[] {
	const groups = new Map<string, GroupedOptions>();
	for (const row of rows) {
		const key = row.model.vendor || 'other';
		const existing = groups.get(key);
		if (existing) {
			existing.models.push(row);
		} else {
			groups.set(key, {
				models: [row],
				provider: key,
				providerLabel: getProviderDisplayName(key),
			});
		}
	}
	return [...groups.values()];
}

/**
 * Builds the ordered picker groups: a leading "Favourites" group (favourited
 * models in starred order) followed by the provider groups with those
 * favourites removed, so each model appears once. Favourites therefore take the
 * low `1-9` shortcut slots. The Favourites group is omitted when empty.
 *
 * `hiddenIds` are dropped from every group (favourites included), so hiding wins
 * over favouriting. Hidden models are absent from the list only — the picker
 * trigger still resolves the active model against the full `options` set.
 *
 * `lockedProvider` pins the chat to one agent runtime. Models belonging to any
 * other runtime stay in their group and come back marked `locked`, so the picker
 * greys them out instead of hiding them: a list that silently shrinks once a
 * chat has a session reads as a bug rather than as a rule.
 * @param options - The full model catalog to present.
 * @param favouriteIds - Starred model ids, in the order they should be pinned.
 * @param hiddenIds - Model ids the user hid in Settings → Models.
 * @param lockedProvider - Agent runtime the chat is pinned to, or null when new.
 * @returns The ordered picker groups, favourites first.
 */
export function buildModelGroups(
	options: readonly ComposerModelOption[],
	favouriteIds: readonly string[],
	hiddenIds: readonly string[] = [],
	lockedProvider: AgentProviderId | null = null,
): GroupedOptions[] {
	const favouriteSet = new Set(favouriteIds);
	const hiddenSet = new Set(hiddenIds);
	const byId = new Map(options.map((option) => [option.id, option]));
	const favouriteRows = favouriteIds.flatMap((id) => {
		const option = byId.get(id);
		return option && !hiddenSet.has(id) ? [toRow(option, lockedProvider)] : [];
	});
	const providerGroups = groupByProvider(
		options.flatMap((option) =>
			favouriteSet.has(option.id) || hiddenSet.has(option.id)
				? []
				: [toRow(option, lockedProvider)],
		),
	);
	if (favouriteRows.length === 0) {
		return providerGroups;
	}
	return [
		{
			models: favouriteRows,
			provider: FAVOURITES_GROUP_KEY,
			providerLabel: i18n.t(
				'workbench:model-picker.group.favourites',
				'Favourites',
			),
		},
		...providerGroups,
	];
}
