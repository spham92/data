/**
  @module @ember-data/store
*/

import { BRAND_SYMBOL } from '../utils/brand';

type RecordDataStoreWrapper = import('./store/record-data-store-wrapper').default;

/**
 * Maps public interfaces to internal class implementations
 *
 * @internal
 */
export interface UpgradeMap {
  RecordDataStoreWrapper: RecordDataStoreWrapper;
}

/**
 * Casts a public interface to the matching internal class implementation
 *
 * @internal
 */
export function upgradeForInternal<K extends keyof UpgradeMap>(
  external: { [BRAND_SYMBOL]: K } | undefined
): UpgradeMap[K] {
  return (external as unknown) as UpgradeMap[K];
}
