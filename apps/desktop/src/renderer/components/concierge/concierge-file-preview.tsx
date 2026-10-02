import { useQuery } from '@tanstack/react-query';
import { useAtom } from 'jotai';
import { XIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import {
	ensemblrQueryKeys,
	readWorkspaceFile,
} from '@/renderer/api/ensemblr-queries';
import { CodeViewerHeader } from '@/renderer/components/code-surface';
import { Button } from '@/renderer/components/ui/button';
import { FilePreviewBody } from '@/renderer/components/workbench-shell/conversation-panel/file-preview-body';
import { describeReadFailure } from '@/renderer/components/workbench-shell/conversation-panel/file-preview-helpers';
import { PanelMessage } from '@/renderer/components/workbench-shell/conversation-panel/panel-message';
import { conciergePreviewAtom } from '@/renderer/state/concierge';

/**
 * Read-only view of a file in the Concierge home — a memory note or an artifact
 * — shown over the transcript inside the panel.
 *
 * It lives in the panel rather than opening a workspace file tab because the
 * Concierge home belongs to no workspace: there is no file tree to place it in,
 * and the panel is reachable from the dashboard where no workspace is focused at
 * all. The read goes through the same `readWorkspaceFile` channel a workspace
 * preview uses, resolved against the home as its working directory, so markdown,
 * images, and oversized files all behave exactly as they do there.
 *
 * Renders nothing when no file is selected, which is what lets the panel mount
 * it unconditionally beside the timeline.
 */
export function ConciergeFilePreview({ home }: { home: string | null }) {
	const { t } = useTranslation();
	const [target, setTarget] = useAtom(conciergePreviewAtom);
	const path = target?.path ?? '';
	const { data, isError, isPending } = useQuery({
		enabled: Boolean(home && path),
		queryFn: () => readWorkspaceFile({ path, workspaceCwd: home ?? '' }),
		queryKey: ensemblrQueryKeys.filePreview(home ?? '', path),
		staleTime: 5_000,
	});

	if (!target) {
		return null;
	}

	return (
		<div className='absolute inset-0 z-10 flex min-h-0 flex-col bg-background'>
			<CodeViewerHeader
				actions={
					<Button
						aria-label={t(
							'workbench:concierge.preview.close',
							'Back to the conversation',
						)}
						onClick={() => setTarget(null)}
						size='icon'
						variant='ghost'
					>
						<XIcon aria-hidden='true' className='size-4' />
					</Button>
				}
				title={target.path}
			/>
			<PreviewContent
				data={data}
				isError={isError}
				isPending={isPending}
				path={path}
				workspaceCwd={home ?? ''}
			/>
		</div>
	);
}

/** The read's three outcomes — loading, failed, and readable — as one body. */
function PreviewContent({
	data,
	isError,
	isPending,
	path,
	workspaceCwd,
}: {
	data: Awaited<ReturnType<typeof readWorkspaceFile>> | undefined;
	isError: boolean;
	isPending: boolean;
	path: string;
	workspaceCwd: string;
}) {
	const { t } = useTranslation();

	if (isPending) {
		return (
			<PanelMessage
				message={t(
					'workbench:file-preview.empty.loading',
					'Loading {{filePath}}…',
					{ filePath: path },
				)}
			/>
		);
	}
	if (isError || !data) {
		return (
			<PanelMessage
				message={t(
					'workbench:file-preview.failure.unreadable',
					'Could not read {{filePath}}.',
					{ filePath: path },
				)}
				tone='error'
			/>
		);
	}
	if (data.error) {
		return (
			<PanelMessage
				message={describeReadFailure(data.error.code, path, t)}
				tone='error'
			/>
		);
	}
	return (
		<FilePreviewBody
			filePath={path}
			result={data}
			workspaceCwd={workspaceCwd}
		/>
	);
}
