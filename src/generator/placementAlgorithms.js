/**
 * Placement algorithms for scene generation
 *
 * This file re-exports from the modular placement/ directory for backward compatibility.
 * All placement functionality has been split into focused modules:
 *
 * - placement/constants.js: Shared constants
 * - placement/samplingAlgorithms.js: Core primitives (Poisson, cluster, ring, edge, grid)
 * - placement/semanticLocation.js: Zone parsing, legacy executeAssetPlacement
 * - placement/terrainProcessing.js: Terrain modification, rebalancing
 * - placement/compositionPlacement.js: Camera-aware composition placement
 * - placement/relationshipResolver.js: Relationship-based placement system
 *
 * @see src/generator/placement/index.js for the full export list
 */

export * from './placement/index.js'
