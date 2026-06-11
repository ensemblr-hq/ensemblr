export { createMacosKeychainSecretStore } from './keychain-backend.ts';
export { createMockSecretStore } from './mock-backend.ts';
export { maskSecret } from './normalize.ts';
export {
	type MacosKeychainSecretStoreOptions,
	type MockSecretStoreOptions,
	type SecretBackend,
	type SecretLookup,
	type SecretMetadata,
	type SecretMetadataFilter,
	type SecretScope,
	type SecretStore,
	SecretStoreError,
	type SecretStoreErrorCode,
	type SecretWriteInput,
} from './secret-store-types.ts';
export {
	createSqliteSecretMetadataStore,
	type MetadataPersistInput,
	type MetadataStore,
} from './sqlite-metadata-store.ts';
