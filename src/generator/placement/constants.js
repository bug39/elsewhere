/**
 * Shared constants for placement algorithms
 */

/**
 * Category-aware minimum distance defaults
 * These are much tighter than the previous 5m default to allow denser scenes
 */
export const CATEGORY_MIN_DISTANCE = {
  props: 1.5,      // Small items can be close together
  nature: 3,       // Trees/plants need some space
  buildings: 8,    // Structures need room
  characters: 2,   // NPCs can be close
  vehicles: 4      // Vehicles need moderate space
}

/**
 * Over-request factor to compensate for Poisson undercount + collision filtering
 * Empirically: Poisson returns 60-80% of requested, collision filters 50%
 * Combined yield is ~40-50%, so 1.8x over-request achieves ~70-90% final placement
 */
export const PLACEMENT_OVERREQUEST = 1.8

/**
 * Default camera positions for composition-aware placement
 */
export const COMPOSITION_CAMERAS = {
  overview: { x: 215, y: 70, z: 240 },
  groundLevel: { x: 160, y: 8, z: 160 }
}
