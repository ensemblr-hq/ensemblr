import {
	$applyNodeReplacement,
	DecoratorNode,
	type LexicalNode,
	type LexicalUpdateJSON,
	type NodeKey,
	type SerializedLexicalNode,
	type Spread,
} from 'lexical';
import type { ReactNode } from 'react';

import type { ComposerAttachment } from '@/renderer/types/workbench';

import { DecoratedAttachmentChip } from './decorated-attachment-chip';

/** Serialized form of an attachment chip, so a draft survives a tab switch. */
export type SerializedAttachmentNode = Spread<
	{ attachment: ComposerAttachment },
	SerializedLexicalNode
>;

/**
 * What a chip contributes to the linearized draft. A single space rather than
 * nothing: it keeps offsets addressable and stops an `@` token from reading
 * across a chip into the text run on the other side of it.
 */
const ATTACHMENT_TEXT_CONTENT = ' ';

/**
 * Whether a chip stands above the draft rather than in it. Only the stored-text
 * chip does: it stacks a two-line preview over its meta row, so inline it
 * inflates the line box and the sentence wraps around a block three lines tall.
 * Every other chip is a single row of label and reads as a word in the sentence.
 * @param attachment - The attachment behind the chip
 * @returns True when the chip belongs in the tray above the typed text
 */
export function isTrayChip(attachment: ComposerAttachment): boolean {
	return attachment.kind === 'pasted-text';
}

/**
 * One composer attachment in the draft, at the position the user put it.
 * Decorator rather than text so the whole chip is one unit to the caret. An
 * inline chip sits in the sentence, where arrow keys step over it and Backspace
 * deletes it whole; a {@link isTrayChip} one is a block of its own above the
 * typed text and is removed by its own control rather than by editing the
 * sentence.
 *
 * Lexical's own backward delete does not respect that boundary — from the start
 * of the first block it walks out and takes the previous sibling, which is the
 * last tray chip — so `TrayGuardPlugin` refuses every backward delete that
 * would reach across it, not just the one a bare Backspace asks for.
 */
export class AttachmentNode extends DecoratorNode<ReactNode> {
	__attachment: ComposerAttachment;

	/** Node type name registered with the editor. */
	static getType(): string {
		return 'composer-attachment';
	}

	/**
	 * Copies a node during reconciliation.
	 * @param node - The node being cloned
	 * @returns A clone carrying the same attachment and key
	 */
	static clone(node: AttachmentNode): AttachmentNode {
		return new AttachmentNode(node.__attachment, node.__key);
	}

	/**
	 * Rebuilds a chip from a persisted draft.
	 * @param serialized - The serialized node
	 * @returns The restored attachment node
	 */
	static importJSON(serialized: SerializedAttachmentNode): AttachmentNode {
		return $createAttachmentNode(serialized.attachment).updateFromJSON(
			serialized,
		);
	}

	constructor(attachment: ComposerAttachment, key?: NodeKey) {
		super(key);
		this.__attachment = attachment;
	}

	/**
	 * Serializes the chip with the attachment it carries.
	 * @returns The serialized node
	 */
	exportJSON(): SerializedAttachmentNode {
		return { ...super.exportJSON(), attachment: this.__attachment };
	}

	/**
	 * Restores the attachment payload alongside the base node fields.
	 * @param serialized - The serialized node being applied
	 * @returns This node, updated
	 */
	updateFromJSON(
		serialized: LexicalUpdateJSON<SerializedAttachmentNode>,
	): this {
		const updated = super.updateFromJSON(serialized);
		updated.__attachment = serialized.attachment;
		return updated;
	}

	/**
	 * Builds the host element the chip renders into. A one-row chip gets a host
	 * exactly one line box tall (`1.625em` is the editor's `leading-relaxed`) and
	 * top-aligned, so its centre is the line's centre and the chip reads as
	 * sitting on the text rather than riding above or below it — which is what
	 * every `vertical-align` keyword does, since the chip is taller than the
	 * text's em box.
	 *
	 * A tray chip is a root-level block, so it needs no line-box sizing at all.
	 * Its host is still `inline-flex` rather than a block: that is what lets the
	 * run of tray chips share one wrapping row above the paragraph instead of
	 * each taking a line of its own. It is top-aligned for a different reason
	 * than the one-row chip — an `inline-flex` column takes its baseline from its
	 * first flex item, so the chip's baseline lands inside its preview's opening
	 * line and the editor's own strut, which is taller above the baseline than
	 * that, would pad the row from above.
	 * @returns A span hosting the chip, sized to the line or laid out in the tray
	 */
	createDOM(): HTMLElement {
		const host = document.createElement('span');
		host.className = isTrayChip(this.__attachment)
			? 'mt-0.5 mr-1 mb-1 inline-flex max-w-full items-center align-top'
			: 'mx-0.5 inline-flex h-[1.625em] max-w-full items-center align-top';
		return host;
	}

	/** The host element never needs rebuilding; React owns what is inside it. */
	updateDOM(): false {
		return false;
	}

	/**
	 * Whether the chip sits in the sentence. A tray chip does not: it is a block
	 * above the typed text, so the caret never steps into a chip three lines tall
	 * and no sentence has to wrap around one.
	 * @returns True for every chip but a tray chip
	 */
	isInline(): boolean {
		return !isTrayChip(this.__attachment);
	}

	/**
	 * What the chip contributes to the draft's plain text.
	 * @returns A single space
	 */
	getTextContent(): string {
		return ATTACHMENT_TEXT_CONTENT;
	}

	/**
	 * Reads the attachment this chip stands for. Called through the
	 * `$isAttachmentNode` type guard in `draft-linearizer.ts`, which fallow's
	 * class-member analysis cannot follow.
	 * @returns The attachment payload
	 */
	// fallow-ignore-next-line unused-class-member
	getAttachment(): ComposerAttachment {
		return this.__attachment;
	}

	/**
	 * Renders the chip itself.
	 * @returns The chip element React mounts into the host
	 */
	decorate(): ReactNode {
		return (
			<DecoratedAttachmentChip
				attachment={this.__attachment}
				nodeKey={this.__key}
			/>
		);
	}
}

/**
 * Builds an attachment chip node.
 * @param attachment - The attachment the chip stands for
 * @returns The node, ready to insert
 */
export function $createAttachmentNode(
	attachment: ComposerAttachment,
): AttachmentNode {
	return $applyNodeReplacement(new AttachmentNode(attachment));
}

/**
 * Narrows a node to an attachment chip.
 * @param node - The node to test
 * @returns True when the node is an attachment chip
 */
export function $isAttachmentNode(
	node: LexicalNode | null | undefined,
): node is AttachmentNode {
	return node instanceof AttachmentNode;
}
