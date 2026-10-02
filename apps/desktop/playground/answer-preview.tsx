import { MessageResponse } from '@/renderer/components/message';
import {
	FilePreviewOpenerProvider,
	WorkspacePathResolverProvider,
} from '@/renderer/components/workbench-shell/conversation-panel/file-preview-context';
import { createWorkspacePathResolver } from '@/renderer/lib/agent-timeline';
import type { WorkspaceFileSummary } from '@/renderer/types/workbench';

/** Stand-in file tree the chips in `CHIP_STATES` are resolved against. */
const WORKSPACE_FILES: readonly WorkspaceFileSummary[] = [
	'src/renderer/components/message.tsx',
	'src/renderer/components/code-surface.tsx',
	'src/main/components/message.tsx',
	'README.md',
].map((path) => ({
	id: path,
	kind: 'file' as const,
	name: path.split('/').at(-1) ?? path,
	path,
}));

const CHIP_STATES = `Chip states, resolved against the stand-in tree:

- Exact path — \`src/renderer/components/message.tsx\` is a chip that opens.
- Truncated but unambiguous — \`renderer/components/code-surface.tsx\` opens the file it can only mean.
- Truncated and ambiguous — \`components/message.tsx\` matches two entries, so it stays inline code.
- Deleted or moved — \`src/renderer/components/chat-activity-row.tsx\` is gone from the tree.
`;

const ANSWER = `## Goal

Replace the Next.js 16 + React app with an Astro app that renders the same
coming-soon page, keeps \`SubscribeForm\` and \`EnsemblrWordmark\` as React
islands, and re-implements \`/api/subscribe\` as an Astro on-demand endpoint
behind \`@astrojs/node\` (standalone), preserving all existing behavior.

### Dependency changes (package.json)

- Remove: \`next\`
- Add: \`astro\`, \`@astrojs/react\`, \`@astrojs/node\`, \`@tailwindcss/vite\`
  (Tailwind 4's Vite plugin, replacing \`@tailwindcss/postcss\`)
- Keep: \`react\`, \`react-dom\`, \`@types/react\`, \`clsx\`, \`tailwind-merge\`,
  \`zod\`, \`resend\`, \`tailwindcss\`, \`@biomejs/biome\`, \`typescript\`
- Remove \`postcss.config.mjs\` — Tailwind runs via the Vite plugin
- Scripts become \`dev: "astro dev"\`, \`build: "astro build"\`, keep \`lint\` /
  \`format\` as Biome

### New config: astro.config.mjs

\`\`\`ts
import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import node from '@astrojs/node';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  output: 'server',
  adapter: node({ mode: 'standalone' }),
  integrations: [react()],
  vite: { plugins: [tailwindcss()] },
});
\`\`\`

The page itself (\`src/pages/index.astro\`) stays fully static/prerendered
(\`export const prerender = true\`) even though the project output is
\`server\`; only \`src/pages/api/subscribe.ts\` runs on-demand.

### File moves / rewrites

1. \`src/app/layout.tsx\` + \`src/app/page.tsx\` → \`src/layouts/Layout.astro\`
   (html/head/body, imports \`src/styles/globals.css\`, sets \`<title>\`)
2. \`src/components/subscribe-form.tsx\` → unchanged content, moved as-is
3. \`src/app/api/subscribe/route.ts\` → rewritten to Astro's endpoint signature

> Same NocoDB dedup/insert logic, same Resend notify call. Responses become
> \`new Response(JSON.stringify(...))\` instead of \`NextResponse.json\`.

#### Verification

| Step | Command | Expect |
| --- | --- | --- |
| Types | \`npm run typecheck\` | clean |
| Lint | \`npm run check\` | clean |
| Build | \`npm run build\` | \`dist/server/entry.mjs\` |

Run it locally with:

\`\`\`bash
npm run dev && open http://localhost:4321
\`\`\`

See the [Astro adapter docs](https://docs.astro.build/en/guides/server-side-rendering/)
for the standalone-vs-middleware tradeoff.

---

An unknown fence tag must not throw:

\`\`\`wingdings
this language does not exist
\`\`\`

And a plain fence with no tag at all:

\`\`\`
plain preformatted text
\`\`\`
`;

/**
 * A settled assistant answer, so fenced code in the final response can be
 * eyeballed against the tool rows it now shares a surface with.
 */
export function AnswerPreview() {
	return (
		<WorkspacePathResolverProvider
			value={createWorkspacePathResolver(WORKSPACE_FILES, '/repo')}
		>
			<FilePreviewOpenerProvider value={() => undefined}>
				<div className='text-sm'>
					<MessageResponse className='h-auto'>{CHIP_STATES}</MessageResponse>
					<hr className='my-8 border-border' />
					<MessageResponse className='h-auto'>{ANSWER}</MessageResponse>
				</div>
			</FilePreviewOpenerProvider>
		</WorkspacePathResolverProvider>
	);
}
