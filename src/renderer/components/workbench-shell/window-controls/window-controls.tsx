import { Copy, Minus, Square, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/renderer/components/ui/button';
import { cn } from '@/renderer/lib/utils';

/**
 * Ensemblr's own minimize / maximize / close cluster, drawn in the app's visual
 * language rather than imitating GNOME or KDE.
 *
 * Buttons only, with no window plumbing, so the title bar above and the
 * playground can each mount them. It takes its height from whatever strip hosts
 * it rather than setting one, because the only strip that hosts it in the app is
 * the title bar and a second height there would be a second source of truth.
 *
 * It carries a group label because a screen reader meets three unrelated icon
 * buttons at the top of the document otherwise, with nothing saying they are the
 * window's own controls rather than the app's.
 */
export function WindowControlCluster({
	isMaximized,
	onClose,
	onMinimize,
	onToggleMaximize,
}: {
	isMaximized: boolean;
	onClose: () => void;
	onMinimize: () => void;
	onToggleMaximize: () => void;
}) {
	const { t } = useTranslation();
	const MaximizeIcon = isMaximized ? Copy : Square;

	return (
		// biome-ignore lint/a11y/useSemanticElements: the semantic equivalent is <fieldset>, which groups form controls; these are the window's.
		<div
			aria-label={t('workbench:window-controls.group', 'Window controls')}
			className='window-control-cluster flex shrink-0 items-center gap-1 px-2'
			role='group'
		>
			<WindowControlButton
				label={t('workbench:window-controls.minimize', 'Minimize')}
				onClick={onMinimize}
			>
				<Minus aria-hidden='true' className='size-3.5' />
			</WindowControlButton>
			<WindowControlButton
				label={
					isMaximized
						? t('workbench:window-controls.restore', 'Restore')
						: t('workbench:window-controls.maximize', 'Maximize')
				}
				onClick={onToggleMaximize}
			>
				<MaximizeIcon aria-hidden='true' className='size-3' />
			</WindowControlButton>
			<WindowControlButton
				label={t('workbench:window-controls.close', 'Close window')}
				onClick={onClose}
				tone='destructive'
			>
				<X aria-hidden='true' className='size-3.5' />
			</WindowControlButton>
		</div>
	);
}

/**
 * One control in the cluster: an icon-only ghost button carrying the translated
 * name of what it does, since the glyph alone tells a screen reader nothing.
 */
function WindowControlButton({
	children,
	label,
	onClick,
	tone = 'default',
}: {
	children: React.ReactNode;
	label: string;
	onClick: () => void;
	tone?: 'default' | 'destructive';
}) {
	return (
		<Button
			aria-label={label}
			className={cn(
				'size-7 text-muted-foreground hover:text-foreground',
				tone === 'destructive' &&
					'hover:bg-destructive/15 hover:text-destructive',
			)}
			onClick={onClick}
			size='icon'
			title={label}
			variant='ghost'
		>
			{children}
		</Button>
	);
}
