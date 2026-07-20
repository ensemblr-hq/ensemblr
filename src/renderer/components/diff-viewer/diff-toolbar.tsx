import { useAtom } from 'jotai';
import {
	Columns2Icon,
	EyeIcon,
	FileDiffIcon,
	FileIcon,
	WrapTextIcon,
} from 'lucide-react';
import type { ComponentType, ReactNode } from 'react';

import { Button } from '@/renderer/components/ui/button';
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from '@/renderer/components/ui/tooltip';
import { cn } from '@/renderer/lib/utils';
import {
	diffLayoutAtom,
	diffShowWhitespaceAtom,
	diffWordWrapAtom,
} from '@/renderer/state/preferences';
import type { DiffViewMode } from './diff-viewer';

/**
 * Toolbar of diff-viewer toggles: a Diff/File segmented switch plus unified ↔
 * split, hidden characters, and word wrap. Layout, whitespace, and word-wrap
 * are persisted app-wide; the diff/file mode is owned by the surrounding viewer.
 */
export function DiffToolbar({
	fileModeDisabled,
	onViewModeChange,
	viewMode,
}: {
	fileModeDisabled: boolean;
	onViewModeChange: (mode: DiffViewMode) => void;
	viewMode: DiffViewMode;
}) {
	const [layout, setLayout] = useAtom(diffLayoutAtom);
	const [showWhitespace, setShowWhitespace] = useAtom(diffShowWhitespaceAtom);
	const [wordWrap, setWordWrap] = useAtom(diffWordWrapAtom);

	return (
		<div className='flex items-center gap-1'>
			<div className='mr-1 flex items-center rounded-md border border-border p-0.5'>
				<ViewModeButton
					active={viewMode === 'diff'}
					icon={FileDiffIcon}
					label='Diff'
					onClick={() => onViewModeChange('diff')}
				/>
				<ViewModeButton
					active={viewMode === 'file'}
					disabled={fileModeDisabled}
					disabledHint='Full file view is unavailable for this diff'
					icon={FileIcon}
					label='File'
					onClick={() => onViewModeChange('file')}
				/>
			</div>
			<ToggleButton
				active={layout === 'split'}
				label={layout === 'split' ? 'Unified view' : 'Split view'}
				onClick={() => setLayout(layout === 'split' ? 'unified' : 'split')}
			>
				<Columns2Icon />
			</ToggleButton>
			<ToggleButton
				active={showWhitespace}
				label={
					showWhitespace ? 'Hide hidden characters' : 'Show hidden characters'
				}
				onClick={() => setShowWhitespace(!showWhitespace)}
			>
				<EyeIcon />
			</ToggleButton>
			<ToggleButton
				active={wordWrap}
				label={wordWrap ? 'Disable word wrap' : 'Enable word wrap'}
				onClick={() => setWordWrap(!wordWrap)}
			>
				<WrapTextIcon />
			</ToggleButton>
		</div>
	);
}

/**
 * One segment of the Diff/File switch: an always-visible labeled button,
 * highlighted when it is the active mode. When disabled it carries a tooltip
 * explaining why the mode is unavailable (e.g. no full-file source).
 */
function ViewModeButton({
	active,
	disabled,
	disabledHint,
	icon: Icon,
	label,
	onClick,
}: {
	active: boolean;
	disabled?: boolean;
	disabledHint?: string;
	icon: ComponentType<{ className?: string }>;
	label: string;
	onClick: () => void;
}) {
	const button = (
		<Button
			aria-label={label}
			aria-pressed={active}
			className={cn(
				'h-6 gap-1 rounded-sm px-2 text-xs [&_svg]:size-3.5',
				!active && 'text-muted-foreground',
			)}
			disabled={disabled}
			onClick={onClick}
			size='sm'
			variant={active ? 'secondary' : 'ghost'}
		>
			<Icon />
			{label}
		</Button>
	);
	if (!disabled || !disabledHint) {
		return button;
	}
	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<span className='inline-flex'>{button}</span>
			</TooltipTrigger>
			<TooltipContent>{disabledHint}</TooltipContent>
		</Tooltip>
	);
}

/** A single ghost icon toggle with a tooltip, highlighted when active. */
function ToggleButton({
	active,
	children,
	disabled,
	label,
	onClick,
}: {
	active: boolean;
	children: ReactNode;
	disabled?: boolean;
	label: string;
	onClick: () => void;
}) {
	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<Button
					aria-label={label}
					aria-pressed={active}
					className='size-7 [&_svg]:size-4'
					disabled={disabled}
					onClick={onClick}
					size='icon-sm'
					variant={active ? 'secondary' : 'ghost'}
				>
					{children}
				</Button>
			</TooltipTrigger>
			<TooltipContent>{label}</TooltipContent>
		</Tooltip>
	);
}
