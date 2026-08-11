/**
 * The tool input a pending approval is really about: the one field the decision
 * turns on, labelled and rendered in full on a code surface, with the remaining
 * arguments as chips beside it.
 */
import { useTranslation } from 'react-i18next';

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

/** How many secondary input fields the card lists beside the primary one. */
const MAX_SECONDARY_FIELDS = 4;

/** The one input field the card shows in full, plus the rest for context. */
interface InputBreakdown {
	primary: { name: string; value: string } | null;
	secondary: ReadonlyArray<{ name: string; value: string }>;
	hidden: number;
}

/**
 * Splits a tool input into the field the user is really deciding about and the
 * remaining context.
 * @param input - Display-ready input preview from the broadcast.
 * @returns The primary field, up to {@link MAX_SECONDARY_FIELDS} others, and how
 * many arguments were left off the card entirely.
 */
function breakDownInput(
	input: Readonly<Record<string, string>>,
): InputBreakdown {
	const names = Object.keys(input);
	const primaryName =
		PRIMARY_INPUT_FIELDS.find((candidate) => names.includes(candidate)) ??
		names[0];
	if (primaryName === undefined) {
		return { hidden: 0, primary: null, secondary: [] };
	}
	const rest = names.filter((name) => name !== primaryName);
	return {
		hidden: Math.max(0, rest.length - MAX_SECONDARY_FIELDS),
		primary: { name: primaryName, value: input[primaryName] ?? '' },
		secondary: rest
			.slice(0, MAX_SECONDARY_FIELDS)
			.map((name) => ({ name, value: input[name] ?? '' })),
	};
}

/** Renders the arguments of the tool call awaiting a decision. */
export function ApprovalInput({
	input,
}: {
	input: Readonly<Record<string, string>>;
}) {
	const { t } = useTranslation();
	const { hidden, primary, secondary } = breakDownInput(input);

	if (!primary) {
		return null;
	}

	return (
		<div className='flex flex-col gap-1.5 px-3 py-2.5'>
			<div className='overflow-hidden rounded-lg border border-code-border bg-code'>
				<span className='block truncate border-code-border/60 border-b bg-foreground/[0.03] px-2.5 py-1 font-mono text-muted-foreground text-xxs leading-4'>
					{primary.name}
				</span>
				<pre className='max-h-40 overflow-auto whitespace-pre-wrap break-words px-2.5 py-2 font-mono text-code-foreground text-xs leading-5'>
					{primary.value}
				</pre>
			</div>

			{secondary.length > 0 ? (
				<ul className='flex flex-wrap items-center gap-1'>
					{secondary.map((field) => (
						<li
							className='max-w-full truncate rounded-md border border-border/60 bg-foreground/[0.04] px-1.5 py-0.5 font-mono text-muted-foreground text-xxs leading-4'
							key={field.name}
						>
							{`${field.name}: ${field.value}`}
						</li>
					))}
					{hidden > 0 ? (
						<li className='px-0.5 text-muted-foreground/70 text-xxs leading-4'>
							{t('common:tool-approval.more-fields', '+{{extra}} more', {
								extra: hidden,
							})}
						</li>
					) : null}
				</ul>
			) : null}
		</div>
	);
}
