import type { DynamicToolUIPart } from 'ai';
import { useMemo } from 'react';
import {
	presentCustomMessage,
	presentReasoning,
	presentSkillInvocation,
	presentToolCall,
} from '@/renderer/lib/agent-timeline';
import type { PiCustomMessageData } from '@/renderer/types/agent-timeline';
import type { ToolPresentation } from '@/renderer/types/tool-presentation';
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
	const presentation = useMemo(() => presentToolCall(part), [part]);
	return <ToolRow presentation={presentation} />;
}

/**
 * One reasoning block, rendered as the same collapsible row a tool call gets so
 * thinking and acting read as a single timeline rather than two styles. A block
 * whose runtime redacted the prose renders nothing: an inert row titled
 * "Thought" costs the turn a line and discloses nothing behind it.
 */
export function ChatReasoningCollapsible({ text }: { text: string }) {
	const presentation = useMemo(() => presentReasoning(text), [text]);
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
	const presentation = useMemo(() => presentCustomMessage(data), [data]);
	return <ToolRow presentation={presentation} />;
}

/**
 * One skill activation, rendered as the same row a tool call gets: the skill
 * named and marked "Skill activated", so invoking `/skill:name` reads as a step
 * the turn took rather than the whole `SKILL.md` pasted above it.
 */
export function ChatSkillInvocation({ name }: { name: string }) {
	const presentation = useMemo(() => presentSkillInvocation(name), [name]);
	return <ToolRow presentation={presentation} />;
}

/**
 * Renders a projected presentation, binding its file badge to the workspace
 * file-preview surface.
 *
 * A body of kind `empty` disables the disclosure rather than offering a control
 * that opens onto nothing — a clean diagnostics run is the common case.
 */
function ToolRow({ presentation }: { presentation: ToolPresentation }) {
	const openFilePreview = useFilePreviewOpener();
	const resolveWorkspacePath = useWorkspacePathResolver();
	const { badge, body, glyph, preview, title, tone } = presentation;
	// A tool that deleted or moved its target leaves a badge pointing at a path
	// the tree no longer holds; leave that one inert instead of opening a preview
	// tab onto a read error.
	const resolvedBadgePath = badge ? resolveWorkspacePath?.(badge.path) : null;
	const isBadgeMissing =
		badge !== null &&
		resolveWorkspacePath !== null &&
		resolvedBadgePath === null;

	return (
		<ToolCollapsible
			disabled={body.kind === 'empty'}
			glyph={glyph}
			pending={body.kind === 'pending'}
			title={title}
			tone={tone}
			toolBadge={
				badge ? (
					<ToolFileBadge
						badge={{
							...badge,
							kind:
								resolvedBadgePath?.kind === 'directory' ? 'folder' : badge.kind,
						}}
						onActivate={
							openFilePreview && !isBadgeMissing
								? () => openFilePreview(resolvedBadgePath?.path ?? badge.path)
								: undefined
						}
					/>
				) : null
			}
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
