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

  // Sync with DB connection status
  useEffect(() => {
    if (isDbConnected === true) {
      console.log("ConnectivityStatus: DB Connected, forcing Online state");
      setIsOnline(true);
    }
  }, [isDbConnected]);

  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      enableNetwork(db).catch(console.error);
    };
    
    const handleOffline = () => {
      setIsOnline(false);
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const handleRetry = async () => {
    try {
      await enableNetwork(db);
      // Also try a simple fetch to wake up the network stack if needed
      await fetch('https://www.google.com/favicon.ico', { mode: 'no-cors' }).catch(() => {});
      setIsOnline(true);
    } catch (error) {
      console.error("Retry failed:", error);
    }
  };

  // Monitor pending writes (simulated for now, as Firestore doesn't expose a direct "pending count" observable easily)
  // We can use a periodic check or hook into the data service later.
  // For now, we'll just show status.

  return (
    <div className={`fixed top-0 left-1/2 transform -translate-x-1/2 z-50 px-4 py-1 rounded-b-lg shadow-md text-xs font-bold flex items-center gap-2 transition-all duration-300 ${
      isOnline ? 'bg-green-100 text-green-800 translate-y-[-100%] hover:translate-y-0' : 'bg-amber-100 text-amber-800 translate-y-0'
    }`}>
      {isOnline ? (
        <>
          <Wifi size={14} />
          <span>Online & Synced</span>
        </>
      ) : (
        <>
          <WifiOff size={14} />
          <span>Offline Mode - Saving Locally</span>
          <button 
            onClick={handleRetry}
            className="ml-2 flex items-center gap-1 bg-white/50 hover:bg-white/80 text-amber-900 px-2 py-0.5 rounded text-[10px] uppercase tracking-wider transition-colors"
            title="Force Reconnect"
          >
            <RefreshCw size={10} />
            Reconnect
          </button>
        </>
      )}
    </div>
  );
};

export default ConnectivityStatus;
