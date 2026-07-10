import { useQuery } from '@tanstack/react-query';
import { useAtom } from 'jotai';
import { useMemo, useState } from 'react';

import { piModelsQuery } from '@/renderer/api/ensemblr';
import { SettingsEmptyState } from '@/renderer/components/settings/settings-empty-state';
import { Button } from '@/renderer/components/ui/button';
import { Input } from '@/renderer/components/ui/input';
import { ScrollArea } from '@/renderer/components/ui/scroll-area';
import { Spinner } from '@/renderer/components/ui/spinner';
import { Switch } from '@/renderer/components/ui/switch';
import { getProviderDisplayName } from '@/renderer/components/workbench-shell/conversation-panel/composer/model-picker-groups';
import { hiddenModelsAtom } from '@/renderer/state/preferences';
import type { PiModelOptionWire } from '@/shared/ipc/contracts/pi-session';

/** A provider and its catalog models, grouped for the model-visibility list. */
interface ProviderGroup {
	provider: string;
	providerLabel: string;
	models: PiModelOptionWire[];
}

/** Groups catalog models by provider, preserving Pi's listing order. */
function groupByProvider(
	models: readonly PiModelOptionWire[],
): ProviderGroup[] {
	const groups = new Map<string, ProviderGroup>();
	for (const model of models) {
		const key = model.provider || 'other';
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
 * Curates which Pi models appear in the composer model picker. Toggling a model
 * off records it in {@link hiddenModelsAtom} (inverse storage) — it stays
 * selectable as a default and never changes the active model; it's just dropped
 * from the picker list. Mirrors the self-fetching shape of the settings lists.
 */
export function ModelVisibilityList() {
	const { data, error, isLoading } = useQuery(piModelsQuery);
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
						getProviderDisplayName(model.provider)
							.toLowerCase()
							.includes(needle),
				)
			: models;
		return groupByProvider(filtered);
	}, [models, query]);

	if (isLoading) {
		return (
			<div className='flex items-center gap-2 py-6 text-muted-foreground text-sm'>
				<Spinner className='size-4' /> Loading Pi models…
			</div>
		);
	}

	if (error) {
		return (
			<div className='py-6 text-sm text-status-danger'>
				Pi model discovery failed: {String(error)}.
			</div>
		);
	}

	if (models.length === 0) {
		return (
			<p className='py-6 text-muted-foreground text-sm'>
				No Pi models available.
			</p>
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
					aria-label='Search models'
					className='h-8'
					onChange={(event) => setQuery(event.target.value)}
					placeholder='Search models…'
					value={query}
				/>
				<Button
					className='shrink-0'
					disabled={hiddenCount === 0}
					onClick={() => setHidden([])}
					size='sm'
					variant='ghost'
				>
					Show all
				</Button>
			</div>

			{groups.length === 0 ? (
				<SettingsEmptyState title={`No models match “${query}”.`} />
			) : (
				<ScrollArea className='h-80 rounded-md border bg-card/40'>
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
											aria-label={`${providerVisible ? 'Hide' : 'Show'} all ${group.providerLabel} models`}
											checked={providerVisible}
											disabled={providerLocked}
											onCheckedChange={() => toggleProvider(group)}
											size='sm'
											title={
												providerLocked
													? 'At least one model must stay visible'
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
														aria-label={`${visible ? 'Hide' : 'Show'} ${model.displayName}`}
														checked={visible}
														disabled={lockedVisible}
														onCheckedChange={() => toggle(model.id)}
														size='sm'
														title={
															lockedVisible
																? 'At least one model must stay visible'
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
				{hiddenCount} of {models.length} hidden.
			</p>
		</div>
	);
}
