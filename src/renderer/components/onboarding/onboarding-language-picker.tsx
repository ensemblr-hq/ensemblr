import { useAtom } from 'jotai';
import { ChevronUpIcon, LanguagesIcon } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/renderer/components/ui/button';
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from '@/renderer/components/ui/collapsible';
import { cn } from '@/renderer/lib/utils';
import { languageAtom } from '@/renderer/state/preferences';
import {
	APP_LANGUAGES,
	type AppLanguage,
	FALLBACK_LANGUAGE,
	isAppLanguage,
	LANGUAGE_ENDONYMS,
} from '@/shared/i18n';

/**
 * Language switch offered on the first-run welcome screen. Until the setting is
 * written the wizard renders in whatever the OS asked for, so a user whose
 * machine is English but who wants Russian meets an English wizard with no way
 * out of it — this is that way out, before any of the copy that matters.
 *
 * Collapsed to a single row by default and anchored to the foot of the screen:
 * the top-right corner it used to occupy is where Ensemblr draws its own window
 * controls on Linux, and one row of three buttons is louder than the choice
 * deserves for the users who are already in their own language.
 *
 * Endonyms rather than a translated list: someone stranded in a language they
 * cannot read still recognises their own.
 */
export function OnboardingLanguagePicker() {
	const { i18n, t } = useTranslation();
	const [preference, setPreference] = useAtom(languageAtom);
	const [isOpen, setOpen] = useState(false);
	const activeLanguage = resolveActiveLanguage(preference, i18n.language);

	return (
		<Collapsible
			className='flex flex-col items-center gap-1.5'
			onOpenChange={setOpen}
			open={isOpen}
		>
			<CollapsibleContent className='data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=open]:animate-in'>
				<nav
					aria-label={t(
						'onboarding:welcome.language.label',
						'Interface language',
					)}
					className='flex items-center gap-1 rounded-full border border-border bg-card p-1'
				>
					{APP_LANGUAGES.map((code) => (
						<Button
							aria-current={activeLanguage === code ? 'true' : undefined}
							className={cn(
								'rounded-full',
								activeLanguage === code && 'bg-muted text-foreground',
							)}
							key={code}
							onClick={() => {
								setOpen(false);
								setPreference(code);
							}}
							size='sm'
							type='button'
							variant='ghost'
						>
							{LANGUAGE_ENDONYMS[code]}
						</Button>
					))}
				</nav>
			</CollapsibleContent>

			<CollapsibleTrigger asChild>
				<Button
					aria-label={t(
						'onboarding:welcome.language.change',
						'Change interface language',
					)}
					className='text-muted-foreground'
					size='sm'
					type='button'
					variant='ghost'
				>
					<LanguagesIcon aria-hidden='true' data-icon='inline-start' />
					{LANGUAGE_ENDONYMS[activeLanguage]}
					<ChevronUpIcon
						aria-hidden='true'
						className={cn('transition-transform', isOpen && 'rotate-180')}
						data-icon='inline-end'
					/>
				</Button>
			</CollapsibleTrigger>
		</Collapsible>
	);
}

/**
 * Names the language the wizard is actually rendering in, which is what the
 * collapsed trigger has to show — the stored preference may still be `system`,
 * and that is not a language anyone recognises as their own.
 * @param preference - The stored `general.language` setting.
 * @param activeTag - The tag i18next resolved for this session.
 * @returns The language currently on screen.
 */
function resolveActiveLanguage(
	preference: string | undefined,
	activeTag: string,
): AppLanguage {
	if (isAppLanguage(preference)) {
		return preference;
	}
	const primary = activeTag.split('-')[0]?.toLowerCase();
	return isAppLanguage(primary) ? primary : FALLBACK_LANGUAGE;
}
