import React, { useState, useEffect } from 'react';
import { Wifi, WifiOff, RefreshCw, Save } from 'lucide-react';
import { db } from '../services/firebase';
import { waitForPendingWrites, enableNetwork, disableNetwork } from 'firebase/firestore';

const ConnectivityStatus: React.FC = () => {
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [pendingWrites, setPendingWrites] = useState(false);
  const [lastSynced, setLastSynced] = useState<Date | null>(null);

  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      // Re-enable network to ensure sync resumes
      enableNetwork(db).catch(console.error);
    };
    
    const handleOffline = () => {
      setIsOnline(false);
      // Disable network to prevent hanging requests
      disableNetwork(db).catch(console.error);
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

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
        </>
      )}
    </div>
  );
};

export default ConnectivityStatus;
