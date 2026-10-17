import React from 'react'

/**
 * Keep a renderer exception from leaving Electron with an opaque black window.
 * The full stack is shown locally so a production-only render crash can be
 * diagnosed from the app itself rather than guessed from the build output.
 */
export default class RenderErrorBoundary extends React.Component {
  state = { error: null }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    console.error('[Lokal renderer] Uncaught React render error', error, info?.componentStack || '')
  }

  render() {
    if (!this.state.error) return this.props.children
    const message = String(this.state.error?.message || this.state.error || 'Unknown render error')
    const stack = String(this.state.error?.stack || '')
    return (
      <div className="min-h-screen overflow-auto bg-[#090909] px-6 py-10 text-white">
        <main role="alert" className="mx-auto max-w-3xl space-y-4">
          <h1 className="text-xl font-semibold">Lokal could not render its interface</h1>
          <p className="text-sm text-white/70">
            A renderer error stopped the interface from loading. The error is shown below and was also written to the app log.
          </p>
          <pre className="max-h-[55vh] overflow-auto whitespace-pre-wrap break-words rounded-lg border border-white/10 bg-black/40 p-4 text-xs text-red-200">{message}{stack && stack !== message ? String.fromCharCode(10, 10) + stack : ""}</pre>
          <button type="button" onClick={() => window.location.reload()} className="rounded-lg bg-white px-4 py-2 text-sm font-medium text-black hover:bg-white/90">
            Reload Lokal
          </button>
        </main>
      </div>
    )
  }
}
