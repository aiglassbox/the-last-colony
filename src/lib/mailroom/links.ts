/**
 * Every link a mailroom email carries is built here, from the site's own
 * origin. The Write form never supplies one: a link typed into a form is how
 * a button turns into somebody else's page.
 */

export const addRecipeUrl = (site: string): string => `${site}/add-recipe`;

/** The page a reader lands on from the link in the footer. */
export const unsubscribeUrl = (site: string, token: string): string => `${site}/unsubscribe?u=${token}`;

/** What Gmail's and Yahoo's own Unsubscribe button POSTs to (RFC 8058). */
export const oneClickUrl = (site: string, token: string): string => `${site}/api/unsubscribe?u=${token}`;

/** 18 random bytes as base64url. Anything else is not one of ours and opts nobody out. */
export const TOKEN_PATTERN = /^[A-Za-z0-9_-]{24}$/;
