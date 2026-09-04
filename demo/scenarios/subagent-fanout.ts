import { DEMO_RUN_SCRIPTS, DEMO_TERMINALS } from '../fixtures/dock.ts';
import {
	DEMO_CLOCK,
	DEMO_GIT_FILES,
	DEMO_REPOSITORIES,
} from '../fixtures/workspaces.ts';
import { type DemoChat, defineScenario } from '../scenario.ts';
import {
	assistantText,
	buildTranscript,
	reasoning,
	toolCall,
	toolResult,
	userPrompt,
} from '../transcript.ts';

const BRANCH_ID = 'demo-branch-fanout';

/**
 * Builds a spawned delegate: its tab, its own session, and the transcript that
 * session produced.
 *
 * Each carries real work rather than an empty pane. A tab strip full of blank
 * timelines would sell the opposite of what the fan-out is for — the point is
 * that every child is a conversation you can open and read.
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
		agentSessionId: `session-${options.id}`,
		branchId: `branch-${options.id}`,
		isStreaming: options.isStreaming ?? false,
		model: 'claude-sonnet-5',
		tabId: `tab-${options.id}`,
		title: options.title,
		transcript: buildTranscript(
			`branch-${options.id}`,
			DEMO_CLOCK,
			options.steps,
		),
	};
}

const RESOLVER_BODY = `return {
  ...idleStatus(channel),
  availableVersion: candidate.version,
  releaseUrl: candidate.htmlUrl,
  state: 'available',
};`;

const PANEL_BODY = `{status.availableVersion ? (
  <UpdateAvailableRow version={status.availableVersion} url={status.releaseUrl} />
) : (
  <p className='text-muted-foreground text-sm'>
    {t('settings:updates.current', 'You are on the latest version.')}
  </p>
)}`;

/**
 * An orchestrator fanned out across four delegates, each in its own tab.
 *
 * The point of the shot is the tab strip: every child is a chat you can open,
 * read, and steer, rather than a spinner inside someone else's transcript.
 */
export default defineScenario({
	chat: {
		agentSessionId: 'demo-session-fanout',
		branchId: BRANCH_ID,
		isStreaming: true,
		model: 'claude-opus-5',
		title: 'Audit the updates surface',
		transcript: buildTranscript(BRANCH_ID, DEMO_CLOCK, [
			userPrompt(
				'Audit everything that touches the updates surface — the resolver, the panel, the feed client, and the tests — and tell me what is actually wrong.',
			),
			reasoning(
				'Four areas that barely overlap: the resolver is main-process logic, the panel is renderer, the feed client is a network boundary, and the tests are their own tree. Nothing one reviewer learns helps the next, so these run in parallel rather than in sequence.\n\nWhat they do share is the shape of the contract, so each brief carries `UpdateStatusSnapshot` rather than making four agents re-derive it.',
			),
			toolCall('Task', 'call-resolver', {
				description: 'Review the update resolver',
				prompt:
					'Review src/main/updates/update-service.ts against the UpdateStatusSnapshot contract. Report every field the resolver drops.',
				subagent_type: 'code-reviewer',
			}),
			toolCall('Task', 'call-panel', {
				description: 'Review the updates panel',
				prompt:
					'Review src/renderer/components/settings/updates-panel.tsx for states it fails to render — empty notes, long notes, a failed check.',
				subagent_type: 'code-reviewer',
			}),
			toolCall('Task', 'call-feed', {
				description: 'Review the feed client',
				prompt:
					'Review the GitHub releases feed client for error handling and rate-limit behaviour.',
				subagent_type: 'code-reviewer',
			}),
			toolCall('Task', 'call-tests', {
				description: 'Review the update tests',
				prompt:
					'Report which branches of resolveUpdate have no test covering them.',
				subagent_type: 'code-reviewer',
			}),
			toolResult(
				'call-resolver',
				'One field dropped: `notes`. The feed carries `body` on every release and the resolver never reads it.',
			),
			toolResult(
				'call-panel',
				'Two unrendered states: a release with no notes renders an empty section rather than skipping it, and a long changelog pushes the update button below the fold.',
			),
			assistantText(
				'Two of the four are back, and they agree on where the bug is.\n\n**The resolver drops `notes`.** The feed already carries `body` on every release; `resolveUpdate` reads `version` and `htmlUrl` and discards the rest. That is a one-line fix and the contract already declares the field.\n\n**The panel has two unrendered states** — an empty notes section, and a long changelog pushing the update button off screen. Mara raised the second one on #438 independently, so it is worth doing in the same pass.\n\nThe feed client and test-coverage reviews are still running.',
			),
		]),
	},
	clock: DEMO_CLOCK,
	dockTab: 'run',
	gitFilesByPath: DEMO_GIT_FILES,
	id: 'subagent-fanout',
	label: 'Sub-agents — fan-out tabs',
	repositories: DEMO_REPOSITORIES,
	runScripts: DEMO_RUN_SCRIPTS,
	route: '/projects/repo-ensemblr/workspaces/ws-release-notes/chats/demo-chat',
	subAgents: [
		delegate({
			id: 'resolver',
			steps: [
				userPrompt(
					'Review src/main/updates/update-service.ts against the UpdateStatusSnapshot contract. Report every field the resolver drops.',
				),
				toolCall('Read', 'r-1', {
					file_path: 'src/main/updates/update-service.ts',
				}),
				toolResult('r-1', RESOLVER_BODY),
				toolCall('Read', 'r-2', {
					file_path: 'src/shared/ipc/contracts/update.ts',
				}),
				toolResult(
					'r-2',
					'interface UpdateStatusSnapshot {\n  availableVersion: string | null;\n  channel: BuildChannel;\n  currentVersion: string;\n  failure: UpdateFailure | null;\n  notes: string | null;\n  releaseUrl: string | null;\n  state: UpdateState;\n}',
				),
				assistantText(
					'**One field dropped: `notes`.**\n\nThe contract declares seven fields and `resolveUpdate` sets six. `notes` is never assigned, so it falls back to whatever `idleStatus` seeds — which is `null`, unconditionally.\n\nThe value is available at the call site: the feed entry the resolver already holds carries `body`. So this is `notes: candidate.body ?? null` on the object it is already building, not a second fetch.\n\nNothing else is missing. `failure` and `state` are both set on every path I traced.',
				),
			],
			title: 'Review the update resolver',
		}),
		delegate({
			id: 'panel',
			steps: [
				userPrompt(
					'Review src/renderer/components/settings/updates-panel.tsx for states it fails to render.',
				),
				toolCall('Read', 'p-1', {
					file_path: 'src/renderer/components/settings/updates-panel.tsx',
				}),
				toolResult('p-1', PANEL_BODY),
				assistantText(
					'**Two states the panel does not handle.**\n\n1. **Empty notes render an empty section.** Once `notes` starts arriving, a release with no body will produce a heading over nothing. Guard on the value rather than on the field existing.\n\n2. **A long changelog pushes the update button below the fold.** The panel is not scrollable at this level, so a 40-line body moves the primary action off screen. Either cap the section height or move the button above it.\n\nThe failure state is handled correctly — `status.failure` renders its own row and suppresses the version line.',
				),
			],
			title: 'Review the updates panel',
		}),
		delegate({
			id: 'feed',
			isStreaming: true,
			steps: [
				userPrompt(
					'Review the GitHub releases feed client for error handling and rate-limit behaviour.',
				),
				toolCall('Grep', 'f-1', {
					pattern: 'fetchReleaseFeed',
					path: 'src/main/updates',
				}),
				toolResult('f-1', 'src/main/updates/release-feed.ts:22'),
				toolCall('Read', 'f-2', {
					file_path: 'src/main/updates/release-feed.ts',
				}),
			],
			title: 'Review the feed client',
		}),
		delegate({
			id: 'tests',
			isStreaming: true,
			steps: [
				userPrompt(
					'Report which branches of resolveUpdate have no test covering them.',
				),
				toolCall('Bash', 't-1', {
					command:
						'npx vitest run --coverage tests/main/update-service.test.ts',
					description: 'Run the update-service tests with coverage',
				}),
			],
			title: 'Review the update tests',
		}),
	],
	terminals: DEMO_TERMINALS,
	workspaceId: 'ws-release-notes',
});
