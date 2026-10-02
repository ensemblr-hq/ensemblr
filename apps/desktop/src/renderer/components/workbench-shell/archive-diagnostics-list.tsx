import { useTranslation } from 'react-i18next';

import { failureDetail, failureText } from '@/renderer/lib/failure-text';

/**
 * Shared diagnostics list every lifecycle surface shows on failure — the
 * archive and delete dialogs, the browse-archive list, and a History row.
 * Generic over the diagnostic shape so no caller needs to coerce; every
 * lifecycle diagnostic type satisfies the `{ code, message, path? }` minimum.
 */
interface ArchiveDiagnosticItem {
	code: string;
	message: string;
	path?: string;
}

/** Renders the shared lifecycle diagnostics list used by the archive, delete, and browse-archive surfaces on failure. */
export function ArchiveDiagnosticsList<T extends ArchiveDiagnosticItem>({
	diagnostics,
	testId,
}: {
	diagnostics: T[];
	testId: string;
}) {
	const { t } = useTranslation();
	return (
		<ul
			className='flex flex-col gap-1.5 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-destructive text-xs'
			data-testid={testId}
		>
			{diagnostics.map((diagnostic, index) => {
				const detail = failureDetail(t, diagnostic);
				return (
					// Diagnostics share a small code set; pair with index so
					// duplicates (multiple warnings during a partial cleanup)
					// still render.
					<li
						className='flex flex-col gap-0.5'
						key={`${diagnostic.code}:${index}`}
					>
						<span className='font-medium'>{failureText(t, diagnostic)}</span>
						{detail ? (
							<span className='wrap-anywhere text-xxs opacity-80'>
								{detail}
							</span>
						) : null}
						{diagnostic.path ? (
							<span className='wrap-anywhere font-mono text-xxs leading-normal opacity-80'>
								{diagnostic.path}
							</span>
						) : null}
					</li>
				);
			})}
		</ul>
	);
}
