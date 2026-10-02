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
	contextUsage,
	reasoning,
	toolCall,
	toolResult,
	userPrompt,
} from '../transcript.ts';

const CLOCK = DEMO_CLOCK;
const BRANCH_ID = 'demo-branch-release-notes';

const UPDATE_SERVICE_BODY = `export async function resolveUpdate(
  channel: BuildChannel,
): Promise<UpdateStatusSnapshot> {
  const feed = await fetchReleaseFeed(channel);
  const candidate = feed.releases.find(isNewerThanCurrent);
  if (!candidate) {
    return idleStatus(channel);
  }
  return {
    ...idleStatus(channel),
    availableVersion: candidate.version,
    releaseUrl: candidate.htmlUrl,
    state: 'available',
  };
}`;

const RELEASE_NOTES_DIFF = `@@ -18,6 +18,7 @@ export async function resolveUpdate(
     return idleStatus(channel);
   }
   return {
     ...idleStatus(channel),
     availableVersion: candidate.version,
+    notes: candidate.body ?? null,
     releaseUrl: candidate.htmlUrl,
     state: 'available',
   };`;

/**
 * The workbench mid-turn: an agent reading a file, editing it, and still
 * streaming its answer. The shot that shows what the app is for.
 */
export default defineScenario({
	chat: {
		agentSessionId: 'demo-session-release-notes',
		branchId: BRANCH_ID,
		isStreaming: true,
		model: 'claude-opus-5',
		title: 'Release notes in the updates panel',
		transcript: buildTranscript(BRANCH_ID, CLOCK, [
			userPrompt(
				'The updates panel shows a version and a link but never the release notes. Wire the notes through from the feed.',
			),
			reasoning(
				'The feed response already carries a `body` for each release — `resolveUpdate` reads `version` and `htmlUrl` off the candidate and drops everything else. So this is a matter of widening the snapshot the resolver returns, not of fetching anything new.\n\nThe renderer side reads `notes` off `UpdateStatusSnapshot`, which already declares the field as nullable. That means the contract needs no change and the panel will pick the value up as soon as the resolver sets it.',
			),
			toolCall('Read', 'call-read-update-service', {
				file_path: 'src/main/updates/update-service.ts',
				limit: 40,
				offset: 12,
			}),
			toolResult('call-read-update-service', UPDATE_SERVICE_BODY),
			assistantText(
				'Found it. `resolveUpdate` builds the snapshot from three fields off the candidate release and never reads `body`, so the notes are dropped at the resolver rather than in the panel.',
			),
			toolCall('Edit', 'call-edit-update-service', {
				file_path: 'src/main/updates/update-service.ts',
				new_string: '    notes: candidate.body ?? null,',
				old_string: '    availableVersion: candidate.version,',
			}),
			toolResult('call-edit-update-service', RELEASE_NOTES_DIFF),
			assistantText(
				'One line at the resolver. `UpdateStatusSnapshot` already declares `notes: string | null`, so the contract is unchanged and the panel renders it without a further edit.\n\nThree things follow from this:\n\n1. **The feed already carried it.** `body` is on every release the GitHub releases API returns, so nothing new is fetched and the check costs exactly what it did before.\n2. **A release with no notes stays null**, which is the state the panel already renders as an empty section rather than a blank card.\n3. **`tests/main/update-service.test.ts` needs one case** covering a candidate whose body is absent, so the null path is pinned.',
			),
			toolCall('Bash', 'call-run-tests', {
				command: 'npm run test:updates',
				description: 'Run the update-service tests',
			}),
			contextUsage(148_000, 1_000_000),
		]),
	},
	clock: CLOCK,
	gitFilesByPath: DEMO_GIT_FILES,
	id: 'workspace-mid-turn',
	label: 'Workspace, mid-turn',
	repositories: DEMO_REPOSITORIES,
	runScripts: DEMO_RUN_SCRIPTS,
	route: '/projects/repo-ensemblr/workspaces/ws-release-notes/chats/demo-chat',
	terminals: DEMO_TERMINALS,
	workspaceId: 'ws-release-notes',
});
