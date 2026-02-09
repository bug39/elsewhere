/**
 * Parts list with type icons and selection
 * @param {{
 *   parts: Array<{displayName: string, type: 'group' | 'mesh', fromUserData: boolean, depth: number}>,
 *   selectedPart: string | null,
 *   onSelectPart: (partName: string) => void,
 *   tweakedParts: Set<string>
 * }} props
 */
export function PartsList({ parts, selectedPart, onSelectPart, tweakedParts }) {
  if (parts.length === 0) {
    return (
      <div class="parts-list-empty">
        No selectable parts found
      </div>
    )
  }

  return (
    <div class="parts-list">
      {parts.map((part) => {
        const isSelected = part.displayName === selectedPart
        const isTweaked = tweakedParts?.has(part.displayName)
        const indent = part.depth * 12

        // Type icon: animation part, group, or mesh
        let typeIcon, typeTitle
        if (part.fromUserData) {
          typeIcon = '\uD83C\uDFAC' // Film clapper
          typeTitle = 'Animation part'
        } else if (part.type === 'group') {
          typeIcon = '\uD83D\uDCE6' // Package
          typeTitle = 'Group'
        } else {
          typeIcon = '\u25C6' // Diamond
          typeTitle = 'Mesh'
        }

        return (
          <div
            key={part.displayName}
            class={`part-item ${isSelected ? 'selected' : ''} ${part.fromUserData ? 'anim-part' : ''}`}
            style={{ paddingLeft: `${12 + indent}px` }}
            onClick={() => onSelectPart(part.displayName)}
          >
            <div class="part-item-radio" />
            <span class="part-item-type" title={typeTitle}>{typeIcon}</span>
            <span class="part-item-name">{part.displayName}</span>
            {isTweaked && <span class="part-item-tweaked" title="Has modifications">*</span>}
          </div>
        )
      })}
    </div>
  )
}
