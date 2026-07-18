import { Component, Fragment, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  children: ReactNode
}
interface State {
  error: Error | null
  /** bumped on "Reload view" to force a fresh mount of the children */
  resetKey: number
}

/**
 * Catches render-phase errors in the 3D scene (e.g. a postprocessing chain
 * reconciliation throwing during a view-mode switch) so a glitch degrades to a
 * recoverable message instead of a frozen canvas. "Reload view" remounts the
 * subtree from scratch.
 */
export default class SceneBoundary extends Component<Props, State> {
  state: State = { error: null, resetKey: 0 }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[git-city] scene error:', error, info.componentStack)
  }

  private reload = (): void => {
    this.setState((s) => ({ error: null, resetKey: s.resetKey + 1 }))
  }

  render(): ReactNode {
    if (this.state.error) {
      return (
        <div className="scene-error">
          <div className="scene-error-card">
            <h2>Rendering hiccup</h2>
            <p>The 3D view hit a snag. Your repository and changes are untouched.</p>
            <button className="primary" onClick={this.reload}>
              Reload view
            </button>
          </div>
        </div>
      )
    }
    // keying on resetKey guarantees a clean remount after a reload, with no
    // extra DOM wrapper to disturb the Canvas's layout
    return <Fragment key={this.state.resetKey}>{this.props.children}</Fragment>
  }
}
