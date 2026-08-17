import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { workspaceFileDiffQuery } from '@/renderer/api/ensemblr-queries';
import { failureText } from '@/renderer/lib/failure-text';
import {
	attachFileDiff,
	workspaceFileAttachment,
} from '@/renderer/lib/workbench/composer-attachments';
import { useComposerAttachmentInsert } from '@/renderer/state/composer';
import type { FileTreeMenuTarget } from '@/renderer/types/workbench';
import type { WorkspaceGitDiffScope } from '@/shared/ipc/contracts/workspace-git';

/**
 * The chip label for a path: its last segment, falling back to the whole path for
 * a single-segment one.
 * @param path - Workspace-relative path being attached
 * @returns The basename; never empty
 */
function basename(path: string): string {
	return path.split('/').at(-1) || path;
}

/**
 * Attaches a workspace entry or a file's diff to the chat as a composer chip, the
 * one path the Files tree and the Changes list both take from their right-click
 * menus. Both land in whichever composer is mounted on this workspace root, since
 * a review surface sits outside the conversation and the paths it carries are
 * workspace-relative.
 *
 * A file or folder is attached by reference — the agent reads it at send — while a
 * diff has no file of its own, so its patch is written out as a markdown document
 * first and the chip points at that.
 * @param scope - Which diff a row's patch is taken at; the working tree by default
 * @param workspaceCwd - Absolute workspace root the attachments resolve against
 * @returns Callbacks attaching a tree row and attaching one file's diff
 */
export function useAttachToChat({
	scope,
	workspaceCwd,
}: {
	scope?: WorkspaceGitDiffScope;
	workspaceCwd: string;
}): {
	attachDiff: (filePath: string) => void;
	attachEntry: (target: FileTreeMenuTarget) => void;
} {
	const { t } = useTranslation();
	const queryClient = useQueryClient();
	const insertAttachment = useComposerAttachmentInsert(workspaceCwd);

	const attachEntry = useCallback(
		(target: FileTreeMenuTarget) => {
			const label = basename(target.relativePath);
			insertAttachment(
				workspaceFileAttachment({
					kind: target.relativePathKind,
					name: label,
					path: target.relativePath,
				}),
			);
			toast.success(
				t(
					'workbench:attach-to-chat.attached',
					'{{label}} is attached to the chat.',
					{
						label,
					},
				),
			);
		},
		[insertAttachment, t],
	);

	const attachDiff = useCallback(
		async (filePath: string) => {
			const result = await queryClient.fetchQuery(
				workspaceFileDiffQuery({ filePath, scope, workspaceCwd }),
			);
			// A refused path or a failed `git diff` is not an unchanged file, and
			// reporting it as one is the single conclusion the user must not draw.
			if (result.error) {
				toast.error(failureText(t, result.error) ?? result.error.message);
				return;
			}
			if (!result.patch) {
				toast.error(
					t(
						'errors:attachment.file-diff-empty.message',
						'{{label}} has no diff to attach.',
						{ label: basename(filePath) },
					),
				);
				return;
			}
			insertAttachment(
				await attachFileDiff({
					filePath: result.path,
					patch: result.patch,
					workspaceCwd,
				}),
			);
			toast.success(
				t(
					'workbench:attach-to-chat.diff-attached',
					'Diff for {{label}} is attached to the chat.',
					{ label: basename(result.path) },
				),
			);
		},
		[insertAttachment, queryClient, scope, t, workspaceCwd],
	);

	return useMemo(
		() => ({
			attachDiff(filePath) {
				void attachDiff(filePath).catch(() => {
					toast.error(
						t(
							'errors:attachment.file-diff-failed.message',
							'Diff could not be attached.',
						),
					);
				});
			},
			attachEntry,
		}),
		[attachDiff, attachEntry, t],
	);
}
