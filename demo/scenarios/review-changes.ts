import { DEMO_RUN_SCRIPTS, DEMO_TERMINALS } from '../fixtures/dock.ts';
import {
	DEMO_CLOCK,
	DEMO_GIT_FILES,
	DEMO_REPOSITORIES,
	DEMO_WORKSPACE_FILES,
} from '../fixtures/workspaces.ts';
import { defineScenario } from '../scenario.ts';
import {
	assistantText,
	buildTranscript,
	toolCall,
	toolResult,
	userPrompt,
} from '../transcript.ts';

const BRANCH_ID = 'demo-branch-review';

const UPDATE_SERVICE_DIFF = `diff --git a/src/main/updates/update-service.ts b/src/main/updates/update-service.ts
index 4a1c9f2..8b23d61 100644
--- a/src/main/updates/update-service.ts
+++ b/src/main/updates/update-service.ts
@@ -14,11 +14,13 @@ import type { UpdateStatusSnapshot } from '../../shared/ipc/contracts/update.ts'
 export async function resolveUpdate(
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
+    notes: candidate.body ?? null,
     releaseUrl: candidate.htmlUrl,
     state: 'available',
   };
 }
`;

const UPDATES_PANEL_DIFF = `diff --git a/src/renderer/components/settings/updates-panel.tsx b/src/renderer/components/settings/updates-panel.tsx
index 91f0aa4..c7d1e08 100644
--- a/src/renderer/components/settings/updates-panel.tsx
+++ b/src/renderer/components/settings/updates-panel.tsx
@@ -42,6 +42,20 @@ export function UpdatesPanel() {
       <p className='text-muted-foreground text-sm'>
         {t('settings:updates.current', 'You are on the latest version.')}
       </p>
+      {status.notes ? (
+        <section className='mt-4 border-border border-t pt-4'>
+          <h3 className='font-medium text-sm'>
+            {t('settings:updates.notes-heading', "What's new")}
+          </h3>
+          <Markdown className='mt-2 text-muted-foreground text-sm'>
+            {status.notes}
+          </Markdown>
+        </section>
+      ) : null}
     </div>
   );
 }
`;

/**
 * The review surface: the Changes tab open over a diff, with an inline comment
 * thread on the line it is about. The shot the docs list has been missing.
 */
export default defineScenario({
	chat: {
		agentSessionId: 'demo-session-review',
		branchId: BRANCH_ID,
		isStreaming: false,
		model: 'claude-opus-5',
		title: 'Release notes in the updates panel',
		transcript: buildTranscript(BRANCH_ID, DEMO_CLOCK, [
			userPrompt(
				'Wire the release notes through and render them in the panel.',
			),
			toolCall('Edit', 'call-edit', {
				file_path: 'src/main/updates/update-service.ts',
			}),
			toolResult('call-edit', 'Applied 1 addition.'),
			assistantText(
				'Done — the resolver carries `notes` now, and the panel renders it under the version. I left the empty case alone: the section is skipped rather than rendered blank.',
			),
		]),
	},
	clock: DEMO_CLOCK,
	dockTab: 'run',
	fileDiffs: {
		'src/main/updates/update-service.ts': UPDATE_SERVICE_DIFF,
		'src/renderer/components/settings/updates-panel.tsx': UPDATES_PANEL_DIFF,
	},
	gitFilesByPath: DEMO_GIT_FILES,
	id: 'review-changes',
	label: 'Review — changes and a comment',
	repositories: DEMO_REPOSITORIES,
	runScripts: DEMO_RUN_SCRIPTS,
	reviewComments: [
		{
			body: 'Worth pinning the null case in a test — a release with no body is the common one for a patch bump.',
			createdAt: DEMO_CLOCK,
			filePath: 'src/main/updates/update-service.ts',
			id: 'comment-notes-null',
			lineNumber: 25,
			origin: 'user',
			status: 'open',
			updatedAt: DEMO_CLOCK,
			workspaceId: 'ws-release-notes',
		},
		{
			body: 'Markdown here is already sanitized upstream, so this can render the body directly.',
			createdAt: DEMO_CLOCK,
			filePath: 'src/renderer/components/settings/updates-panel.tsx',
			id: 'comment-markdown',
			lineNumber: 48,
			origin: 'agent',
			status: 'open',
			updatedAt: DEMO_CLOCK,
			workspaceId: 'ws-release-notes',
		},
	],
	openDiffPath: 'src/main/updates/update-service.ts',
	reviewTab: 'changes',
	route: '/projects/repo-ensemblr/workspaces/ws-release-notes/chats/demo-chat',
	workspaceFiles: DEMO_WORKSPACE_FILES,
	terminals: DEMO_TERMINALS,
	workspaceId: 'ws-release-notes',
});
