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

export function ArchiveDiagnosticsList<T extends ArchiveDiagnosticItem>({
	diagnostics,
	testId,
}: {
	diagnostics: T[];
	testId: string;
}) {
	return (
		<ul
			className='rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-destructive text-xs'
			data-testid={testId}
		>
			{diagnostics.map((diagnostic, index) => (
				// Diagnostics share a small code set; pair with index so
				// duplicates (multiple warnings during a partial cleanup)
				// still render.
				<li
					className='flex flex-col gap-0.5'
					key={`${diagnostic.code}:${index}`}
				>
					<span className='font-medium'>{diagnostic.message}</span>
					{diagnostic.path ? (
						<span className='font-mono text-[0.6875rem] opacity-80'>
							{diagnostic.path}
						</span>
					) : null}
				</li>
			))}
		</ul>
	);
}
