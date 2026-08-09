import { useAtom, useAtomValue } from 'jotai';
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useHotkey } from '@/renderer/hooks/use-hotkey';
import { buildModelGroups } from '@/renderer/lib/workbench/model-picker-groups';
import {
	favouriteModelsAtom,
	hiddenModelsAtom,
} from '@/renderer/state/preferences';
import type {
	ComposerModelOption,
	GroupedOptions,
} from '@/renderer/types/workbench';
import type { AgentProviderId } from '@/shared/agent-provider';

/** Everything the model picker needs to render its trigger and popover. */
export interface ModelPickerState {
	/** True when the catalog is non-empty but every model is hidden. */
	allHidden: boolean;
	favouriteIds: ReadonlySet<string>;
	groups: readonly GroupedOptions[];
	open: boolean;
	selectModel: (modelId: string) => void;
	selected: ComposerModelOption | null;
	setOpen: (next: boolean) => void;
	/**
	 * Digit shortcut shown on each row, keyed by model id. Rows locked out by the
	 * chat's provider pin are absent, so a digit always selects something.
	 */
	shortcutIndexById: ReadonlyMap<string, number>;
	toggleFavourite: (modelId: string) => void;
}

/**
 * Derives the model picker's open state, grouped options, favourites, and digit
 * shortcuts, and binds the shortcut hotkey while the popover is open.
 * @param controlledOpen - Open state when the caller controls the popover
 * @param lockedProvider - Agent runtime the chat is pinned to, or null when new
 * @param onChange - Called with the model id the user picked
 * @param onOpenChange - Notified whenever the popover opens or closes
 * @param options - The model catalog to present
 * @param value - Id of the currently selected model
 * @returns The picker's derived state and its selection callbacks
 */
export function useModelPickerState({
	controlledOpen,
	lockedProvider,
	onChange,
	onOpenChange,
	options,
	value,
}: {
	controlledOpen: boolean | undefined;
	lockedProvider: AgentProviderId | null;
	onChange: (modelId: string) => void;
	onOpenChange: ((open: boolean) => void) | undefined;
	options: readonly ComposerModelOption[];
	value: string | null;
}): ModelPickerState {
	const { i18n } = useTranslation();
	const [internalOpen, setInternalOpen] = useState(false);
	const open = controlledOpen ?? internalOpen;
	const setOpen = useCallback(
		(next: boolean) => {
			if (controlledOpen === undefined) {
				setInternalOpen(next);
			}
			onOpenChange?.(next);
		},
		[controlledOpen, onOpenChange],
	);

	const [favourites, setFavourites] = useAtom(favouriteModelsAtom);
	const hidden = useAtomValue(hiddenModelsAtom);
	const favouriteIds = useMemo(() => new Set(favourites), [favourites]);
	const toggleFavourite = useCallback(
		(modelId: string) => {
			setFavourites((prev) =>
				prev.includes(modelId)
					? prev.filter((id) => id !== modelId)
					: [...prev, modelId],
			);
		},
		[setFavourites],
	);

	// biome-ignore lint/correctness/useExhaustiveDependencies: provider labels are translated through the i18n singleton, so the language is a real input Biome cannot see.
	const groups = useMemo(
		() => buildModelGroups(options, favourites, hidden, lockedProvider),
		[options, favourites, hidden, lockedProvider, i18n.language],
	);
	const orderedShortcuts = useMemo(
		() =>
			groups.flatMap((group) =>
				group.models.flatMap((row) => (row.locked ? [] : [row.model])),
			),
		[groups],
	);
	const shortcutIndexById = useMemo(
		() =>
			new Map(orderedShortcuts.map((model, index) => [model.id, index + 1])),
		[orderedShortcuts],
	);

	const selectModel = useCallback(
		(modelId: string) => {
			onChange(modelId);
			setOpen(false);
		},
		[onChange, setOpen],
	);

	const handleDigitShortcut = useCallback(
		(event: KeyboardEvent) => {
			const target = orderedShortcuts[Number.parseInt(event.key, 10) - 1];
			if (target) {
				selectModel(target.id);
			}
		},
		[orderedShortcuts, selectModel],
	);
	useHotkey('modelPicker.selectByIndex', handleDigitShortcut, {
		enabled: open,
	});

	return {
		// Every model is hidden: the catalog isn't empty but the list is, so the
		// popover renders a hint instead of a zero-height scroll box.
		allHidden: options.length > 0 && groups.length === 0,
		favouriteIds,
		groups,
		open,
		selected: options.find((option) => option.id === value) ?? null,
		selectModel,
		setOpen,
		shortcutIndexById,
		toggleFavourite,
	};
}
