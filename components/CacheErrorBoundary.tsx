import React, { Component, ErrorInfo, ReactNode } from "react";
import { RefreshCw, AlertTriangle } from "lucide-react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class CacheErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Uncaught error caught by ErrorBoundary:", error, errorInfo);
  }

  public render() {
    if (this.state.hasError) {
      return (
        <div className="fixed inset-0 bg-slate-50 flex items-center justify-center p-4 z-[9999]" style={{ fontFamily: 'system-ui, sans-serif' }}>
          <div className="bg-white p-6 md:p-8 rounded-xl shadow-2xl max-w-md w-full border border-slate-200">
            <div className="flex justify-center mb-6">
              <div className="p-4 bg-red-100 rounded-full">
                <AlertTriangle className="w-8 h-8 md:w-10 md:h-10 text-red-600" />
              </div>
            </div>
            
            <h2 className="text-xl md:text-2xl font-bold text-center text-slate-800 mb-2">
              حدث خطأ في التطبيق
            </h2>
            <h3 className="text-lg text-center text-slate-600 mb-6">
              App Encountered an Error
            </h3>

            {this.state.error && (
              <details className="mb-6 group">
                 <summary className="text-xs text-slate-400 cursor-pointer list-none hover:text-slate-600 text-center">
                    View Error Details (Click to expand)
                 </summary>
                 <div className="bg-slate-100 p-3 rounded mt-2 text-[10px] md:text-xs font-mono text-slate-700 overflow-auto max-h-32 border border-slate-200">
                    {this.state.error.toString()}
                 </div>
              </details>
            )}

            <button
              onClick={() => window.location.reload()}
              className="w-full py-3 px-4 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-bold flex items-center justify-center gap-2 transition-all"
            >
              <RefreshCw className="w-5 h-5" />
              إعادة تحميل / Reload
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
