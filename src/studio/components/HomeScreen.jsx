import { useState, useEffect } from 'preact/hooks'
import { listWorlds, loadWorld, deleteWorld, exportWorldAsJSON, importWorldFromJSON, getCreationStats } from '../state/storage'
import { showToast } from './Toast'
import { ConfirmModal, showConfirm } from './ConfirmModal'
import { isFeatureEnabled } from '../../shared/featureFlags'

const BIOMES = [
  { id: 'grass', label: 'Grassland', color: '#7dd87d' },
  { id: 'desert', label: 'Desert', color: '#ffd966' },
  { id: 'snow', label: 'Snow', color: '#b8d4e8' },
  { id: 'forest', label: 'Forest', color: '#5ab85a' },
  { id: 'volcanic', label: 'Volcanic', color: '#ff7b3a' }
]

export function HomeScreen({ onNewWorld, onLoadWorld, onEnterDirector }) {
  const [worlds, setWorlds] = useState([])
  const [isLoading, setIsLoading] = useState(true)
  const [showNewWorldModal, setShowNewWorldModal] = useState(false)
  const [newWorldName, setNewWorldName] = useState('')
  const [newWorldBiome, setNewWorldBiome] = useState('grass')
  const [themePrompt, setThemePrompt] = useState('')
  const [isImporting, setIsImporting] = useState(false)
  const [stats, setStats] = useState(null)

  useEffect(() => {
    loadWorlds()
  }, [])

  // Load stats when worlds change
  useEffect(() => {
    getCreationStats().then(setStats)
  }, [worlds])

  async function loadWorlds() {
    setIsLoading(true)
    try {
      const list = await listWorlds()
      setWorlds(list)
    } finally {
      setIsLoading(false)
    }
  }

  function handleCreateWorld() {
    if (!newWorldName.trim()) return
    onNewWorld(newWorldName.trim(), newWorldBiome, themePrompt.trim() || null)
    setShowNewWorldModal(false)
    setNewWorldName('')
    setNewWorldBiome('grass')
    setThemePrompt('')
  }

  async function handleExport(worldId, e) {
    e.stopPropagation()
    // H13 FIX: loadWorld returns { success, data, error }, not data directly
    const result = await loadWorld(worldId)
    if (result.success && result.data) {
      const filename = `${result.data.meta.name.replace(/[^a-z0-9]/gi, '_')}.thinq.json`
      exportWorldAsJSON(result.data)
      showToast(`Exported "${filename}" to Downloads`, 'success')
    } else {
      showToast(result.error || 'Failed to export world', 'error')
    }
  }

  // H12 FIX: Add world delete handler
  async function handleDelete(worldId, worldName, e) {
    e.stopPropagation()
    const confirmed = await showConfirm({
      title: 'Delete World',
      message: `Delete "${worldName}"? This cannot be undone.`,
      confirmText: 'Delete',
      danger: true
    })
    if (!confirmed) return
    const success = await deleteWorld(worldId)
    if (success) {
      showToast('World deleted', 'success')
      loadWorlds()
    } else {
      showToast('Failed to delete world', 'error')
    }
  }

  async function handleImport(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setIsImporting(true)
    try {
      await importWorldFromJSON(file)
      showToast('World imported', 'success')
      loadWorlds()
    } catch (err) {
      showToast(`Import failed: ${err.message}`, 'error')
    } finally {
      setIsImporting(false)
      e.target.value = ''
    }
  }

  return (
    <div class="home-screen">
      <h1 class="home-title">elsewhere</h1>
      <p class="home-subtitle">3D Studio for Living Worlds</p>

      {/* Creation stats banner - show only if feature enabled and user has created something */}
      {isFeatureEnabled('creationStats') && stats && (stats.assets > 0 || stats.worlds > 0) && (
        <div class="home-stats">
          <div class="home-stats__item">
            <span class="home-stats__value">{stats.worlds}</span>
            <span class="home-stats__label">{stats.worlds === 1 ? 'world' : 'worlds'}</span>
          </div>
          <div class="home-stats__item">
            <span class="home-stats__value">{stats.assets}</span>
            <span class="home-stats__label">{stats.assets === 1 ? 'asset' : 'assets'}</span>
          </div>
          <div class="home-stats__item">
            <span class="home-stats__value">{stats.instances}</span>
            <span class="home-stats__label">placed</span>
          </div>
          <div class="home-stats__item">
            <span class="home-stats__value">{stats.npcs}</span>
            <span class="home-stats__label">{stats.npcs === 1 ? 'NPC' : 'NPCs'}</span>
          </div>
        </div>
      )}

      <div class="home-worlds">
        {/* Skeleton cards while loading */}
        {isLoading && Array.from({ length: 3 }).map((_, i) => (
          <div key={`skeleton-${i}`} class="home-world-card" style="pointer-events: none">
            <div class="home-world-thumbnail">
              <div class="skeleton skeleton--thumbnail" />
            </div>
            <div class="skeleton skeleton--text" style="margin: var(--sp-2) auto 0" />
          </div>
        ))}

        {!isLoading && worlds.map(world => (
          <div
            key={world.id}
            class="home-world-card"
            onClick={() => onLoadWorld(world.id)}
          >
            <div class="home-world-thumbnail">
              {world.thumbnail ? (
                <img src={world.thumbnail} alt={world.name} />
              ) : (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="width: 32px; height: 32px; color: var(--text-tertiary)">
                  <circle cx="12" cy="12" r="10"/>
                  <path d="M2 12h20M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z"/>
                </svg>
              )}
            </div>
            <div class="home-world-name">{world.name}</div>
            <div style="display: flex; gap: var(--sp-2); margin-top: var(--sp-2)">
              <button
                class="btn btn--ghost btn--sm"
                onClick={(e) => handleExport(world.id, e)}
                title="Export"
              >
                Export
              </button>
              {/* H12 FIX: Add world delete button */}
              <button
                class="btn btn--ghost btn--sm"
                onClick={(e) => handleDelete(world.id, world.name, e)}
                title="Delete"
                style="color: var(--danger)"
              >
                Delete
              </button>
            </div>
          </div>
        ))}

        {!isLoading && (
          <div
            class="home-world-card home-new-world"
            onClick={() => setShowNewWorldModal(true)}
          >
          <div class="home-world-thumbnail">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="width: 32px; height: 32px; color: var(--text-tertiary)">
              <path d="M12 5v14M5 12h14"/>
            </svg>
          </div>
          <div class="home-world-name">New World</div>
          </div>
        )}
      </div>

      <div style="display: flex; gap: var(--sp-3); align-items: center; flex-wrap: wrap; justify-content: center">
        <label class="btn" style="cursor: pointer">
          {isImporting ? 'Importing...' : 'Import World'}
          <input type="file" accept=".json" style="display: none" onChange={handleImport} disabled={isImporting} />
        </label>
      </div>

      {/* New World Modal */}
      {showNewWorldModal && (
        <div class="modal-overlay" onClick={() => setShowNewWorldModal(false)}>
          <div class="modal modal--lg" onClick={(e) => e.stopPropagation()}>
            <div class="modal__header">
              <span class="modal__title">Create New World</span>
            </div>

            <div class="modal__body">
              <div class="field" style="margin-bottom: var(--sp-4)">
                <label class="field__label">World Name</label>
                <input
                  type="text"
                  class="input"
                  placeholder="My World"
                  value={newWorldName}
                  onInput={(e) => setNewWorldName(e.target.value)}
                  autoFocus
                />
              </div>

              <div class="field" style="margin-bottom: var(--sp-4)">
                <label class="field__label">Starting Biome</label>
                <div style="display: grid; grid-template-columns: repeat(5, 1fr); gap: var(--sp-2); margin-top: var(--sp-2)">
                  {BIOMES.map(biome => (
                    <div
                      key={biome.id}
                      style={`
                        padding: var(--sp-2) var(--sp-1);
                        text-align: center;
                        border-radius: var(--radius-sm);
                        cursor: pointer;
                        border: 1px solid ${newWorldBiome === biome.id ? 'var(--accent)' : 'var(--line)'};
                        background: ${newWorldBiome === biome.id ? 'var(--accent-light)' : 'var(--gray-50)'};
                        transition: all 100ms ease;
                      `}
                      onClick={() => setNewWorldBiome(biome.id)}
                    >
                      <div style={`width: 24px; height: 24px; margin: 0 auto var(--sp-1); border-radius: var(--radius-sm); background: ${biome.color}`} />
                      <div style="font-size: var(--text-2xs); color: var(--text-secondary)">{biome.label}</div>
                    </div>
                  ))}
                </div>
              </div>

              <div class="field">
                <label class="field__label">Theme Pack (optional)</label>
                <textarea
                  class="input"
                  placeholder="e.g. 'pirate cove with ships and treasure'"
                  value={themePrompt}
                  onInput={(e) => setThemePrompt(e.target.value)}
                  rows={3}
                  style="resize: vertical"
                />
                <div style="font-size: var(--text-2xs); color: var(--text-tertiary); margin-top: var(--sp-1)">
                  Leave empty to start with a blank world
                </div>
              </div>
            </div>

            <div class="modal__footer">
              <button class="btn btn--ghost" onClick={() => setShowNewWorldModal(false)}>Cancel</button>
              <button class="btn btn--primary" onClick={handleCreateWorld} disabled={!newWorldName.trim()}>
                Create
              </button>
            </div>
          </div>
        </div>
      )}

      <ConfirmModal />
    </div>
  )
}
