import { Copy, Minus, Square, X } from 'lucide-react';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { closeWindow, minimizeWindow } from '@/renderer/api/ensemblr';
import { Button } from '@/renderer/components/ui/button';
import { cn } from '@/renderer/lib/utils';
import { TOOLBAR_HEIGHT_CLASS } from '@/renderer/lib/workbench/shell-inset';

import { useDragRegionDoubleClick } from './use-drag-region-double-click';
import { useWindowMaximized } from './use-window-maximized';

/**
 * Ensemblr's own minimize / maximize / close cluster, drawn in the app's visual
 * language rather than imitating GNOME or KDE.
 *
 * Mounted once as a fixed overlay in the window's top-right corner, because the
 * rightmost toolbar differs per route; the trailing inset that keeps a toolbar's
 * own actions out from under it is a CSS rule keyed on the
 * `app-window-controls` class the chrome resolver sets.
 *
 * Close goes through `closeWindow`, which fires the window's `close` event and
 * therefore the quit confirmation. Calling `app.quit()` here would kill running
 * agents without asking.
 */
export function WindowControls() {
	const { maximized, toggle } = useWindowMaximized();

	const toggleMaximize = useCallback(() => {
		void toggle();
	}, [toggle]);

	useDragRegionDoubleClick(toggleMaximize, true);

	return (
		<div className='fixed top-0 right-0 z-50'>
			<WindowControlCluster
				isMaximized={maximized}
				onClose={() => void closeWindow()}
				onMinimize={() => void minimizeWindow()}
				onToggleMaximize={toggleMaximize}
			/>
		</div>
	);
}

/**
 * The three buttons themselves, with no window plumbing, so the overlay above
 * and the playground can each mount them.
 *
 * The cluster is positioned against the window rather than against any one
 * toolbar, so it takes its height from the same custom property
 * `.native-toolbar` does — otherwise a toolbar that changed height would leave
 * the buttons sitting off-centre against it.
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
		<div className={cn('flex items-center gap-1 px-2', TOOLBAR_HEIGHT_CLASS)}>
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
