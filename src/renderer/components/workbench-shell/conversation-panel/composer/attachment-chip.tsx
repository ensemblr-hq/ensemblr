import { Icon } from '@iconify/react';
import { XIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
	GithubLogo,
	LinearLogo,
} from '@/renderer/components/workbench-shell/source-provider-logo';
import { cn } from '@/renderer/lib/utils';
import { getWorkspaceFileIconName } from '@/renderer/lib/workbench';
import type { ComposerAttachment } from '@/renderer/types/workbench';

/**
 * The glyph that says where an attachment came from: a tracker issue wears its
 * provider's brand mark, since the markdown document it was written to would
 * otherwise render as an anonymous file icon.
 */
function AttachmentIcon({ attachment }: { attachment: ComposerAttachment }) {
	if (attachment.kind === 'issue') {
		const Logo = attachment.provider === 'linear' ? LinearLogo : GithubLogo;
		return <Logo className='size-3.5 shrink-0' />;
	}
	return (
		<Icon
			aria-hidden='true'
			className='size-3.5 shrink-0'
			icon={getWorkspaceFileIconName({
				kind: attachment.kind === 'workspace-directory' ? 'directory' : 'file',
				name: attachment.label,
			})}
		/>
	);
}

/**
 * Compact chip for one composer attachment, whatever its source: a VSCode-style
 * icon and the attachment's label inside a rounded outlined pill. The label
 * truncates rather than widening the chip, so one long path cannot push the
 * chips below it onto another row.
 */
export function AttachmentChip({
	attachment,
	onRemove,
}: {
	attachment: ComposerAttachment;
	onRemove: () => void;
}) {
	const { t } = useTranslation();
	const label = attachment.label;

	return (
		<span
			className={cn(
				'group/chip inline-flex h-6 max-w-xs items-center gap-1.5 rounded-md border border-border bg-background px-1.5 text-xs',
				'hover:border-border/80',
			)}
			title={label}
		>
			<AttachmentIcon attachment={attachment} />
			<span className='truncate font-medium'>{label}</span>
			<button
				aria-label={t('common:actions.remove-named', 'Remove {{label}}', {
					label,
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
