import { useQuery } from '@tanstack/react-query';
import { useCallback } from 'react';
import { toast } from 'sonner';

import { agentActionTemplatesQuery } from '@/renderer/api/ensemblr-queries';
import {
	AGENT_ACTION_SETTING_KEYS,
	buildAgentActionPrompt,
	resolveAgentActionTemplate,
} from '@/renderer/lib/workbench/agent-actions';
import { useComposerInsert } from '@/renderer/state/composer';
import type {
	AgentActionKind,
	ProjectShellModel,
	WorkspaceShellModel,
} from '@/renderer/types/workbench';

/**
 * Loads agent-action templates for the active project and returns a callback
 * that resolves a template, builds the prompt, and inserts it into the
 * composer. Toast surfaces the template source so the user knows which
 * overrideable setting was applied.
 */
export function useAgentActionRunner({
	activeProject,
	activeWorkspace,
}: {
	activeProject: ProjectShellModel;
	activeWorkspace: WorkspaceShellModel;
}): (action: AgentActionKind) => void {
	const insertIntoComposer = useComposerInsert();
	const { data: actionTemplates } = useQuery(
		agentActionTemplatesQuery({
			repositoryId: activeProject.id,
			repositoryPath: activeProject.pathLabel,
		}),
	);

	return useCallback(
		(action: AgentActionKind) => {
			const setting = actionTemplates?.[AGENT_ACTION_SETTING_KEYS[action]];
			const resolved = resolveAgentActionTemplate({
				action,
				settingSource: setting?.source,
				settingValue: setting?.value,
			});
			insertIntoComposer(
				buildAgentActionPrompt({
					action,
					template: resolved.template,
					workspace: activeWorkspace,
				}),
			);
			toast.success('Prompt added to chat for review.', {
				description: `Template source: ${resolved.source}. Edit before sending if needed.`,
			});
		},
		[actionTemplates, activeWorkspace, insertIntoComposer],
	);
}
