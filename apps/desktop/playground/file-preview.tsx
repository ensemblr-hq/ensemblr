import { QueryClientProvider } from '@tanstack/react-query';

import { FilePreviewPanel } from '@/renderer/components/workbench-shell/conversation-panel/file-preview-panel';
import { useSeededFileClient } from './seeded-file-client.ts';

const WORKSPACE_CWD = '/workspace/ensemblr';
const WORKSPACE_ID = 'playground-workspace';
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
	const client = useSeededFileClient(WORKSPACE_CWD, FILE_PATH, FILE_CONTENT);

	return (
		<QueryClientProvider client={client}>
			<div className='flex h-96 flex-col overflow-hidden rounded-md border border-border bg-surface'>
				<FilePreviewPanel
					filePath={FILE_PATH}
					workspaceCwd={WORKSPACE_CWD}
					workspaceId={WORKSPACE_ID}
				/>
			</div>
		</QueryClientProvider>
	);
}
