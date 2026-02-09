import { useState, useMemo, useCallback } from 'preact/hooks'
import { memo } from 'preact/compat'
import { GenerationSection } from './GenerationSection'
import { showConfirm } from './ConfirmModal'

/**
 * Tab header component for Create/Library tabs
 */
function TabHeader({ activeTab, onTabChange }) {
  return (
    <div class="library-tabs">
      <button
        class={`library-tab ${activeTab === 'create' ? 'library-tab--active' : ''}`}
        onClick={() => onTabChange('create')}
        aria-selected={activeTab === 'create'}
        role="tab"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M12 5v14M5 12h14" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
        Create
      </button>
      <button
        class={`library-tab ${activeTab === 'library' ? 'library-tab--active' : ''}`}
        onClick={() => onTabChange('library')}
        aria-selected={activeTab === 'library'}
        role="tab"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M21 8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/>
          <path d="M3.27 6.96L12 12.01l8.73-5.05M12 22.08V12"/>
        </svg>
        Library
      </button>
    </div>
  )
}

const CATEGORIES = [
  { id: 'all', label: 'All' },
  { id: 'characters', label: 'Characters' },
  { id: 'creatures', label: 'Creatures' },
  { id: 'buildings', label: 'Buildings' },
  { id: 'props', label: 'Props' },
  { id: 'nature', label: 'Nature' },
  { id: 'vehicles', label: 'Vehicles' }
]

const CATEGORY_ICONS = {
  characters: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
      <circle cx="12" cy="7" r="4"/>
      <path d="M5.5 21v-2a6.5 6.5 0 0113 0v2"/>
    </svg>
  ),
  creatures: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
      <path d="M12 3c-4 0-7 3-7 7 0 2 1 4 2 5l-2 6h14l-2-6c1-1 2-3 2-5 0-4-3-7-7-7z"/>
      <circle cx="9" cy="9" r="1" fill="currentColor"/>
      <circle cx="15" cy="9" r="1" fill="currentColor"/>
    </svg>
  ),
  buildings: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
      <path d="M3 21h18M5 21V7l7-4 7 4v14"/>
      <path d="M9 21v-6h6v6M9 9h.01M15 9h.01M9 13h.01M15 13h.01"/>
    </svg>
  ),
  props: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
      <path d="M21 8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/>
      <path d="M3.27 6.96L12 12.01l8.73-5.05M12 22.08V12"/>
    </svg>
  ),
  nature: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
      <path d="M12 22v-7M8 9l4-6 4 6c2 0 4 2 4 5s-2 4-4 4H8c-2 0-4-1-4-4s2-5 4-5z"/>
    </svg>
  ),
  vehicles: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
      <path d="M5 17h14v-5l-2-4H7l-2 4v5zM5 17a2 2 0 104 0M15 17a2 2 0 104 0"/>
    </svg>
  )
}

function CategoryIcon({ category }) {
  const icon = CATEGORY_ICONS[category] || CATEGORY_ICONS.props
  return <span class="library-item-icon">{icon}</span>
}

function CollapseToggle({ direction = 'left', onClick }) {
  return (
    <button
      class="panel-collapse-toggle"
      onClick={onClick}
      aria-label={direction === 'left' ? 'Collapse panel' : 'Expand panel'}
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d={direction === 'left' ? 'M15 18l-6-6 6-6' : 'M9 18l6-6-6-6'} />
      </svg>
    </button>
  )
}

function LibraryPanelInner({ library, placedAssets, onAssetSelect, selectedAssetId, onReviewItem, onVariationBatch, onDeleteAsset, worldId, isCollapsed, onToggleCollapse, hidden }) {
  const [activeTab, setActiveTab] = useState('create')
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('all')
  const [expandedVariants, setExpandedVariants] = useState(new Set())

  // Build variant groupings
  const { parentAssets, variantsByParent, orphanedVariants } = useMemo(() => {
    const variantsByParent = new Map() // parentId -> variants[]
    const parentAssets = []
    const orphanedVariants = [] // Variants whose parent doesn't exist

    for (const asset of library) {
      if (asset.variantOf) {
        // This is a variant
        const parent = library.find(a => a.id === asset.variantOf)
        if (parent) {
          if (!variantsByParent.has(asset.variantOf)) {
            variantsByParent.set(asset.variantOf, [])
          }
          variantsByParent.get(asset.variantOf).push(asset)
        } else {
          // Parent doesn't exist, treat as standalone
          orphanedVariants.push(asset)
        }
      } else {
        parentAssets.push(asset)
      }
    }

    return { parentAssets, variantsByParent, orphanedVariants }
  }, [library])

  // Memoize filtered list - now filtering parent assets only (variants are nested)
  const filteredLibrary = useMemo(() => {
    const matchesFilter = (asset) => {
      const matchesSearch = !search ||
        asset.name.toLowerCase().includes(search.toLowerCase()) ||
        (asset.tags || []).some(tag => tag.toLowerCase().includes(search.toLowerCase()))
      const matchesCategory = category === 'all' || asset.category === category
      return matchesSearch && matchesCategory
    }

    // Include parent assets that match OR have variants that match
    const filtered = parentAssets.filter(asset => {
      if (matchesFilter(asset)) return true
      const variants = variantsByParent.get(asset.id) || []
      return variants.some(v => matchesFilter(v))
    })

    // Include orphaned variants that match
    const matchingOrphans = orphanedVariants.filter(matchesFilter)

    return [...filtered, ...matchingOrphans]
  }, [parentAssets, orphanedVariants, variantsByParent, search, category])

  // Toggle variant expansion
  const toggleVariantExpansion = useCallback((parentId, e) => {
    e.stopPropagation()
    setExpandedVariants(prev => {
      const next = new Set(prev)
      if (next.has(parentId)) {
        next.delete(parentId)
      } else {
        next.add(parentId)
      }
      return next
    })
  }, [])

  // Stable callback references
  const handleSearchInput = useCallback((e) => setSearch(e.target.value), [])
  const handleCategoryClick = useCallback((catId) => setCategory(catId), [])

  // Delete library asset with confirmation showing instance count
  const handleDeleteAsset = useCallback(async (assetId, e) => {
    e.stopPropagation()
    const asset = library.find(a => a.id === assetId)
    const instanceCount = (placedAssets || []).filter(p => p.libraryId === assetId).length

    let message = `Delete "${asset?.name}" from library?`
    if (instanceCount > 0) {
      message = `Delete "${asset?.name}" from library?\n\nThis will also remove ${instanceCount} placed instance${instanceCount !== 1 ? 's' : ''} from the world.`
    }

    const confirmed = await showConfirm({
      title: 'Delete Asset',
      message,
      confirmText: 'Delete',
      danger: true
    })
    if (confirmed) {
      onDeleteAsset?.(assetId)
    }
  }, [library, placedAssets, onDeleteAsset])

  return (
    <aside
      class={`library-panel ${isCollapsed ? 'library-panel--collapsed' : ''}`}
      style={hidden ? { display: 'none' } : undefined}
    >
      <CollapseToggle
        direction={isCollapsed ? 'right' : 'left'}
        onClick={onToggleCollapse}
      />

      {/* Tabbed header */}
      <TabHeader activeTab={activeTab} onTabChange={setActiveTab} />

      {/* Create tab content */}
      {activeTab === 'create' && (
        <div class="library-tab-content">
          <GenerationSection onReviewItem={onReviewItem} onVariationBatch={onVariationBatch} worldId={worldId} />
        </div>
      )}

      {/* Library tab content */}
      {activeTab === 'library' && (
        <div class="library-tab-content">
          <div class="library-search">
            <div class="search">
              <svg class="search__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
              </svg>
              <input
                type="text"
                class="search__input"
                placeholder="Search assets..."
                value={search}
                onInput={handleSearchInput}
              />
            </div>
          </div>

          <div class="library-categories">
            {CATEGORIES.map(cat => (
              <span
                key={cat.id}
                class={`library-category ${category === cat.id ? 'active' : ''}`}
                onClick={() => handleCategoryClick(cat.id)}
              >
                {cat.label}
              </span>
            ))}
          </div>

          <div class="library-items">
            {filteredLibrary.length === 0 ? (
              <div class="library-empty">
                {library.length === 0 ? (
                  <>
                    <svg class="library-empty__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                      <path d="M21 8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/>
                      <path d="M3.27 6.96L12 12.01l8.73-5.05M12 22.08V12"/>
                    </svg>
                    <div class="library-empty__title">Your library is empty</div>
                    <div class="library-empty__hint">
                      Use the Create tab to generate your first 3D asset
                    </div>
                  </>
                ) : (
                  'No assets match your search.'
                )}
              </div>
            ) : (
              filteredLibrary.map((asset, index) => {
                const variants = variantsByParent.get(asset.id) || []
                const hasVariants = variants.length > 0
                const isExpanded = expandedVariants.has(asset.id)

                return (
                  <div key={asset.id} class="library-item-group">
                    {/* Main asset item */}
                    <div
                      class={`library-item ${selectedAssetId === asset.id ? 'selected' : ''} ${asset.variantOf ? 'library-item--variant' : ''}`}
                      title={asset.name}
                      onClick={() => onAssetSelect?.(asset.id)}
                      draggable
                      onDragStart={(e) => {
                        e.dataTransfer.setData('application/x-thinq-asset', asset.id)
                        e.dataTransfer.effectAllowed = 'copy'
                        const thumbnail = e.currentTarget.querySelector('.library-item-thumbnail')
                        if (thumbnail) {
                          const clone = thumbnail.cloneNode(true)
                          clone.style.cssText = 'position:absolute;top:-9999px;left:-9999px;background:transparent;width:80px;height:80px;'
                          document.body.appendChild(clone)
                          e.dataTransfer.setDragImage(clone, 40, 40)
                          requestAnimationFrame(() => document.body.removeChild(clone))
                        }
                      }}
                      {...(index === 0 ? { 'data-walkthrough': 'library-item' } : {})}
                    >
                      <div class="library-item-actions">
                        <button
                          class="library-item-delete-btn"
                          title="Delete from Library"
                          aria-label={`Delete ${asset.name} from library`}
                          onClick={(e) => handleDeleteAsset(asset.id, e)}
                        >
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M18 6L6 18M6 6l12 12"/>
                          </svg>
                        </button>
                      </div>
                      <div class="library-item-thumbnail">
                        {asset.thumbnail ? (
                          <img
                            src={asset.thumbnail}
                            alt={asset.name}
                            loading="lazy"
                            onError={(e) => { e.target.style.display = 'none' }}
                          />
                        ) : asset.isGenerating ? (
                          <div class="skeleton skeleton--thumbnail" />
                        ) : (
                          <CategoryIcon category={asset.category} />
                        )}
                      </div>
                      <div class="library-item-name">{asset.name}</div>
                      {asset.variantOf && (
                        <div class="library-item-variant-badge" title="Variant">V</div>
                      )}
                      {hasVariants && (
                        <button
                          class={`library-item-variants-badge ${isExpanded ? 'expanded' : ''}`}
                          title={`${variants.length} variant${variants.length !== 1 ? 's' : ''}`}
                          onClick={(e) => toggleVariantExpansion(asset.id, e)}
                        >
                          {variants.length}
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points={isExpanded ? '18 15 12 9 6 15' : '6 9 12 15 18 9'} />
                          </svg>
                        </button>
                      )}
                    </div>

                    {/* Expanded variants */}
                    {hasVariants && isExpanded && (
                      <div class="library-item-variants">
                        {variants.map((variant) => (
                          <div
                            key={variant.id}
                            class={`library-item library-item--variant ${selectedAssetId === variant.id ? 'selected' : ''}`}
                            title={variant.name}
                            onClick={() => onAssetSelect?.(variant.id)}
                            draggable
                            onDragStart={(e) => {
                              e.dataTransfer.setData('application/x-thinq-asset', variant.id)
                              e.dataTransfer.effectAllowed = 'copy'
                            }}
                          >
                            <div class="library-item-actions">
                              <button
                                class="library-item-delete-btn"
                                title="Delete Variant"
                                aria-label={`Delete ${variant.name}`}
                                onClick={(e) => handleDeleteAsset(variant.id, e)}
                              >
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                  <path d="M18 6L6 18M6 6l12 12"/>
                                </svg>
                              </button>
                            </div>
                            <div class="library-item-thumbnail">
                              {variant.thumbnail ? (
                                <img
                                  src={variant.thumbnail}
                                  alt={variant.name}
                                  loading="lazy"
                                  onError={(e) => { e.target.style.display = 'none' }}
                                />
                              ) : (
                                <CategoryIcon category={variant.category} />
                              )}
                            </div>
                            <div class="library-item-name">{variant.name}</div>
                            <div class="library-item-variant-badge" title={variant.variantDescription || 'Variant'}>V</div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })
            )}
          </div>
        </div>
      )}
    </aside>
  )
}

// Memoize to prevent re-renders when parent changes but props don't
export const LibraryPanel = memo(LibraryPanelInner)
