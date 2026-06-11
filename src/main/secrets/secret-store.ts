/**
 * Public entry point for the secret-store module. The implementation has been
 * split across focused files; this barrel keeps the historical import path
 * stable for callers.
 */
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
