import { Component, type ErrorInfo, type ReactNode } from 'react'
import { AlertTriangle, RotateCcw, BookOpen } from 'lucide-react'
import { appLogger } from '../utils/logger'

export interface StageErrorBoundaryProps {
  children: ReactNode
  onExitToSongbook?: () => void
}

export interface StageErrorBoundaryState {
  hasError: boolean
  errorMessage: string | null
}

export class StageErrorBoundary extends Component<StageErrorBoundaryProps, StageErrorBoundaryState> {
  constructor(props: StageErrorBoundaryProps) {
    super(props)
    this.state = { hasError: false, errorMessage: null }
  }

  static getDerivedStateFromError(error: Error): StageErrorBoundaryState {
    return {
      hasError: true,
      errorMessage: error?.message || 'Unknown stage render exception',
    }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    // Log diagnostic metadata only; NEVER log or display raw song text / user chord content
    appLogger.error(
      'StageErrorBoundary',
      `caught stage render exception: ${error?.name || 'Error'}: ${error?.message || 'Unknown'}`,
      errorInfo?.componentStack?.slice(0, 300)
    )
  }

  handleRetry = () => {
    this.setState({ hasError: false, errorMessage: null })
  }

  handleExit = () => {
    this.setState({ hasError: false, errorMessage: null })
    this.props.onExitToSongbook?.()
  }

  render() {
    if (this.state.hasError) {
      return (
        <div
          role="alert"
          aria-live="assertive"
          className="flex-1 flex flex-col items-center justify-center p-6 bg-[#002B36] text-[#EEE8D5] select-none text-center min-h-[400px]"
        >
          <div className="w-14 h-14 rounded-2xl bg-[#DC6E67]/15 border border-[#DC6E67]/40 flex items-center justify-center text-[#DC6E67] mb-4">
            <AlertTriangle className="w-8 h-8" />
          </div>

          <h2 className="text-xl font-bold text-[#FDF6E3] mb-2 font-mono">
            Stage View Error
          </h2>

          <p className="text-sm text-[#93A1A1] max-w-md mb-6 leading-relaxed">
            The stage view encountered an unexpected render issue. Your song library and setlists are completely safe.
          </p>

          <div className="flex flex-wrap items-center justify-center gap-3">
            <button
              type="button"
              onClick={this.handleRetry}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#2AA198] text-[#002B36] font-bold text-sm shadow-md hover:bg-[#2AA198]/90 transition-colors cursor-pointer"
            >
              <RotateCcw className="w-4 h-4" />
              Retry Stage
            </button>

            <button
              type="button"
              onClick={this.handleExit}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#073642] border border-[#1A4A55] text-[#EEE8D5] font-semibold text-sm hover:border-[#2AA198] transition-colors cursor-pointer"
            >
              <BookOpen className="w-4 h-4" />
              Return to Songbook
            </button>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}
