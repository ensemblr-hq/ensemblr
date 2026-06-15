import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

import { piSlashCommandsQuery } from '@/renderer/api/ensemble-queries';

import {
	SLASH_COMMANDS,
	type SlashCommandDescriptor,
} from '@/renderer/components/workbench-shell/conversation-panel/composer/slash-commands';

/** Ranks slash commands in the default empty-query menu. */
function getSlashCommandRank(command: SlashCommandDescriptor): number {
	if (command.source === 'skill' && command.sourceScope === 'project') {
		return 0;
	}
	if (command.source === 'skill') {
		return 1;
	}
	if (command.source === 'extension') {
		return 2;
	}
	if (command.source === 'prompt') {
		return 3;
	}
	return 4;
}

/** Sorts prompt-invokable commands by desired default slash-menu groups. */
export function sortSlashCommands(
	commands: readonly SlashCommandDescriptor[],
): SlashCommandDescriptor[] {
	return [...commands].sort((left, right) => {
		const sourceDiff = getSlashCommandRank(left) - getSlashCommandRank(right);
		if (sourceDiff !== 0) {
			return sourceDiff;
		}
		return left.command.localeCompare(right.command);
	});
}

/**
 * Hook returning pi's slash commands. Prefers SDK-backed live IPC data; falls
 * back to the vendored static catalogue if pi's slash-commands module cannot
 * be resolved (e.g. pi not installed yet, or installed via an unusual layout).
 * @param workspaceCwd - Workspace directory used for project-local Pi resources.
 */
export function useSlashCommands(
	workspaceCwd: string,
): readonly SlashCommandDescriptor[] {
	const { data } = useQuery({
		...piSlashCommandsQuery({ cwd: workspaceCwd }),
		retry: false,
	});

	return useMemo(() => {
		const remote = data;
		if (!remote) {
			return sortSlashCommands(SLASH_COMMANDS);
		}
		if (remote.source !== 'sdk' && remote.commands.length === 0) {
			return sortSlashCommands(SLASH_COMMANDS);
		}
		return sortSlashCommands(
			remote.commands.map((entry) => ({
				autoSubmit: entry.autoSubmit,
				command: entry.command,
				description: entry.description,
				source: entry.source,
				sourceScope: entry.sourceScope,
			})),
		);
	}, [data]);
}
