/**
 * Placement algorithms barrel export
 *
 * Re-exports all public APIs from the modular placement system.
 * This file maintains backward compatibility with existing imports.
 *
 * Module structure:
 * - constants.js: Shared constants (CATEGORY_MIN_DISTANCE, PLACEMENT_OVERREQUEST, COMPOSITION_CAMERAS)
 * - samplingAlgorithms.js: Core primitives (Poisson disk, cluster, ring, edge, grid)
 * - semanticLocation.js: Zone parsing, legacy executeAssetPlacement
 * - terrainProcessing.js: Terrain modification, rebalancing
 * - compositionPlacement.js: Camera-aware composition placement
 * - relationshipResolver.js: Relationship-based placement system
 */

// Constants
export {
  CATEGORY_MIN_DISTANCE,
  PLACEMENT_OVERREQUEST,
  COMPOSITION_CAMERAS
} from './constants'

// Sampling algorithms
export {
  checkRectangularCollision,
  poissonDiskSampling,
  clusterPlacement,
  ringPlacement,
  edgePlacement,
  gridPlacement
} from './samplingAlgorithms'

// Semantic location and legacy placement
export {
  parseSemanticLocation,
  executeAssetPlacement,
  calculateMinDistance,
  validatePlacements,
  computeFootprintOverlap
} from './semanticLocation'

// Terrain processing
export {
  applyTerrainModification,
  rebalancePlacements,
  applyTerrainHeight
} from './terrainProcessing'

// Composition placement
export {
  framePlacement,
  behindPlacement,
  facingRotation,
  densityGradientSampling,
  leadingLinePlacement,
  backgroundPlacement,
  executeLayeredPlacement
} from './compositionPlacement'

// Relationship resolver
export {
  facingToAngle,
  StructureRegistry,
  resolveStructurePlacement,
  resolveDecorationRelationship,
  resolveArrangement,
  resolveAtmosphereRelationship,
  resolveNPCPlacement,
  resolveRelationshipPlacements
} from './relationshipResolver'
