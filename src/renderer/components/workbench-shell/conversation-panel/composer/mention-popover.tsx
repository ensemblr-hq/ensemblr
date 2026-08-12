import type { TFunction } from 'i18next';
import type { CSSProperties, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
	Popover,
	PopoverAnchor,
	PopoverContent,
} from '@/renderer/components/ui/popover';
import { ScrollArea } from '@/renderer/components/ui/scroll-area';
import { Skeleton } from '@/renderer/components/ui/skeleton';
import { WorkspaceFileIcon } from '@/renderer/components/workbench-shell/review-files/workspace-file-icon';
import type {
	AutocompleteKind,
	MentionMatch,
	SlashCommandMatch,
	WorkspaceFileSummary,
} from '@/renderer/types/workbench';
import { getAutocompleteHeight } from './autocomplete-height';
import { AutocompleteRow } from './autocomplete-list';
import { MatchHighlight } from './match-highlight';

const LOADING_PLACEHOLDER_ROWS = 5;

/** Props for the textarea-anchored @ and / autocomplete popover. */
interface ComposerAutocompletePopoverProps {
	activeIndex: number;
	children: ReactNode;
	kind: AutocompleteKind;
	mentionMatches: readonly MentionMatch[];
	onHover: (index: number) => void;
	onMentionSelect: (entry: WorkspaceFileSummary) => void;
	onOpenChange: (open: boolean) => void;
	onSlashSelect: (command: string, autoSubmit: boolean) => void;
	/** True while the runtime is still being asked for its command catalogue. */
	slashLoading: boolean;
	slashMatches: readonly SlashCommandMatch[];
}

/** Formats slash command description text without redundant source prefixes. */
function formatSlashCommandSecondary(match: SlashCommandMatch): ReactNode {
	if (!match.item.description) {
		return undefined;
	}
	return <span className='truncate'>{match.item.description}</span>;
}

/** Wraps autocomplete options in shadcn's native scroll area and scrollbar. */
function AutocompleteScrollArea({
	children,
	rowCount,
}: {
	children: ReactNode;
	rowCount: number;
}): ReactNode {
	const style: CSSProperties = { height: getAutocompleteHeight(rowCount) };

	return (
		<ScrollArea className='-mr-1.5 pr-1.5' style={style}>
			{children}
		</ScrollArea>
	);
}

/**
 * Renders placeholder rows while a runtime that has never been asked before
 * resolves its catalogue, so the menu keeps the height and rhythm of the list it
 * is about to become instead of collapsing to a line of text.
 */
function AutocompletePlaceholderRows(): ReactNode {
	return Array.from({ length: LOADING_PLACEHOLDER_ROWS }, (_, index) => (
		<div className='flex h-9 items-center gap-2 px-2' key={index}>
			<Skeleton className='h-3 w-40' />
			<Skeleton className='h-3 w-24' />
		</div>
	));
}

/** Renders workspace file autocomplete rows. */
function renderMentionRows({
	activeIndex,
	matches,
	onHover,
	onSelect,
	t,
}: {
	activeIndex: number;
	matches: readonly MentionMatch[];
	onHover: (index: number) => void;
	onSelect: (entry: WorkspaceFileSummary) => void;
	t: TFunction;
}): ReactNode {
	if (matches.length === 0) {
		return (
			<div className='px-2 py-1.5 text-muted-foreground text-xs'>
				{t('workbench:autocomplete.no-files', 'No matching files')}
			</div>
		);
	}

	return matches.map((match, index) => (
		<AutocompleteRow
			active={index === activeIndex}
			icon={<WorkspaceFileIcon file={match.entry} />}
			key={match.entry.id}
			onHover={() => onHover(index)}
			onSelect={() => onSelect(match.entry)}
			primary={
				<MatchHighlight ranges={match.nameRanges} text={match.entry.name} />
			}
			secondary={
				match.entry.path === match.entry.name ? undefined : (
					<MatchHighlight ranges={match.pathRanges} text={match.entry.path} />
				)
			}
		/>
	));
}

/** Renders slash command autocomplete rows. */
function renderSlashRows({
	activeIndex,
	loading,
	matches,
	onHover,
	onSelect,
	t,
}: {
	activeIndex: number;
	loading: boolean;
	matches: readonly SlashCommandMatch[];
	onHover: (index: number) => void;
	onSelect: (command: string, autoSubmit: boolean) => void;
	t: TFunction;
}): ReactNode {
	// Guarded on an empty list, not on `loading` alone: once the cache seeds the
	// menu, every background revalidate is a fetch with rows already on screen,
	// and a loading affordance there would flash on each one.
	if (matches.length === 0) {
		return loading ? (
			<AutocompletePlaceholderRows />
		) : (
			<div className='px-2 py-1.5 text-muted-foreground text-xs'>
				{t('workbench:autocomplete.no-commands', 'No matching commands')}
			</div>
		);
	}

	return matches.map((match, index) => (
		<AutocompleteRow
			active={index === activeIndex}
			key={match.item.command}
			onHover={() => onHover(index)}
			onSelect={() => onSelect(match.item.command, match.item.autoSubmit)}
			primary={
				<span>
					<span className='text-muted-foreground'>/</span>
					<MatchHighlight ranges={match.ranges} text={match.item.command} />
				</span>
			}
			secondary={formatSlashCommandSecondary(match)}
		/>
	));
}

/**
 * Counts the rows the popover should size itself for, so placeholder rows do not
 * make it jump when the real list arrives.
 * @param kind - Which autocomplete is open.
 * @param mentionCount - How many mention rows there are.
 * @param slashCount - How many slash rows there are.
 * @param slashLoading - Whether the slash catalogue is still resolving.
 * @returns The row count to size the list by.
 */
function getRowCount(
	kind: AutocompleteKind,
	mentionCount: number,
	slashCount: number,
	slashLoading: boolean,
): number {
	if (kind === 'mention') {
		return mentionCount;
	}
	if (slashCount === 0 && slashLoading) {
		return LOADING_PLACEHOLDER_ROWS;
	}
	return slashCount;
}

/** Stable textarea-anchored popover that renders @ files or / commands. */
export function ComposerAutocompletePopover({
	activeIndex,
	children,
	kind,
	mentionMatches,
	onHover,
	onMentionSelect,
	onOpenChange,
	onSlashSelect,
	slashLoading,
	slashMatches,
}: ComposerAutocompletePopoverProps) {
	const { t } = useTranslation();
	const open = kind === 'mention' || kind === 'slash';
	const rowCount = getRowCount(
		kind,
		mentionMatches.length,
		slashMatches.length,
		slashLoading,
	);
	const rows =
		kind === 'mention'
			? renderMentionRows({
					activeIndex,
					matches: mentionMatches,
					onHover,
					onSelect: onMentionSelect,
					t,
				})
			: renderSlashRows({
					activeIndex,
					loading: slashLoading,
					matches: slashMatches,
					onHover,
					onSelect: onSlashSelect,
					t,
				});

	return (
		<Popover onOpenChange={onOpenChange} open={open}>
			<PopoverAnchor asChild>{children}</PopoverAnchor>
			<PopoverContent
				align='start'
				className='w-(--radix-popover-trigger-width) min-w-80 max-w-2xl overflow-hidden p-1.5'
				onOpenAutoFocus={(event) => event.preventDefault()}
				side='top'
				sideOffset={8}
			>
				<AutocompleteScrollArea rowCount={rowCount}>
					{rows}
				</AutocompleteScrollArea>
			</PopoverContent>
		</Popover>
	);
}
