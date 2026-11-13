import { APP_NAME } from '@apace/model';

/** Bumped whenever generated output changes, so a persisted bench profile gets reseeded. */
export const GENERATOR_VERSION = 1;

export interface SeedInfo {
  readonly app: string;
  readonly generatorVersion: number;
}

export function seedInfo(): SeedInfo {
  return { app: APP_NAME, generatorVersion: GENERATOR_VERSION };
}
