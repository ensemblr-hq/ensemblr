import { DEMO_RUN_SCRIPTS, DEMO_TERMINALS } from '../fixtures/dock.ts';
import {
	DEMO_CLOCK,
	DEMO_GIT_FILES,
	DEMO_REPOSITORIES,
} from '../fixtures/workspaces.ts';
import { defineScenario } from '../scenario.ts';
import {
	assistantText,
	buildTranscript,
	reasoning,
	toolCall,
	toolResult,
	userPrompt,
} from '../transcript.ts';

const BRANCH_ID = 'demo-branch-plan-mode';

/** The plan the agent wrote, rendered as the last message in the timeline. */
const PLAN = `## Virtualize the diff viewer

**Problem.** \`DiffViewer\` renders every hunk of every file at once. A 4,000-line
diff mounts ~12,000 rows, which blocks the renderer for about 1.9s and drops the
scroll to single-digit frames.

**Approach.** Keep \`react-diff-view\` for tokenizing and rendering a hunk, and
put \`@tanstack/react-virtual\` in front of the hunk list rather than the line
list — a hunk is the smallest unit whose height is stable once Shiki has
tokenized it, so line-level virtualization would re-measure on every theme
change.

### Changes

1. \`use-virtual-hunks.ts\` — new hook owning the virtualizer, keyed by file path
   so switching tabs does not reset the scroll offset.
2. \`diff-viewer.tsx\` — render the windowed hunks; the expand-context control
   keeps working because it only ever grows a hunk already in the window.
3. Tokenize off the critical path: Shiki already runs async, so a hunk entering
   the window renders plain and upgrades on the next frame.

### Verification

1. \`npx vitest run tests/renderer/diff-viewer.test.tsx\`
2. Open the 4k-line fixture and confirm the mount stays under 200ms.
3. Toggle the theme mid-scroll and confirm no hunk re-measures.

### Open question

Should collapsed files stay mounted? Recommendation: no — unmounting them is
what buys the mount time, and re-expanding costs one frame.`;

/**
 * Plan Mode active in the composer with a finished plan waiting on the user.
 *
 * Two pushes rather than answers, which is why the scenario declares
 * `planReview` instead of a handler: the decision bar is raised by main's
 * `onExitPlanMode` broadcast, and the composer's Plan chip reads a
 * `localStorage`-backed atom keyed by chat tab. `DemoRuntime` performs both, so
 * nothing under `src/` is touched to stage either.
 *
 * The plan itself is just the agent's last message — the decision bar carries no
 * title of its own, deliberately, because it would only restate the heading
 * immediately above it.
 */
export default defineScenario({
	chat: {
		agentSessionId: 'demo-session-plan-mode',
		branchId: BRANCH_ID,
		isStreaming: false,
		model: 'claude-opus-5',
		title: 'Virtualize the diff viewer',
		transcript: buildTranscript(BRANCH_ID, DEMO_CLOCK, [
			userPrompt(
				'The diff viewer stalls on big files. Plan a fix before you touch anything.',
			),
			reasoning(
				'Plan Mode is on, so I can read and measure but not edit. Find out where the time actually goes before proposing anything.',
			),
			toolCall('Read', 'call-plan-1', {
				file_path:
					'src/renderer/components/workbench-shell/diff/diff-viewer.tsx',
			}),
			toolResult(
				'call-plan-1',
				'318 lines. Every hunk of every file is mounted at once; no windowing anywhere in the tree.',
			),
			toolCall('Bash', 'call-plan-2', {
				command: 'wc -l tests/fixtures/large-diff.patch',
				description: 'Size the worst case',
			}),
			toolResult('call-plan-2', '   4182 tests/fixtures/large-diff.patch'),
			assistantText(PLAN),
		]),
	},
	clock: DEMO_CLOCK,
	dockTab: 'run',
	gitFilesByPath: DEMO_GIT_FILES,
	id: 'plan-mode',
	label: 'Composer — plan mode',
	planReview: {
		planPath: '.context/plans/virtualize-the-diff-viewer.md',
		title: 'Virtualize the diff viewer',
	},
	repositories: DEMO_REPOSITORIES,
	route:
		'/projects/repo-ensemblr/workspaces/ws-diff-virtualization/chats/demo-chat',
	runScripts: DEMO_RUN_SCRIPTS,
	terminals: DEMO_TERMINALS,
	workspaceId: 'ws-diff-virtualization',
});
