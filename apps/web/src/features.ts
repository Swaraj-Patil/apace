/**
 * What the app can do today. The bench measures a metric only when the feature it needs is
 * listed here, so a budget can't silently pass on a feature that doesn't exist yet. Each step
 * that finishes a feature adds it.
 */
export const FEATURES = ['shell'] as const;

export type Feature = (typeof FEATURES)[number];
