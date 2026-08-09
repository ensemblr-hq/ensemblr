import { useQuery } from '@tanstack/react-query';
import { useAtom } from 'jotai';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { agentModelsQuery } from '@/renderer/api/ensemblr';
import {
	SettingsErrorState,
	SettingsLoadingState,
} from '@/renderer/components/settings/settings-async-state';
import { SettingsEmptyState } from '@/renderer/components/settings/settings-empty-state';
import { Button } from '@/renderer/components/ui/button';
import { Input } from '@/renderer/components/ui/input';
import { ScrollArea } from '@/renderer/components/ui/scroll-area';
import { Switch } from '@/renderer/components/ui/switch';
import { getProviderDisplayName } from '@/renderer/lib/workbench/model-picker-groups';
import { hiddenModelsAtom } from '@/renderer/state/preferences';
import type { AgentModelOption } from '@/shared/ipc/contracts/agent-models';

/** A provider and its catalog models, grouped for the model-visibility list. */
interface ProviderGroup {
	provider: string;
	providerLabel: string;
	models: AgentModelOption[];
}

/** Groups catalog models by provider, preserving the catalog's listing order. */
function groupByProvider(models: readonly AgentModelOption[]): ProviderGroup[] {
	const groups = new Map<string, ProviderGroup>();
	for (const model of models) {
		const key = model.vendor || 'other';
		const existing = groups.get(key);
		if (existing) {
			existing.models.push(model);
		} else {
			groups.set(key, {
				models: [model],
				provider: key,
				providerLabel: getProviderDisplayName(key),
			});
		}
	}
	return [...groups.values()];
}

/**
 * Curates which agent models appear in the composer model picker. Toggling a model
 * off records it in {@link hiddenModelsAtom} (inverse storage) — it stays
 * selectable as a default and never changes the active model; it's just dropped
 * from the picker list. Mirrors the self-fetching shape of the settings lists.
 */
export function ModelVisibilityList() {
	const { t } = useTranslation();
	const { data, error, isLoading } = useQuery(agentModelsQuery);
	const [hidden, setHidden] = useAtom(hiddenModelsAtom);
	const [query, setQuery] = useState('');

	const models = useMemo(() => data?.models ?? [], [data]);
	const hiddenSet = useMemo(() => new Set(hidden), [hidden]);

	const groups = useMemo(() => {
		const needle = query.trim().toLowerCase();
		const filtered = needle
			? models.filter(
					(model) =>
						model.displayName.toLowerCase().includes(needle) ||
						model.id.toLowerCase().includes(needle) ||
						getProviderDisplayName(model.vendor).toLowerCase().includes(needle),
				)
			: models;
		return groupByProvider(filtered);
	}, [models, query]);

	if (isLoading) {
		return (
			<SettingsLoadingState
				label={t('settings:models.loading', 'Loading models…')}
			/>
		);
	}

	if (error) {
		return (
			<SettingsErrorState
				message={t(
					'settings:models.discovery-failed',
					'Model discovery failed: {{error}}.',
					{ error: String(error) },
				)}
			/>
		);
	}

	if (models.length === 0) {
		return (
			<SettingsEmptyState
				title={t('settings:models.visibility.empty', 'No models available.')}
			/>
		);
	}

	const hiddenCount = models.filter((model) => hiddenSet.has(model.id)).length;
	const visibleCount = models.length - hiddenCount;

	// Showing is always safe; hiding is blocked when it would leave the picker
	// with no models (the UI also disables the last visible toggle).
	const toggle = (id: string) =>
		setHidden((prev) => {
			if (prev.includes(id)) {
				return prev.filter((entry) => entry !== id);
			}
			if (models.length - prev.length <= 1) {
				return prev;
			}
			return [...prev, id];
		});

	// Bulk hide/show a whole provider group. Operates on the rows currently
	// shown under the header (the search-filtered set), and keeps ≥1 model
	// visible overall just like the per-row toggle.
	const toggleProvider = (group: ProviderGroup) => {
		const ids = group.models.map((model) => model.id);
		const idSet = new Set(ids);
		const anyVisible = group.models.some((model) => !hiddenSet.has(model.id));
		if (!anyVisible) {
			setHidden((prev) => prev.filter((id) => !idSet.has(id)));
			return;
		}
		const visibleInGroup = ids.filter((id) => !hiddenSet.has(id)).length;
		if (visibleCount - visibleInGroup < 1) {
			return;
		}
		setHidden((prev) => [...new Set([...prev, ...ids])]);
	};

	return (
		<div className='space-y-3'>
			<div className='flex items-center gap-2'>
				<Input
					aria-label={t(
						'settings:models.visibility.search-aria-label',
						'Search models',
					)}
					className='h-7'
					onChange={(event) => setQuery(event.target.value)}
					placeholder={t(
						'settings:models.visibility.search-placeholder',
						'Search models…',
					)}
					value={query}
				/>
				<Button
					className='shrink-0'
					disabled={hiddenCount === 0}
					onClick={() => setHidden([])}
					size='sm'
					variant='ghost'
				>
					{t('settings:models.visibility.show-all', 'Show all')}
				</Button>
			</div>

			{groups.length === 0 ? (
				<SettingsEmptyState
					title={t(
						'settings:models.visibility.no-matches',
						'No models match “{{query}}”.',
						{ query },
					)}
				/>
			) : (
				<ScrollArea className='h-80 rounded-xl border border-border bg-card/40'>
					<ul className='divide-y divide-border'>
						{groups.map((group) => {
							const groupVisibleCount = group.models.filter(
								(model) => !hiddenSet.has(model.id),
							).length;
							const providerVisible = groupVisibleCount > 0;
							// Block hiding a whole provider when it holds every
							// remaining visible model — at least one must stay.
							const providerLocked =
								providerVisible && groupVisibleCount >= visibleCount;
							return (
								<li key={group.provider}>
									<div className='flex items-center justify-between gap-3 bg-muted/30 px-3 py-1.5'>
										<span className='font-medium text-muted-foreground text-xs'>
											{group.providerLabel}
										</span>
										<Switch
											aria-label={
												providerVisible
													? t(
															'settings:models.visibility.hide-provider',
															'Hide all {{provider}} models',
															{ provider: group.providerLabel },
														)
													: t(
															'settings:models.visibility.show-provider',
															'Show all {{provider}} models',
															{ provider: group.providerLabel },
														)
											}
											checked={providerVisible}
											disabled={providerLocked}
											onCheckedChange={() => toggleProvider(group)}
											size='sm'
											title={
												providerLocked
													? t(
															'settings:models.visibility.locked',
															'At least one model must stay visible',
														)
													: undefined
											}
										/>
									</div>
									<ul className='divide-y divide-border'>
										{group.models.map((model) => {
											const visible = !hiddenSet.has(model.id);
											// Never let the user hide the last visible model — the
											// composer always needs at least one to pick.
											const lockedVisible = visible && visibleCount <= 1;
											return (
												<li
													className='flex items-center justify-between gap-3 px-3 py-2'
													key={model.id}
												>
													<div className='min-w-0 flex-1'>
														<div className='truncate text-foreground text-sm'>
															{model.displayName}
														</div>
														{model.displayName !== model.id ? (
															<div className='truncate font-mono text-muted-foreground text-xs'>
																{model.id}
															</div>
														) : null}
													</div>
													<Switch
														aria-label={
															visible
																? t(
																		'settings:models.visibility.hide-model',
																		'Hide {{model}}',
																		{ model: model.displayName },
																	)
																: t(
																		'settings:models.visibility.show-model',
																		'Show {{model}}',
																		{ model: model.displayName },
																	)
														}
														checked={visible}
														disabled={lockedVisible}
														onCheckedChange={() => toggle(model.id)}
														size='sm'
														title={
															lockedVisible
																? t(
																		'settings:models.visibility.locked',
																		'At least one model must stay visible',
																	)
																: undefined
														}
													/>
												</li>
											);
										})}
									</ul>
								</li>
							);
						})}
					</ul>
				</ScrollArea>
			)}

			<p className='text-muted-foreground text-xs'>
				{t('settings:models.visibility.hidden-count', {
					count: hiddenCount,
					defaultValue_one: '{{count}} of {{total}} hidden.',
					defaultValue_other: '{{count}} of {{total}} hidden.',
					total: models.length,
				})}
			</p>
		</div>
	);
}
