import type {
	ParentedUIMessagePart,
	TimelineActivityNode,
	UIMessagePart,
} from '@/renderer/types/agent-timeline';
import { outputOf } from './tool-part-fields.ts';

/**
 * Reads the tool call a part ran inside.
 * @param part - The timeline part to inspect
 * @returns The owning tool call's id, or null when the main thread produced it
 */
export function parentToolCallIdOf(part: UIMessagePart): string | null {
	const parent = (part as ParentedUIMessagePart).parentToolCallId;
	return typeof parent === 'string' && parent.length > 0 ? parent : null;
}

/**
 * Reads the id a tool part is keyed by, so a row can adopt the rows that ran
 * inside it.
 * @param part - The timeline part to inspect
 * @returns The tool call id, or null for a part that is not a tool call
 */
function toolCallIdOf(part: UIMessagePart): string | null {
	if (part.type !== 'dynamic-tool') {
		return null;
	}
	return part.toolCallId.length > 0 ? part.toolCallId : null;
}

/** A {@link TimelineActivityNode} while its children are still being collected. */
interface CollectingActivityNode {
	children: TimelineActivityNode[];
	key: string;
	part: UIMessagePart;
}

/**
 * Groups a turn's flat parts into the tree the timeline renders, hanging every
 * part a subagent produced under the tool call that spawned it.
 *
 * A node registers itself only after its own parent lookup, so a part can adopt
 * only a parent that already appeared. That makes the walk total without a depth
 * cap: self-reference and cycles cannot form, and a part whose parent is missing
 * — a runtime without subagents, a row persisted before the link shipped, or a
 * parent the caller filtered out — stays at the top level and renders flat.
 * @param parts - The turn's visible parts, in the order it produced them
 * @returns The top-level rows, each carrying the rows nested inside it
 */
export function groupSubagentActivity(
	parts: readonly UIMessagePart[],
): readonly TimelineActivityNode[] {
	const roots: CollectingActivityNode[] = [];
	const nodesByToolCallId = new Map<string, CollectingActivityNode>();

	parts.forEach((part, index) => {
		const toolCallId = toolCallIdOf(part);
		const node: CollectingActivityNode = {
			children: [],
			key: toolCallId === null ? `p:${index}` : `t:${toolCallId}`,
			part,
		};

		const parentId = parentToolCallIdOf(part);
		const parent =
			parentId === null ? undefined : nodesByToolCallId.get(parentId);
		(parent ? parent.children : roots).push(node);

		if (toolCallId !== null) {
			nodesByToolCallId.set(toolCallId, node);
		}
	});

	return roots;
}

/**
 * Counts the tool calls nested beneath a node, at every depth.
 *
 * Only tool calls are counted because the badge that reads this names them: a
 * subagent's forwarded prose and reasoning are rows too, so counting every
 * descendant would report a delegate that thought twice and ran one grep as
 * three tool calls.
 * @param node - The node whose descendants to count
 * @returns The number of nested tool calls
 */
export function countNestedToolCalls(node: TimelineActivityNode): number {
	return node.children.reduce(
		(total, child) =>
			total +
			(child.part.type === 'dynamic-tool' ? 1 : 0) +
			countNestedToolCalls(child),
		0,
	);
}

/**
 * Reads the closing report a settled tool call carries as its output.
 * @param part - The timeline part to inspect
 * @returns The trimmed report text, or null when the part carries none
 */
function reportTextOf(part: UIMessagePart): string | null {
	if (part.type !== 'dynamic-tool') {
		return null;
	}
	const text = outputOf(part)?.text.trim() ?? '';
	return text.length > 0 ? text : null;
}

/**
 * Drops the closing prose a subagent's own card already shows as its body.
 *
 * A `Task`'s tool result *is* the subagent's final message, and the forwarded
 * text stream carries that same message again as a row tagged with the call, so
 * without this the report renders twice inside one card — once muted as a row,
 * once as the card body. Dropping it here rather than at the row also keeps it
 * out of the collapsed summary's message count.
 *
 * Matching on the text rather than on position leaves a genuinely different
 * closing row in place, and only the last match per delegation goes, so a
 * subagent that happened to repeat itself mid-run keeps the earlier copy.
 * @param parts - The turn's parts, in the order it produced them
 * @returns The parts with each delegation's echoed report removed
 */
export function dropEchoedSubagentReports(
	parts: readonly UIMessagePart[],
): UIMessagePart[] {
	const reportByToolCallId = new Map<string, string>();
	for (const part of parts) {
		const report = reportTextOf(part);
		const toolCallId = toolCallIdOf(part);
		if (report !== null && toolCallId !== null) {
			reportByToolCallId.set(toolCallId, report);
		}
	}

	const echoIndexByParent = new Map<string, number>();
	parts.forEach((part, index) => {
		const parentId = parentToolCallIdOf(part);
		if (parentId === null || part.type !== 'text' || part.state !== 'done') {
			return;
		}
		if (part.text.trim() === reportByToolCallId.get(parentId)) {
			echoIndexByParent.set(parentId, index);
		}
	});

	const echoIndices = new Set(echoIndexByParent.values());
	return parts.filter((_, index) => !echoIndices.has(index));
}
