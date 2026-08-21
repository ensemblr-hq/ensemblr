import type { TextContextMenuTarget } from '@/shared/ipc/contracts/text-editing';

/** Receives the payload main would have forwarded for a right-click. */
type TargetListener = (target: TextContextMenuTarget) => void;

/** Receives one line describing an edit command the menu just dispatched. */
type CallListener = (call: string) => void;

const targetListeners = new Set<TargetListener>();
const callListeners = new Set<CallListener>();

/**
 * What Chromium reports about an ordinary right-click, before a variant layers
 * a spellchecker verdict or a restricted clipboard on top of it.
 */
const BASE_TARGET: TextContextMenuTarget = {
	canCopy: true,
	canCut: true,
	canPaste: true,
	canRedo: true,
	canSelectAll: true,
	canUndo: true,
	dictionarySuggestions: [],
	isEditable: false,
	misspelledWord: '',
	selectionText: '',
	x: 0,
	y: 0,
};

/** One right-click the scene can stage, named by what makes it interesting. */
export interface TextContextMenuVariant {
	readonly label: string;
	readonly note: string;
	readonly overrides: Partial<TextContextMenuTarget>;
}

/**
 * The right-clicks worth looking at: the plain one, the spellchecker's two
 * verdicts, the overlong correction that decides whether a row truncates or
 * wraps, and the empty clipboard that greys half the menu out.
 */
export const TEXT_CONTEXT_MENU_VARIANTS: readonly TextContextMenuVariant[] = [
	{
		label: 'plain',
		note: 'Nothing flagged, everything permitted.',
		overrides: {},
	},
	{
		label: 'misspelling',
		note: 'Chromium flagged the word and offered corrections, which head the menu.',
		overrides: {
			dictionarySuggestions: ['receive', 'relieve', 'reprieve'],
			misspelledWord: 'recieve',
			selectionText: 'recieve',
		},
	},
	{
		label: 'no corrections',
		note: 'Flagged with nothing to offer — the dead row keeps the dictionary reachable.',
		overrides: {
			misspelledWord: 'ensemblr',
			selectionText: 'ensemblr',
		},
	},
	{
		label: 'long corrections',
		note: 'Six corrections, one far past the menu width: the cap and the truncation together.',
		overrides: {
			dictionarySuggestions: [
				'electroencephalographically',
				'compartmentalisation',
				'internationalization',
				'counterproductive',
				'irreproducible',
				'incontestable',
			],
			misspelledWord: 'electroencephalographicaly',
			selectionText: 'electroencephalographicaly',
		},
	},
	{
		label: 'empty clipboard',
		note: 'Nothing selected and nothing to paste, so only the always-on rows stay live.',
		overrides: {
			canCopy: false,
			canCut: false,
			canPaste: false,
		},
	},
];

/**
 * Builds the payload the main process would have forwarded, from the variant
 * under review plus what the click itself carried.
 * @param variant - The staged right-click being previewed.
 * @param click - Where the click landed and whether it landed on a field.
 * @returns The target payload to hand the menu.
 */
export function fixtureTextContextMenuTarget(
	variant: TextContextMenuVariant,
	click: { isEditable: boolean; selectionText: string; x: number; y: number },
): TextContextMenuTarget {
	return {
		...BASE_TARGET,
		selectionText: click.selectionText,
		...variant.overrides,
		isEditable: click.isEditable,
		x: click.x,
		y: click.y,
	};
}

/**
 * Stands in for the preload subscription the menu opens itself from. Registered
 * on the playground bridge, so the shipped component subscribes exactly as it
 * does in the app.
 * @param listener - The menu's own handler, typed loosely by the bridge.
 * @returns The unsubscribe the component stores as its effect cleanup.
 */
export function registerFixtureTextContextMenu(listener: unknown): () => void {
	if (typeof listener !== 'function') {
		return () => undefined;
	}

	const notify = listener as TargetListener;
	targetListeners.add(notify);

	return () => {
		targetListeners.delete(notify);
	};
}

/**
 * Delivers a staged right-click to every mounted menu, the way main's
 * `context-menu` forwarding does.
 * @param target - The payload the menu should open against.
 */
export function emitFixtureTextContextMenu(
	target: TextContextMenuTarget,
): void {
	for (const listener of targetListeners) {
		listener(target);
	}
}

/**
 * Subscribes to the edit commands the menu dispatches. The playground has no
 * main process to run them, so the scene reports them instead of pretending the
 * field changed.
 * @param listener - Called with a readable line per dispatched command.
 * @returns The unsubscribe for the caller's effect cleanup.
 */
export function subscribeToFixtureTextEditCalls(
	listener: CallListener,
): () => void {
	callListeners.add(listener);

	return () => {
		callListeners.delete(listener);
	};
}

/**
 * Reports one dispatched command to the scene.
 * @param call - The line describing what the menu asked main to do.
 */
function reportCall(call: string): void {
	for (const listener of callListeners) {
		listener(call);
	}
}

/**
 * Stands in for `runTextEditCommand`, reporting the command rather than running
 * it — the browser has no main process to route it through.
 * @param payload - The command name, typed loosely by the bridge.
 */
export function recordFixtureTextEditCommand(payload: unknown): void {
	reportCall(`runTextEditCommand('${String(payload)}')`);
}

/**
 * Stands in for `replaceMisspelling`, reporting the correction the user picked.
 * @param payload - The replacement request, typed loosely by the bridge.
 */
export function recordFixtureMisspellingReplacement(payload: unknown): void {
	const replacement =
		typeof payload === 'object' && payload !== null && 'replacement' in payload
			? String(payload.replacement)
			: '';
	reportCall(`replaceMisspelling('${replacement}')`);
}

/**
 * Stands in for `addWordToDictionary`, reporting the word the user taught the
 * spellchecker.
 * @param payload - The dictionary request, typed loosely by the bridge.
 */
export function recordFixtureDictionaryWord(payload: unknown): void {
	const word =
		typeof payload === 'object' && payload !== null && 'word' in payload
			? String(payload.word)
			: '';
	reportCall(`addWordToDictionary('${word}')`);
}
