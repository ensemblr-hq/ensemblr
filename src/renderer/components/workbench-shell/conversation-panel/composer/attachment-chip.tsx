import { Icon } from '@iconify/react';
import { XIcon } from 'lucide-react';
import { cn } from '@/renderer/lib/utils';
import { getWorkspaceFileIconName } from '@/renderer/lib/workbench';
import type { WorkspaceFileSummary } from '@/renderer/types/workbench';

/** Props for a composer attachment chip. */
interface AttachmentChipProps {
	file: WorkspaceFileSummary | { kind: 'upload'; name: string };
	onRemove: () => void;
}

/**
 * Compact chip rendered above the textarea for repo-file mentions and local
 * uploads. Mirrors the reference design: VSCode-style icon + monospace label
 * inside a rounded outlined pill.
 */
export function AttachmentChip({ file, onRemove }: AttachmentChipProps) {
	const isWorkspaceFile = 'kind' in file && file.kind !== 'upload';
	const label = file.name;
	const iconName = isWorkspaceFile
		? getWorkspaceFileIconName(file as WorkspaceFileSummary)
		: 'vscode-icons:default-file';

	return (
		<span
			className={cn(
				'group/chip inline-flex h-6 items-center gap-1.5 rounded-md border border-border bg-background px-1.5 text-xs',
				'hover:border-border/80',
			)}
		>
			<Icon aria-hidden='true' className='size-3.5 shrink-0' icon={iconName} />
			<span className='font-medium'>{label}</span>
			<button
				aria-label={`Remove ${label}`}
				className='inline-flex size-3.5 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground'
				onClick={onRemove}
				type='button'
			>
				<XIcon className='size-3' />
			</button>
		</span>
	);
}
