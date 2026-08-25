import type { DynamicToolUIPart } from 'ai';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { ChatAttachmentChip } from '@/renderer/components/chat-attachment-chip';
import {
	presentCustomMessage,
	presentReasoning,
	presentSkillInvocation,
	presentTaskPlan,
	presentToolCall,
} from '@/renderer/lib/agent-timeline';
import {
	conciergeReferenceChipKind,
	conciergeReferenceTitle,
} from '@/renderer/lib/concierge';
import type { PiCustomMessageData } from '@/renderer/types/agent-timeline';
import type {
	ToolBadgeDescriptor,
	ToolChatBadgeDescriptor,
	ToolFileBadgeDescriptor,
	ToolPresentation,
	ToolWorkspaceBadgeDescriptor,
} from '@/renderer/types/tool-presentation';
import type { ConciergeReference } from '@/shared/concierge-references';
import type { ConciergeReferenceAccess } from './concierge/concierge-reference-context';
import {
	useConciergeReferenceAccess,
	useTimelineSurface,
} from './concierge/concierge-reference-context';
import { ToolCollapsible } from './tool-collapsible';
import { ToolBody } from './tool-collapsible/tool-body';
import { ToolCommandChip, ToolFileBadge } from './tool-collapsible/tool-chips';
import {
	useFilePreviewOpener,
	useWorkspacePathResolver,
} from './workbench-shell/conversation-panel/file-preview-context';

/**
 * One tool call in an assistant turn: a collapsible row whose icon, title,
 * badge, preview, and body all come from the projected presentation.
 */
export function ChatToolCall({ part }: { part: DynamicToolUIPart }) {
	const { i18n } = useTranslation();
	const surface = useTimelineSurface();
	// biome-ignore lint/correctness/useExhaustiveDependencies: the presenter translates through the i18n singleton, so the language is a real input Biome cannot see.
	const presentation = useMemo(
		() => presentToolCall(part, surface),
		[part, surface, i18n.language],
	);
	return <ToolRow presentation={presentation} />;
}

/**
 * The plan a run of task creations added up to, rendered as one checklist row
 * rather than as one row per task. The agent files a plan a task at a time, and
 * the run is the only place its shape survives.
 */
export function ChatTaskPlan({
	parts,
}: {
	parts: readonly DynamicToolUIPart[];
}) {
	const { i18n } = useTranslation();
	// biome-ignore lint/correctness/useExhaustiveDependencies: the presenter translates through the i18n singleton, so the language is a real input Biome cannot see.
	const presentation = useMemo(
		() => presentTaskPlan(parts),
		[parts, i18n.language],
	);
	return <ToolRow presentation={presentation} />;
}

/**
 * One reasoning block, rendered as the same collapsible row a tool call gets so
 * thinking and acting read as a single timeline rather than two styles. A block
 * whose runtime redacted the prose renders nothing: an inert row titled
 * "Thought" costs the turn a line and discloses nothing behind it.
 */
export function ChatReasoningCollapsible({ text }: { text: string }) {
	const { i18n } = useTranslation();
	// biome-ignore lint/correctness/useExhaustiveDependencies: the presenter translates through the i18n singleton, so the language is a real input Biome cannot see.
	const presentation = useMemo(
		() => presentReasoning(text),
		[text, i18n.language],
	);
	if (presentation === null) {
		return null;
	}
	return <ToolRow presentation={presentation} />;
}

/**
 * One extension-injected message, rendered as the same collapsible row a tool
 * call gets — context an extension pushed into the turn is activity, not prose
 * the assistant wrote, and it stays folded until asked for.
 */
export function ChatCustomMessage({ data }: { data: PiCustomMessageData }) {
	const { i18n } = useTranslation();
	// biome-ignore lint/correctness/useExhaustiveDependencies: the presenter translates through the i18n singleton, so the language is a real input Biome cannot see.
	const presentation = useMemo(
		() => presentCustomMessage(data),
		[data, i18n.language],
	);
	return <ToolRow presentation={presentation} />;
}

/**
 * One skill activation, rendered as the same row a tool call gets: the skill
 * named and marked "Skill activated", so invoking `/skill:name` reads as a step
 * the turn took rather than the whole `SKILL.md` pasted above it.
 */
export function ChatSkillInvocation({ name }: { name: string }) {
	const { i18n } = useTranslation();
	// biome-ignore lint/correctness/useExhaustiveDependencies: the presenter translates through the i18n singleton, so the language is a real input Biome cannot see.
	const presentation = useMemo(
		() => presentSkillInvocation(name),
		[name, i18n.language],
	);
	return <ToolRow presentation={presentation} />;
}

/**
 * Renders a projected presentation, binding its badge to whichever surface can
 * open what the badge names.
 *
 * The chip is resolved here rather than inside a badge component so the row can
 * see whether one will actually appear: a chat or workspace chip resolves against
 * a live catalogue and comes up empty outside the Concierge, and a row that pins
 * nothing must both skip the badge slot and put the subject back in its title.
 *
 * A body of kind `empty` disables the disclosure rather than offering a control
 * that opens onto nothing — a clean diagnostics run is the common case.
 */
function ToolRow({ presentation }: { presentation: ToolPresentation }) {
	const { badge, body, glyph, preview, title, tone, unpinnedTitle } =
		presentation;
	const subject = useToolRowSubject(badge);

	return (
		<ToolCollapsible
			disabled={body.kind === 'empty'}
			glyph={glyph}
			pending={body.kind === 'pending'}
			title={subject ? title : (unpinnedTitle ?? title)}
			tone={tone}
			toolBadge={subject ? <ToolRowBadge subject={subject} /> : null}
			toolPreview={
				preview ? (
					<ToolCommandChip font={preview.font} tone={tone}>
						{preview.text}
					</ToolCommandChip>
				) : null
			}
		>
			<ToolBody body={body} />
		</ToolCollapsible>
	);
}

/** What a row pins beside its title, already bound to what opens it. */
type ToolRowSubject =
	| {
			badge: ToolFileBadgeDescriptor;
			kind: 'file';
			onActivate: (() => void) | undefined;
	  }
	| {
			kind: 'reference';
			onActivate: () => void;
			reference: ConciergeReference;
	  };

/**
 * Resolves a badge descriptor against the surface that can open what it names,
 * answering null when nothing will render.
 *
 * A descriptor naming both a chat and its workspace prefers the chat and falls
 * back to the workspace, which is what keeps a spawn row pinned to something: a
 * tab nobody has named yet is deliberately absent from the catalogue, and that is
 * the state the row is written in. Neither resolves outside the Concierge — the
 * only surface these calls are made on — nor for an archived workspace or a
 * deleted chat, and a chip that opens onto nothing is worse than none.
 *
 * A file badge always renders: a path the tree no longer holds still names the
 * file the row touched, it just stops being clickable.
 * @param badge - The descriptor the presentation carries, or null
 * @returns What to pin, or null when this surface can pin nothing
 */
function useToolRowSubject(
	badge: ToolBadgeDescriptor | null,
): ToolRowSubject | null {
	const access = useConciergeReferenceAccess();
	const openFilePreview = useFilePreviewOpener();
	const resolveWorkspacePath = useWorkspacePathResolver();
	if (badge === null) {
		return null;
	}
	if (badge.kind === 'chat' || badge.kind === 'workspace') {
		const reference = resolveBadgeReference(access, badge);
		return access && reference
			? {
					kind: 'reference',
					onActivate: () => access.openReference(reference),
					reference,
				}
			: null;
	}
	return {
		kind: 'file',
		...resolveFileBadge(badge, openFilePreview, resolveWorkspacePath),
	};
}

/**
 * Looks a chat or workspace badge up in the Concierge's catalogue, narrowest
 * subject first.
 * @param access - The Concierge's reference catalogue, absent on every other
 * surface
 * @param badge - The chat or workspace the row named
 * @returns The reference, or null when this surface cannot resolve it
 */
function resolveBadgeReference(
	access: ConciergeReferenceAccess | null,
	badge: ToolChatBadgeDescriptor | ToolWorkspaceBadgeDescriptor,
): ConciergeReference | null {
	if (access === null) {
		return null;
	}
	const chatTabId = badge.kind === 'chat' ? badge.chatTabId : null;
	const workspaceId = badge.workspaceId;
	return (
		(chatTabId ? access.resolveReference('chat', chatTabId) : null) ??
		(workspaceId ? access.resolveReference('workspace', workspaceId) : null)
	);
}

/**
 * Binds a file badge to the workspace's preview surface.
 * @param badge - The file the row touched
 * @param openFilePreview - Opens a preview tab, absent outside a workspace
 * conversation
 * @param resolveWorkspacePath - Checks a path against the file tree, absent
 * outside a workspace conversation
 * @returns The badge to render and the click handler it earns
 */
function resolveFileBadge(
	badge: ToolFileBadgeDescriptor,
	openFilePreview: ReturnType<typeof useFilePreviewOpener>,
	resolveWorkspacePath: ReturnType<typeof useWorkspacePathResolver>,
): { badge: ToolFileBadgeDescriptor; onActivate: (() => void) | undefined } {
	// A tool that deleted or moved its target leaves a badge pointing at a path
	// the tree no longer holds; leave that one inert instead of opening a preview
	// tab onto a read error.
	const resolvedPath = resolveWorkspacePath?.(badge.path);
	const isMissing = resolveWorkspacePath !== null && !resolvedPath;
	return {
		badge: {
			...badge,
			kind: resolvedPath?.kind === 'directory' ? 'folder' : badge.kind,
		},
		onActivate:
			openFilePreview && !isMissing
				? () => openFilePreview(resolvedPath?.path ?? badge.path)
				: undefined,
	};
}

/** The chip a row pins beside its title, wearing the mark its subject reads by. */
function ToolRowBadge({ subject }: { subject: ToolRowSubject }) {
	if (subject.kind === 'file') {
		return (
			<ToolFileBadge badge={subject.badge} onActivate={subject.onActivate} />
		);
	}
	return (
		<ChatAttachmentChip
			className='filebadge min-w-0'
			kind={conciergeReferenceChipKind(subject.reference)}
			label={subject.reference.label}
			onActivate={subject.onActivate}
			title={conciergeReferenceTitle(subject.reference)}
		/>
	);
}
