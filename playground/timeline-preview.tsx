import type { DynamicToolUIPart } from 'ai';
import {
	ChatCustomMessage,
	ChatReasoningCollapsible,
	ChatSkillInvocation,
	ChatToolCall,
} from '@/renderer/components/chat-tool-call';
import { ChatUserPrompt } from '@/renderer/components/chat-user-prompt';
import {
	FilePreviewOpenerProvider,
	WorkspacePathResolverProvider,
} from '@/renderer/components/workbench-shell/conversation-panel/file-preview-context';

const SHORT_PROMPT = 'Swap the Read row for the line-numbered body.';

const CHIPPED_PROMPT = `Okay I think we are ready to make a new beta release of

Referenced workspace folders:
@ensemblr

. So update the docs there and cut the beta. Once that is done let's make sure

Referenced workspace folders:
@ensemblr-dev

is updated with the new release, and check src/renderer/components/chat-user-prompt.tsx while you are in there. Everything under (

Referenced workspace folders:
@src/main
@src/renderer

) can wait for the next one.`;

const PASTED_PROMPT = `We have merged some PR so db may be out of sync:

## Error Type
Runtime PrismaClientKnownRequestError

## Error Message

Invalid \`()=>__TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$prisma$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__.default.agency.findUnique()\` invocation in
/Users/psoldunov/Ensemblr/workspaces/yeco-connect/lavrangas/.next/dev/server/chunks/ssr/[root-of-the-server]__6f2b1a._.js:3079:41

  3078 async function getAgency(id) {
→ 3079     const cached = await (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$queries$2f$cache$2e$ts__$28$ecmascript$29$__.cachedById)('agency', id,
The column \`(not available)\` does not exist in the current database.

  at <unknown> (src/lib/queries/agency.ts:61:17)
  at getAgency (src/lib/queries/agency.ts:60:17)
  at <anonymous> (src/lib/session.ts:147:17)

Next.js version: 16.2.6 (Turbopack)`;

const THINKING_TEXT = `The error variant is working correctly with the collapsed destructive chip display. Now I need to swap out the existing Read tool row to match the reference shape — keeping the file icon, updating the title to "Read 30 lines", and using the file badge button as a preview chip.

For the body, I'm building a line-numbered code view that displays file content with a gutter numbered from the real file offset, using a monospace font in a rounded container with syntax highlighting.`;

const READ_OUTPUT = `const THEMES = ['light', 'dark'] as const;

/** Which of the app's two root theme classes the canvas is pinned to. */
type PlaygroundTheme = (typeof THEMES)[number];

export function Playground() {
  const [sceneId, setSceneId] = useState(scenes[0]?.id ?? '');
  const [theme, setTheme] = useState<PlaygroundTheme>('light');
  const scene = scenes.find((candidate) => candidate.id === sceneId);

  return (
    <div className='flex h-screen w-screen overflow-hidden bg-canvas'>
      {scene?.render() ?? null}
    </div>
  );
}`;

const INJECTED_DOCS = `[Context7 Docs: tailwind (/rails/tailwindcss-rails)]

## tailwindcss:build

Compiles Tailwind CSS from the source file into a minified output file. This
task is automatically invoked during asset precompilation.

### Options

- **debug** — Disable minification; generates unminified CSS.
- **verbose** — Enable verbose logging.

\`\`\`bash
bin/rails tailwindcss:build
\`\`\``;

const WRITE_CONTENT = `export interface ToolBadgeDescriptor {
	additions: number | null;
	deletions: number | null;
	kind: 'file' | 'folder';
	path: string;
}`;

const EDIT_PATCH = `--- src/renderer/components/tool-collapsible.tsx
+++ src/renderer/components/tool-collapsible.tsx
@@ -20,8 +20,10 @@
 const CODE_THEME = 'catppuccin-mocha' as BundledTheme;

-const TOOL_COMMAND = 'open "http://localhost:5199/playground/"';
-const TOOL_OUTPUT = 'Bash completed with no output';
+const BASH_COMMAND = 'open "http://localhost:5199/playground/"';
+const BASH_OUTPUT = 'Bash completed with no output';
+
+const READ_PATH = 'playground/playground.tsx';

 export function ToolCollapsible({
@@ -99,11 +101,13 @@
 	glyph,
+	title,
 	toolPreview,
 	children,
 }: {
 	glyph: ToolGlyph;
+	title: string;
-	toolPreview: string;
+	toolPreview: ReactNode;
 	children: ReactNode;
 }) {`;

const GREP_OUTPUT = `src/renderer/components/code-block.tsx:12
src/renderer/components/diff-viewer/shiki-tokenize.tsx:11
src/renderer/lib/language-from-path.ts:1`;

const LS_OUTPUT = `answer-preview.tsx
bridge.ts
index.html
main.tsx
playground.tsx
timeline-preview.tsx`;

/**
 * Builds a settled tool part the way the event mapper does, so the preview
 * exercises the same `{ details, text }` output envelope the app receives.
 * @param toolName - Name of the tool that ran
 * @param input - Arguments it was called with
 * @param text - Flattened result text
 * @param details - Tool-specific details bag, when the tool reports one
 * @returns The tool part to hand to a row
 */
function toolPart(
	toolName: string,
	input: Record<string, unknown>,
	text: string,
	details: Record<string, unknown> | null = null,
): DynamicToolUIPart {
	return {
		input,
		output: { details, text },
		state: 'output-available',
		toolCallId: `${toolName}-preview`,
		toolName,
		type: 'dynamic-tool',
	};
}

/**
 * Every tool row the app can render, built from realistic Pi payloads and
 * mounted through the real `ChatToolCall`, so a regression in the shipped
 * projection and body components shows up here rather than in hand-written
 * markup that can drift from them. The three user prompts leading the scene
 * cover the card across its range: one that fits, one whose attachment chips sit
 * mid-sentence so the paragraph has to flow around them — through every case the
 * reconstructed gap has to get right, a word either side, punctuation binding
 * from either side, and two chips in a row — and a pasted stack trace long
 * enough to clamp and wide enough to test the unbreakable-run wrapping.
 */
export function TimelinePreview() {
	return (
		<WorkspacePathResolverProvider
			value={(path: string) => ({
				kind: path.includes('.') ? 'file' : 'directory',
				path,
				scope: path.startsWith('/') ? 'external' : 'workspace',
			})}
		>
			<FilePreviewOpenerProvider value={() => undefined}>
				<div className='flex flex-col gap-1'>
					<ChatUserPrompt prompt={SHORT_PROMPT} />

					<ChatUserPrompt prompt={CHIPPED_PROMPT} />

					<ChatUserPrompt prompt={PASTED_PROMPT} />

					<ChatReasoningCollapsible text={THINKING_TEXT} />

					<ChatCustomMessage
						data={{
							customType: 'context7_docs',
							display: false,
							text: INJECTED_DOCS,
						}}
					/>

					<ChatSkillInvocation name='caveman' />

					<ChatToolCall
						part={toolPart(
							'bash',
							{ command: 'open "http://localhost:5199/playground/"' },
							'(Bash completed with no output)',
						)}
					/>

					<ChatToolCall
						part={toolPart(
							'read',
							{ offset: 525, path: 'playground/playground.tsx' },
							READ_OUTPUT,
						)}
					/>

					<ChatToolCall
						part={toolPart(
							'write',
							{
								content: WRITE_CONTENT,
								path: 'src/renderer/types/tool-presentation.ts',
							},
							'Wrote 6 lines.',
						)}
					/>

					<ChatToolCall
						part={toolPart(
							'edit',
							{ path: 'src/renderer/components/tool-collapsible.tsx' },
							'Successfully replaced 2 blocks.',
							{ firstChangedLine: 20, patch: EDIT_PATCH },
						)}
					/>

					<ChatToolCall
						part={toolPart(
							'grep',
							{ path: 'src/renderer', pattern: "from 'shiki'" },
							GREP_OUTPUT,
						)}
					/>

					<ChatToolCall
						part={toolPart('glob', { pattern: 'src/**/*.tsx' }, GREP_OUTPUT)}
					/>

					<ChatToolCall
						part={toolPart('ls', { path: 'playground' }, LS_OUTPUT)}
					/>

					<ChatToolCall
						part={toolPart(
							'lsp_diagnostics',
							{ filePath: 'src/broken.ts' },
							'2 diagnostics found.',
							{
								diagnostics: [
									{
										message:
											"Argument of type 'string' is not assignable to parameter of type 'number'.",
										range: { start: { character: 25, line: 3 } },
										severity: 1,
										source: 'typescript',
									},
									{
										message: "'classify' is declared but never read.",
										range: { start: { character: 9, line: 0 } },
										severity: 2,
										source: 'typescript',
									},
								],
							},
						)}
					/>

					<ChatToolCall
						part={toolPart(
							'playwright__browser_navigate',
							{ url: 'http://localhost:5199/playground/' },
							'### Ran Playwright code\n```js\nawait page.goto("http://localhost:5199/playground/");\n```\n### Page\n- Page URL: http://localhost:5199/playground/\n- Page Title: Ensemblr Playground',
						)}
					/>

					<ChatToolCall
						part={{
							errorText:
								'<tool_use_error>String to replace not found in file.\nString: \t\t\t\t\t\t<div className="flex min-w-0 flex-1 items-center gap-2"></tool_use_error>',
							input: { path: 'src/renderer/components/message.tsx' },
							state: 'output-error',
							toolCallId: 'edit-failed',
							toolName: 'edit',
							type: 'dynamic-tool',
						}}
					/>

					<ChatToolCall
						part={{
							input: { command: 'npx tsc --noEmit' },
							state: 'input-available',
							toolCallId: 'bash-running',
							toolName: 'bash',
							type: 'dynamic-tool',
						}}
					/>
				</div>
			</FilePreviewOpenerProvider>
		</WorkspacePathResolverProvider>
	);
}
