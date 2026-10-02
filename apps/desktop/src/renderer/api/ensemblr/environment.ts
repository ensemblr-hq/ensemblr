import { queryOptions } from '@tanstack/react-query';

import { profileElectronIpcCall } from '@/renderer/lib/instrumentation';
import type {
	EnvironmentFileRequest,
	EnvironmentFilesResult,
	EnvironmentFilesScopeRequest,
	EnvironmentMutationResult,
	ReadEnvironmentVariableValueRequest,
	ReadEnvironmentVariableValueResult,
	SelectEnvFileResult,
	SetEnvironmentVariableRequest,
	UnsetEnvironmentVariableRequest,
} from '@/shared/ipc/contracts/environment';

import { ensemblrQueryKeys, getEnsemblrApi } from './query-keys';

/** Query options for the env-file paths configured at a scope. */
export function envFilesQuery(request: EnvironmentFilesScopeRequest) {
	return queryOptions({
		queryFn: () =>
			profileElectronIpcCall(
				{ channel: 'ensemblr:list-env-files', usesDatabase: true },
				() => getEnsemblrApi().listEnvFiles(request),
			),
		queryKey: ensemblrQueryKeys.environmentFiles(
			request.scope,
			request.scopeId,
		),
		staleTime: 5000,
	});
}

/** Creates or updates a single environment variable (auto-classified). */
export function setEnvironmentVariable(
	request: SetEnvironmentVariableRequest,
): Promise<EnvironmentMutationResult> {
	return profileElectronIpcCall(
		{ channel: 'ensemblr:set-environment-variable', usesDatabase: true },
		() => getEnsemblrApi().setEnvironmentVariable(request),
	);
}

/** Removes a single environment variable. */
export function unsetEnvironmentVariable(
	request: UnsetEnvironmentVariableRequest,
): Promise<EnvironmentMutationResult> {
	return profileElectronIpcCall(
		{ channel: 'ensemblr:unset-environment-variable', usesDatabase: true },
		() => getEnsemblrApi().unsetEnvironmentVariable(request),
	);
}

/** Reads the raw stored value of a single environment variable. */
export function readEnvironmentVariableValue(
	request: ReadEnvironmentVariableValueRequest,
): Promise<ReadEnvironmentVariableValueResult> {
	return profileElectronIpcCall(
		{ channel: 'ensemblr:read-environment-variable-value', usesDatabase: true },
		() => getEnsemblrApi().readEnvironmentVariableValue(request),
	);
}

/** Appends an env-file path to a scope. */
export function addEnvFile(
	request: EnvironmentFileRequest,
): Promise<EnvironmentFilesResult> {
	return profileElectronIpcCall(
		{ channel: 'ensemblr:add-env-file', usesDatabase: true },
		() => getEnsemblrApi().addEnvFile(request),
	);
}

/** Removes an env-file path from a scope. */
export function removeEnvFile(
	request: EnvironmentFileRequest,
): Promise<EnvironmentFilesResult> {
	return profileElectronIpcCall(
		{ channel: 'ensemblr:remove-env-file', usesDatabase: true },
		() => getEnsemblrApi().removeEnvFile(request),
	);
}

/** Opens a native file picker for selecting an env file. */
export function selectEnvFile(): Promise<SelectEnvFileResult> {
	return profileElectronIpcCall(
		{ channel: 'ensemblr:select-env-file', usesDatabase: false },
		() => getEnsemblrApi().selectEnvFile(),
	);
}
