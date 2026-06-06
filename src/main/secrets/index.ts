export type {
	MacosKeychainSecretStoreOptions,
	MockSecretStoreOptions,
	SecretBackend,
	SecretLookup,
	SecretMetadata,
	SecretMetadataFilter,
	SecretScope,
	SecretStore,
	SecretStoreErrorCode,
	SecretWriteInput,
} from './secret-store';
export {
	createMacosKeychainSecretStore,
	createMockSecretStore,
	maskSecret,
	SecretStoreError,
} from './secret-store';
