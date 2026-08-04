import { QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import type { BundledLanguage } from 'shiki';

import { CodePanel } from '@/renderer/components/code-surface';
import { DiffViewer } from '@/renderer/components/diff-viewer';
import { ToolDiffPreview } from '@/renderer/components/tool-collapsible/tool-diff-preview';
import { FilePreviewPanel } from '@/renderer/components/workbench-shell/conversation-panel/file-preview-panel';
import { OpenInToolbarMenu } from '@/renderer/components/workbench-shell/open-in-toolbar-menu';
import type { DiffComment } from '@/renderer/types/diff';
import { useSeededFileClient } from './seeded-file-client.ts';

const WORKSPACE_CWD = '/workspace/ensemblr';
const WORKSPACE_ID = 'playground-workspace';
const FILE_PATH = 'src/renderer/lib/workbench/preview-urls.ts';

const FILE_CONTENT = [
	"import type { PreviewDeployment } from '@/shared/ipc/contracts/preview';",
	'',
	'const PROVIDER_HOSTS = new Map([',
	"\t['vercel', 'vercel.app'],",
	"\t['netlify', 'netlify.app'],",
	']);',
	'',
	'export function previewUrlFor(deployment: PreviewDeployment): string | null {',
	'\tconst host = PROVIDER_HOSTS.get(deployment.provider);',
	'\tif (!host) {',
	'\t\treturn null;',
	'\t}',
	'\t// A very long line, so the horizontal scroll and the surface behind it can be checked: the background must keep painting past the fold instead of stopping where the viewport did.',
	'\treturn "https://" + deployment.slug + "-" + deployment.hash.slice(0, 7) + "." + host;',
	'}',
	'',
].join('\n');

const PATCH = [
	`diff --git a/${FILE_PATH} b/${FILE_PATH}`,
	'--- a/src/renderer/lib/workbench/preview-urls.ts',
	'+++ b/src/renderer/lib/workbench/preview-urls.ts',
	'@@ -1,8 +1,9 @@',
	" import type { PreviewDeployment } from '@/shared/ipc/contracts/preview';",
	'',
	'-const PROVIDER_HOSTS = new Map([',
	"-\t['vercel', 'vercel.app'],",
	'+const PROVIDER_HOSTS = new Map<string, string>([',
	"+\t['vercel', 'vercel.app'],",
	"+\t['netlify', 'netlify.app'],",
	' ]);',
	'',
	' export function previewUrlFor(deployment: PreviewDeployment): string | null {',
	'@@ -34,7 +35,7 @@',
	' \tconst host = PROVIDER_HOSTS.get(deployment.provider);',
	' \tif (!host) {',
	'-\t\treturn undefined;',
	'+\t\treturn null;',
	' \t}',
	'-\treturn "https://" + deployment.slug + "." + host;',
	'+\treturn "https://" + deployment.slug + "-" + deployment.hash.slice(0, 7) + "." + host; // a deliberately long replacement line, so a changed row proves its tint runs the whole width once the diff is scrolled sideways',
	' }',
].join('\n');

/**
 * Comments anchored to real change keys from this patch (`I`/`D`/`N` plus the
 * line number, the scheme react-diff-view keys changes by), covering every state
 * a thread row can be in: local, GitHub, bot, resolved, and outdated.
 */
const COMMENTS = new Map<string, readonly DiffComment[]>([
	[
		'I4',
		[
			{
				author: 'philipp',
				body: 'Worth pulling the host table out to config — a third provider is already queued.',
				id: 'local-1',
				source: 'local',
			},
		],
	],
	[
		'D36',
		[
			{
				author: 'reviewer',
				body: 'Returning null here changes the contract for every caller that checked for undefined.',
				id: 'github-1',
				source: 'github',
			},
			{
				body: 'typecheck failed on this line in the previous run.',
				id: 'bot-1',
				isOutdated: true,
				source: 'github-actions',
			},
		],
	],
	[
		'N35',
		[
			{
				author: 'philipp',
				body: 'Handled in the follow-up.',
				id: 'local-2',
				isResolved: true,
				source: 'local',
			},
		],
	],
]);

const SNIPPET = [
	'const host = PROVIDER_HOSTS.get(deployment.provider);',
	'if (!host) {',
	'\treturn null;',
	'}',
].join('\n');

/**
 * Side-by-side scene for the app's four code surfaces — chat code block, the diff
 * preview inside a tool row, the file viewer, and the full diff viewer — driven
 * by one file and one patch.
 *
 * They only look like one design language when they are read together, which is
 * what this scene is for: check the surface fill, type size, row rhythm, gutter
 * hairline, change tints, and skipped-lines band line up across all four, and
 * scroll each one sideways to confirm nothing stops painting at the fold.
 */
export function ViewersScene() {
	const client = useSeededFileClient(WORKSPACE_CWD, FILE_PATH, FILE_CONTENT);
	const [viewed, setViewed] = useState(false);

	return (
		<QueryClientProvider client={client}>
			<div className='flex flex-col gap-6'>
				<ViewerSection label='chat code block — CodePanel'>
					<CodePanel
						code={SNIPPET}
						copyable
						language={'typescript' as BundledLanguage}
						startLine={34}
					/>
				</ViewerSection>

				<ViewerSection label='tool-row diff preview — ToolDiffPreview'>
					<ToolDiffPreview
						language={'typescript' as BundledLanguage}
						patch={PATCH}
					/>
				</ViewerSection>

				<ViewerSection label='file viewer — FilePreviewPanel'>
					<div className='flex h-64 flex-col overflow-hidden rounded-md border border-border bg-surface'>
						<FilePreviewPanel
							filePath={FILE_PATH}
							workspaceCwd={WORKSPACE_CWD}
							workspaceId={WORKSPACE_ID}
						/>
					</div>
				</ViewerSection>

				<ViewerSection label='diff viewer — DiffViewer'>
					<div className='flex h-80 flex-col overflow-hidden rounded-md border border-border bg-surface'>
						<DiffViewer
							commentsByChangeKey={COMMENTS}
							filePath={FILE_PATH}
							fullFileContent={FILE_CONTENT}
							headerActions={
								<OpenInToolbarMenu
									filePath={FILE_PATH}
									workspaceId={WORKSPACE_ID}
								/>
							}
							onAddComment={() => undefined}
							onDeleteComment={() => undefined}
							onResolveComment={() => undefined}
							onViewedChange={setViewed}
							patch={PATCH}
							viewed={viewed}
						/>
					</div>
				</ViewerSection>
			</div>
		</QueryClientProvider>
	);
}

/** Labels one surface in the scene so the four can be compared row by row. */
function ViewerSection({
	children,
	label,
}: {
	children: React.ReactNode;
	label: string;
}) {
	return (
		<section className='flex flex-col gap-1.5'>
			<h2 className='font-mono text-muted-foreground text-xxs uppercase tracking-wide'>
				{label}
			</h2>
			{children}
		</section>
	);
}
