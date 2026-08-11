import { FolderSymlinkIcon, XIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

/**
 * Chip for a directory outside the workspace this chat may read. Two lines
 * rather than one: several folders share a basename, so the absolute path is the
 * only thing that says which one is linked — and it is also what the agent was
 * granted, so it belongs on screen.
 */
export function LinkedDirectoryChip({
	name,
	onRemove,
	path,
	pending,
}: {
	name: string;
	onRemove: () => void;
	path: string;
	/** True while the running session predates this link and cannot read it yet. */
	pending?: boolean;
}) {
	const { t } = useTranslation();

	return (
		<span
			className='group/chip inline-flex h-9 max-w-xs items-center gap-1.5 rounded-md border border-border bg-background px-1.5 align-bottom'
			title={path}
		>
			<FolderSymlinkIcon
				aria-hidden='true'
				className={
					pending
						? 'size-3.5 shrink-0 text-muted-foreground/60'
						: 'size-3.5 shrink-0 text-muted-foreground'
				}
			/>
			<span className='flex min-w-0 flex-col'>
				<span className='truncate font-medium text-xs leading-tight'>
					{name}
				</span>
				<span className='truncate text-muted-foreground text-xxs leading-tight'>
					{path}
				</span>
			</span>
			<button
				aria-label={t('common:actions.remove-named', 'Remove {{label}}', {
					label: name,
				})}
				className='inline-flex size-3.5 shrink-0 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground'
				onClick={onRemove}
				type='button'
			>
				<XIcon className='size-3' />
			</button>
		</span>
	);
}
