import { useAtom } from 'jotai';
import { CheckIcon, SparklesIcon, StarIcon } from 'lucide-react';
import { type CSSProperties, useCallback, useMemo, useState } from 'react';
import { Button } from '@/renderer/components/ui/button';
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from '@/renderer/components/ui/popover';
import { ScrollArea } from '@/renderer/components/ui/scroll-area';
import { Separator } from '@/renderer/components/ui/separator';
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from '@/renderer/components/ui/tooltip';
import { useHotkey } from '@/renderer/hooks/use-hotkey';
import { cn } from '@/renderer/lib/utils';
import { favouriteModelsAtom } from '@/renderer/state/preferences';
import type { ComposerModelOption } from '@/renderer/types/workbench';

const MAX_MENU_HEIGHT_REM = 24;
const MODEL_ROW_HEIGHT_REM = 2.25;
const GROUP_LABEL_HEIGHT_REM = 1.5;
const GROUP_SEPARATOR_HEIGHT_REM = 0.75;
const MENU_VERTICAL_PADDING_REM = 0.5;

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

/** Model selector inputs shown in the composer footer. */
interface ModelPickerProps {
	disabled?: boolean;
	onChange: (modelId: string) => void;
	onOpenChange?: (open: boolean) => void;
	open?: boolean;
	options: readonly ComposerModelOption[];
	value: string | null;
}

/** One provider group inside the model selector menu. */
interface GroupedOptions {
	provider: string;
	providerLabel: string;
	models: ComposerModelOption[];
}

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

const FAVOURITES_GROUP_KEY = '__favourites__';

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

/** Builds keyboard shortcut indices for displayed model rows. */
function buildShortcutIndexById(
	models: readonly ComposerModelOption[],
): ReadonlyMap<string, number> {
	return new Map(models.map((model, index) => [model.id, index + 1]));
}

/** Estimates content height so Radix ScrollArea receives a definite height. */
function getMenuHeight(groups: readonly GroupedOptions[]): string {
	const modelCount = groups.reduce(
		(total, group) => total + group.models.length,
		0,
	);
	const separatorCount = Math.max(0, groups.length - 1);
	const estimatedHeightRem =
		MENU_VERTICAL_PADDING_REM +
		groups.length * GROUP_LABEL_HEIGHT_REM +
		modelCount * MODEL_ROW_HEIGHT_REM +
		separatorCount * GROUP_SEPARATOR_HEIGHT_REM;

	return `min(${estimatedHeightRem}rem, min(${MAX_MENU_HEIGHT_REM}rem, var(--radix-popover-content-available-height, ${MAX_MENU_HEIGHT_REM}rem)))`;
}

/** Renders one selectable model row plus its favourite-toggle star. */
function ModelOptionRow({
	favourite,
	model,
	onSelect,
	onToggleFavourite,
	selected,
	shortcutIndex,
}: {
	favourite: boolean;
	model: ComposerModelOption;
	onSelect: () => void;
	onToggleFavourite: () => void;
	selected: boolean;
	shortcutIndex: number | undefined;
}) {
	// Row is a flex container, not a single button, so the star can be its own
	// interactive control (a button nested in a button is invalid).
	return (
		<div
			className={cn(
				'flex items-center gap-0.5 rounded-md',
				selected && 'bg-muted',
			)}
		>
			<Button
				className={cn(
					'h-9 min-w-0 flex-1 justify-start rounded-md px-2 text-left font-normal hover:bg-transparent',
					selected && 'text-foreground',
				)}
				onClick={onSelect}
				size='sm'
				type='button'
				variant='ghost'
			>
				<SparklesIcon className='text-muted-foreground' />
				<span className='flex-1 truncate'>{model.displayName}</span>
				{selected ? <CheckIcon /> : null}
				{shortcutIndex && shortcutIndex < 10 ? (
					<span className='ml-1 text-muted-foreground text-xs tabular-nums'>
						{shortcutIndex}
					</span>
				) : null}
			</Button>
			<button
				aria-label={favourite ? 'Unfavourite model' : 'Favourite model'}
				aria-pressed={favourite}
				className={cn(
					'mr-1 shrink-0 rounded-md p-1.5 transition-colors hover:bg-secondary/60',
					favourite
						? 'text-status-warning'
						: 'text-muted-foreground/40 hover:text-muted-foreground',
				)}
				onClick={(event) => {
					// Never let the star select the model or close the popover.
					event.stopPropagation();
					onToggleFavourite();
				}}
				type='button'
			>
				<StarIcon className={cn('size-3.5', favourite && 'fill-current')} />
			</button>
		</div>
	);
}

/** Renders the scrollable provider sections for model choices. */
function ModelOptionsList({
	favouriteIds,
	groups,
	onSelect,
	onToggleFavourite,
	selectedId,
	shortcutIndexById,
}: {
	favouriteIds: ReadonlySet<string>;
	groups: readonly GroupedOptions[];
	onSelect: (modelId: string) => void;
	onToggleFavourite: (modelId: string) => void;
	selectedId: string | null;
	shortcutIndexById: ReadonlyMap<string, number>;
}) {
	return (
		<div className='flex flex-col gap-0.5'>
			{groups.map((group, groupIndex) => (
				<div className='flex flex-col gap-0.5' key={group.provider}>
					<div className='px-2 pt-1 pb-0.5 text-muted-foreground text-xs'>
						{group.providerLabel}
					</div>
					{group.models.map((model) => (
						<ModelOptionRow
							favourite={favouriteIds.has(model.id)}
							key={model.id}
							model={model}
							onSelect={() => onSelect(model.id)}
							onToggleFavourite={() => onToggleFavourite(model.id)}
							selected={model.id === selectedId}
							shortcutIndex={shortcutIndexById.get(model.id)}
						/>
					))}
					{groupIndex < groups.length - 1 ? (
						<Separator className='my-1' />
					) : null}
				</div>
			))}
		</div>
	);
}

/** Renders the composer model selector with grouped shortcut rows. */
export function ModelPicker({
	disabled,
	onChange,
	onOpenChange,
	open: controlledOpen,
	options,
	value,
}: ModelPickerProps) {
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
	const groups = useMemo(
		() => buildModelGroups(options, favourites),
		[options, favourites],
	);
	const orderedShortcuts = useMemo(
		() => groups.flatMap((group) => group.models),
		[groups],
	);
	const shortcutIndexById = useMemo(
		() => buildShortcutIndexById(orderedShortcuts),
		[orderedShortcuts],
	);
	const scrollAreaStyle = useMemo<CSSProperties>(
		() => ({ height: getMenuHeight(groups) }),
		[groups],
	);
	const selected = options.find((option) => option.id === value) ?? null;

	const handleDigitShortcut = useCallback(
		(event: KeyboardEvent) => {
			const index = Number.parseInt(event.key, 10) - 1;
			const target = orderedShortcuts[index];
			if (!target) {
				return;
			}
			onChange(target.id);
			setOpen(false);
		},
		[onChange, orderedShortcuts, setOpen],
	);
	useHotkey('modelPicker.selectByIndex', handleDigitShortcut, {
		enabled: open,
	});

	if (options.length === 0) {
		return (
			<span className='inline-flex items-center gap-1.5 rounded-md px-1.5 py-1 text-muted-foreground text-xs'>
				<SparklesIcon className='size-3.5' />
				<span>Pi model pending</span>
			</span>
		);
	}

	return (
		<Popover onOpenChange={setOpen} open={open}>
			<Tooltip open={open ? false : undefined}>
				<TooltipTrigger asChild>
					<PopoverTrigger asChild>
						<Button
							aria-label='Model'
							className='h-7 rounded-md px-1.5'
							disabled={disabled}
							size='sm'
							type='button'
							variant='subtle'
						>
							<SparklesIcon />
							<span className='font-medium text-foreground'>
								{selected?.displayName ?? 'Select model'}
							</span>
						</Button>
					</PopoverTrigger>
				</TooltipTrigger>
				<TooltipContent sideOffset={4}>
					Change model
					<span className='ml-2 text-muted-foreground'>⌥P</span>
				</TooltipContent>
			</Tooltip>
			<PopoverContent align='start' className='w-80 overflow-hidden p-1.5'>
				<ScrollArea className='pr-3.5' style={scrollAreaStyle}>
					<ModelOptionsList
						favouriteIds={favouriteIds}
						groups={groups}
						onSelect={(modelId) => {
							onChange(modelId);
							setOpen(false);
						}}
						onToggleFavourite={toggleFavourite}
						selectedId={selected?.id ?? null}
						shortcutIndexById={shortcutIndexById}
					/>
				</ScrollArea>
			</PopoverContent>
		</Popover>
	);
}
