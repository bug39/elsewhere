import { useState, useEffect } from 'preact/hooks'
import { isOnboardingComplete, markOnboardingComplete } from '../state/walkthroughState'

const STEPS = [
  {
    number: 1,
    title: 'Generate',
    description: 'Describe any 3D asset and AI will create it for you',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
        <path d="M12 3v18m-9-9h18" stroke-linecap="round"/>
        <circle cx="12" cy="12" r="3"/>
      </svg>
    )
  },
  {
    number: 2,
    title: 'Arrange',
    description: 'Place, rotate, and scale assets in your 3D world',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
        <rect x="3" y="3" width="7" height="7"/>
        <rect x="14" y="3" width="7" height="7"/>
        <rect x="14" y="14" width="7" height="7"/>
        <rect x="3" y="14" width="7" height="7"/>
      </svg>
    )
  },
  {
    number: 3,
    title: 'Script',
    description: 'Give NPCs dialogue trees and behaviors',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
        <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/>
      </svg>
    )
  },
  {
    number: 4,
    title: 'Play',
    description: 'Explore your world in third-person view',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
        <polygon points="5 3 19 12 5 21 5 3"/>
      </svg>
    )
  }
]

export function WelcomeModal({ onClose }) {
  const handleGetStarted = () => {
    // Don't mark complete yet - let onboarding run
    onClose(true) // Start with onboarding hints enabled
  }

  const handleSkip = () => {
    markOnboardingComplete() // Skip = mark as done
    onClose(false) // Skip onboarding hints
  }

  return (
    <div class="modal-overlay" onClick={handleGetStarted}>
      <div class="modal welcome-modal" onClick={(e) => e.stopPropagation()}>
        <div class="welcome-modal__header">
          <h2 class="welcome-modal__title">Welcome to thinq</h2>
          <p class="welcome-modal__subtitle">Build 3D worlds with AI-generated assets</p>
        </div>

        <div class="welcome-modal__steps">
          {STEPS.map(step => (
            <div key={step.number} class="welcome-step">
              <div class="welcome-step__icon">
                {step.icon}
              </div>
              <div class="welcome-step__content">
                <div class="welcome-step__number">{step.number}</div>
                <div class="welcome-step__title">{step.title}</div>
                <div class="welcome-step__description">{step.description}</div>
              </div>
            </div>
          ))}
        </div>

        <div class="welcome-modal__footer">
          <button class="btn btn--primary" onClick={handleGetStarted}>
            Get Started
          </button>
          <button class="btn btn--ghost welcome-modal__skip" onClick={handleSkip}>
            I know what I'm doing
          </button>
        </div>
      </div>
    </div>
  )
}
