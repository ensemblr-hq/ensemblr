import type { DynamicToolUIPart } from 'ai';
import type { ReactNode } from 'react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { presentToolCall } from '@/renderer/lib/agent-timeline';
import { ToolCollapsible } from './tool-collapsible';
import { ToolBody } from './tool-collapsible/tool-body';
import { ToolCommandChip } from './tool-collapsible/tool-chips';

/**
 * One delegation to a subagent, rendered as a tool row that opens onto the work
 * the subagent actually did.
 *
 * Claude forwards a subagent's rows flat alongside the main thread's, so without
 * this they read as the agent's own — the card is what says a stretch of the
 * turn belonged to a delegate. Nested rows come first and the subagent's closing
 * report last, which is the order it produced them in.
 *
 * The timeline renders this only for a delegation that produced rows; one that
 * produced none is a plain tool row and never reaches here.
 */
export function ChatSubagentCall({
	children,
	part,
	toolCallCount,
}: {
	children: ReactNode;
	part: DynamicToolUIPart;
	/** How many tool calls the subagent ran, at every depth. */
	toolCallCount: number;
}) {
	const { i18n, t } = useTranslation();
	// biome-ignore lint/correctness/useExhaustiveDependencies: the presenter translates through the i18n singleton, so the language is a real input Biome cannot see.
	const presentation = useMemo(
		() => presentToolCall(part),
		[part, i18n.language],
	);
	const { body, glyph, preview, title, tone } = presentation;
	const hasBody = body.kind !== 'empty';

	return (
		<ToolCollapsible
			glyph={glyph}
			pending={body.kind === 'pending'}
			title={title}
			tone={tone}
			toolBadge={
				toolCallCount > 0 ? (
					<span className='shrink-0 text-muted-foreground text-xs'>
						{t('common:turn-summary.tool-calls', {
							count: toolCallCount,
							defaultValue_one: '{{count}} tool call',
							defaultValue_other: '{{count}} tool calls',
						})}
					</span>
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
			<div className='flex flex-col gap-2'>
				<div
					className='flex flex-col gap-1.5 border-border/40 border-l pl-3'
					data-role='subagent-children'
				>
					{children}
				</div>
				{hasBody ? <ToolBody body={body} /> : null}
			</div>
		</ToolCollapsible>
	);
}
