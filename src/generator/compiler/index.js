/**
 * Compiler module - Deterministic schema to Three.js code compilation
 */

export { SchemaCompiler } from './SchemaCompiler.js'
export { parseSchema, normalizeColor, clampSegments } from './parser.js'
export { validateSchema, topologicalSort } from './validator.js'
export { emitGeometry, estimateBounds } from './geometry.js'
export { emitModule } from './emitter.js'
