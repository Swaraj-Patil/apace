import { APP_NAME } from '@apace/model';

export { COVER_ASSETS, IMAGE_ASSETS, type SeedAsset, seedAssets } from './assets.ts';
export {
  databasesHash,
  HEALTHS,
  type Health,
  healthOf,
  openBlockersOf,
  PERSON_COUNT,
  type Person,
  PRIORITIES,
  PROJECT_COUNT,
  type Project,
  type Property,
  type SeedDatabases,
  STATUSES,
  seedDatabases,
  TASK_COUNT,
  TASK_PROPERTIES,
  type Task,
  TODAY,
} from './databases.ts';
export { BLOCK_MIX, EMBED_ORIGIN, LINK_ORIGIN, pageContent } from './pages.ts';
export {
  EPOCH,
  FAVORITE_PAGES,
  HUB_EVERY,
  LARGE_PAGE_BLOCKS,
  MAX_DEPTH,
  MEDIAN_BLOCKS,
  PAGE_COUNT,
  PAGE_OPEN_TARGETS,
  type PagePlan,
  planWorkspace,
  TRASHED_PAGES,
  type WorkspacePlan,
} from './plan.ts';
export { PLANTED } from './words.ts';
export {
  contentHash,
  pageRecord,
  type SearchFixture,
  type SeededWorkspace,
  type SeedFixtures,
  type SeedRecord,
  seedFixtures,
  seedRecords,
  seedWorkspace,
  workspaceRecord,
} from './workspace.ts';

/** Bumped whenever generated output changes, so a persisted bench profile gets reseeded. */
export const GENERATOR_VERSION = 1;

/** The seed every bench run and fixture uses unless told otherwise. */
export const DEFAULT_SEED = 1;

export interface SeedInfo {
  readonly app: string;
  readonly generatorVersion: number;
}

export function seedInfo(): SeedInfo {
  return { app: APP_NAME, generatorVersion: GENERATOR_VERSION };
}
