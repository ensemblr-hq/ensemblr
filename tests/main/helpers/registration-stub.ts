import path from 'node:path';

import type { LocalRepositoryRegistrationService } from '../../../src/main/repository/register-repository.ts';
import type {
	RegisteredRepositorySnapshot,
	RegisterLocalRepositoryResult,
} from '../../../src/shared/ipc';

/** Recorded call from {@link buildRegistrationStub}. */
export interface RecordedRegistrationCall {
	name: string;
	path: string;
}

/** Result of {@link buildRegistrationStub}. */
export interface RegistrationStub {
	calls: RecordedRegistrationCall[];
	service: LocalRepositoryRegistrationService;
}

/**
 * Builds a `LocalRepositoryRegistrationService` test double whose `register`
 * always succeeds, records every call, and reports a synthetic repository
 * row rooted at `repositoryPath`.
 */
export function buildRegistrationStub(
	repositoryPath: string,
	overrides: Partial<RegisteredRepositorySnapshot> = {},
): RegistrationStub {
	const calls: RecordedRegistrationCall[] = [];
	const repository: RegisteredRepositorySnapshot = {
		createdAt: '2026-06-07T12:00:00.000Z',
		defaultBranch: 'main',
		id: 'repository-test',
		metadata: {},
		name: path.basename(repositoryPath),
		path: repositoryPath,
		remoteUrl: null,
		slug: path.basename(repositoryPath),
		updatedAt: '2026-06-07T12:00:00.000Z',
		...overrides,
	};

	return {
		calls,
		service: {
			register: async (request) => {
				calls.push({ name: request.name, path: request.path });
				const result: RegisterLocalRepositoryResult = {
					diagnostics: [],
					registered: true,
					repository,
					settingsSources: [],
				};
				return result;
			},
		},
	};
}
