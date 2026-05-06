import { Component } from 'react'

export default class PreviewErrorBoundary extends Component {
  state = { hasError: false }

  static getDerivedStateFromError() {
    return { hasError: true }
  }

  componentDidCatch(error, info) {
    if (import.meta.env.DEV) {
      console.error('[PreviewErrorBoundary]', error, info.componentStack)
    }
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="preview-error-fallback">
          <p>The clone preview had trouble rendering sampled textures.</p>
          <button
            className="btn-secondary"
            onClick={() => {
              this.setState({ hasError: false })
              this.props.onSkipTextures?.()
            }}
          >
            Preview without sampled textures
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
