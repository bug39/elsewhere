import { useState, useEffect, useCallback } from 'preact/hooks'

/**
 * Transform input fields for position, rotation, and scale
 * Uses commit-on-blur pattern to prevent lag during typing
 * @param {{
 *   mode: 'translate' | 'rotate' | 'scale',
 *   position: [number, number, number],
 *   rotation: [number, number, number],
 *   scale: [number, number, number],
 *   onPositionChange: (pos: [number, number, number]) => void,
 *   onRotationChange: (rot: [number, number, number]) => void,
 *   onScaleChange: (scl: [number, number, number]) => void,
 *   disabled?: boolean
 * }} props
 */
export function PartTransformInputs({
  mode = 'translate',
  position,
  rotation,
  scale,
  onPositionChange,
  onRotationChange,
  onScaleChange,
  disabled = false
}) {
  const MIN_PART_SCALE = 0.01

  // Local state for each transform - allows typing without immediate commits
  const [localPosition, setLocalPosition] = useState(position)
  const [localRotation, setLocalRotation] = useState(rotation)
  const [localScale, setLocalScale] = useState(scale)

  // Track which field is being edited (e.g., 'pos-0', 'rot-1', 'scl-2')
  const [editingField, setEditingField] = useState(null)

  // Sync from props when not editing
  useEffect(() => {
    if (!editingField?.startsWith('pos-')) {
      setLocalPosition(position)
    }
  }, [position, editingField])

  useEffect(() => {
    if (!editingField?.startsWith('rot-')) {
      setLocalRotation(rotation)
    }
  }, [rotation, editingField])

  useEffect(() => {
    if (!editingField?.startsWith('scl-')) {
      setLocalScale(scale)
    }
  }, [scale, editingField])

  const round = (v) => Math.round(v * 1000) / 1000

  // Position handlers
  const handlePosInput = useCallback((axis, value) => {
    const newPos = [...localPosition]
    newPos[axis] = parseFloat(value) || 0
    setLocalPosition(newPos)
  }, [localPosition])

  const commitPosition = useCallback(() => {
    setEditingField(null)
    onPositionChange(localPosition)
  }, [localPosition, onPositionChange])

  // Rotation handlers
  const handleRotInput = useCallback((axis, value) => {
    const newRot = [...localRotation]
    newRot[axis] = parseFloat(value) || 0
    setLocalRotation(newRot)
  }, [localRotation])

  const commitRotation = useCallback(() => {
    setEditingField(null)
    onRotationChange(localRotation)
  }, [localRotation, onRotationChange])

  // Scale handlers
  const handleSclInput = useCallback((axis, value) => {
    const newScl = [...localScale]
    const parsed = parseFloat(value)
    const baseValue = Number.isFinite(parsed) ? parsed : 1
    newScl[axis] = Math.max(MIN_PART_SCALE, baseValue)
    setLocalScale(newScl)
  }, [localScale])

  const commitScale = useCallback(() => {
    setEditingField(null)
    onScaleChange(localScale)
  }, [localScale, onScaleChange])

  // Handle Enter key to commit
  const handleKeyDown = useCallback((e, commitFn) => {
    if (e.key === 'Enter') {
      e.target.blur()
    }
  }, [])

  return (
    <div class="part-transform-inputs">
      {mode === 'translate' && (
        <div class="part-transform-row">
          <span class="part-transform-label">Position</span>
          <div class="part-transform-fields">
            <div class="part-transform-field">
              <span class="part-transform-axis" style="color: var(--axis-x)">X</span>
              <input
                type="number"
                step="0.1"
                value={round(localPosition[0])}
                onInput={(e) => handlePosInput(0, e.target.value)}
                onFocus={() => setEditingField('pos-0')}
                onBlur={commitPosition}
                onKeyDown={handleKeyDown}
                disabled={disabled}
              />
            </div>
            <div class="part-transform-field">
              <span class="part-transform-axis" style="color: var(--axis-y)">Y</span>
              <input
                type="number"
                step="0.1"
                value={round(localPosition[1])}
                onInput={(e) => handlePosInput(1, e.target.value)}
                onFocus={() => setEditingField('pos-1')}
                onBlur={commitPosition}
                onKeyDown={handleKeyDown}
                disabled={disabled}
              />
            </div>
            <div class="part-transform-field">
              <span class="part-transform-axis" style="color: var(--axis-z)">Z</span>
              <input
                type="number"
                step="0.1"
                value={round(localPosition[2])}
                onInput={(e) => handlePosInput(2, e.target.value)}
                onFocus={() => setEditingField('pos-2')}
                onBlur={commitPosition}
                onKeyDown={handleKeyDown}
                disabled={disabled}
              />
            </div>
          </div>
        </div>
      )}

      {mode === 'rotate' && (
        <div class="part-transform-row">
          <span class="part-transform-label">Rotation</span>
          <div class="part-transform-fields">
            <div class="part-transform-field">
              <span class="part-transform-axis" style="color: var(--axis-x)">X</span>
              <input
                type="number"
                step="5"
                value={round(localRotation[0])}
                onInput={(e) => handleRotInput(0, e.target.value)}
                onFocus={() => setEditingField('rot-0')}
                onBlur={commitRotation}
                onKeyDown={handleKeyDown}
                disabled={disabled}
              />
            </div>
            <div class="part-transform-field">
              <span class="part-transform-axis" style="color: var(--axis-y)">Y</span>
              <input
                type="number"
                step="5"
                value={round(localRotation[1])}
                onInput={(e) => handleRotInput(1, e.target.value)}
                onFocus={() => setEditingField('rot-1')}
                onBlur={commitRotation}
                onKeyDown={handleKeyDown}
                disabled={disabled}
              />
            </div>
            <div class="part-transform-field">
              <span class="part-transform-axis" style="color: var(--axis-z)">Z</span>
              <input
                type="number"
                step="5"
                value={round(localRotation[2])}
                onInput={(e) => handleRotInput(2, e.target.value)}
                onFocus={() => setEditingField('rot-2')}
                onBlur={commitRotation}
                onKeyDown={handleKeyDown}
                disabled={disabled}
              />
            </div>
          </div>
        </div>
      )}

      {mode === 'scale' && (
        <div class="part-transform-row">
          <span class="part-transform-label">Scale</span>
          <div class="part-transform-fields">
            <div class="part-transform-field">
              <span class="part-transform-axis" style="color: var(--axis-x)">X</span>
              <input
                type="number"
                step="0.1"
                min="0.01"
                value={round(localScale[0])}
                onInput={(e) => handleSclInput(0, e.target.value)}
                onFocus={() => setEditingField('scl-0')}
                onBlur={commitScale}
                onKeyDown={handleKeyDown}
                disabled={disabled}
              />
            </div>
            <div class="part-transform-field">
              <span class="part-transform-axis" style="color: var(--axis-y)">Y</span>
              <input
                type="number"
                step="0.1"
                min="0.01"
                value={round(localScale[1])}
                onInput={(e) => handleSclInput(1, e.target.value)}
                onFocus={() => setEditingField('scl-1')}
                onBlur={commitScale}
                onKeyDown={handleKeyDown}
                disabled={disabled}
              />
            </div>
            <div class="part-transform-field">
              <span class="part-transform-axis" style="color: var(--axis-z)">Z</span>
              <input
                type="number"
                step="0.1"
                min="0.01"
                value={round(localScale[2])}
                onInput={(e) => handleSclInput(2, e.target.value)}
                onFocus={() => setEditingField('scl-2')}
                onBlur={commitScale}
                onKeyDown={handleKeyDown}
                disabled={disabled}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
