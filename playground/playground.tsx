import { useSetAtom } from 'jotai';
import { useEffect, useState } from 'react';

import { cn } from '@/renderer/lib/utils';
import { codeThemeAtom } from '@/renderer/state/preferences';

import { AnswerPreview } from './answer-preview.tsx';
import { CommentPreviewScene } from './comment-preview.tsx';
import { ComposerScene } from './composer-preview.tsx';
import { ConflictsScene } from './conflicts-preview.tsx';
import { ConversationScrollScene } from './conversation-scroll-preview.tsx';
import { FilePreviewScene } from './file-preview.tsx';
import { RightSidebarHeaderScene } from './right-sidebar-header-preview.tsx';
import { StartingStatePreview } from './starting-state-preview.tsx';
import { TabScrollerScene } from './tab-scroller-preview.tsx';
import { TimelinePreview } from './timeline-preview.tsx';
import { TurnSummaryPreview } from './turn-summary-preview.tsx';
import { ViewersScene } from './viewers-preview.tsx';

const CANVAS_WIDTHS = [
	{ className: 'max-w-md', id: 'narrow', label: '448' },
	{ className: 'max-w-3xl', id: 'chat', label: '768' },
	{ className: 'max-w-none', id: 'full', label: 'full' },
] as const;

/**
 * Each scene drives the shipped components with real tool payloads, so what the
 * canvas shows is what the timeline renders rather than a parallel mock-up.
 */
const SCENES = [
	{
		id: 'app',
		label: 'app',
		render: () => <TimelinePreview />,
		source: 'playground/timeline-preview.tsx',
	},
	{
		id: 'answer',
		label: 'answer',
		render: () => <AnswerPreview />,
		source: 'playground/answer-preview.tsx',
	},
	{
		id: 'summary',
		label: 'summary',
		render: () => <TurnSummaryPreview />,
		source: 'playground/turn-summary-preview.tsx',
	},
	{
		id: 'file',
		label: 'file',
		render: () => <FilePreviewScene />,
		source: 'playground/file-preview.tsx',
	},
	{
		id: 'comment',
		label: 'comment',
		render: () => <CommentPreviewScene />,
		source: 'playground/comment-preview.tsx',
	},
	{
		id: 'tabs',
		label: 'tabs',
		render: () => <TabScrollerScene />,
		source: 'playground/tab-scroller-preview.tsx',
	},
	{
		id: 'viewers',
		label: 'viewers',
		render: () => <ViewersScene />,
		source: 'playground/viewers-preview.tsx',
	},
	{
		id: 'scroll',
		label: 'scroll',
		render: () => <ConversationScrollScene />,
		source: 'playground/conversation-scroll-preview.tsx',
	},
	{
		id: 'starting',
		label: 'starting',
		render: () => <StartingStatePreview />,
		source: 'playground/starting-state-preview.tsx',
	},
	{
		id: 'pr-header',
		label: 'pr header',
		render: () => <RightSidebarHeaderScene />,
		source: 'playground/right-sidebar-header-preview.tsx',
	},
	{
		id: 'conflicts',
		label: 'conflicts',
		render: () => <ConflictsScene />,
		source: 'playground/conflicts-preview.tsx',
	},
	{
		id: 'composer',
		label: 'composer',
		render: () => <ComposerScene />,
		source: 'playground/composer-preview.tsx',
	},
] as const;

const THEMES = ['light', 'dark'] as const;

/**
 * Two families from Settings → Appearance → Code theme. Only syntax colours
 * come from the picked family — the surface under them follows the app theme —
 * so switching families here proves the setting reaches the tokens and nothing
 * else. Each family flips to its own light or dark cut with the theme toggle.
 */
const CODE_THEMES = ['catppuccin-mocha', 'github-dark'] as const;

/** Which of the app's two root theme classes the canvas is pinned to. */
type PlaygroundTheme = (typeof THEMES)[number];

/**
 * Playground shell: a themeable, width-constrained canvas around the scene
 * previews. Nothing here ships with the app — it exists so timeline components
 * can be built and eyeballed in a plain browser, without the Electron runtime.
 */
export function Playground() {
	const [width, setWidth] =
		useState<(typeof CANVAS_WIDTHS)[number]['id']>('chat');
	const [sceneId, setSceneId] = useState<(typeof SCENES)[number]['id']>('app');
	const [theme, setTheme] = useState<PlaygroundTheme>('dark');
	const [codeTheme, setCodeThemeLabel] =
		useState<(typeof CODE_THEMES)[number]>('catppuccin-mocha');
	const setCodeTheme = useSetAtom(codeThemeAtom);
	const canvasWidth =
		CANVAS_WIDTHS.find((candidate) => candidate.id === width) ??
		CANVAS_WIDTHS[1];
	const scene =
		SCENES.find((candidate) => candidate.id === sceneId) ?? SCENES[0];

	useEffect(() => {
		const root = document.documentElement;
		for (const candidate of THEMES) {
			root.classList.toggle(candidate, candidate === theme);
		}
	}, [theme]);

	return (
		<div className='flex h-screen w-screen flex-col overflow-hidden bg-canvas text-foreground'>
			<PlaygroundToolbar
				codeTheme={codeTheme}
				onCodeThemeChange={(option) => {
					setCodeThemeLabel(option);
					setCodeTheme(option);
				}}
				onSceneChange={setSceneId}
				onThemeChange={setTheme}
				onWidthChange={setWidth}
				sceneId={sceneId}
				source={scene.source}
				theme={theme}
				width={width}
			/>

			<div className='flex min-h-0 flex-1 justify-center overflow-hidden bg-canvas'>
				<div
					className={cn(
						'flex min-h-0 w-full flex-col overflow-y-auto bg-canvas p-6 text-foreground',
						canvasWidth.className,
					)}
				>
					{scene.render()}
				</div>
			</div>
		</div>
	);
}

/**
 * Playground chrome: the scene picker on its own row, then the active scene's
 * source path beside the canvas controls. The scene list grows with the app, so
 * it gets the full width and the canvas controls are labelled — one flat run of
 * pills stopped fitting and stopped being readable.
 */
function PlaygroundToolbar({
	codeTheme,
	onCodeThemeChange,
	onSceneChange,
	onThemeChange,
	onWidthChange,
	sceneId,
	source,
	theme,
	width,
}: {
	codeTheme: (typeof CODE_THEMES)[number];
	onCodeThemeChange: (option: (typeof CODE_THEMES)[number]) => void;
	onSceneChange: (id: (typeof SCENES)[number]['id']) => void;
	onThemeChange: (theme: PlaygroundTheme) => void;
	onWidthChange: (id: (typeof CANVAS_WIDTHS)[number]['id']) => void;
	sceneId: (typeof SCENES)[number]['id'];
	source: string;
	theme: PlaygroundTheme;
	width: (typeof CANVAS_WIDTHS)[number]['id'];
}) {
	return (
		<header className='flex shrink-0 flex-col gap-2 border-border border-b bg-toolbar px-4 py-2'>
			<div className='flex flex-wrap items-center gap-1'>
				{SCENES.map((option) => (
					<ToolbarToggle
						isActive={option.id === sceneId}
						key={option.id}
						label={option.label}
						onClick={() => onSceneChange(option.id)}
					/>
				))}
			</div>
			<div className='flex flex-wrap items-center gap-x-4 gap-y-1.5'>
				<span className='truncate font-mono text-muted-foreground text-xxs'>
					{source}
				</span>
				<div className='ml-auto flex flex-wrap items-center gap-x-4 gap-y-1.5'>
					<ToolbarGroup label='code'>
						{CODE_THEMES.map((option) => (
							<ToolbarToggle
								isActive={option === codeTheme}
								key={option}
								label={option.replace(/-.*$/, '')}
								onClick={() => onCodeThemeChange(option)}
							/>
						))}
					</ToolbarGroup>
					<ToolbarGroup label='width'>
						{CANVAS_WIDTHS.map((option) => (
							<ToolbarToggle
								isActive={option.id === width}
								key={option.id}
								label={option.label}
								onClick={() => onWidthChange(option.id)}
							/>
						))}
					</ToolbarGroup>
					<ToolbarGroup label='theme'>
						{THEMES.map((candidate) => (
							<ToolbarToggle
								isActive={candidate === theme}
								key={candidate}
								label={candidate}
								onClick={() => onThemeChange(candidate)}
							/>
						))}
					</ToolbarGroup>
				</div>
			</div>
		</header>
	);
}

/**
 * Names one cluster of canvas toggles. The scene list grows with the app, so the
 * canvas controls carry their own labels rather than being told apart by
 * position in a single undifferentiated run of pills.
 */
function ToolbarGroup({
	children,
	label,
}: {
	children: React.ReactNode;
	label: string;
}) {
	return (
		<div className='flex items-center gap-1'>
			<span className='font-mono text-muted-foreground text-xxs uppercase tracking-wide'>
				{label}
			</span>
			{children}
		</div>
	);
}

/** Compact toolbar pill used for the width presets and the theme switch. */
function ToolbarToggle({
	isActive,
	label,
	onClick,
}: {
	isActive: boolean;
	label: string;
	onClick: () => void;
}) {
	return (
		<button
			className={cn(
				'rounded-md border px-2 py-1 font-mono text-xxs transition-colors',
				isActive
					? 'border-border bg-surface text-foreground'
					: 'border-transparent text-muted-foreground hover:bg-accent/50',
			)}
			onClick={onClick}
			type='button'
		>
			{label}
		</button>
	);
}
