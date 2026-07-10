import type { CSSProperties, ReactNode } from 'react';
import {
	Popover,
	PopoverAnchor,
	PopoverContent,
} from '@/renderer/components/ui/popover';
import { ScrollArea } from '@/renderer/components/ui/scroll-area';
import { WorkspaceFileIcon } from '@/renderer/components/workbench-shell/review-files/workspace-file-icon';
import type {
	AutocompleteKind,
	SlashCommandDescriptor,
	WorkspaceFileSummary,
} from '@/renderer/types/workbench';
import { AutocompleteRow } from './autocomplete-list';

const MAX_AUTOCOMPLETE_HEIGHT_REM = 24;
const AUTOCOMPLETE_ROW_HEIGHT_REM = 2.25;
const AUTOCOMPLETE_VERTICAL_PADDING_REM = 0.5;

/** Props for the textarea-anchored @ and / autocomplete popover. */
interface ComposerAutocompletePopoverProps {
	activeIndex: number;
	children: ReactNode;
	kind: AutocompleteKind;
	mentionMatches: readonly WorkspaceFileSummary[];
	onHover: (index: number) => void;
	onMentionSelect: (entry: WorkspaceFileSummary) => void;
	onOpenChange: (open: boolean) => void;
	onSlashSelect: (command: string, autoSubmit: boolean) => void;
	slashMatches: readonly SlashCommandDescriptor[];
}

/** Formats slash command description text without redundant source prefixes. */
function formatSlashCommandSecondary(match: SlashCommandDescriptor): ReactNode {
	if (!match.description) {
		return undefined;
	}
	return <span className='truncate'>{match.description}</span>;
}

/** Estimates popover list height so Radix ScrollArea owns overflow correctly. */
function getAutocompleteHeight(rowCount: number): string {
	const visibleRows = Math.max(1, rowCount);
	const estimatedHeightRem =
		AUTOCOMPLETE_VERTICAL_PADDING_REM +
		visibleRows * AUTOCOMPLETE_ROW_HEIGHT_REM;

	return `min(${estimatedHeightRem}rem, min(${MAX_AUTOCOMPLETE_HEIGHT_REM}rem, var(--radix-popover-content-available-height, ${MAX_AUTOCOMPLETE_HEIGHT_REM}rem)))`;
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
		<ScrollArea className='pr-2' style={style}>
			<div className='p-1'>{children}</div>
		</ScrollArea>
	);
}

/** Renders workspace file autocomplete rows. */
function renderMentionRows({
	activeIndex,
	matches,
	onHover,
	onSelect,
}: {
	activeIndex: number;
	matches: readonly WorkspaceFileSummary[];
	onHover: (index: number) => void;
	onSelect: (entry: WorkspaceFileSummary) => void;
}): ReactNode {
	if (matches.length === 0) {
		return (
			<div className='px-2 py-1.5 text-muted-foreground text-xs'>
				No matching files
			</div>
		);
	}

	return matches.map((match, index) => (
		<AutocompleteRow
			active={index === activeIndex}
			icon={<WorkspaceFileIcon file={match} />}
			key={match.id}
			keyId={match.id}
			onMouseEnter={() => onHover(index)}
			onSelect={() => onSelect(match)}
			primary={match.name}
			secondary={match.path === match.name ? undefined : match.path}
		/>
	));
}

/** Renders slash command autocomplete rows. */
function renderSlashRows({
	activeIndex,
	matches,
	onHover,
	onSelect,
}: {
	activeIndex: number;
	matches: readonly SlashCommandDescriptor[];
	onHover: (index: number) => void;
	onSelect: (command: string, autoSubmit: boolean) => void;
}): ReactNode {
	if (matches.length === 0) {
		return (
			<div className='px-2 py-1.5 text-muted-foreground text-xs'>
				No matching commands
			</div>
		);
	}

	return matches.map((match, index) => (
		<AutocompleteRow
			active={index === activeIndex}
			key={match.command}
			keyId={match.command}
			onMouseEnter={() => onHover(index)}
			onSelect={() => onSelect(match.command, match.autoSubmit)}
			primary={
				<span>
					<span className='text-muted-foreground'>/</span>
					<span>{match.command}</span>
				</span>
			}
			secondary={formatSlashCommandSecondary(match)}
		/>
	));
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
	slashMatches,
}: ComposerAutocompletePopoverProps) {
	const open = kind === 'mention' || kind === 'slash';
	const rowCount =
		kind === 'mention' ? mentionMatches.length : slashMatches.length;
	const rows =
		kind === 'mention'
			? renderMentionRows({
					activeIndex,
					matches: mentionMatches,
					onHover,
					onSelect: onMentionSelect,
				})
			: renderSlashRows({
					activeIndex,
					matches: slashMatches,
					onHover,
					onSelect: onSlashSelect,
				});

	return (
		<Popover onOpenChange={onOpenChange} open={open}>
			<PopoverAnchor asChild>{children}</PopoverAnchor>
			<PopoverContent
				align='start'
				className='w-(--radix-popover-trigger-width) min-w-80 max-w-2xl overflow-hidden p-0'
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
