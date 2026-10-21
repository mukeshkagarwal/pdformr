// Everything stored locally is partitioned by the signed-in user, so people sharing a
// browser each see only their own forms.
let scope = 'local';

export function setScope(userId: string) {
  scope = userId;
}

export function getScope(): string {
  return scope;
}

/** IndexedDB database name for a user's workspace. */
export function dbName(userId = scope): string {
  return `pdf-form-editor:${userId}`;
}

/** The pre-login database, migrated into the first account that signs in. */
export const LEGACY_DB = 'pdf-form-editor';
