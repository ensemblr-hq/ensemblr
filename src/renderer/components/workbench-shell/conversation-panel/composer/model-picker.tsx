import { CheckIcon, SparklesIcon, StarIcon } from 'lucide-react';
import { type CSSProperties, useEffect, useMemo, useState } from 'react';
import { Button } from '@/renderer/components/ui/button';
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from '@/renderer/components/ui/popover';
import { ScrollArea } from '@/renderer/components/ui/scroll-area';
import { Separator } from '@/renderer/components/ui/separator';
import { cn } from '@/renderer/lib/utils';
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

/** Renders one selectable model row inside the grouped model picker. */
function ModelOptionRow({
	model,
	onSelect,
	selected,
	shortcutIndex,
}: {
	model: ComposerModelOption;
	onSelect: () => void;
	selected: boolean;
	shortcutIndex: number | undefined;
}) {
	return (
		<Button
			className={cn(
				'h-9 w-full justify-start rounded-md px-2 text-left font-normal',
				selected && 'bg-muted text-foreground',
			)}
			onClick={onSelect}
			size='sm'
			type='button'
			variant='ghost'
		>
			<SparklesIcon className='text-muted-foreground' />
			<span className='flex-1 truncate'>{model.displayName}</span>
			{model.isDefault ? <StarIcon className='text-status-warning' /> : null}
			{selected ? <CheckIcon /> : null}
			{shortcutIndex && shortcutIndex < 10 ? (
				<span className='ml-1 text-muted-foreground text-xs tabular-nums'>
					{shortcutIndex}
				</span>
			) : null}
		</Button>
	);
}

/** Renders the scrollable provider sections for model choices. */
function ModelOptionsList({
	groups,
	onSelect,
	selectedId,
	shortcutIndexById,
}: {
	groups: readonly GroupedOptions[];
	onSelect: (modelId: string) => void;
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
							key={model.id}
							model={model}
							onSelect={() => onSelect(model.id)}
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
	options,
	value,
}: ModelPickerProps) {
	const [open, setOpen] = useState(false);
	const groups = useMemo(() => groupByProvider(options), [options]);
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

	useEffect(() => {
		if (!open) {
			return;
		}
		const handler = (event: KeyboardEvent) => {
			if (!/^[1-9]$/.test(event.key)) {
				return;
			}
			const index = Number.parseInt(event.key, 10) - 1;
			const target = orderedShortcuts[index];
			if (!target) {
				return;
			}
			event.preventDefault();
			onChange(target.id);
			setOpen(false);
		};
		document.addEventListener('keydown', handler);
		return () => document.removeEventListener('keydown', handler);
	}, [open, orderedShortcuts, onChange]);

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
			<PopoverTrigger asChild>
				<Button
					aria-label='Model'
					className='h-7 rounded-md px-1.5 text-muted-foreground hover:text-foreground'
					disabled={disabled}
					size='sm'
					type='button'
					variant='ghost'
				>
					<SparklesIcon />
					<span className='font-medium text-foreground'>
						{selected?.displayName ?? 'Select model'}
					</span>
				</Button>
			</PopoverTrigger>
			<PopoverContent align='start' className='w-80 overflow-hidden p-1.5'>
				<ScrollArea className='pr-2' style={scrollAreaStyle}>
					<ModelOptionsList
						groups={groups}
						onSelect={(modelId) => {
							onChange(modelId);
							setOpen(false);
						}}
						selectedId={selected?.id ?? null}
						shortcutIndexById={shortcutIndexById}
					/>
				</ScrollArea>
			</PopoverContent>
		</Popover>
	);
}
