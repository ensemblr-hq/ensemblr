import { Icon } from '@iconify/react';
import type { TFunction } from 'i18next';
import { FolderGitIcon, GitBranchIcon, MessageSquareIcon } from 'lucide-react';
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
import { getWorkspaceFileIconNameForPath } from '@/renderer/lib/workbench';
import type {
	AutocompleteKind,
	ConciergeReferenceMatch,
	MentionMatch,
	SlashCommandMatch,
	WorkspaceFileSummary,
} from '@/renderer/types/workbench';
import {
	type ConciergeReference,
	conciergeReferenceId,
} from '@/shared/concierge-references';
import { getAutocompleteHeight } from './autocomplete-height';
import { AutocompleteRow } from './autocomplete-list';
import { MatchHighlight } from './match-highlight';

const LOADING_PLACEHOLDER_ROWS = 5;

/** Props for the textarea-anchored @ and / autocomplete popover. */
interface ComposerAutocompletePopoverProps {
	activeIndex: number;
	children: ReactNode;
	/** Projects, workspaces, and chats for an `entity` menu; empty otherwise. */
	entityMatches?: readonly ConciergeReferenceMatch[];
	kind: AutocompleteKind;
	mentionMatches: readonly MentionMatch[];
	onEntitySelect?: (reference: ConciergeReference) => void;
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

/** The glyph that says what an entity row stands for. */
function EntityRowIcon({ reference }: { reference: ConciergeReference }) {
	// An artifact is a document on disk, so it wears the file tree's own icon set
	// and is read by extension — a `.md` report looks like the markdown files
	// listed two rows above it rather than like a generic page.
	if (reference.kind === 'artifact') {
		return (
			<Icon
				aria-hidden='true'
				className='size-3.5 shrink-0'
				icon={getWorkspaceFileIconNameForPath(reference.path)}
			/>
		);
	}
	if (reference.kind === 'project') {
		return <FolderGitIcon aria-hidden='true' className='size-3.5' />;
	}
	if (reference.kind === 'workspace') {
		return <GitBranchIcon aria-hidden='true' className='size-3.5' />;
	}
	return <MessageSquareIcon aria-hidden='true' className='size-3.5' />;
}

/**
 * What an entity row says under its name: which project a workspace belongs to,
 * which workspace a chat lives in. Without it two same-named workspaces in
 * different projects are one row typed twice.
 * @param reference - The reference the row stands for.
 * @param t - Translator for the closed-chat marker.
 * @returns The secondary text, or undefined for a project, which owns nothing above it.
 */
function entityRowSecondary(
	reference: ConciergeReference,
	t: TFunction,
): ReactNode {
	if (reference.kind === 'project') {
		return undefined;
	}
	// The path is only worth a second line when it says something the name did
	// not — an artifact in a subfolder. A file at the top of `artifacts/` repeats
	// its own name there.
	if (reference.kind === 'artifact') {
		return reference.path === reference.label ? undefined : (
			<span className='truncate'>{reference.path}</span>
		);
	}
	if (reference.kind === 'workspace') {
		return <span className='truncate'>{reference.project}</span>;
	}
	return (
		<span className='truncate'>
			{reference.state === 'closed'
				? t('workbench:autocomplete.closed-chat-in', '{{workspace}} · closed', {
						workspace: reference.workspace,
					})
				: reference.workspace}
		</span>
	);
}

/** Renders Concierge project, workspace, and chat autocomplete rows. */
function renderEntityRows({
	activeIndex,
	matches,
	onHover,
	onSelect,
	t,
}: {
	activeIndex: number;
	matches: readonly ConciergeReferenceMatch[];
	onHover: (index: number) => void;
	onSelect: (reference: ConciergeReference) => void;
	t: TFunction;
}): ReactNode {
	if (matches.length === 0) {
		return (
			<div className='px-2 py-1.5 text-muted-foreground text-xs'>
				{t(
					'workbench:autocomplete.no-references',
					'No matching projects, workspaces, or chats',
				)}
			</div>
		);
	}

	return matches.map((match, index) => (
		<AutocompleteRow
			active={index === activeIndex}
			icon={<EntityRowIcon reference={match.reference} />}
			key={`${match.reference.kind}:${conciergeReferenceId(match.reference)}`}
			onHover={() => onHover(index)}
			onSelect={() => onSelect(match.reference)}
			primary={
				<MatchHighlight
					ranges={match.labelRanges}
					text={match.reference.label}
				/>
			}
			secondary={entityRowSecondary(match.reference, t)}
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
	if (kind === 'entity' || kind === 'mention') {
		return mentionCount;
	}
	if (slashCount === 0 && slashLoading) {
		return LOADING_PLACEHOLDER_ROWS;
	}
	return slashCount;
}

/**
 * Popover that renders @ files or / commands, anchored to the composer surface
 * it is handed. It wraps that surface in its own anchor element, so a caller may
 * pass any children without owing it a ref onto a DOM node.
 */
export function ComposerAutocompletePopover({
	activeIndex,
	children,
	entityMatches = [],
	kind,
	mentionMatches,
	onEntitySelect,
	onHover,
	onMentionSelect,
	onOpenChange,
	onSlashSelect,
	slashLoading,
	slashMatches,
}: ComposerAutocompletePopoverProps) {
	const { t } = useTranslation();
	const open = kind !== null;
	const rowCount = getRowCount(
		kind,
		kind === 'entity' ? entityMatches.length : mentionMatches.length,
		slashMatches.length,
		slashLoading,
	);
	const rows = renderRows({
		activeIndex,
		entityMatches,
		kind,
		mentionMatches,
		onEntitySelect,
		onHover,
		onMentionSelect,
		onSlashSelect,
		slashLoading,
		slashMatches,
		t,
	});

	return (
		<Popover onOpenChange={onOpenChange} open={open}>
			{/* Not `asChild`: React 19 passes ref as an ordinary prop, so a wrapper
			    that drops it leaves Radix measuring nothing and parking the menu
			    off-screen. */}
			<PopoverAnchor>{children}</PopoverAnchor>
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

/**
 * Picks the row renderer for whichever menu is open, so the popover itself stays
 * one anchored, scroll-sized shell rather than three.
 * @param input - The open kind, every match list, and the sinks a pick writes to.
 * @returns The rows to render.
 */
function renderRows({
	activeIndex,
	entityMatches,
	kind,
	mentionMatches,
	onEntitySelect,
	onHover,
	onMentionSelect,
	onSlashSelect,
	slashLoading,
	slashMatches,
	t,
}: {
	activeIndex: number;
	entityMatches: readonly ConciergeReferenceMatch[];
	kind: AutocompleteKind;
	mentionMatches: readonly MentionMatch[];
	onEntitySelect?: (reference: ConciergeReference) => void;
	onHover: (index: number) => void;
	onMentionSelect: (entry: WorkspaceFileSummary) => void;
	onSlashSelect: (command: string, autoSubmit: boolean) => void;
	slashLoading: boolean;
	slashMatches: readonly SlashCommandMatch[];
	t: TFunction;
}): ReactNode {
	if (kind === 'entity') {
		return renderEntityRows({
			activeIndex,
			matches: entityMatches,
			onHover,
			onSelect: onEntitySelect ?? noSelection,
			t,
		});
	}
	if (kind === 'mention') {
		return renderMentionRows({
			activeIndex,
			matches: mentionMatches,
			onHover,
			onSelect: onMentionSelect,
			t,
		});
	}
	return renderSlashRows({
		activeIndex,
		loading: slashLoading,
		matches: slashMatches,
		onHover,
		onSelect: onSlashSelect,
		t,
	});
}

/** Stands in for an entity sink a surface without entities never supplies. */
function noSelection(): void {
	return;
}
