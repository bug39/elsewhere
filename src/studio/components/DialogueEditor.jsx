import { useState, useCallback, useMemo, useEffect } from 'preact/hooks'
import {
  ReactFlow,
  Controls,
  Background,
  useNodesState,
  useEdgesState,
  addEdge,
  MarkerType
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'

/**
 * Custom node component for dialogue nodes
 */
function DialogueNode({ data, selected }) {
  const [isEditing, setIsEditing] = useState(false)
  const [text, setText] = useState(data.text || '')

  const handleSave = () => {
    data.onTextChange?.(text)
    setIsEditing(false)
  }

  return (
    <div class={`dialogue-node ${selected ? 'selected' : ''}`}>
      <div class="dialogue-node-header">
        {data.isStart && <span class="start-badge">START</span>}
        <span class="node-type">NPC</span>
      </div>

      <div class="dialogue-node-content">
        {isEditing ? (
          <textarea
            value={text}
            onInput={(e) => setText(e.target.value)}
            onBlur={handleSave}
            autoFocus
            class="dialogue-node-textarea"
          />
        ) : (
          <div
            class="dialogue-node-text"
            onClick={() => setIsEditing(true)}
          >
            {data.text || 'Click to edit...'}
          </div>
        )}
      </div>

      {/* Choice handles */}
      {data.choices?.map((choice, index) => (
        <div key={index} class="dialogue-choice-handle">
          <span class="choice-text">{choice.text || `Choice ${index + 1}`}</span>
        </div>
      ))}

      <button
        class="add-choice-btn"
        onClick={() => data.onAddChoice?.()}
      >
        + Add Choice
      </button>
    </div>
  )
}

const nodeTypes = {
  dialogue: DialogueNode
}

/**
 * Convert dialogue data to React Flow format
 */
function dialogueToFlow(dialogue) {
  if (!dialogue?.nodes) {
    return { nodes: [], edges: [] }
  }

  const nodes = []
  const edges = []
  let y = 0

  const nodeIds = Object.keys(dialogue.nodes)
  const positions = new Map()

  // Calculate positions (simple layout)
  nodeIds.forEach((id, index) => {
    positions.set(id, { x: (index % 3) * 320, y: Math.floor(index / 3) * 200 })
  })

  for (const [id, node] of Object.entries(dialogue.nodes)) {
    const pos = positions.get(id) || { x: 0, y: y }

    nodes.push({
      id,
      type: 'dialogue',
      position: pos,
      data: {
        text: node.text,
        choices: node.choices || [],
        isStart: id === dialogue.startNode
      }
    })

    // Create edges for choices
    if (node.choices) {
      node.choices.forEach((choice, index) => {
        if (choice.next) {
          edges.push({
            id: `${id}-${index}-${choice.next}`,
            source: id,
            target: choice.next,
            label: choice.text,
            markerEnd: { type: MarkerType.ArrowClosed }
          })
        }
      })
    } else if (node.next) {
      edges.push({
        id: `${id}-${node.next}`,
        source: id,
        target: node.next,
        markerEnd: { type: MarkerType.ArrowClosed }
      })
    }

    y += 200
  }

  return { nodes, edges }
}

/**
 * Convert React Flow back to dialogue format
 */
function flowToDialogue(nodes, edges, startNode) {
  const dialogue = {
    nodes: {},
    startNode
  }

  for (const node of nodes) {
    const outEdges = edges.filter(e => e.source === node.id)

    const choices = node.data.choices?.map((choice, index) => {
      const edge = outEdges.find(e => e.label === choice.text)
      return {
        text: choice.text,
        next: edge?.target || null
      }
    })

    dialogue.nodes[node.id] = {
      type: 'npc',
      text: node.data.text || '',
      choices: choices?.length > 0 ? choices : undefined,
      next: choices?.length === 0 ? outEdges[0]?.target : undefined
    }
  }

  return dialogue
}

/**
 * Dialogue Editor using React Flow
 */
export function DialogueEditor({ dialogue, npcName, onSave, onClose }) {
  const initial = useMemo(() => dialogueToFlow(dialogue), [dialogue])
  const [nodes, setNodes, onNodesChange] = useNodesState(initial.nodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState(initial.edges)

  // Reset nodes/edges when dialogue prop changes (e.g., switching NPCs)
  useEffect(() => {
    const flow = dialogueToFlow(dialogue)
    setNodes(flow.nodes)
    setEdges(flow.edges)
  }, [dialogue])

  const startNode = dialogue?.startNode || nodes[0]?.id || 'start'

  const onConnect = useCallback((params) => {
    setEdges((eds) => addEdge({
      ...params,
      markerEnd: { type: MarkerType.ArrowClosed }
    }, eds))
  }, [setEdges])

  const addNode = useCallback(() => {
    const id = `node_${Date.now()}`
    const newNode = {
      id,
      type: 'dialogue',
      position: { x: Math.random() * 400, y: Math.random() * 300 },
      data: {
        text: '',
        choices: []
      }
    }
    setNodes((nds) => [...nds, newNode])
  }, [setNodes])

  const handleSave = useCallback(() => {
    const newDialogue = flowToDialogue(nodes, edges, startNode)
    onSave?.(newDialogue)
    onClose?.()
  }, [nodes, edges, startNode, onSave, onClose])

  return (
    <div class="modal-overlay" onClick={onClose}>
      <div class="dialogue-editor-modal" onClick={(e) => e.stopPropagation()}>
        <div class="dialogue-editor-header">
          <h2>Dialogue Editor: {npcName || 'NPC'}</h2>
          <div class="dialogue-editor-actions">
            <button class="btn btn--secondary" onClick={addNode}>+ Add Node</button>
            <button class="btn btn--primary" onClick={handleSave}>Save</button>
            <button class="btn btn--ghost" onClick={onClose}>Cancel</button>
          </div>
        </div>

        <div class="dialogue-editor-canvas">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            nodeTypes={nodeTypes}
            fitView
          >
            <Controls />
            <Background variant="dots" gap={20} size={1} />
          </ReactFlow>
        </div>
      </div>
    </div>
  )
}
