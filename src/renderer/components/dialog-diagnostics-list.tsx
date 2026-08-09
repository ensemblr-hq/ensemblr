import { useTranslation } from 'react-i18next';

import { failureDetail, failureText } from '@/renderer/lib/failure-text';

/** The diagnostic fields this card renders; every dialog diagnostic wire type satisfies it. */
interface DialogDiagnostic {
	code: string;
	message: string;
	path?: string;
}

/**
 * Renders the destructive diagnostics card a dialog shows after a failed
 * action, listing each diagnostic message with its offending path.
 */
export function DialogDiagnosticsList({
	diagnostics,
	testId,
}: {
	diagnostics: readonly DialogDiagnostic[];
	testId: string;
}) {
	const { t } = useTranslation();
	return (
		<ul
			className='rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-destructive text-xs'
			data-testid={testId}
		>
			{diagnostics.map((diagnostic) => {
				const detail = failureDetail(t, diagnostic);
				return (
					<li className='flex flex-col gap-0.5' key={diagnostic.code}>
						<span className='font-medium'>{failureText(t, diagnostic)}</span>
						{detail ? (
							<span className='wrap-anywhere text-xxs opacity-80'>
								{detail}
							</span>
						) : null}
						{diagnostic.path ? (
							<span className='font-mono text-xxs opacity-80'>
								{diagnostic.path}
							</span>
						) : null}
					</li>
				);
			})}
		</ul>
	);
}
