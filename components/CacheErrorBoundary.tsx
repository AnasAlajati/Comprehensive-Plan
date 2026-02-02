import React, { Component, ErrorInfo, ReactNode } from "react";
import { Trash2, RefreshCw, Wifi, WifiOff } from "lucide-react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  isAutoRecovering: boolean;
}

export class CacheErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
    isAutoRecovering: false,
  };

  public static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Uncaught error caught by CacheErrorBoundary:", error, errorInfo);
    
    // Check if it's a Firestore assertion error - auto recover
    const isFirestoreAssertionError = error.message?.includes('INTERNAL ASSERTION FAILED');
    if (isFirestoreAssertionError) {
      this.handleAutoRecovery();
    }
  }

  private handleAutoRecovery = async () => {
    this.setState({ isAutoRecovering: true });
    
    // Wait a moment then reload
    await new Promise(resolve => setTimeout(resolve, 2000));
    window.location.reload();
  };

  private handleReset = async () => {
    // Only ask for confirmation if it's not a critical "must wipe" situation, 
    // but users prefer control.
    if (window.confirm("This will clear all saved offline data and reload the app from the server. You must be online. Continue?")) {
      try {
        console.log("Starting full cache reset...");
        
        // 1. Clear Local Storage
        localStorage.clear();
        sessionStorage.clear();

        // 2. Clear IndexedDB (The main source of Firestore Cache Corruption)
        if (window.indexedDB && window.indexedDB.databases) {
            try {
                const dbs = await window.indexedDB.databases();
                for (const db of dbs) {
                    if (db.name) {
                        console.log(`Deleting IndexedDB: ${db.name}`);
                        const deleteRequest = window.indexedDB.deleteDatabase(db.name);
                        
                        // Wait for deletion (wrap in promise)
                        await new Promise((resolve, reject) => {
                            deleteRequest.onsuccess = () => resolve(true);
                            deleteRequest.onerror = () => reject(deleteRequest.error);
                            deleteRequest.onblocked = () => {
                                console.warn(`Delete blocked for ${db.name}`);
                                // Proceed anyway, reload usually forces close
                                resolve(false); 
                            };
                        });
                    }
                }
            } catch (idbError) {
                console.error("Failed to list/delete IndexedDBs:", idbError);
                // Fallback attempt for standard firebase DB name if listing fails
                try {
                   window.indexedDB.deleteDatabase("firebaseLocalStorageDb");
                } catch(e) {}
            }
        }

        // 3. Unregister Service Workers
        if ('serviceWorker' in navigator) {
            const registrations = await navigator.serviceWorker.getRegistrations();
            for (const registration of registrations) {
                await registration.unregister();
            }
        }

      } catch (e) {
        console.error("Error during reset sequence:", e);
      } finally {
        // 4. Force Reload
        // Reloading with 'true' (forceGet) is deprecated in some browsers but clearCache headers help
        window.location.reload(); 
      }
    }
  };

  public render() {
    if (this.state.hasError) {
      const isFirestoreError = this.state.error?.message?.includes("FIRESTORE") || 
                               this.state.error?.message?.includes("INTERNAL ASSERTION") ||
                               this.state.error?.message?.includes("FormattedMessage") || // Common in intl errors
                               this.state.error?.message?.includes("Minified React error"); 
      
      const isFirestoreAssertionError = this.state.error?.message?.includes('INTERNAL ASSERTION FAILED');

      // Auto-recovery UI for Firestore assertion errors
      if (this.state.isAutoRecovering || isFirestoreAssertionError) {
        return (
          <div className="fixed inset-0 bg-slate-900/90 flex items-center justify-center p-4 z-[9999]" style={{ fontFamily: 'system-ui, sans-serif' }}>
            <div className="bg-white p-6 md:p-8 rounded-xl shadow-2xl max-w-sm w-full border border-slate-200 text-center">
              <div className="flex justify-center mb-4">
                <div className="p-4 bg-blue-100 rounded-full">
                  <RefreshCw className="w-8 h-8 text-blue-600 animate-spin" />
                </div>
              </div>
              
              <h2 className="text-lg font-bold text-slate-800 mb-2">
                جاري الإصلاح التلقائي...
              </h2>
              <p className="text-slate-500 text-sm mb-4">
                Auto-recovering, please wait...
              </p>
              
              <div className="w-full bg-slate-200 rounded-full h-2">
                <div className="bg-blue-600 h-2 rounded-full animate-pulse" style={{ width: '70%' }}></div>
              </div>
            </div>
          </div>
        );
      }

      return (
        <div className="fixed inset-0 bg-slate-50 flex items-center justify-center p-4 z-[9999]" style={{ fontFamily: 'system-ui, sans-serif' }}>
          <div className="bg-white p-6 md:p-8 rounded-xl shadow-2xl max-w-md w-full border border-slate-200">
            <div className="flex justify-center mb-6">
              <div className="p-4 bg-red-100 rounded-full animate-pulse">
                <Trash2 className="w-8 h-8 md:w-10 md:h-10 text-red-600" />
              </div>
            </div>
            
            <h2 className="text-xl md:text-2xl font-bold text-center text-slate-800 mb-2">
              App Encountered an Error
            </h2>
            
            <p className="text-center text-slate-600 mb-6 text-sm md:text-base leading-relaxed">
              {isFirestoreError 
                ? "The local offline database appears to be corrupted. This often happens on mobile devices with unstable connections." 
                : "An unexpected error occurred that crashed the application."}
            </p>

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

            <div className="space-y-3">
              <button
                onClick={() => window.location.reload()}
                className="w-full py-3 px-4 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-bold flex items-center justify-center gap-2 transition-all"
              >
                <RefreshCw className="w-5 h-5" />
                إعادة تحميل / Reload
              </button>
              
              <button
                onClick={this.handleReset}
                className="w-full py-3 px-4 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg font-medium flex items-center justify-center gap-2 transition-all text-sm"
              >
                <Trash2 className="w-4 h-4" />
                مسح البيانات المؤقتة / Clear Cache
              </button>
            </div>
            
            <p className="text-[10px] w-full text-center text-slate-400 mt-4 leading-normal">
              Try "Reload" first. If it keeps happening, use "Clear Cache".
            </p>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
