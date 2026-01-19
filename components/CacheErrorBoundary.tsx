import React, { Component, ErrorInfo, ReactNode } from "react";
import { Trash2, RefreshCw } from "lucide-react";

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

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Uncaught error caught by CacheErrorBoundary:", error, errorInfo);
  }

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

            <button
              onClick={this.handleReset}
              className="w-full py-3.5 px-4 bg-red-600 hover:bg-red-700 active:bg-red-800 text-white rounded-lg font-bold flex items-center justify-center gap-2 transition-all shadow-lg hover:shadow-xl transform hover:-translate-y-0.5"
            >
              <RefreshCw className="w-5 h-5" />
              Fix & Reset App
            </button>
            
            <p className="text-[10px] w-full text-center text-slate-400 mt-4 leading-normal">
              Note: This will clear temporary files and reload. <br/>
              Please ensure you are connected to the internet.
            </p>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
