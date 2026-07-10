import type { CloneGithubRepositoryDiagnostic } from '@/shared/ipc/contracts/clone';

/** Failure detail card listing each diagnostic in execution order. */
export function CloneGithubDiagnostics({
	diagnostics,
}: {
	diagnostics: CloneGithubRepositoryDiagnostic[];
}) {
	return (
		<ul
			className='rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-destructive text-xs'
			data-testid='clone-diagnostics'
		>
			{diagnostics.map((diagnostic) => (
				<li className='flex flex-col gap-0.5' key={diagnostic.code}>
					<span className='font-medium'>{diagnostic.message}</span>
					{diagnostic.path ? (
						<span className='font-mono text-xxs opacity-80'>
							{diagnostic.path}
						</span>
					) : null}
				</li>
			))}
		</ul>
	);
}
