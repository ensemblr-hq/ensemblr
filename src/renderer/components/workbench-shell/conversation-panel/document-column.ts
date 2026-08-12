/**
 * Reading column for the read-only markdown document surfaces — a `.md` file's
 * formatted preview and a pull-request comment preview. Both open as
 * main-surface tabs that can be as wide as the window, and markdown set edge to
 * edge there runs to a line length a reader loses their place in on the way back
 * to the next line.
 *
 * The width is the conversation timeline's own, so a document reads at the same
 * measure whether an agent wrote it into the chat or it is being previewed off
 * disk. Vertical rhythm is left to the caller: a header band and the body it
 * introduces share the column but not the padding that separates them.
 */
export const DOCUMENT_COLUMN_CLASSES = 'mx-auto w-full max-w-3xl px-6';

/**
 * The document column as a body: the column, its own vertical breathing room,
 * and the app's type size rather than the browser's 16px default, which these
 * previews inherited only because nothing above them had set one.
 */
export const DOCUMENT_BODY_CLASSES = `${DOCUMENT_COLUMN_CLASSES} py-5 text-sm`;
