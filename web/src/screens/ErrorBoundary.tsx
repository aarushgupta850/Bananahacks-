// Catches any crash inside the app and shows a friendly screen with a way forward, instead of a blank page
// or a raw error (web/CLAUDE.md: never show users a raw error).
// React only supports error boundaries as class components, so this is the one class in the app.
import { Component, type ErrorInfo, type ReactNode } from 'react'

interface ErrorBoundaryProps {
  children: ReactNode
  onReset: () => void // clears the session and goes back to the subject picker
}

export default class ErrorBoundary extends Component<ErrorBoundaryProps, { crashed: boolean }> {
  state = { crashed: false }

  static getDerivedStateFromError() {
    return { crashed: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(error, info.componentStack) // details for developers only
  }

  private reset = () => {
    this.setState({ crashed: false })
    this.props.onReset()
  }

  render() {
    if (!this.state.crashed) return this.props.children
    return (
      <section className="screen crash-screen" role="alert">
        <h1>Something went wrong</h1>
        <p className="screen-lead">Sorry, that wasn't supposed to happen. Your drawing is safe to redo: start over and pick a subject.</p>
        <div>
          <button type="button" className="btn btn-primary" onClick={this.reset}>Start over</button>
        </div>
      </section>
    )
  }
}
