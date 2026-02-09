import { useState, useRef, useEffect, useCallback } from 'preact/hooks'

/**
 * Inline editable text component.
 * Click to edit, Enter to save, Escape to cancel, blur to save.
 *
 * @param {Object} props
 * @param {string} props.value - Current text value
 * @param {function} props.onSave - Called with new value when saved
 * @param {string} [props.placeholder='Untitled'] - Placeholder when empty
 * @param {number} [props.maxLength=50] - Maximum character length
 * @param {string} [props.className] - Additional CSS class
 */
export function InlineEditableText({
  value,
  onSave,
  placeholder = 'Untitled',
  maxLength = 50,
  className = ''
}) {
  const [isEditing, setIsEditing] = useState(false)
  const [editValue, setEditValue] = useState(value)
  const inputRef = useRef(null)

  // Sync edit value when prop changes (external update)
  useEffect(() => {
    if (!isEditing) {
      setEditValue(value)
    }
  }, [value, isEditing])

  const startEditing = useCallback(() => {
    setIsEditing(true)
    setEditValue(value)
  }, [value])

  const saveAndClose = useCallback(() => {
    const trimmed = editValue.trim()
    if (trimmed && trimmed !== value) {
      onSave(trimmed)
    } else if (!trimmed) {
      // Revert to previous value if empty
      setEditValue(value)
    }
    setIsEditing(false)
  }, [editValue, value, onSave])

  const cancelEditing = useCallback(() => {
    setEditValue(value)
    setIsEditing(false)
  }, [value])

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      saveAndClose()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      cancelEditing()
    }
  }, [saveAndClose, cancelEditing])

  // Focus and select text when editing starts
  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [isEditing])

  if (isEditing) {
    return (
      <input
        ref={inputRef}
        type="text"
        class={`inline-editable-input ${className}`}
        value={editValue}
        onInput={(e) => setEditValue(e.target.value.slice(0, maxLength))}
        onBlur={saveAndClose}
        onKeyDown={handleKeyDown}
        maxLength={maxLength}
      />
    )
  }

  return (
    <span
      class={`inline-editable-text ${className}`}
      onClick={startEditing}
      onKeyDown={(e) => e.key === 'Enter' && startEditing()}
      tabIndex={0}
      role="button"
      aria-label={`Edit ${value || placeholder}`}
      title="Click to edit"
    >
      {value || placeholder}
    </span>
  )
}
