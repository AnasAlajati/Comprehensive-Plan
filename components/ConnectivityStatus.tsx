import React, { useState, useEffect } from 'react';
import { Wifi, WifiOff, RefreshCw, Save } from 'lucide-react';
import { db } from '../services/firebase';
import { waitForPendingWrites, enableNetwork, disableNetwork } from 'firebase/firestore';

interface ConnectivityStatusProps {
  isDbConnected?: boolean | null;
}

const ConnectivityStatus: React.FC<ConnectivityStatusProps> = ({ isDbConnected }) => {
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [pendingWrites, setPendingWrites] = useState(false);
  const [lastSynced, setLastSynced] = useState<Date | null>(null);
  const [isForcedOffline, setIsForcedOffline] = useState(false);
  
  // Slow connection detection
  const [isSlow, setIsSlow] = useState(false);

  // Sync with DB connection status
  useEffect(() => {
    // If we've manually forced offline, ignore positive DB signals
    if (isForcedOffline) return;

    if (isDbConnected === true) {
      console.log("ConnectivityStatus: DB Connected, forcing Online state");
      setIsOnline(true);
      setIsSlow(false); // Reset slow status on success
    } else if (isDbConnected === false) {
       // If specifically false (failed), check back soon
    }
  }, [isDbConnected, isForcedOffline]);

  // Network State Listeners
  useEffect(() => {
    const handleOnline = () => {
      // Only auto-reconnect if not manually forced offline
      if (!isForcedOffline) {
        setIsOnline(true);
        enableNetwork(db).catch(console.error);
      }
    };
    
    const handleOffline = () => {
      setIsOnline(false);
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    // Watch for slow connection on initial load or transitions
    let slowTimer: NodeJS.Timeout;
    if (isOnline && !isDbConnected && !isForcedOffline) {
        slowTimer = setTimeout(() => {
            setIsSlow(true);
        }, 4000); // 4 seconds threshold
    }

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      clearTimeout(slowTimer);
    };
  }, [isOnline, isDbConnected, isForcedOffline]);

  const handleGoOffline = async () => {
      try {
          await disableNetwork(db);
          setIsOnline(false);
          setIsForcedOffline(true);
          setIsSlow(false); // No longer "slow", just offline
          console.log("App switched to Offline Mode by user");
      } catch (err) {
          console.error("Failed to go offline:", err);
      }
  };

  const handleRetry = async () => {
    try {
      await enableNetwork(db);
      // Also try a simple fetch to wake up the network stack if needed
      await fetch('https://www.google.com/favicon.ico', { mode: 'no-cors' }).catch(() => {});
      setIsOnline(true);
      setIsForcedOffline(false);
      setIsSlow(false);
    } catch (error) {
      console.error("Retry failed:", error);
    }
  };

  // Prevent accidental close if offline (pending writes assumption)
  useEffect(() => {
      const handleBeforeUnload = (e: BeforeUnloadEvent) => {
          if (!isOnline || isForcedOffline) {
              e.preventDefault();
              e.returnValue = ''; // Standard for showing chrome warning
              return '';
          }
      };
      
      if (!isOnline || isForcedOffline) {
        window.addEventListener('beforeunload', handleBeforeUnload);
      }

      return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [isOnline, isForcedOffline]);

  return (
    <div className={`fixed top-0 left-1/2 transform -translate-x-1/2 z-50 px-4 py-1 rounded-b-lg shadow-md text-xs font-bold flex items-center gap-2 transition-all duration-300 ${
      !isOnline || isForcedOffline
        ? 'bg-amber-100 text-amber-800 translate-y-0 border-b-2 border-amber-300' 
        : isSlow 
            ? 'bg-yellow-50 text-yellow-800 translate-y-0 border-b-2 border-yellow-300'
            : 'bg-green-100 text-green-800 translate-y-[-100%] hover:translate-y-0'
    }`}>
      {(!isOnline || isForcedOffline) ? (
        <>
          <WifiOff size={14} className="animate-pulse" />
          <span>OFFLINE MODE - Saving Locally</span>
          <button 
            onClick={handleRetry}
            className="ml-2 flex items-center gap-1 bg-white/50 hover:bg-white/80 text-amber-900 px-2 py-0.5 rounded text-[10px] uppercase tracking-wider transition-colors border border-amber-200"
            title="Force Reconnect"
          >
            <RefreshCw size={10} />
            Go Online
          </button>
        </>
      ) : isSlow ? (
        <>
            <Wifi size={14} className="text-yellow-600" />
            <span>Slow Connection...</span>
            <button 
                onClick={handleGoOffline}
                className="ml-2 flex items-center gap-1 bg-white hover:bg-slate-50 text-slate-700 px-2 py-0.5 rounded text-[10px] uppercase tracking-wider transition-colors border border-slate-200 shadow-sm"
            >
                <WifiOff size={10} />
                Work Offline
            </button>
        </>
      ) : (
        <>
          <Wifi size={14} />
          <span>Online & Synced</span>
        </>
      )}
    </div>
  );
};

export default ConnectivityStatus;
