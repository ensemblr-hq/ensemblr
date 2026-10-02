/**
 * Public surface for the renderer's dictation helpers: the pure text-joining
 * rule the composer applies to a finished transcript, plus the container the
 * capture hook records in. The clip limits it enforces are shared with the main
 * process and come from {@link import('@/shared/dictation-limits')}.
 */
export { type EndpointSafety, endpointSafety } from './endpoint-safety';
export { joinDictatedText } from './join-dictated-text';
export { preferredRecorderMimeType } from './recorder-limits';
