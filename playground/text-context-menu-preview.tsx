import type { MouseEvent, ReactNode } from 'react';
import { useCallback, useEffect, useState } from 'react';

import { TextContextMenu } from '@/renderer/components/text-context-menu';
import { findEditableIn } from '@/renderer/components/text-context-menu/text-edit-actions';

import {
	ControlGroup,
	SceneControls,
	SceneSection,
	SceneToggle,
} from './scene-chrome.tsx';
import {
	emitFixtureTextContextMenu,
	fixtureTextContextMenuTarget,
	subscribeToFixtureTextEditCalls,
	TEXT_CONTEXT_MENU_VARIANTS,
	type TextContextMenuVariant,
} from './text-context-menu-fixtures.ts';

/**
 * The right-click menu the chat surfaces draw themselves, opened from a staged
 * payload rather than from a real `context-menu` event.
 *
 * In the app the menu never sees the DOM event: Chromium reports the
 * spellchecker's verdict and the edit flags only at the browser layer, and only
 * while the page leaves that event uncancelled, so main forwards the whole
 * payload and the renderer draws from it. A browser tab has no main process, so
 * the scene cancels the event, reads the click's own coordinates and selection,
 * layers the variant's verdict on top, and hands the result to the same
 * subscription preload would have delivered it on.
 *
 * Both surfaces mount their own menu, because that is what the app does — the
 * timeline wraps one and the composer another — and the scope check that keeps
 * a click from opening both is only visible with two of them on screen.
 */
export function TextContextMenuScene() {
	const [variant, setVariant] = useState(TEXT_CONTEXT_MENU_VARIANTS[0]);
	const [lastCall, setLastCall] = useState<string | null>(null);

	useEffect(() => subscribeToFixtureTextEditCalls(setLastCall), []);

	const stageRightClick = useCallback(
		(event: MouseEvent<HTMLElement>) => {
			event.preventDefault();
			emitFixtureTextContextMenu(
				fixtureTextContextMenuTarget(variant, {
					isEditable:
						findEditableIn(
							document.elementFromPoint(event.clientX, event.clientY),
						) !== null,
					selectionText: window.getSelection()?.toString() ?? '',
					x: event.clientX,
					y: event.clientY,
				}),
			);
		},
		[variant],
	);

	return (
		<div className='flex flex-col gap-8'>
			<VariantControls onSelect={setVariant} selected={variant} />

			<SceneSection
				label='Read-only surface'
				note={`Right-click the prose. Select a phrase first and Copy takes the selection main reported rather than a clipboard command; Select all scopes the range to this surface instead of the window. ${variant.note}`}
			>
				<TextContextMenu>
					{/* biome-ignore lint/a11y/noStaticElementInteractions: stands in for main's forwarded context-menu event, which has no DOM equivalent */}
					<div
						className='max-w-2xl rounded-md border border-border p-4 text-sm leading-relaxed'
						onContextMenu={stageRightClick}
					>
						<p>
							The menu opens from the main process rather than from a DOM
							handler, because a page that cancels its own context-menu event
							can never learn what the spellchecker flagged. Main forwards
							Chromium&rsquo;s whole verdict instead — what is misspelled, what
							is selected, and which clipboard commands are live.
						</p>
					</div>
				</TextContextMenu>
			</SceneSection>

			<SceneSection
				label='Editable surface'
				note='The composer stand-in. An editable target adds undo, redo, cut and paste, and the commands run against the field once the menu has released focus.'
			>
				<TextContextMenu>
					{/* biome-ignore lint/a11y/noStaticElementInteractions: stands in for main's forwarded context-menu event, which has no DOM equivalent */}
					<div className='max-w-2xl' onContextMenu={stageRightClick}>
						{/* biome-ignore lint/a11y/useSemanticElements: stands in for the composer's Lexical surface, which is a contenteditable */}
						<div
							aria-label='Composer draft'
							className='min-h-24 rounded-md border border-border bg-background p-4 text-sm leading-relaxed outline-hidden focus-visible:ring-2 focus-visible:ring-ring'
							contentEditable
							role='textbox'
							suppressContentEditableWarning
							tabIndex={0}
						>
							I recieve the same suggestion every time I write this word.
						</div>
					</div>
				</TextContextMenu>
			</SceneSection>

			<SceneSection
				label='Dispatched command'
				note='What the menu asked main to run. The playground has no main process, so nothing edits the field — the call itself is the thing under review.'
			>
				<CallReadout call={lastCall} />
			</SceneSection>
		</div>
	);
}

/** Shows the last command the menu dispatched, or that none has been yet. */
function CallReadout({ call }: { call: string | null }) {
	return (
		<div className='max-w-2xl rounded-md border border-border px-3 py-2 font-mono text-xs'>
			{call ?? (
				<span className='text-muted-foreground'>
					No command yet — pick a row.
				</span>
			)}
		</div>
	);
}

/** Picks which right-click both surfaces stage. */
function VariantControls({
	onSelect,
	selected,
}: {
	onSelect: (variant: TextContextMenuVariant) => void;
	selected: TextContextMenuVariant;
}): ReactNode {
	return (
		<SceneControls>
			<ControlGroup label='right-click'>
				{TEXT_CONTEXT_MENU_VARIANTS.map((entry) => (
					<SceneToggle
						isActive={entry.label === selected.label}
						key={entry.label}
						label={entry.label}
						onClick={() => onSelect(entry)}
					/>
				))}
			</ControlGroup>
		</SceneControls>
	);
}
