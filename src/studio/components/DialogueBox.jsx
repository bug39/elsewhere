import { useState, useEffect, useCallback } from 'preact/hooks'

/**
 * Dialogue box for NPC conversations in play mode
 */
export function DialogueBox({ dialogue, npcName, onChoice, onClose }) {
  const [currentNodeId, setCurrentNodeId] = useState(dialogue?.startNode || null)
  const [displayedText, setDisplayedText] = useState('')
  const [isTyping, setIsTyping] = useState(false)

  const currentNode = dialogue?.nodes?.[currentNodeId]

  // Typewriter effect
  useEffect(() => {
    if (!currentNode?.text) {
      setDisplayedText('')
      return
    }

    setIsTyping(true)
    setDisplayedText('')

    const text = currentNode.text
    let index = 0

    const interval = setInterval(() => {
      if (index < text.length) {
        setDisplayedText(text.slice(0, index + 1))
        index++
      } else {
        setIsTyping(false)
        clearInterval(interval)
      }
    }, 30) // 30ms per character

    return () => clearInterval(interval)
  }, [currentNodeId, currentNode?.text])

  // Skip typing on click
  const handleSkip = useCallback(() => {
    if (isTyping && currentNode?.text) {
      setDisplayedText(currentNode.text)
      setIsTyping(false)
    }
  }, [isTyping, currentNode?.text])

  // Handle choice selection
  const handleChoice = useCallback((choice) => {
    // M4 FIX: Add null check for choice
    if (!choice) return
    if (choice.next) {
      // M4 FIX: Validate next node exists before navigating
      if (dialogue?.nodes?.[choice.next]) {
        setCurrentNodeId(choice.next)
      } else {
        // Invalid next node, end dialogue
        onClose?.()
      }
    } else {
      // End of dialogue
      onClose?.()
    }
    onChoice?.(choice)
  }, [onChoice, onClose, dialogue])

  // Handle continue (for nodes without choices)
  const handleContinue = useCallback(() => {
    if (isTyping) {
      handleSkip()
      return
    }

    if (currentNode?.next) {
      setCurrentNodeId(currentNode.next)
    } else if (!currentNode?.choices || currentNode.choices.length === 0) {
      // End of dialogue
      onClose?.()
    }
  }, [isTyping, handleSkip, currentNode, onClose])

  // Keyboard handler
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.code === 'Space' || e.code === 'Enter') {
        e.preventDefault()
        handleContinue()
      } else if (e.code === 'Escape') {
        e.preventDefault()
        onClose?.()
      }

      // Number keys 1-4 for dialogue choices
      if (!isTyping && hasChoices) {
        const keyNum = parseInt(e.key, 10)
        if (keyNum >= 1 && keyNum <= 4) {
          const choiceIndex = keyNum - 1
          if (currentNode.choices[choiceIndex]) {
            e.preventDefault()
            handleChoice(currentNode.choices[choiceIndex])
          }
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleContinue, onClose, isTyping, hasChoices, currentNode, handleChoice])

  if (!dialogue || !currentNode) {
    return null
  }

  const hasChoices = currentNode.choices && currentNode.choices.length > 0

  return (
    <div class="dialogue-overlay" onClick={handleContinue}>
      <div class="dialogue-box" onClick={(e) => e.stopPropagation()}>
        {/* NPC Name */}
        <div class="dialogue-name">{npcName || 'NPC'}</div>

        {/* Dialogue Text */}
        <div class="dialogue-text">
          {displayedText}
          {isTyping && <span class="dialogue-cursor">|</span>}
        </div>

        {/* Choices */}
        {!isTyping && hasChoices && (
          <div class="dialogue-choices">
            {currentNode.choices.map((choice, index) => (
              <button
                key={index}
                class="dialogue-choice"
                onClick={() => handleChoice(choice)}
              >
                <span class="dialogue-choice-key">{index + 1}</span>
                {choice.text}
              </button>
            ))}
          </div>
        )}

        {/* Continue prompt */}
        {!isTyping && !hasChoices && (
          <div class="dialogue-continue">
            Press SPACE to continue...
          </div>
        )}
      </div>

      <style>{`
        .dialogue-overlay {
          position: fixed;
          bottom: 0;
          left: 0;
          right: 0;
          display: flex;
          justify-content: center;
          padding: 20px;
          pointer-events: auto;
          z-index: 1000;
        }

        .dialogue-box {
          width: 60%;
          max-width: 800px;
          background: rgba(26, 26, 46, 0.95);
          border: 2px solid var(--accent, #d64560);
          border-radius: 12px;
          padding: 20px;
          box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);
        }

        .dialogue-name {
          font-size: 14px;
          font-weight: 600;
          color: var(--accent, #d64560);
          margin-bottom: 8px;
          text-transform: uppercase;
          letter-spacing: 1px;
        }

        .dialogue-text {
          font-size: 18px;
          line-height: 1.6;
          color: #fff;
          min-height: 60px;
        }

        .dialogue-cursor {
          animation: blink 0.7s infinite;
        }

        @keyframes blink {
          0%, 100% { opacity: 1; }
          50% { opacity: 0; }
        }

        .dialogue-choices {
          margin-top: 16px;
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .dialogue-choice {
          background: rgba(233, 69, 96, 0.2);
          border: 1px solid var(--accent, #d64560);
          color: #fff;
          padding: 12px 16px;
          border-radius: 8px;
          font-size: 14px;
          cursor: pointer;
          transition: background 0.15s, transform 0.1s;
          text-align: left;
          display: flex;
          align-items: center;
          gap: 12px;
        }

        .dialogue-choice:hover {
          background: rgba(233, 69, 96, 0.4);
          transform: translateX(4px);
        }

        .dialogue-choice-key {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          min-width: 24px;
          height: 24px;
          background: rgba(255, 255, 255, 0.15);
          border: 1px solid rgba(255, 255, 255, 0.3);
          border-radius: 4px;
          font-size: 12px;
          font-weight: 600;
          flex-shrink: 0;
        }

        .dialogue-continue {
          margin-top: 16px;
          font-size: 12px;
          color: rgba(255, 255, 255, 0.5);
          text-align: center;
          animation: pulse 2s infinite;
        }

        @keyframes pulse {
          0%, 100% { opacity: 0.5; }
          50% { opacity: 1; }
        }
      `}</style>
    </div>
  )
}
