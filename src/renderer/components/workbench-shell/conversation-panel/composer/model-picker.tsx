import type { TFunction } from 'i18next';
import { CheckIcon, SparklesIcon, StarIcon } from 'lucide-react';
import { type CSSProperties, type Ref, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
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
import { useModelPickerState } from '@/renderer/hooks/workbench-shell/composer/use-model-picker-state';
import { cn } from '@/renderer/lib/utils';
import type {
	ComposerModelOption,
	GroupedOptions,
} from '@/renderer/types/workbench';
import {
	type AgentProviderId,
	getAgentProviderLabel,
} from '@/shared/agent-provider';
import { ModelProviderIcon } from './model-provider-icon';

const MAX_MENU_HEIGHT_REM = 24;
const MODEL_ROW_HEIGHT_REM = 2.25;
const GROUP_LABEL_HEIGHT_REM = 1.5;
const GROUP_SEPARATOR_HEIGHT_REM = 0.75;
const MENU_VERTICAL_PADDING_REM = 0.5;

/** Model selector inputs shown in the composer footer. */
interface ModelPickerProps {
	disabled?: boolean;
	/**
	 * Agent runtime this chat is pinned to, or `null` while it is still new. When
	 * set, every other runtime's models render disabled rather than disappearing.
	 */
	lockedProvider?: AgentProviderId | null;
	onChange: (modelId: string) => void;
	onOpenChange?: (open: boolean) => void;
	open?: boolean;
	options: readonly ComposerModelOption[];
	value: string | null;
}

/**
 * Explains why a model row is unselectable, naming the runtime the chat is
 * already committed to so the rule reads as a pin rather than a failure.
 * @param lockedProvider - Agent runtime the chat is pinned to.
 * @param t - Translator from the calling component, so the hint follows the UI language.
 * @returns The tooltip copy shown on every locked-out row.
 */
function getLockedHint(lockedProvider: AgentProviderId, t: TFunction): string {
	return t(
		'workbench:model-picker.locked-hint',
		'This chat runs on {{provider}}. Start a new chat to switch provider.',
		{ provider: getAgentProviderLabel(lockedProvider) },
	);
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

/**
 * Renders one model row plus its favourite-toggle star. A row locked out by the
 * chat's provider pin stays visible but disabled, and carries the tooltip that
 * explains the pin — the same disabled-with-a-hint shape the diff toolbar uses,
 * where a wrapper span supplies the hover the disabled button swallows.
 */
function ModelOptionRow({
	favourite,
	locked,
	lockedHint,
	model,
	onSelect,
	onToggleFavourite,
	ref,
	selected,
	shortcutIndex,
}: {
	favourite: boolean;
	locked: boolean;
	lockedHint: string | null;
	model: ComposerModelOption;
	onSelect: () => void;
	onToggleFavourite: () => void;
	/** Set only on the selected row, so the popover can reveal it on open. */
	ref?: Ref<HTMLDivElement>;
	selected: boolean;
	shortcutIndex: number | undefined;
}) {
	const { t } = useTranslation();
	const selectButton = (
		<Button
			className={cn(
				'h-9 min-w-0 flex-1 justify-start rounded-md px-2 text-left font-normal hover:bg-transparent',
				selected && 'text-foreground',
			)}
			disabled={locked}
			onClick={onSelect}
			size='sm'
			type='button'
			variant='ghost'
		>
			<ModelProviderIcon
				agentProvider={model.agentProvider}
				className='text-muted-foreground'
				vendor={model.vendor}
			/>
			<span className='flex-1 truncate'>{model.displayName}</span>
			{selected ? <CheckIcon /> : null}
			{shortcutIndex && shortcutIndex < 10 ? (
				<span className='ml-1 text-muted-foreground text-xs tabular-nums'>
					{shortcutIndex}
				</span>
			) : null}
		</Button>
	);

	// Row is a flex container, not a single button, so the star can be its own
	// interactive control (a button nested in a button is invalid).
	return (
		<div
			className={cn(
				'flex items-center gap-0.5 rounded-md',
				selected && 'bg-muted',
			)}
			ref={ref}
		>
			{locked && lockedHint ? (
				<Tooltip>
					<TooltipTrigger asChild>
						<span className='flex min-w-0 flex-1'>{selectButton}</span>
					</TooltipTrigger>
					<TooltipContent>{lockedHint}</TooltipContent>
				</Tooltip>
			) : (
				selectButton
			)}
			<button
				aria-label={
					favourite
						? t('workbench:model-picker.unfavourite', 'Unfavourite model')
						: t('workbench:model-picker.favourite', 'Favourite model')
				}
				aria-pressed={favourite}
				className={cn(
					'mr-1 shrink-0 rounded-md p-1.5 transition-[color,background-color,opacity] hover:bg-secondary/60',
					favourite
						? 'text-status-warning opacity-100'
						: 'text-muted-foreground opacity-40 hover:opacity-100',
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

/**
 * Centres a row inside the popover's scroll viewport. Runs as a ref callback on
 * the selected row, which mounts with the popover, so the list opens already
 * scrolled to the current model instead of at the top of a long catalogue.
 * @param row - The selected row, or null as it unmounts.
 */
function revealRow(row: HTMLDivElement | null): void {
	const viewport = row?.closest<HTMLElement>(
		'[data-slot="scroll-area-viewport"]',
	);
	if (!row || !viewport) {
		return;
	}
	viewport.scrollTop =
		row.offsetTop - viewport.clientHeight / 2 + row.offsetHeight / 2;
}

/** Renders the scrollable provider sections for model choices. */
function ModelOptionsList({
	favouriteIds,
	groups,
	lockedHint,
	onSelect,
	onToggleFavourite,
	selectedId,
	shortcutIndexById,
}: {
	favouriteIds: ReadonlySet<string>;
	groups: readonly GroupedOptions[];
	lockedHint: string | null;
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
					{group.models.map(({ locked, model }) => (
						<ModelOptionRow
							favourite={favouriteIds.has(model.id)}
							key={model.id}
							locked={locked}
							lockedHint={lockedHint}
							model={model}
							onSelect={() => onSelect(model.id)}
							onToggleFavourite={() => onToggleFavourite(model.id)}
							ref={model.id === selectedId ? revealRow : undefined}
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
	lockedProvider = null,
	onChange,
	onOpenChange,
	open: controlledOpen,
	options,
	value,
}: ModelPickerProps) {
	const { t } = useTranslation();
	const [tooltipOpen, setTooltipOpen] = useState(false);
	const {
		allHidden,
		favouriteIds,
		groups,
		open,
		selectModel,
		selected,
		setOpen,
		shortcutIndexById,
		toggleFavourite,
	} = useModelPickerState({
		controlledOpen,
		lockedProvider,
		onChange,
		onOpenChange,
		options,
		value,
	});
	const lockedHint = lockedProvider ? getLockedHint(lockedProvider, t) : null;
	const scrollAreaStyle = useMemo<CSSProperties>(
		() => ({ height: getMenuHeight(groups) }),
		[groups],
	);

	if (options.length === 0) {
		return (
			<span className='inline-flex items-center gap-1.5 rounded-md px-1.5 py-1 text-muted-foreground text-xs'>
				<SparklesIcon className='size-3.5' />
				<span>{t('workbench:model-picker.pending', 'Model pending')}</span>
			</span>
		);
	}

	return (
		<Popover onOpenChange={setOpen} open={open}>
			<Tooltip onOpenChange={setTooltipOpen} open={open ? false : tooltipOpen}>
				<TooltipTrigger asChild>
					<PopoverTrigger asChild>
						<Button
							aria-label={t('workbench:model-picker.aria-label', 'Model')}
							className='h-7 rounded-md px-1.5'
							disabled={disabled}
							size='sm'
							type='button'
							variant='subtle'
						>
							<ModelProviderIcon
								agentProvider={selected?.agentProvider ?? null}
								vendor={selected?.vendor ?? ''}
							/>
							<span className='font-medium text-foreground'>
								{selected?.displayName ??
									t('workbench:model-picker.unselected', 'Select model')}
							</span>
						</Button>
					</PopoverTrigger>
				</TooltipTrigger>
				<TooltipContent sideOffset={4}>
					{t('workbench:model-picker.tooltip', 'Change model')}
					{/* i18next-instrument-ignore */}
					<span className='ml-2 text-muted-foreground'>⌥P</span>
				</TooltipContent>
			</Tooltip>
			<PopoverContent align='start' className='w-80 overflow-hidden p-1.5'>
				{allHidden ? (
					<p className='px-2 py-3 text-muted-foreground text-xs'>
						{t(
							'workbench:model-picker.all-hidden',
							'All models hidden — manage in Settings → Models.',
						)}
					</p>
				) : (
					<ScrollArea className='-mr-1.5 pr-1.5' style={scrollAreaStyle}>
						<ModelOptionsList
							favouriteIds={favouriteIds}
							groups={groups}
							lockedHint={lockedHint}
							onSelect={selectModel}
							onToggleFavourite={toggleFavourite}
							selectedId={selected?.id ?? null}
							shortcutIndexById={shortcutIndexById}
						/>
					</ScrollArea>
				)}
			</PopoverContent>
		</Popover>
	);
}
