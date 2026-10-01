import { useQuery } from '@tanstack/react-query';

import {
	ensemblrQueryKeys,
	readWorkspaceFile,
} from '@/renderer/api/ensemblr-queries';
import { useMarkdownDocumentScope } from '@/renderer/components/markdown/markdown-document-scope-context';
import { imageSourceForPreview } from '@/renderer/components/workbench-shell/conversation-panel/file-preview-helpers';
import { staysInsideWorkspace } from '@/renderer/lib/markdown-references';
import type { MarkdownReference } from '@/renderer/types/markdown';
import type { ReadWorkspaceFileResult } from '@/shared/ipc/contracts/workspace-files';

import { useMarkdownFileReference } from './use-markdown-file-reference';

/** How long a markdown image's bytes stay fresh before another read is made. */
const IMAGE_STALE_TIME_MS = 60_000;

/** A path naming an SVG, whatever case its extension is written in. */
const SVG_PATH = /\.svg$/i;

/**
 * What a markdown `<img>` should actually load, and whether that is still being
 * worked out.
 *
 * `source` null with `isPending` false is the settled failure: the reference
 * names no file the surface will read, so the caller draws its placeholder.
 */
interface MarkdownImageSource {
	isPending: boolean;
	source: string | null;
}

/**
 * The path a markdown image may be read from, empty when there is nothing this
 * surface will fetch on the document's say-so.
 *
 * A reference the tree could not place is still read, because an asset the
 * repository ignores is missing from the tree but present on disk — but only
 * while it stays inside the workspace. The preview IPC will read an absolute
 * path, a `~/` path, or a climb out of the root just as readily, and an image is
 * fetched the instant it is drawn rather than on a click, so a destination that
 * leaves the workspace is refused here instead. Markdown is not always the
 * reader's own: a pull-request comment renders through the same surface, and a
 * link the reader *chooses* to follow is the affordance that may still leave it.
 * @param reference - What the destination was placed as.
 * @returns The workspace-relative path to read, or an empty string.
 */
function readableWorkspacePath(reference: MarkdownReference): string {
	if (reference.kind !== 'local') {
		return '';
	}
	if (reference.match) {
		return reference.match.scope === 'workspace' ? reference.match.path : '';
	}
	return staysInsideWorkspace(reference.lookupPath) ? reference.lookupPath : '';
}

/**
 * The URL a markdown image draws a workspace read from.
 *
 * The preview reads an SVG back as text, because the file view and the diff show
 * its source, so it never arrives as the image bytes a raster file does. Handed
 * to an `<img>` as a data URL it is drawn as a static picture: an SVG in image
 * context runs no script and loads nothing it references.
 * @param result - The workspace read for the image's path.
 * @param path - The workspace-relative path that was read.
 * @returns A data URL for the image, or null when the read holds no image.
 */
function imageSourceForRead(
	result: ReadWorkspaceFileResult,
	path: string,
): string | null {
	const rasterSource = imageSourceForPreview(result);
	if (rasterSource) {
		return rasterSource;
	}
	if (result.contentEncoding !== 'utf8' || !result.content) {
		return null;
	}
	return SVG_PATH.test(path)
		? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(result.content)}`
		: null;
}

/**
 * Resolves what a markdown image renders from.
 *
 * A remote source is handed back untouched — the platform fetches it, as it does
 * for the badges a PR comment carries. A source that names a path cannot be
 * fetched at all: the renderer's origin is the app bundle, so `./images/a.png`
 * resolves against the app rather than against the document, and the one file it
 * can never reach is the one it names. Those go through the same guarded read
 * the file preview uses and come back as a data URL, which shares the preview's
 * query cache with the tab that opens the image on its own.
 * @param src - The image source exactly as the document wrote it.
 * @returns The source to render and whether the read is still in flight.
 */
export function useMarkdownImageSource(src: string): MarkdownImageSource {
	const scope = useMarkdownDocumentScope();
	const reference = useMarkdownFileReference(src);
	const path = readableWorkspacePath(reference);
	const workspaceCwd = scope?.workspaceCwd ?? '';
	const isReadable = Boolean(workspaceCwd && path);
	const { data, isPending } = useQuery({
		enabled: isReadable,
		queryFn: () => readWorkspaceFile({ path, workspaceCwd }),
		queryKey: ensemblrQueryKeys.filePreview(workspaceCwd, path),
		staleTime: IMAGE_STALE_TIME_MS,
	});

	if (reference.kind === 'remote') {
		return { isPending: false, source: src };
	}
	if (!isReadable) {
		return { isPending: false, source: null };
	}
	if (isPending) {
		return { isPending: true, source: null };
	}
	return {
		isPending: false,
		source: data ? imageSourceForRead(data, path) : null,
	};
}
