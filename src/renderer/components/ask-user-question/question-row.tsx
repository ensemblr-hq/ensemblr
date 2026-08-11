/**
 * One row of an agent question: a numbered option, or the free-text row the
 * user types their own answer into.
 */
import { CheckIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Input } from '@/renderer/components/ui/input';
import { cn } from '@/renderer/lib/utils';
import type { QuestionnaireRow } from '@/renderer/types/ask-user-question';

/** Shared row chrome: number gutter, hit area, and the focus/hover background. */
const ROW_CLASSNAME =
	'flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left transition-colors';

/** Box that holds a row adornment on the row's first line of text. */
const ADORNMENT_CLASSNAME = 'flex h-5 shrink-0 items-center';

/**
 * Leading shortcut number for a row, dimmed until the row is focused so the
 * live key reads as an affordance rather than as decoration.
 */
function RowNumber({ focused, number }: { focused: boolean; number: number }) {
	return (
		<span
			className={cn(
				ADORNMENT_CLASSNAME,
				'w-4 justify-end text-xs tabular-nums',
				focused ? 'text-foreground' : 'text-muted-foreground/60',
			)}
		>
			{number}
		</span>
	);
}

/**
 * Checkbox mark for a multi-select row. Mirrors the shadcn checkbox's look as a
 * plain span: the row itself is a button, and Radix's checkbox is a nested
 * button, which is invalid markup the parser splits the row apart over.
 */
function RowCheckbox({ checked }: { checked: boolean }) {
	return (
		<span className={ADORNMENT_CLASSNAME}>
			<span
				className={cn(
					'flex size-4 items-center justify-center rounded-sm border border-input transition-colors',
					checked && 'border-primary bg-primary text-primary-foreground',
				)}
			>
				{checked ? <CheckIcon aria-hidden='true' className='size-3' /> : null}
			</span>
		</span>
	);
}

/**
 * Renders a single selectable option. Multi-select questions show a checkbox;
 * single-select questions mark the confirmed choice with a check.
 */
export function QuestionOptionRow({
	checked,
	focused,
	multiSelect,
	onSelect,
	row,
}: {
	checked: boolean;
	focused: boolean;
	multiSelect: boolean;
	onSelect: () => void;
	row: QuestionnaireRow;
}) {
	return (
		<button
			aria-pressed={checked}
			className={cn(
				ROW_CLASSNAME,
				'hover:bg-pane-strong/60',
				focused && 'bg-pane-strong hover:bg-pane-strong',
			)}
			onClick={onSelect}
			type='button'
		>
			<RowNumber focused={focused} number={row.number} />
			{multiSelect ? <RowCheckbox checked={checked} /> : null}
			<span className='min-w-0 flex-1'>
				<span className='block truncate text-foreground text-sm leading-5'>
					{row.label}
				</span>
				{row.description ? (
					<span className='block text-muted-foreground text-xs leading-4'>
						{row.description}
					</span>
				) : null}
			</span>
			{!multiSelect && checked ? (
				<span className={ADORNMENT_CLASSNAME}>
					<CheckIcon aria-hidden='true' className='size-3.5 text-foreground' />
				</span>
			) : null}
		</button>
	);
}

/**
 * Renders the free-text row. Focusing it is enough to start typing — there is no
 * separate edit affordance — and Enter submits whatever has been typed.
 */
export function QuestionFreeTextRow({
	focused,
	inputRef,
	onChange,
	onFocus,
	onKeyDown,
	row,
	value,
}: {
	focused: boolean;
	inputRef: React.RefObject<HTMLInputElement | null>;
	onChange: (value: string) => void;
	onFocus: () => void;
	onKeyDown: (event: React.KeyboardEvent) => void;
	row: QuestionnaireRow;
	value: string;
}) {
	const { t } = useTranslation();
	return (
		<div className={cn(ROW_CLASSNAME, focused && 'bg-pane-strong')}>
			<RowNumber focused={focused} number={row.number} />
			<Input
				aria-label={t(
					'common:agent-question.free-text-label',
					'Type your own answer',
				)}
				className='h-5 border-0 bg-transparent p-0 text-sm leading-5 shadow-none placeholder:text-muted-foreground/60 focus-visible:ring-0 dark:bg-transparent'
				onChange={(event) => onChange(event.target.value)}
				onFocus={onFocus}
				onKeyDown={onKeyDown}
				placeholder={t(
					'common:agent-question.free-text-placeholder',
					'Type something…',
				)}
				ref={inputRef}
				value={value}
			/>
		</div>
	);
}
