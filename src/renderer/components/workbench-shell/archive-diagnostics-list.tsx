import { useTranslation } from 'react-i18next';

import { failureDetail, failureText } from '@/renderer/lib/failure-text';

/**
 * Shared diagnostics list shown by both `ArchiveRepositoryDialog` and
 * `ArchiveWorkspaceDialog` on failure. Generic over the diagnostic shape so
 * neither caller needs to coerce; both archive diagnostic types satisfy the
 * `{ code, message, path? }` minimum.
 */
interface ArchiveDiagnosticItem {
	code: string;
	message: string;
	path?: string;
}

/** Renders the shared archive diagnostics list used by the repository and workspace archive dialogs on failure. */
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
