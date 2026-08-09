import { useAtom } from 'jotai';
import { useTranslation } from 'react-i18next';

import { Button } from '@/renderer/components/ui/button';
import { cn } from '@/renderer/lib/utils';
import { languageAtom } from '@/renderer/state/preferences';
import { APP_LANGUAGES, LANGUAGE_ENDONYMS } from '@/shared/i18n';

/**
 * Language switch offered on the first-run welcome screen. Until the setting is
 * written the wizard renders in whatever the OS asked for, so a user whose
 * machine is English but who wants Russian meets an English wizard with no way
 * out of it — this is that way out, before any of the copy that matters.
 *
 * Endonyms rather than a translated list: someone stranded in a language they
 * cannot read still recognises their own.
 */
export function OnboardingLanguagePicker() {
	const { t } = useTranslation();
	const [language, setLanguage] = useAtom(languageAtom);

	return (
		<nav
			aria-label={t('onboarding:welcome.language.label', 'Interface language')}
			className='flex items-center gap-1'
		>
			{APP_LANGUAGES.map((code) => (
				<Button
					aria-current={language === code ? 'true' : undefined}
					className={cn(
						'h-7 px-2 text-xs',
						language === code && 'bg-muted text-foreground',
					)}
					key={code}
					onClick={() => setLanguage(code)}
					size='sm'
					type='button'
					variant='ghost'
				>
					{LANGUAGE_ENDONYMS[code]}
				</Button>
			))}
		</nav>
	);
}
