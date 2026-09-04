import {
	DEV_SERVER_OUTPUT,
	HARNESS_OUTPUT,
} from '../fixtures/terminal-output.ts';
import {
	DEMO_CLOCK,
	DEMO_GIT_FILES,
	DEMO_REPOSITORIES,
	DEMO_WORKSPACE_FILES,
} from '../fixtures/workspaces.ts';
import { type DemoChat, defineScenario } from '../scenario.ts';
import {
	assistantText,
	buildTranscript,
	contextUsage,
	reasoning,
	toolCall,
	toolResult,
	userPrompt,
} from '../transcript.ts';

const BRANCH_ID = 'demo-branch-hero';

/**
 * Builds a delegate the orchestrator spawned: its tab, its session, and the
 * transcript that session produced, so the tab strip in the hero shot opens onto
 * real work rather than an empty pane.
 * @param options - The delegate's identity and the conversation it had.
 * @returns The chat the tab strip, the session list, and the timeline all read.
 */
function delegate(options: {
	id: string;
	isStreaming?: boolean;
	steps: Parameters<typeof buildTranscript>[2];
	title: string;
}): DemoChat {
	return {
		agentSessionId: `session-hero-${options.id}`,
		branchId: `branch-hero-${options.id}`,
		isStreaming: options.isStreaming ?? false,
		model: 'claude-sonnet-5',
		tabId: `tab-hero-${options.id}`,
		title: options.title,
		transcript: buildTranscript(
			`branch-hero-${options.id}`,
			DEMO_CLOCK,
			options.steps,
		),
	};
}

/**
 * The one shot people see before they read anything: an agent driving Ensemblr
 * itself from inside a workspace.
 *
 * All three of the workbench's surfaces are on camera at once, because the claim
 * the picture has to make is that they are one screen — the orchestrator's
 * timeline in the middle with its delegates in the tab strip, the diff the turn
 * produced in the Changes panel, and the dev server it started still streaming in
 * the dock.
 */
export default defineScenario({
	chat: {
		agentSessionId: 'demo-session-hero',
		branchId: BRANCH_ID,
		isStreaming: true,
		model: 'claude-opus-5',
		title: 'Release notes in the updates panel',
		transcript: buildTranscript(BRANCH_ID, DEMO_CLOCK, [
			userPrompt(
				'The updates panel never shows release notes. Find out why, fix it, and get the panel rendering them — translations included.',
			),
			reasoning(
				'Two halves that barely touch. The resolver is main-process logic against a contract; the panel is renderer work with its own states to get right. Nothing one learns helps the other, so they run in parallel rather than in sequence.\n\nThe translations are a third thing again, and a harness is the better tool for it — it is a mechanical backfill across two locale files, not a judgement call.',
			),
			toolCall('ensemblr_set_workspace_status', 'call-status', {
				status: 'in-progress',
			}),
			toolResult('call-status', 'Moved to In progress.'),
			toolCall('ensemblr_start_terminal', 'call-run', {
				kind: 'run',
				scriptName: 'dev',
			}),
			toolResult(
				'call-run',
				'Started `dev` in the dock — http://localhost:5173/',
			),
			toolCall('ensemblr_start_conversation', 'call-resolver', {
				prompt:
					'Read src/main/updates/update-service.ts against the UpdateStatusSnapshot contract and report every field the resolver drops.',
				title: 'Resolver contract',
			}),
			toolCall('ensemblr_start_conversation', 'call-panel', {
				prompt:
					'Review src/renderer/components/settings/updates-panel.tsx for states it fails to render, then implement the missing ones.',
				title: 'Updates panel states',
			}),
			toolResult('call-resolver', 'Started in its own tab.'),
			toolResult('call-panel', 'Started in its own tab.'),
			toolCall('ensemblr_launch_harness', 'call-harness', {
				harnessId: 'claude-code',
				prompt:
					'Backfill the ru and el values for every key this branch added.',
			}),
			toolResult('call-harness', 'Claude Code running in terminal `claude`.'),
			toolCall('ensemblr_wait_for_agents', 'call-wait', { mode: 'all' }),
			toolResult(
				'call-wait',
				'Both delegates finished. Resolver: one field dropped. Panel: two states unrendered, both now handled.',
			),
			assistantText(
				'Found it, and both halves are fixed on this branch.\n\n**The resolver dropped `notes`.** `UpdateStatusSnapshot` declares seven fields and `resolveUpdate` set six — the feed already carries `body` on every release and nothing ever read it. One line, and the contract needed no change.\n\n**The panel had two unrendered states.** A release with no notes drew a heading over nothing, and a long changelog pushed the update button below the fold. Both are handled now, and the second is what Mara raised on #438 independently.\n\nClaude Code has the four new keys backfilled in `ru` and `el`, and is verifying with `i18n:status` — you can watch it in the dock. Five files in the diff, and the tests cover both resolver branches.',
			),
			contextUsage(148_000, 1_000_000),
		]),
	},
	clock: DEMO_CLOCK,
	dockTab: 'run',
	gitFilesByPath: DEMO_GIT_FILES,
	id: 'hero-orchestrator',
	label: 'Hero — orchestrator, changes, dock',
	repositories: DEMO_REPOSITORIES,
	reviewTab: 'changes',
	route: '/projects/repo-ensemblr/workspaces/ws-release-notes/chats/demo-chat',
	runScripts: [
		{
			availableIn: ['local'],
			command: 'npm run dev',
			icon: 'play',
			isDefault: true,
			name: 'dev',
		},
		{
			availableIn: ['local'],
			command: 'npm run test',
			icon: 'test-tube',
			isDefault: false,
			name: 'test',
		},
	],
	subAgents: [
		delegate({
			id: 'resolver',
			steps: [
				userPrompt(
					'Read src/main/updates/update-service.ts against the UpdateStatusSnapshot contract and report every field the resolver drops.',
				),
				toolCall('Read', 'h-r-1', {
					file_path: 'src/main/updates/update-service.ts',
				}),
				toolResult(
					'h-r-1',
					"return {\n  ...idleStatus(channel),\n  availableVersion: candidate.version,\n  releaseUrl: candidate.htmlUrl,\n  state: 'available',\n};",
				),
				assistantText(
					'**One field dropped: `notes`.**\n\nThe contract declares seven fields and `resolveUpdate` sets six. `notes` falls back to whatever `idleStatus` seeds, which is `null` unconditionally.\n\nThe value is already at the call site — the feed entry the resolver holds carries `body` — so this is `notes: candidate.body ?? null` on the object it is already building, not a second fetch.',
				),
			],
			title: 'Resolver contract',
		}),
		delegate({
			id: 'panel',
			steps: [
				userPrompt(
					'Review src/renderer/components/settings/updates-panel.tsx for states it fails to render, then implement the missing ones.',
				),
				toolCall('Read', 'h-p-1', {
					file_path: 'src/renderer/components/settings/updates-panel.tsx',
				}),
				toolResult(
					'h-p-1',
					"{status.availableVersion ? (\n  <UpdateAvailableRow version={status.availableVersion} url={status.releaseUrl} />\n) : (\n  <p className='text-muted-foreground text-sm'>\n    {t('settings:updates.current', 'You are on the latest version.')}\n  </p>\n)}",
				),
				assistantText(
					'**Two states the panel did not handle**, both now implemented.\n\n1. **Empty notes drew an empty section.** Guarded on the value rather than on the field existing.\n2. **A long changelog pushed the update button below the fold.** The notes section is capped and scrolls; the action stays put.\n\nFour new keys, so `ru` and `el` need filling before this is finishable.',
				),
			],
			title: 'Updates panel states',
		}),
	],
	terminals: [
		{
			id: 'terminal-run',
			kind: 'run-script',
			output: DEV_SERVER_OUTPUT,
			scriptName: 'dev',
			title: 'dev',
		},
		{
			id: 'terminal-harness',
			kind: 'terminal',
			output: HARNESS_OUTPUT,
			title: 'claude',
		},
	],
	workspaceFiles: DEMO_WORKSPACE_FILES,
	workspaceId: 'ws-release-notes',
});
