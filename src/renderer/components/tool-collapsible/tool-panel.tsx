import type { ReactNode } from 'react';
import { cn } from '@/renderer/lib/utils';
import type { ToolPanelSectionDescriptor } from '@/renderer/types/tool-presentation';

/**
 * Panel shared by tool bodies that show plain payloads rather than code. Sits
 * on the app's code surface, like the code bodies do, so every tool body reads
 * as one family; it wraps instead of scrolling sideways.
 *
 * Scrolls natively under `sleek-scrollbar`, the same way the code surfaces and
 * the file and diff viewers do, so its scrollbar neither looks nor behaves like
 * a different component's.
 */
export function ToolPanel({ children }: { children: ReactNode }) {
	return (
		<div className='select-text rounded-md border border-code-border bg-code p-3 font-mono text-code-foreground text-xs'>
			<div className='sleek-scrollbar max-h-96 overflow-auto overscroll-contain'>
				{children}
			</div>
		</div>
	);
}

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
		<ToolPanel>
			<div className='space-y-3'>
				{sections.map((section) => (
					<ToolPanelSection
						key={section.label}
						label={section.label}
						muted={section.muted}
					>
						{section.text}
					</ToolPanelSection>
				))}
			</div>
		</ToolPanel>
	);
}

/**
 * One labelled payload block inside a {@link ToolPanel}. Punctuation belongs to
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
