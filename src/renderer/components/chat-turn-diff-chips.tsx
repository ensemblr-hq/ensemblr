import { useQuery } from '@tanstack/react-query';
import { type RefObject, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { workspaceGitStatusQuery } from '@/renderer/api/ensemblr';
import { ChatAttachmentChip } from '@/renderer/components/chat-attachment-chip';
import { chipLabelsForPaths } from '@/renderer/lib/agent-timeline';
import type {
	WorkspaceGitDiffScope,
	WorkspaceGitFileWire,
} from '@/shared/ipc/contracts/workspace-git';

/**
 * How many file chips a turn shows before the rest collapse into a count that
 * opens the whole-turn diff. A turn that regenerates a lockfile touches
 * hundreds of files, and the footer is a one-line affordance, not a file list.
 */
const MAX_VISIBLE_CHIPS = 6;

/**
 * Whether a changed row names bytes the diff viewer can show. A symlink does
 * not: its content is the path it points at, so a diff of it reports a link
 * target rather than a change, and an untracked one has no counts to report
 * either. Both listings carry links as ordinary file rows, so this is the only
 * thing separating them.
 * @param file - A changed-file row from the git status read
 * @returns Whether the row can open a diff
 */
function isDiffableFile(file: WorkspaceGitFileWire): boolean {
	return file.symlinkTargetKind === undefined;
}

/**
 * Line counts for one changed file, rendered inside its chip.
 *
 * Binary files report `null` for both, in which case nothing is drawn rather
 * than a misleading `+0 -0`.
 */
function DiffCounts({ file }: { file: WorkspaceGitFileWire }) {
	if (file.additions === null && file.deletions === null) {
		return null;
	}
	return (
		<span className='flex shrink-0 items-center gap-1 font-mono text-xxs tabular-nums'>
			{file.additions === null ? null : (
				<span className='text-diff-addition-foreground'>+{file.additions}</span>
			)}
			{file.deletions === null ? null : (
				<span className='text-diff-deletion-foreground'>-{file.deletions}</span>
			)}
		</span>
	);
}

/**
 * Reports whether the element has been on screen at least once, latching to
 * true so the query it gates does not unmount as the transcript scrolls.
 * @param target - Element to observe
 * @returns Whether the element has ever intersected the viewport
 */
function useHasBeenVisible(target: RefObject<HTMLElement | null>): boolean {
	const [seen, setSeen] = useState(false);

	useEffect(() => {
		if (seen) {
			return;
		}
		// Somewhere without the API, gating on it would hide the chips forever
		// rather than merely delay them, so treat it as already visible.
		if (typeof IntersectionObserver === 'undefined') {
			setSeen(true);
			return;
		}
		const element = target.current;
		if (!element) {
			return;
		}
		const observer = new IntersectionObserver((entries) => {
			if (entries.some((entry) => entry.isIntersecting)) {
				setSeen(true);
			}
		});
		observer.observe(element);
		return () => observer.disconnect();
	}, [seen, target]);

	return seen;
}

/**
 * The files one agent turn changed, as clickable chips on that turn's footer.
 *
 * The transcript is not virtualized, so every settled turn in it would
 * otherwise issue its own `git diff` on first paint; the read is held back
 * until the footer has scrolled into view at least once.
 */
export function ChatTurnDiffChips({
	onOpenFile,
	onOpenTurnDiff,
	scope,
	workspaceCwd,
}: {
	onOpenFile: (filePath: string) => void;
	/** Opens the whole-turn diff, which the overflow count leads to. */
	onOpenTurnDiff?: () => void;
	scope: Extract<WorkspaceGitDiffScope, { kind: 'turn' }>;
	workspaceCwd: string | null;
}) {
	const { t } = useTranslation();
	const anchorRef = useRef<HTMLSpanElement>(null);
	const isVisible = useHasBeenVisible(anchorRef);
	const { data } = useQuery({
		...workspaceGitStatusQuery(workspaceCwd, scope),
		enabled: Boolean(workspaceCwd) && isVisible,
	});

	const files = data && !data.error ? data.files : [];
	const visible = files.slice(0, MAX_VISIBLE_CHIPS);
	const overflow = files.length - visible.length;
	// Resolved over the visible chips alone: a name the overflow count hides is
	// not on screen to be confused with, and lengthening a label for it would
	// read as noise.
	const labels = chipLabelsForPaths(visible.map((file) => file.path));

	return (
		<span
			className='flex min-w-0 flex-1 flex-wrap items-center gap-1'
			ref={anchorRef}
		>
			{visible.map((file) => {
				const diffable = isDiffableFile(file);
				return (
					<ChatAttachmentChip
						key={file.path}
						label={labels.get(file.path) ?? file.path}
						onActivate={diffable ? () => onOpenFile(file.path) : undefined}
						symlinkTargetKind={file.symlinkTargetKind}
						title={
							diffable
								? file.path
								: t(
										'common:turn-footer.symlink',
										'{{path}} is a symlink and has no diff',
										{ path: file.path },
									)
						}
						trailing={diffable ? <DiffCounts file={file} /> : null}
					/>
				);
			})}
			{overflow > 0 ? (
				<button
					className='rounded-md px-1 text-muted-foreground text-xs underline-offset-2 hover:text-foreground hover:underline'
					onClick={onOpenTurnDiff}
					type='button'
				>
					{t('common:turn-footer.more-files', {
						count: overflow,
						defaultValue_one: '+{{count}} more file',
						defaultValue_other: '+{{count}} more files',
					})}
				</button>
			) : null}
		</span>
	);
}
