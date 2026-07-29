import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';

import { ensemblrQueryKeys } from '@/renderer/api/ensemblr-queries';
import { FilePreviewPanel } from '@/renderer/components/workbench-shell/conversation-panel/file-preview-panel';

const WORKSPACE_CWD = '/workspace/ensemblr';
const FILE_PATH = 'docs/plans/astro-migration.md';

const FILE_CONTENT = [
	'# Astro migration',
	'',
	'## Plan',
	'',
	'- Port the marketing pages to **Astro islands**, keeping the subscribe form as a **React island** so the client bundle stays scoped to one route instead of shipping to every other route.',
	'- Move `POST /api/subscribe` onto an `APIRoute`, reusing `subscribeSchema` (zod) on the client and the server, then call `notifyNewSignup` once the REST API accepts the record.',
	'- Keep the existing design tokens (background/foreground/accent colours, font weights) and the `src/*` path alias so the diff stays reviewable.',
	'',
	'## Notes',
	'',
	'short line',
	'\ttab-indented line',
	'',
	'```ts',
	'export const config = { adapter: vercel(), integrations: [react()] };',
	'```',
	'',
].join('\n');

/**
 * File-preview scene: a workspace file rendered through the shipped
 * {@link FilePreviewPanel} with the read IPC pre-seeded, so the code surface,
 * its horizontal scrolling, and the word-wrap toggle can be eyeballed without
 * the Electron runtime.
 */
export function FilePreviewScene() {
	const [client] = useState(() => {
		const seeded = new QueryClient({
			defaultOptions: {
				queries: { retry: false, staleTime: Number.POSITIVE_INFINITY },
			},
		});
		seeded.setQueryData(
			ensemblrQueryKeys.filePreview(WORKSPACE_CWD, FILE_PATH),
			{
				content: FILE_CONTENT,
				contentEncoding: 'utf8',
				path: FILE_PATH,
				sizeBytes: FILE_CONTENT.length,
			},
		);
		return seeded;
	});

	return (
		<QueryClientProvider client={client}>
			<div className='flex h-96 flex-col overflow-hidden rounded-md border border-border bg-surface'>
				<FilePreviewPanel filePath={FILE_PATH} workspaceCwd={WORKSPACE_CWD} />
			</div>
		</QueryClientProvider>
	);
}
