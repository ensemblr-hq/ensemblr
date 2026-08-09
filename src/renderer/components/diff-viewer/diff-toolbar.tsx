import { useAtom } from 'jotai';
import {
	Columns2Icon,
	EyeIcon,
	FileDiffIcon,
	FileIcon,
	WrapTextIcon,
} from 'lucide-react';
import { type ComponentType, useId } from 'react';
import { useTranslation } from 'react-i18next';

import { IconToggle } from '@/renderer/components/icon-toggle';
import { Button } from '@/renderer/components/ui/button';
import { Checkbox } from '@/renderer/components/ui/checkbox';
import { Label } from '@/renderer/components/ui/label';
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
import type { DiffViewMode } from '@/renderer/types/diff';

/** Inputs for {@link DiffToolbar}: the modes it switches, and review state it can mark. */
interface DiffToolbarProps {
	fileModeDisabled: boolean;
	/** Records or clears the file's "viewed" mark; omit to hide that control. */
	onViewedChange?: (viewed: boolean) => void;
	onViewModeChange: (mode: DiffViewMode) => void;
	viewed?: boolean;
	viewMode: DiffViewMode;
}

/**
 * Toolbar of diff-viewer toggles: a Diff/File segmented switch plus unified ↔
 * split, hidden characters, and word wrap, and — where the surrounding viewer
 * tracks review state — a Viewed marker. Layout, whitespace, and word-wrap are
 * persisted app-wide; the diff/file mode is owned by the surrounding viewer.
 */
export function DiffToolbar({
	fileModeDisabled,
	onViewedChange,
	onViewModeChange,
	viewed = false,
	viewMode,
}: DiffToolbarProps) {
	const { t } = useTranslation();
	const [layout, setLayout] = useAtom(diffLayoutAtom);
	const [showWhitespace, setShowWhitespace] = useAtom(diffShowWhitespaceAtom);
	const [wordWrap, setWordWrap] = useAtom(diffWordWrapAtom);

	return (
		<div className='flex items-center gap-1'>
			<div className='mr-1 flex items-center rounded-md border border-border p-0.5'>
				<ViewModeButton
					active={viewMode === 'diff'}
					icon={FileDiffIcon}
					label={t('review:diff-toolbar.mode-diff', 'Diff')}
					onClick={() => onViewModeChange('diff')}
				/>
				<ViewModeButton
					active={viewMode === 'file'}
					disabled={fileModeDisabled}
					disabledHint={t(
						'review:diff-toolbar.mode-file-unavailable',
						'Full file view is unavailable for this diff',
					)}
					icon={FileIcon}
					label={t('review:diff-toolbar.mode-file', 'File')}
					onClick={() => onViewModeChange('file')}
				/>
			</div>
			<IconToggle
				active={layout === 'split'}
				label={
					layout === 'split'
						? t('review:diff-toolbar.unified-view', 'Unified view')
						: t('review:diff-toolbar.split-view', 'Split view')
				}
				onClick={() => setLayout(layout === 'split' ? 'unified' : 'split')}
			>
				<Columns2Icon />
			</IconToggle>
			<IconToggle
				active={showWhitespace}
				label={
					showWhitespace
						? t('review:diff-toolbar.hide-whitespace', 'Hide hidden characters')
						: t('review:diff-toolbar.show-whitespace', 'Show hidden characters')
				}
				onClick={() => setShowWhitespace(!showWhitespace)}
			>
				<EyeIcon />
			</IconToggle>
			<IconToggle
				active={wordWrap}
				label={
					wordWrap
						? t('review:diff-toolbar.disable-word-wrap', 'Disable word wrap')
						: t('review:diff-toolbar.enable-word-wrap', 'Enable word wrap')
				}
				onClick={() => setWordWrap(!wordWrap)}
			>
				<WrapTextIcon />
			</IconToggle>
			{onViewedChange ? (
				<>
					<div aria-hidden='true' className='mx-1 h-4 w-px bg-border' />
					<ViewedCheckbox onChange={onViewedChange} viewed={viewed} />
				</>
			) : null}
		</div>
	);
}

/**
 * Marks the file on screen as reviewed. A checkbox rather than another toggle
 * button: it records review progress instead of changing how the diff is drawn,
 * and a filled box states which of the two it is at a glance.
 */
function ViewedCheckbox({
	onChange,
	viewed,
}: {
	onChange: (viewed: boolean) => void;
	viewed: boolean;
}) {
	const { t } = useTranslation();
	const checkboxId = useId();

	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<Label
					className={cn(
						'h-6 cursor-pointer gap-1.5 rounded-sm px-1.5 font-normal text-xs',
						viewed ? 'text-foreground' : 'text-muted-foreground',
					)}
					htmlFor={checkboxId}
				>
					<Checkbox
						checked={viewed}
						className='size-3.5 [&_svg]:size-3'
						id={checkboxId}
						onCheckedChange={(checked) => onChange(checked === true)}
					/>
					{t('review:diff-toolbar.viewed', 'Viewed')}
				</Label>
			</TooltipTrigger>
			<TooltipContent>
				{viewed
					? t('review:diff-toolbar.unmark-viewed', 'Unmark viewed')
					: t('review:diff-toolbar.mark-viewed', 'Mark viewed')}
			</TooltipContent>
		</Tooltip>
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
