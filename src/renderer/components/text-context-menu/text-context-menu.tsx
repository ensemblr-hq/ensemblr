import {
	BookPlusIcon,
	ClipboardIcon,
	CopyIcon,
	Redo2Icon,
	ScissorsIcon,
	TextSelectIcon,
	Undo2Icon,
} from 'lucide-react';
import type { ComponentType, ReactNode } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuShortcut,
	DropdownMenuTrigger,
} from '@/renderer/components/ui/dropdown-menu';
import { cn } from '@/renderer/lib/utils';
import type { TextContextMenuTarget } from '@/shared/ipc/contracts/text-editing';
import type { TextEditCommand } from '@/shared/text-edit-commands';

import {
	addWordToDictionary,
	copyText,
	findEditableIn,
	replaceMisspelling,
	runTextEditCommand,
	selectContentsOf,
} from './text-edit-actions';

/** How many of Chromium's corrections the menu offers before truncating. */
const MAX_SUGGESTIONS = 5;

/** One row of the text menu. */
interface MenuActionProps {
	disabled?: boolean;
	/** Renders the label heavier, which is how a spelling correction reads. */
	emphasized?: boolean;
	/** Omitted by the spelling rows, whose gutter stays empty but reserved. */
	icon?: ComponentType<{ className?: string }>;
	label: string;
	onSelect?: () => void;
	shortcut?: string;
}

/**
 * A single command row, keeping the icon, label, and shortcut layout in one
 * place rather than repeated per command. A row without an icon still reserves
 * the gutter, so every label in the menu shares one left edge.
 */
function MenuAction({
	disabled = false,
	emphasized = false,
	icon: Icon,
	label,
	onSelect,
	shortcut,
}: MenuActionProps) {
	return (
		<DropdownMenuItem disabled={disabled} onSelect={onSelect}>
			{Icon ? (
				<Icon className='text-muted-foreground' />
			) : (
				<span aria-hidden className='size-4 shrink-0' />
			)}
			<span
				className={cn('min-w-0 flex-1 truncate', emphasized && 'font-medium')}
			>
				{label}
			</span>
			{shortcut ? (
				<DropdownMenuShortcut className='tracking-normal'>
					{shortcut}
				</DropdownMenuShortcut>
			) : null}
		</DropdownMenuItem>
	);
}

/**
 * Right-click menu carrying the clipboard, history, and spellcheck operations
 * for the chat surfaces, in the app's own chrome rather than the system one.
 *
 * It opens from the main process rather than from a DOM `contextmenu` handler.
 * Chromium reports the spellchecker's verdict and the edit flags only through
 * the `context-menu` event it raises at the browser layer, and only while the
 * page leaves that DOM event uncancelled — so a renderer that calls
 * `preventDefault` to open its own menu can never learn what is misspelled.
 * Main forwards the whole payload instead, which also retires this component's
 * former guesses: `selectionText` and `isEditable` come from Chromium now.
 *
 * Several of these are mounted at once, so each ignores a click that did not
 * land inside its own subtree.
 *
 * Every command runs from `onCloseAutoFocus`, after the menu has released
 * focus, because each acts on whatever is focused or selected once it is gone.
 * Radix would hand focus back to the trigger, which is a zero-size anchor, so
 * the menu takes that over: a command refocuses the field it targets, and a
 * dismissal puts focus back where the right-click found it. A read-only surface
 * has no field to return to, so a dismissal and `Copy` restore whatever held
 * focus before the menu opened — leaving it on `document.body` would strand the
 * keyboard outside the surface that hosts the menu, and a host binding its
 * chords to its own subtree (the Concierge panel closing on ⎋) would stop
 * hearing them.
 *
 * A read-only surface runs its own `Copy` and `Select all` rather than the
 * `WebContents` ones, which need a focused field. `Copy` reads the live DOM
 * selection, never {@link TextContextMenuTarget.selectionText} — Chromium
 * truncates that. `Select all` covers this surface rather than the window, so
 * it is the one row whose behavior ⌘A would not reproduce, and the only one
 * that drops its shortcut.
 */
export function TextContextMenu({ children }: { children: ReactNode }) {
	const { t } = useTranslation();
	const scopeRef = useRef<HTMLDivElement | null>(null);
	const pendingActionRef = useRef<(() => void) | null>(null);
	const editableRef = useRef<HTMLElement | null>(null);
	const previousFocusRef = useRef<HTMLElement | null>(null);
	const [target, setTarget] = useState<TextContextMenuTarget | null>(null);

	useEffect(() => {
		return window.ensemblr?.onTextContextMenu?.((payload) => {
			const hit = document.elementFromPoint(payload.x, payload.y);
			const scope = scopeRef.current;

			if (!scope || !hit || !scope.contains(hit)) {
				return;
			}

			editableRef.current = payload.isEditable ? findEditableIn(hit) : null;
			previousFocusRef.current =
				document.activeElement instanceof HTMLElement
					? document.activeElement
					: null;
			setTarget(payload);
		});
	}, []);

	const handleOpenChange = useCallback((open: boolean) => {
		if (!open) {
			setTarget(null);
		}
	}, []);

	const handleCloseAutoFocus = useCallback((event: Event) => {
		const action = pendingActionRef.current;
		pendingActionRef.current = null;
		event.preventDefault();

		if (action) {
			action();
			return;
		}

		(editableRef.current ?? previousFocusRef.current)?.focus();
	}, []);

	const runOnField = useCallback((run: () => void) => {
		pendingActionRef.current = () => {
			const field = editableRef.current;

			if (!field) {
				return;
			}

			field.focus();
			run();
		};
	}, []);

	const runCommand = useCallback(
		(command: TextEditCommand) => {
			runOnField(() => void runTextEditCommand(command));
		},
		[runOnField],
	);

	const applySuggestion = useCallback(
		(suggestion: string) => {
			runOnField(() => void replaceMisspelling(suggestion));
		},
		[runOnField],
	);

	const learnWord = useCallback((word: string) => {
		pendingActionRef.current = () => void addWordToDictionary(word);
	}, []);

	const copySelection = useCallback(() => {
		pendingActionRef.current = () => {
			void copyText(window.getSelection()?.toString() ?? '');
			previousFocusRef.current?.focus();
		};
	}, []);

	const selectScopeContents = useCallback(() => {
		// No focus restore here: what held focus is usually a composer, and focusing
		// an editable collapses the selection this row just made.
		pendingActionRef.current = () => {
			if (scopeRef.current) {
				selectContentsOf(scopeRef.current);
			}
		};
	}, []);

	const isEditable = target?.isEditable ?? false;
	const misspelledWord = target?.misspelledWord ?? '';
	const suggestions = (target?.dictionarySuggestions ?? []).slice(
		0,
		MAX_SUGGESTIONS,
	);

	return (
		<>
			<div className='contents' ref={scopeRef}>
				{children}
			</div>
			<DropdownMenu onOpenChange={handleOpenChange} open={target !== null}>
				<DropdownMenuTrigger asChild>
					<span
						className='pointer-events-none fixed size-0'
						style={{ left: target?.x ?? 0, top: target?.y ?? 0 }}
					/>
				</DropdownMenuTrigger>
				<DropdownMenuContent
					align='start'
					className='w-auto min-w-52 max-w-80'
					collisionPadding={8}
					onCloseAutoFocus={handleCloseAutoFocus}
					side='bottom'
					sideOffset={0}
				>
					{misspelledWord ? (
						<>
							{suggestions.map((suggestion) => (
								<MenuAction
									emphasized
									key={suggestion}
									label={suggestion}
									onSelect={() => applySuggestion(suggestion)}
								/>
							))}
							{suggestions.length === 0 ? (
								<MenuAction
									disabled
									label={t('common:actions.no-suggestions', 'No suggestions')}
								/>
							) : null}
							<DropdownMenuSeparator />
							<MenuAction
								icon={BookPlusIcon}
								label={t(
									'common:actions.add-to-dictionary',
									'Add to dictionary',
								)}
								onSelect={() => learnWord(misspelledWord)}
							/>
							<DropdownMenuSeparator />
						</>
					) : null}
					{isEditable ? (
						<>
							{/* Undo and redo stay enabled: the composer's editor keeps its own
							    history, so Chromium reports canUndo false even with edits to
							    undo, and the command still reaches the editor. */}
							<MenuAction
								icon={Undo2Icon}
								label={t('common:actions.undo', 'Undo')}
								onSelect={() => runCommand('undo')}
								shortcut='⌘Z'
							/>
							<MenuAction
								icon={Redo2Icon}
								label={t('common:actions.redo', 'Redo')}
								onSelect={() => runCommand('redo')}
								shortcut='⇧⌘Z'
							/>
							<DropdownMenuSeparator />
							<MenuAction
								disabled={!target?.canCut}
								icon={ScissorsIcon}
								label={t('common:actions.cut', 'Cut')}
								onSelect={() => runCommand('cut')}
								shortcut='⌘X'
							/>
						</>
					) : null}
					<MenuAction
						disabled={!target?.canCopy}
						icon={CopyIcon}
						label={t('common:actions.copy', 'Copy')}
						onSelect={() => (isEditable ? runCommand('copy') : copySelection())}
						shortcut='⌘C'
					/>
					{isEditable ? (
						<MenuAction
							disabled={!target?.canPaste}
							icon={ClipboardIcon}
							label={t('common:actions.paste', 'Paste')}
							onSelect={() => runCommand('paste')}
							shortcut='⌘V'
						/>
					) : null}
					<DropdownMenuSeparator />
					<MenuAction
						disabled={isEditable && !target?.canSelectAll}
						icon={TextSelectIcon}
						label={t('common:actions.select-all', 'Select all')}
						onSelect={() =>
							isEditable ? runCommand('selectAll') : selectScopeContents()
						}
						shortcut={isEditable ? '⌘A' : undefined}
					/>
				</DropdownMenuContent>
			</DropdownMenu>
		</>
	);
}
