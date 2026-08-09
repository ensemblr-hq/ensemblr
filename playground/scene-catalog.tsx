import { AnswerPreview } from './answer-preview.tsx';
import { CommentPreviewScene } from './comment-preview.tsx';
import { ComposerScene } from './composer-preview.tsx';
import { ConflictsScene } from './conflicts-preview.tsx';
import { ConversationScrollScene } from './conversation-scroll-preview.tsx';
import { FilePreviewScene } from './file-preview.tsx';
import { OnboardingScene } from './onboarding-preview.tsx';
import { ProvidersScene } from './providers-preview.tsx';
import { RightSidebarHeaderScene } from './right-sidebar-header-preview.tsx';
import { StartingStatePreview } from './starting-state-preview.tsx';
import { TabScrollerScene } from './tab-scroller-preview.tsx';
import { TimelinePreview } from './timeline-preview.tsx';
import { ToolApprovalScene } from './tool-approval-preview.tsx';
import { TurnSummaryPreview } from './turn-summary-preview.tsx';
import { ViewersScene } from './viewers-preview.tsx';

/**
 * Each scene drives the shipped components with real tool payloads, so what the
 * canvas shows is what the timeline renders rather than a parallel mock-up. The
 * grouping is the left sidebar's only structure — a flat list of fifteen entries
 * stopped being scannable.
 */
export const SCENE_GROUPS = [
	{
		label: 'conversation',
		scenes: [
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
				id: 'scroll',
				label: 'scroll',
				render: () => <ConversationScrollScene />,
				source: 'playground/conversation-scroll-preview.tsx',
			},
			{
				id: 'composer',
				label: 'composer',
				render: () => <ComposerScene />,
				source: 'playground/composer-preview.tsx',
			},
			{
				id: 'tool-approval',
				label: 'tool approval',
				render: () => <ToolApprovalScene />,
				source: 'playground/tool-approval-preview.tsx',
			},
		],
	},
	{
		label: 'review',
		scenes: [
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
		],
	},
	{
		label: 'workbench',
		scenes: [
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
				id: 'starting',
				label: 'starting',
				render: () => <StartingStatePreview />,
				source: 'playground/starting-state-preview.tsx',
			},
		],
	},
	{
		label: 'setup',
		scenes: [
			{
				id: 'onboarding',
				label: 'onboarding',
				render: () => <OnboardingScene />,
				source: 'playground/onboarding-preview.tsx',
			},
			{
				id: 'providers',
				label: 'providers',
				render: () => <ProvidersScene />,
				source: 'playground/providers-preview.tsx',
			},
		],
	},
] as const;

/** One preview the canvas can show. */
export type Scene = (typeof SCENE_GROUPS)[number]['scenes'][number];

/** Every scene in navigation order, flattened out of its group. */
const SCENES: readonly Scene[] = SCENE_GROUPS.flatMap(
	(group): readonly Scene[] => group.scenes,
);

/** Identifies the scene the canvas is currently showing. */
export type SceneId = Scene['id'];

/**
 * Resolves the scene behind an id, falling back to the first one so a stale id
 * lands on a canvas rather than a blank screen.
 * @param sceneId - Id of the scene to look up.
 * @returns The matching scene, or the first scene when there is no match.
 */
export function findScene(sceneId: SceneId): Scene {
	return SCENES.find((candidate) => candidate.id === sceneId) ?? SCENES[0];
}
