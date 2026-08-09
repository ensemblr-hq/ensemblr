/**
 * The per-tool approval card. A Claude session in `approval-required` mode is
 * blocked inside the SDK's `canUseTool` until this resolves, so it takes the
 * composer's place in the chat that raised it — the same swap the agent
 * questionnaire uses, for the same reason.
 */
import type { TFunction } from 'i18next';
import { XIcon } from 'lucide-react';
import { useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/renderer/components/ui/button';
import type {
	ToolApprovalDecision,
	ToolApprovalRequestedBroadcast,
} from '@/shared/agent-tool-approval';

/**
 * Tool-input fields worth showing first, in priority order: a `Bash` command, an
 * `Edit`/`Write` path, a `Grep` pattern. Anything else falls back to whichever
 * field the tool listed first.
 */
const PRIMARY_INPUT_FIELDS = [
	'command',
	'file_path',
	'filePath',
	'path',
	'pattern',
	'url',
	'query',
] as const;

/** Decision each shortcut key stands for. */
const DECISION_KEYS: Readonly<
	Record<string, ToolApprovalDecision | undefined>
> = {
	'1': { kind: 'allow' },
	'2': { kind: 'allow-for-session' },
	'3': { kind: 'deny' },
	Escape: { kind: 'deny' },
};

/** How many secondary input fields the card lists under the primary one. */
const MAX_SECONDARY_FIELDS = 3;

/** The one input field the card shows in full, plus the rest for context. */
interface InputBreakdown {
	primary: { name: string; value: string } | null;
	secondary: ReadonlyArray<{ name: string; value: string }>;
}

/**
 * Splits a tool input into the field the user is really deciding about and the
 * remaining context.
 * @param input - Display-ready input preview from the broadcast.
 * @returns The primary field and up to {@link MAX_SECONDARY_FIELDS} others.
 */
function breakDownInput(
	input: Readonly<Record<string, string>>,
): InputBreakdown {
	const names = Object.keys(input);
	const primaryName =
		PRIMARY_INPUT_FIELDS.find((candidate) => names.includes(candidate)) ??
		names[0];
	if (primaryName === undefined) {
		return { primary: null, secondary: [] };
	}
	return {
		primary: { name: primaryName, value: input[primaryName] ?? '' },
		secondary: names
			.filter((name) => name !== primaryName)
			.slice(0, MAX_SECONDARY_FIELDS)
			.map((name) => ({ name, value: input[name] ?? '' })),
	};
}

/**
 * The sentence at the top of the card. Claude Code supplies its own prompt for
 * most tools; the fallback names the tool so an unrecognised one still reads.
 * @param request - The pending prompt.
 * @param t - Translator from the calling component.
 * @returns The headline to show.
 */
function headlineFor(
	request: ToolApprovalRequestedBroadcast,
	t: TFunction,
): string {
	return (
		request.title ??
		t('common:tool-approval.headline', 'Claude wants to use {{tool}}.', {
			tool: request.displayName ?? request.toolName,
		})
	);
}

/**
 * Renders the tool call a Claude session is blocked on.
 *
 * Keyboard: `1` allows once, `2` allows this tool for the rest of the session,
 * `3` and Escape deny.
 */
export function ToolApprovalCard({
	onDecide,
	request,
}: {
	onDecide: (decision: ToolApprovalDecision) => void;
	request: ToolApprovalRequestedBroadcast;
}) {
	const { t } = useTranslation();
	const shellRef = useRef<HTMLElement>(null);
	const decideRef = useRef(onDecide);

	useEffect(() => {
		decideRef.current = onDecide;
	}, [onDecide]);

	useEffect(() => {
		shellRef.current?.focus();
	}, []);

	const handleKeyDown = useCallback((event: React.KeyboardEvent) => {
		if (event.metaKey || event.ctrlKey || event.altKey) {
			return;
		}
		const decision = DECISION_KEYS[event.key];
		if (!decision) {
			return;
		}
		event.preventDefault();
		decideRef.current(decision);
	}, []);

	const { primary, secondary } = breakDownInput(request.input);

	return (
		<footer className='shrink-0 bg-background px-4 pt-2 pb-5'>
			<section
				aria-label={t(
					'common:tool-approval.section-label',
					'Tool approval request',
				)}
				className='mx-auto flex w-full max-w-4xl flex-col gap-2 rounded-xl border border-border bg-pane/80 px-4 pt-3 pb-2.5 shadow-panel outline-none'
				onKeyDown={handleKeyDown}
				ref={shellRef}
				tabIndex={-1}
			>
				<p className='sr-only' role='status'>
					{t('common:tool-approval.status', 'Approval required for {{tool}}.', {
						tool: request.toolName,
					})}
				</p>
				<header className='flex items-start justify-between gap-3'>
					<div className='flex min-w-0 flex-1 flex-col gap-1'>
						<h2 className='text-pretty font-medium text-foreground text-sm leading-5'>
							{headlineFor(request, t)}
						</h2>
						<p className='flex items-center gap-2 text-muted-foreground text-xs'>
							<span className='rounded-sm bg-muted px-1.5 py-0.5 font-mono text-foreground text-xxs'>
								{request.toolName}
							</span>
							{request.description ? (
								<span className='min-w-0 truncate'>{request.description}</span>
							) : null}
						</p>
					</div>
					<Button
						aria-label={t('common:tool-approval.deny-label', 'Deny tool call')}
						className='-mt-0.5 -mr-1'
						onClick={() => onDecide({ kind: 'deny' })}
						size='icon-xs'
						type='button'
						variant='subtle'
					>
						<XIcon aria-hidden='true' />
					</Button>
				</header>

				{primary ? (
					<div className='flex flex-col gap-1'>
						<pre className='max-h-32 overflow-auto whitespace-pre-wrap break-words rounded-md border border-border bg-background px-2 py-1.5 font-mono text-foreground text-xs'>
							{primary.value}
						</pre>
						{secondary.length > 0 ? (
							<p className='truncate text-muted-foreground/70 text-xs'>
								{secondary
									.map((field) => `${field.name}: ${field.value}`)
									.join(' · ')}
							</p>
						) : null}
					</div>
				) : null}

				<div className='flex items-center justify-between gap-3'>
					<p className='min-w-0 flex-1 text-muted-foreground/60 text-xs'>
						{t(
							'common:tool-approval.key-hints',
							'1 allow · 2 allow for session · 3 deny · Esc deny',
						)}
					</p>
					<div className='flex shrink-0 items-center gap-1.5'>
						<Button
							onClick={() => onDecide({ kind: 'deny' })}
							size='sm'
							type='button'
							variant='ghost'
						>
							{t('common:actions.deny', 'Deny')}
						</Button>
						<Button
							onClick={() => onDecide({ kind: 'allow-for-session' })}
							size='sm'
							type='button'
							variant='outline'
						>
							{t(
								'common:tool-approval.allow-session',
								'Allow for this session',
							)}
						</Button>
						<Button onClick={() => onDecide({ kind: 'allow' })} size='sm'>
							{t('common:actions.allow', 'Allow')}
						</Button>
					</div>
				</div>
			</section>
		</footer>
	);
}
