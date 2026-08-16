import type { Locale } from 'date-fns/locale';
import { el, enUS, ru } from 'date-fns/locale';
import { CalendarIcon } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/renderer/components/ui/button';
import { Calendar } from '@/renderer/components/ui/calendar';
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from '@/renderer/components/ui/popover';
import { formatIssueDueDate, parseIssueDueDate } from '@/renderer/lib/linear';
import { cn } from '@/renderer/lib/utils';

/** Calendar month and weekday names per shipped language. */
const CALENDAR_LOCALES: Record<string, Locale> = { el, en: enUS, ru };

/**
 * Resolve the date-fns locale backing the calendar's own month and weekday
 * names, which i18next's catalogues do not cover.
 * @param language - Active i18next language, possibly region-qualified
 * @returns The matching date-fns locale, falling back to English
 */
function resolveCalendarLocale(language: string): Locale {
	return CALENDAR_LOCALES[language.split('-')[0]] ?? enUS;
}

/**
 * Due-date picker: a compact pill that opens the calendar, replacing the native
 * date input whose `dd/mm/yyyy` chrome ignored both the theme and the language.
 */
export function IssueEditorDueDate({
	disabled,
	onChange,
	value,
}: {
	disabled?: boolean;
	onChange: (dueDate: string) => void;
	value: string;
}) {
	const { i18n, t } = useTranslation();
	const [open, setOpen] = useState(false);
	const selected = parseIssueDueDate(value);
	const label = t('linear:issue-editor.field.due-date', 'Due date');
	const dueDateFormat = useMemo(
		() =>
			new Intl.DateTimeFormat(i18n.language, {
				day: 'numeric',
				month: 'short',
				year: 'numeric',
			}),
		[i18n.language],
	);

	return (
		<Popover onOpenChange={setOpen} open={open}>
			<PopoverTrigger asChild>
				<Button
					aria-label={label}
					className={cn(
						'max-w-52 justify-start font-normal',
						selected ? null : 'text-muted-foreground',
					)}
					disabled={disabled}
					size='sm'
					variant='outline'
				>
					<CalendarIcon data-icon='inline-start' />
					<span className='truncate'>
						{selected ? dueDateFormat.format(selected) : label}
					</span>
				</Button>
			</PopoverTrigger>
			<PopoverContent align='start' className='w-auto p-0'>
				<Calendar
					autoFocus
					captionLayout='dropdown'
					locale={resolveCalendarLocale(i18n.language)}
					mode='single'
					onSelect={(date) => {
						onChange(date ? formatIssueDueDate(date) : '');
						setOpen(false);
					}}
					selected={selected}
				/>
				{selected ? (
					<div className='border-t p-1'>
						<Button
							className='w-full justify-center'
							onClick={() => {
								onChange('');
								setOpen(false);
							}}
							size='sm'
							variant='ghost'
						>
							{t('linear:issue-editor.due-date-clear', 'Clear due date')}
						</Button>
					</div>
				) : null}
			</PopoverContent>
		</Popover>
	);
}
