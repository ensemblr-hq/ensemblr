import {
	$createRangeSelection,
	$getNodeByKey,
	$getRoot,
	$getSelection,
	$isElementNode,
	$isRangeSelection,
	$isTextNode,
	$setSelection,
	type LexicalNode,
} from 'lexical';

import type {
	ComposerAttachment,
	ComposerDraftSegment,
} from '@/renderer/types/workbench';

import { $isAttachmentNode, type AttachmentNode } from './attachment-node';

/** What separates two top-level blocks in the linearized draft. */
const BLOCK_SEPARATOR = '\n';

/** One leaf node's span in the linearized draft. */
interface DraftSegment {
	length: number;
	node: LexicalNode;
	start: number;
}

/** The draft as the autocomplete engine and the send pipeline read it. */
export interface LinearizedDraft {
	/** The chips out of {@link segments}, for consumers that need only the list. */
	attachments: readonly ComposerAttachment[];
	/** Caret position as an offset into `text`. */
	caret: number;
	/** Text runs and chips interleaved, in the order they sit in the document. */
	segments: readonly ComposerDraftSegment[];
	/** Plain text of the draft, with each chip standing in as one space. */
	text: string;
}

/** Running state of a linearization walk. */
interface DraftAccumulator {
	segments: DraftSegment[];
	text: string;
}

/**
 * Walks one node and its descendants, appending each leaf's text and recording
 * where in the linearized draft it landed.
 * @param node - The node to walk
 * @param accumulator - The walk's running text and segment list
 */
function $appendNode(node: LexicalNode, accumulator: DraftAccumulator): void {
	if ($isElementNode(node)) {
		for (const child of node.getChildren()) {
			$appendNode(child, accumulator);
		}
		return;
	}
	const content = node.getTextContent();
	accumulator.segments.push({
		length: content.length,
		node,
		start: accumulator.text.length,
	});
	accumulator.text += content;
}

/**
 * Flattens the document into text plus the segment map that turns an offset
 * back into a node.
 * @returns The linearized text and its segments
 */
function $collect(): DraftAccumulator {
	const accumulator: DraftAccumulator = { segments: [], text: '' };
	const blocks = $getRoot().getChildren();
	for (const [index, block] of blocks.entries()) {
		if (index > 0) {
			accumulator.text += BLOCK_SEPARATOR;
		}
		$appendNode(block, accumulator);
	}
	return accumulator;
}

/**
 * Resolves an element-anchored selection point, which addresses a child index
 * rather than a character offset.
 * @param segments - The walk's segment map
 * @param key - Key of the element the point sits in
 * @param childIndex - Index of the child the point sits before
 * @returns The offset into the linearized draft, or null when unresolvable
 */
function $elementPointOffset(
	segments: readonly DraftSegment[],
	key: string,
	childIndex: number,
): number | null {
	const element = $getNodeByKey(key);
	if (!$isElementNode(element)) {
		return null;
	}
	const children = element.getChildren();
	const target = children[childIndex];
	if (target) {
		return (
			segments.find((segment) => segment.node.getKey() === target.getKey())
				?.start ?? null
		);
	}
	const last = children.at(-1);
	const lastSegment = last
		? segments.find((segment) => segment.node.getKey() === last.getKey())
		: undefined;
	return lastSegment ? lastSegment.start + lastSegment.length : null;
}

/**
 * Locates the caret in the linearized draft.
 * @param accumulator - The walk's text and segment map
 * @returns The caret offset, falling back to the end of the draft
 */
function $caretOffset(accumulator: DraftAccumulator): number {
	const selection = $getSelection();
	if (!$isRangeSelection(selection)) {
		return accumulator.text.length;
	}
	const point = selection.focus;
	if (point.type === 'element') {
		return (
			$elementPointOffset(accumulator.segments, point.key, point.offset) ??
			accumulator.text.length
		);
	}
	const segment = accumulator.segments.find(
		(entry) => entry.node.getKey() === point.key,
	);
	return segment ? segment.start + point.offset : accumulator.text.length;
}

/**
 * Splits the linearized text at each chip, so the draft reads back as the text
 * runs and chips the user interleaved rather than as a flat string plus a list.
 * The chip's own stand-in space is dropped: it exists to keep offsets
 * addressable, not to be sent.
 * @param accumulator - The walk's text and segment map
 * @returns The draft's runs and chips, in document order
 */
function $draftSegments(
	accumulator: DraftAccumulator,
): readonly ComposerDraftSegment[] {
	const segments: ComposerDraftSegment[] = [];
	let cursor = 0;
	const pushText = (text: string) => {
		if (text.length > 0) {
			segments.push({ kind: 'text', text });
		}
	};
	for (const entry of accumulator.segments) {
		if (!$isAttachmentNode(entry.node)) {
			continue;
		}
		pushText(accumulator.text.slice(cursor, entry.start));
		segments.push({
			attachment: entry.node.getAttachment(),
			kind: 'attachment',
		});
		cursor = entry.start + entry.length;
	}
	pushText(accumulator.text.slice(cursor));
	return segments;
}

/**
 * Reads the whole draft the way the rest of the composer expects it: plain
 * text, the runs and chips in document order, and the caret as an offset into
 * that text. Must run inside an editor read or update.
 * @returns The linearized draft
 */
export function $linearizeDraft(): LinearizedDraft {
	const accumulator = $collect();
	const segments = $draftSegments(accumulator);
	return {
		attachments: segments.flatMap((segment) =>
			segment.kind === 'attachment' ? [segment.attachment] : [],
		),
		caret: $caretOffset(accumulator),
		segments,
		text: accumulator.text,
	};
}

/**
 * Finds the chip carrying a given attachment, so a remove can target it without
 * the caller knowing anything about node keys. Must run inside an editor read
 * or update.
 * @param id - Attachment id to look for
 * @returns The chip node, or null when the draft no longer holds it
 */
export function $findAttachmentNode(id: string): AttachmentNode | null {
	for (const segment of $collect().segments) {
		if (
			$isAttachmentNode(segment.node) &&
			segment.node.getAttachment().id === id
		) {
			return segment.node;
		}
	}
	return null;
}

/**
 * The text node a range's opening offset resolves to: the one covering it, or
 * the next one along when a chip covers it instead.
 * @param textSegments - Every text run in the draft, in document order
 * @param covering - The text runs spanning the offset, which may be none
 * @param offset - Offset into the linearized draft
 * @returns The text run to anchor in, or undefined when none lies after it
 */
function anchorTextSegment(
	textSegments: readonly DraftSegment[],
	covering: readonly DraftSegment[],
	offset: number,
): DraftSegment | undefined {
	return (
		covering.find((segment) => offset < segment.start + segment.length) ??
		covering.at(-1) ??
		textSegments.find((segment) => segment.start > offset)
	);
}

/**
 * The text node a range's closing offset resolves to: the one covering it, or
 * the previous one when a chip covers it instead.
 * @param textSegments - Every text run in the draft, in document order
 * @param covering - The text runs spanning the offset, which may be none
 * @param offset - Offset into the linearized draft
 * @returns The text run to focus in, or undefined when none lies before it
 */
function focusTextSegment(
	textSegments: readonly DraftSegment[],
	covering: readonly DraftSegment[],
	offset: number,
): DraftSegment | undefined {
	return (
		covering.find((segment) => offset > segment.start) ??
		covering[0] ??
		textSegments.filter((segment) => segment.start < offset).at(-1)
	);
}

/**
 * Finds the text node and inner offset a linearized offset points at, snapping
 * to the nearest text run when a chip covers the offset instead. A chip stands
 * in the draft as one space, so a token detected against that text can have a
 * boundary land on a chip — a mention typed flush against one is the common
 * case — and that boundary belongs to the text beside it rather than nowhere.
 * @param segments - The walk's segment map
 * @param offset - Offset into the linearized draft
 * @param preferStart - Whether a boundary belongs to the node starting there
 * @returns The node key and inner offset, or null when the draft holds no text
 */
function findTextPoint(
	segments: readonly DraftSegment[],
	offset: number,
	preferStart: boolean,
): { key: string; offset: number } | null {
	const textSegments = segments.filter((segment) => $isTextNode(segment.node));
	const covering = textSegments.filter(
		(segment) =>
			offset >= segment.start && offset <= segment.start + segment.length,
	);
	const chosen = preferStart
		? anchorTextSegment(textSegments, covering, offset)
		: focusTextSegment(textSegments, covering, offset);
	if (!chosen) {
		return null;
	}
	const clamped = Math.min(
		Math.max(offset, chosen.start),
		chosen.start + chosen.length,
	);
	return { key: chosen.node.getKey(), offset: clamped - chosen.start };
}

/**
 * Selects a span of the linearized draft so a pick can replace exactly the
 * token the user typed. Must run inside an editor update.
 * @param start - Offset the span starts at
 * @param end - Offset the span ends at
 * @returns True when the span resolved and is now selected
 */
export function $selectDraftRange(start: number, end: number): boolean {
	const { segments } = $collect();
	const anchor = findTextPoint(segments, start, true);
	const focus = findTextPoint(segments, end, false);
	if (!anchor || !focus) {
		return false;
	}
	const selection = $createRangeSelection();
	selection.anchor.set(anchor.key, anchor.offset, 'text');
	selection.focus.set(focus.key, focus.offset, 'text');
	$setSelection(selection);
	return true;
}
