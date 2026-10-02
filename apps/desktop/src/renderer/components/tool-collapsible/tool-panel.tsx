import type { ReactNode } from 'react';
import { TextSurface } from '@/renderer/components/code-surface';
import { withListKeys } from '@/renderer/lib/list-keys';
import { cn } from '@/renderer/lib/utils';
import type { ToolPanelSectionDescriptor } from '@/renderer/types/tool-presentation';

/**
 * Body for a tool whose payload is labelled plain text — an extension call's
 * arguments and reply, or a task's description and command.
 *
 * The block that is context rather than the answer is dimmed, so the eye lands
 * on the part the row was opened to read.
 */
export function ToolLabeledPanel({
	sections,
}: {
	sections: readonly ToolPanelSectionDescriptor[];
}) {
	return (
		<TextSurface>
			<div className='space-y-3'>
				{withListKeys(sections, sectionIdentity).map(({ item, key }) => (
					<ToolPanelSection key={key} label={item.label} muted={item.muted}>
						{item.text}
					</ToolPanelSection>
				))}
			</div>
		</TextSurface>
	);
}

/**
 * What a labelled section is, for keying: its label, its payload, and whether it
 * reads as context.
 * @param section - The section to identify
 * @returns A stable identity string
 */
function sectionIdentity(section: ToolPanelSectionDescriptor): string {
	return `${section.label}:${section.text}:${section.muted}`;
}

/**
 * One labelled payload block inside a {@link TextSurface}. Punctuation belongs to
 * `label` — pass `'Input:'` or `'Command'` as it should be painted, so the
 * component never has to special-case a trailing colon.
 */
function ToolPanelSection({
	children,
	label,
	muted,
}: {
	children: string;
	label: string;
	muted: boolean;
}) {
	return (
		<div>
			<div className='mb-1 font-medium text-xs opacity-50'>{label}</div>
			<pre
				className={cn(
					'wrap-break-word m-0 whitespace-pre-wrap p-0 font-mono text-xs',
					muted && 'opacity-70',
				)}
			>
				{children}
			</pre>
		</div>
	);
}

/**
 * Body for a failed tool call. Wraps rather than scrolling sideways, so a long
 * error is readable without hunting horizontally, and sits on the destructive
 * surface instead of the shared `code` one — failure is worth the visual break.
 */
export function ToolErrorOutput({ children }: { children: ReactNode }) {
	return (
		<div className='wrap-break-word select-text whitespace-pre-wrap rounded-md border border-destructive/20 bg-destructive/10 p-3 font-medium font-mono text-destructive text-xs'>
			{children}
		</div>
	);
}
