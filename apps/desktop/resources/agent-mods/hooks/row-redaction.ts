/**
 * Walks the blocks of one conversation row and redacts every text in it — a
 * text block's text, a tool result's content as a string or as nested blocks —
 * handing back the very same objects wherever nothing changed, so an untouched
 * row reaches the engine exactly as it made it.
 */

/** One content block of a row, as `session.append` hands it. */
export type ContentBlock = { [field: string]: unknown; type: string };

/** Redacts one text; resolves to the same string when nothing matched. */
export type TextRedactor = (text: string) => Promise<string>;

/**
 * Longest text one `redactText` call carries. The control server refuses a body
 * over 1,000,000 bytes, and JSON escaping and multi-byte UTF-8 can grow text
 * several-fold on the wire.
 */
const CHUNK_CHARS = 150_000;

/** Shortest text worth redacting: no secret is shorter. */
const MINIMUM_CHARS = 4;

/**
 * Finds where to cut a piece: after the last line break inside the limit, else
 * after the last whitespace, so a secret, which holds neither, is never split
 * across two calls. Only a single unbroken run longer than the limit is cut
 * mid-run.
 * @param text - Text longer than the limit.
 * @returns The length of the first piece.
 */
function cutPoint(text: string): number {
	const lineBreak = text.lastIndexOf('\n', CHUNK_CHARS - 1);
	if (lineBreak > 0) {
		return lineBreak + 1;
	}
	let space = CHUNK_CHARS - 1;
	while (space > 0 && !/\s/.test(text[space] ?? '')) {
		space -= 1;
	}
	return space > 0 ? space + 1 : CHUNK_CHARS;
}

/**
 * Cuts text into pieces the op accepts.
 * @param text - The text to cut.
 * @returns The pieces, in order, joining back to the text.
 */
export function chunkText(text: string): string[] {
	if (text.length <= CHUNK_CHARS) {
		return [text];
	}
	const end = cutPoint(text);
	return [text.slice(0, end), ...chunkText(text.slice(end))];
}

/**
 * Builds the redactor a row is walked with: one known value replaced locally,
 * then the rest piece by piece through `remote`.
 * @param localValue - A value this process knows and replaces itself.
 * @param localPlaceholder - What that value becomes.
 * @param remote - Redacts one piece against every other secret.
 * @returns The text redactor.
 */
export function createTextRedactor(
	localValue: string,
	localPlaceholder: string,
	remote: TextRedactor,
): TextRedactor {
	return async (text) => {
		if (text.length < MINIMUM_CHARS) {
			return text;
		}
		const local = text.split(localValue).join(localPlaceholder);
		const pieces = await Promise.all(chunkText(local).map(remote));
		return pieces.join('');
	};
}

/**
 * Redacts a tool result's content, which is a string or a list of blocks.
 * @param content - The tool result's content.
 * @param redact - The text redactor.
 * @returns The redacted content, or `content` itself when nothing changed.
 */
async function redactToolContent(
	content: unknown,
	redact: TextRedactor,
): Promise<unknown> {
	if (typeof content === 'string') {
		return redact(content);
	}
	return Array.isArray(content) ? redactBlocks(content, redact) : content;
}

/**
 * Redacts the text one block carries. Every other block (images, thinking, tool
 * calls) passes untouched, since the engine puts those back as made.
 * @param block - One content block.
 * @param redact - The text redactor.
 * @returns The redacted block, or `block` itself when nothing changed.
 */
async function redactBlock(
	block: ContentBlock,
	redact: TextRedactor,
): Promise<ContentBlock> {
	if (block.type === 'text' && typeof block.text === 'string') {
		const text = await redact(block.text);
		return text === block.text ? block : { ...block, text };
	}
	if (block.type === 'tool_result') {
		const content = await redactToolContent(block.content, redact);
		return content === block.content ? block : { ...block, content };
	}
	return block;
}

/**
 * Redacts a list of blocks.
 * @param blocks - The blocks.
 * @param redact - The text redactor.
 * @returns The redacted blocks, or `blocks` itself when none changed.
 */
export async function redactBlocks(
	blocks: readonly ContentBlock[],
	redact: TextRedactor,
): Promise<readonly ContentBlock[]> {
	const redacted = await Promise.all(
		blocks.map((block) => redactBlock(block, redact)),
	);
	return redacted.every((block, index) => block === blocks[index])
		? blocks
		: redacted;
}
