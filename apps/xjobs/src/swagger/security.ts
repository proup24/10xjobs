// Security scheme names shared by the document builder and the controllers.
export const ENGINE_KEY_SCHEME = 'engine-key';
export const BEARER_SCHEME = 'bearer';

/**
 * One OpenAPI security requirement object listing both schemes, so they are
 * ANDed. An operation-level `security` replaces the global engine-key
 * requirement, so user routes must name the engine key again here.
 */
export const ENGINE_KEY_AND_BEARER: Record<string, string[]> = {
  [ENGINE_KEY_SCHEME]: [],
  [BEARER_SCHEME]: [],
};
