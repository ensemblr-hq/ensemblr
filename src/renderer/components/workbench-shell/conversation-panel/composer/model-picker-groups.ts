import type { ComposerModelOption } from '@/renderer/types/workbench';

/** One provider group inside the model selector menu. */
export interface GroupedOptions {
	provider: string;
	providerLabel: string;
	models: ComposerModelOption[];
}

const PROVIDER_DISPLAY_NAMES: Record<string, string> = {
	anthropic: 'Claude Code',
	'claude-code': 'Claude Code',
	codex: 'Codex',
	composer: 'Cursor',
	cursor: 'Cursor',
	gemini: 'Gemini',
	google: 'Gemini',
	openai: 'Codex',
};

export const FAVOURITES_GROUP_KEY = '__favourites__';

/** Maps provider identifiers to the grouped label shown in the model picker. */
function getProviderDisplayName(provider: string): string {
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

/** Groups model options by provider while preserving source order. */
function groupByProvider(
	options: readonly ComposerModelOption[],
): GroupedOptions[] {
	const groups = new Map<string, GroupedOptions>();
	for (const option of options) {
		const key = option.provider || 'other';
		const existing = groups.get(key);
		if (existing) {
			existing.models.push(option);
		} else {
			groups.set(key, {
				models: [option],
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
 */
export function buildModelGroups(
	options: readonly ComposerModelOption[],
	favouriteIds: readonly string[],
): GroupedOptions[] {
	const favouriteSet = new Set(favouriteIds);
	const byId = new Map(options.map((option) => [option.id, option]));
	const favouriteModels = favouriteIds.flatMap((id) => {
		const option = byId.get(id);
		return option ? [option] : [];
	});
	const providerGroups = groupByProvider(
		options.filter((option) => !favouriteSet.has(option.id)),
	);
	if (favouriteModels.length === 0) {
		return providerGroups;
	}
	return [
		{
			models: favouriteModels,
			provider: FAVOURITES_GROUP_KEY,
			providerLabel: 'Favourites',
		},
		...providerGroups,
	];
}
