

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { 
  collection, 
  onSnapshot, 
  query, 
  doc,
  getDocs,
  limit,
  deleteDoc,
  setDoc,
  getDoc,
  collectionGroup,
  where,
  serverTimestamp
} from 'firebase/firestore';
import { onAuthStateChanged, User } from 'firebase/auth';
import { db, auth } from './services/firebase';
import { DataService } from './services/dataService';
import { ActivityService } from './services/activityService';
import { MachineRow } from './types';
import { StatusBadge } from './components/StatusBadge';
import { PlanningSchedule } from './components/PlanningSchedule';
import { MaintenanceDashboard } from './components/MaintenanceDashboard';
import { MaintenancePage } from './components/MaintenancePage';
import { IdleMachineMonitor } from './components/IdleMachineMonitor';
import { AIInsightsModal } from './components/AIInsightsModal';
import { getScheduleRecommendations } from './services/ai';
import FetchDataPage from './components/FetchDataPage';
import { ClientOrdersPage } from './components/ClientOrdersPage';
import { CompareDaysPage } from './components/CompareDaysPage';
import { ProductionHistoryPage } from './components/ProductionHistoryPage';
import { FabricHistoryPage } from './components/FabricHistoryPage';
import { YarnInventoryPage } from './components/YarnInventoryPage';
import { DyehouseInventoryPage } from './components/DyehouseInventoryPage';
import { DyehouseDirectoryPage } from './components/DyehouseDirectoryPage';
import { SampleTrackingPage } from './components/SampleTrackingPage';
import { FabricsPage } from './components/FabricsPage';
import { MachinesPage } from './components/MachinesPage';
import { GlobalFabricButton } from './components/GlobalFabricButton';
import { LoginPage } from './components/LoginPage';
import { UserManagementPage } from './components/UserManagementPage';
import { 
  Send, 
  CheckCircle, 
  LayoutGrid, 
  Table, 
  Calendar, 
  Wrench, 
  AlertCircle, 
  PlusCircle, 
  Package, 
  GitCompare, 
  History, 
  BarChart3,
  Sparkles,
  PieChart,
  Truck,
  Layers,
  FileSpreadsheet,
  Settings,
  Building,
  LogOut,
  Users,
  Menu,
  X,
  Beaker
} from 'lucide-react';
import { MachineStatus } from './types';

const App: React.FC = () => {
  const [user, setUser] = useState<User | null>(null);
  const [userName, setUserName] = useState<string>(''); // NEW: Store display name from Firestore
  const [userRole, setUserRole] = useState<'admin' | 'editor' | 'viewer' | 'dyehouse_manager' | 'factory_manager' | null>(null);
  const [isAuthorized, setIsAuthorized] = useState<boolean | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [rawMachines, setRawMachines] = useState<any[]>([]);
  const [todaysLogs, setTodaysLogs] = useState<any[]>([]); // NEW: Store logs from sub-collection
  const [machines, setMachines] = useState<MachineRow[]>([]);
  const [selectedDate, setSelectedDate] = useState<string>(() => {
    return localStorage.getItem('globalActiveDay') || new Date().toISOString().split('T')[0];
  });
  const [isConnected, setIsConnected] = useState<boolean | null>(null);
  const [connectionError, setConnectionError] = useState<string>('');
  const [machineLoading, setMachineLoading] = useState<boolean>(true);
  const [globalActiveDay, setGlobalActiveDay] = useState<string | null>(null);
  const notificationCooldown = useRef<Set<string>>(new Set()); // Prevent notification loops

  // UI State
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  // AI State
  const [showInsights, setShowInsights] = useState(false);
  const [aiAnalysis, setAiAnalysis] = useState<any[]>([]);
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  // View Modes
  const [viewMode, setViewMode] = useState<'excel' | 'planning' | 'maintenance' | 'real-maintenance' | 'idle' | 'orders' | 'compare' | 'history' | 'fabric-history' | 'yarn-inventory' | 'dyehouse-inventory' | 'dyehouse-directory' | 'sample-tracking' | 'fabrics' | 'machines' | 'users'>('excel'); 
  const [planningInitialViewMode, setPlanningInitialViewMode] = useState<'INTERNAL' | 'EXTERNAL'>('INTERNAL');
  
  // Force dyehouse_manager to only see dyehouse-directory or orders
  // Force factory_manager to only see real-maintenance or sample-tracking
  useEffect(() => {
    if (userRole === 'dyehouse_manager' && viewMode !== 'dyehouse-directory' && viewMode !== 'orders') {
      setViewMode('dyehouse-directory');
    }
    if (userRole === 'factory_manager' && viewMode !== 'real-maintenance' && viewMode !== 'sample-tracking') {
      setViewMode('real-maintenance');
    }
  }, [userRole, viewMode]);

  // Track page views for activity monitoring
  useEffect(() => {
    if (user?.email && isAuthorized) {
      ActivityService.trackPageView(user.email, viewMode);
    }
  }, [viewMode, user?.email, isAuthorized]);
  
  // Navigation State
  const [highlightTarget, setHighlightTarget] = useState<{client: string, fabric?: string} | null>(null);

  const handleNavigateToPlanning = (mode: 'INTERNAL' | 'EXTERNAL') => {
    setPlanningInitialViewMode(mode);
    setViewMode('planning');
  };

  const handleNavigateToOrder = (client: string, fabric?: string) => {
    setHighlightTarget({ client, fabric });
    setViewMode('orders');
  };
  
  // External Production State
  const [externalProduction, setExternalProduction] = useState<number>(0);

  // 0. Auth Listener & Role Check
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);
      
      if (currentUser) {
        try {
          const email = currentUser.email?.toLowerCase();
          console.log('[DEBUG] Auth email:', currentUser.email);
          console.log('[DEBUG] Lowercase email:', email);
          console.log('[DEBUG] Auth UID:', currentUser.uid);
          if (!email) {
             setIsAuthorized(false);
             setAuthLoading(false);
             return;
          }

          // Check if ANY users exist (Bootstrap first admin)
          const usersRef = collection(db, 'users');
          const snapshot = await getDocs(query(usersRef, limit(1)));
          
          if (snapshot.empty) {
            // First user ever! Make them Admin.
            const name = currentUser.displayName || email.split('@')[0];
            await setDoc(doc(db, 'users', email), {
              email: email,
              displayName: name,
              role: 'admin',
              createdAt: serverTimestamp()
            });
            setUserRole('admin');
            setUserName(name);
            setIsAuthorized(true);
          } else {
            // Check if THIS user is authorized
            const q = query(usersRef, where('email', '==', email));
            const userSnap = await getDocs(q);
            
            if (!userSnap.empty) {
              const userData = userSnap.docs[0].data();
              // If role is 'pending', they are NOT authorized yet
              if (userData.role === 'pending') {
                setIsAuthorized(false);
              } else {
                setUserRole(userData.role);
                setUserName(userData.displayName || email.split('@')[0]);
                setIsAuthorized(true);
                
                // Update presence on login
                await setDoc(doc(db, 'users', email), {
                  isOnline: true,
                  lastSeen: serverTimestamp()
                }, { merge: true });
              }
            } else {
              // User signed up but is not in the list.
              // Create a 'pending' entry for them so Admin can see them.
              const name = currentUser.displayName || email.split('@')[0];
              await setDoc(doc(db, 'users', email), {
                email: email,
                displayName: name,
                role: 'pending',
                createdAt: serverTimestamp()
              });
              setIsAuthorized(false);
            }
          }
        } catch (err) {
          console.error("Auth check failed:", err);
          setIsAuthorized(false);
        }
      } else {
        setUserRole(null);
        setUserName('');
        setIsAuthorized(null);
      }

      setAuthLoading(false);
    });
    return () => unsubscribe();
  }, []);

  // Presence & Activity Tracking (Online, Idle, Background)
  useEffect(() => {
    if (!user?.email || !isAuthorized) return;
    
    const email = user.email.toLowerCase();
    const userDocRef = doc(db, 'users', email);
    
    // Mutable state for the effect closure
    let lastActivity = Date.now();
    let currentStatus = 'online'; 

    // Helper: Update Firestore
    const updatePresence = async (status: string) => {
      currentStatus = status;
      try {
        await setDoc(userDocRef, {
          isOnline: true, // User is technically connected
          status: status, // 'online' | 'idle' | 'background'
          lastSeen: serverTimestamp()
        }, { merge: true });
      } catch (err) {
        console.error('Failed to update presence:', err);
      }
    };

    // 1. IDLE CHECKER (Heartbeat)
    // Run every 60 seconds to check activity and send heartbeat
    const heartbeatInterval = setInterval(() => {
        const now = Date.now();
        const isHidden = document.visibilityState === 'hidden';
        
        // Determine Status based on simple rules
        let newStatus = currentStatus;

        if (isHidden) {
            newStatus = 'background';
        } else {
            // 5 minutes idle threshold
            if (now - lastActivity > 5 * 60 * 1000) {
                newStatus = 'idle';
            } else {
                newStatus = 'online';
            }
        }
        
        // Always send heartbeat to update 'lastSeen'
        updatePresence(newStatus);
    }, 60000);

    // 2. VISIBILITY LISTENER (Immediate Background Detection)
    const handleVisibility = () => {
        if (document.visibilityState === 'hidden') {
            updatePresence('background');
        } else {
            // Back to foreground - Reset activity if they come back
            lastActivity = Date.now();
            updatePresence('online');
        }
    };

    // 3. ACTIVITY LISTENER (Reset Idle Timer)
    const handleActivity = () => {
        lastActivity = Date.now();
        // If we were idle, immediately switch back to online without waiting for heartbeat
        if (currentStatus === 'idle' && document.visibilityState === 'visible') {
            updatePresence('online');
        }
    };

    // Initial Set
    updatePresence('online');

    // Attach Listeners
    document.addEventListener('visibilitychange', handleVisibility);
    const events = ['mousedown', 'mousemove', 'keydown', 'scroll', 'touchstart'];
    events.forEach(ev => window.addEventListener(ev, handleActivity));
    
    // Cleanup
    return () => {
      clearInterval(heartbeatInterval);
      document.removeEventListener('visibilitychange', handleVisibility);
      events.forEach(ev => window.removeEventListener(ev, handleActivity));
      
      // Set offline on exit
      setDoc(userDocRef, {
          isOnline: false,
          status: 'offline',
          lastSeen: serverTimestamp()
      }, { merge: true }).catch(console.error);
    };
  }, [user?.email, isAuthorized]);

  // 1. Test Connection on Mount & Monitor Network Status
  useEffect(() => {
    if (!user) return; // Don't fetch if not logged in

    // Network Status Handlers
    const handleOnline = () => {
      console.log("Network Status: Online");
      setIsConnected(true);
      setConnectionError("");
    };

    const handleOffline = () => {
      console.log("Network Status: Offline");
      setIsConnected(false);
      setConnectionError("No internet connection");
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    // Initial Network Check
    // Always try to connect, don't rely solely on navigator.onLine
    const testConnection = async () => {
      try {
        const machinesRef = collection(db, 'MachineSS');
        await getDocs(query(machinesRef, limit(1)));
        setIsConnected(true);
        setConnectionError("");
      } catch (error: any) {
        console.error("Firebase Connection Error:", error);
        // Only set offline if we really failed to connect
        setIsConnected(false);
        setConnectionError(error.message || "Unknown error occurred");
      }
    };
    
    testConnection();

    // Listen to Active Day from Settings
    const unsubSettings = onSnapshot(doc(db, 'settings', 'global'), (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        if (data.activeDay) {
          localStorage.setItem('globalActiveDay', data.activeDay);
          setSelectedDate(data.activeDay);
          setGlobalActiveDay(data.activeDay);
        }
      }
    });

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      unsubSettings();
    };
  }, []);

  // 2. Setup Real-time Listeners with error recovery
  useEffect(() => {
    // REMOVED: if (isConnected === false) return; 
    // We want listeners to run even if offline so we get cached data.

    // Machines Listener (Now listening to MachineSS)
    const qMachines = query(collection(db, 'MachineSS'));
    const unsubscribeMachines = onSnapshot(qMachines, (snapshot) => {
      const fetchedRawMachines = snapshot.docs.map(doc => ({
        ...doc.data(),
        id: doc.id, // Use string ID to support non-numeric IDs
        firestoreId: doc.id // Store the real ID
      }));
      setRawMachines(fetchedRawMachines);
      setMachineLoading(false);
      setIsConnected(true);
    }, (error) => {
      console.error("Snapshot Error (MachineSS):", error);
      
      // Check if it's the Firestore assertion error - let global handler deal with it
      if (error.message?.includes('INTERNAL ASSERTION FAILED')) {
        console.warn('Firestore internal error detected, global handler will recover...');
        return;
      }
      
      setIsConnected(false);
      setConnectionError(error.message);
      setMachineLoading(false);
    });

    // NEW: Daily Logs Listener (Sub-collection support)
    // We only fetch logs for the selected date to keep it lightweight
    // NOTE: This requires a composite index on collectionGroup 'dailyLogs' for field 'date'.
    // If index is missing, this will fail silently in console but not crash app.
    let unsubscribeLogs = () => {};
    try {
      const qLogs = query(collectionGroup(db, 'dailyLogs'), where('date', '==', selectedDate));
      unsubscribeLogs = onSnapshot(qLogs, (snapshot) => {
        const fetchedLogs = snapshot.docs.map(doc => ({
          ...doc.data(),
          id: doc.id
        }));
        setTodaysLogs(fetchedLogs);
      }, (error) => {
        // Suppress index error to avoid user confusion if they haven't created it yet
        if (error.code === 'failed-precondition') {
           console.warn("DailyLogs index missing. Create it in Firebase Console to see daily logs.");
        } else {
           console.error("Snapshot Error (DailyLogs):", error);
        }
      });
    } catch (e) {
      console.error("Error setting up logs listener:", e);
    }

    // Factory Stats Listener (for External Production)
    const statsDocRef = doc(db, 'factory_stats', 'daily_production');
    const unsubscribeStats = onSnapshot(statsDocRef, (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        setExternalProduction(data.external || 0);
      }
    }, (error) => {
      console.warn("Could not fetch factory stats:", error);
    });

    return () => {
      unsubscribeMachines();
      unsubscribeLogs();
      unsubscribeStats();
    };
  }, [isConnected, selectedDate]); // Added selectedDate dependency so logs re-fetch when date changes

  // 3. Process Machines based on Selected Date
  useEffect(() => {
    const processedMachines: MachineRow[] = rawMachines.map(data => {
      // 1. Try to find log in the new sub-collection state
      let dailyLog = todaysLogs.find((l: any) => String(l.machineId) === String(data.id));

      // 2. Fallback to legacy array if not found in sub-collection
      if (!dailyLog) {
         dailyLog = (data.dailyLogs || []).find((l: any) => l.date === selectedDate);
      }
      
      return {
        ...data,
        id: data.id,
        machineName: data.name || '',
        brand: data.brand || '',
        type: data.type || '',
        // Use log data if exists, otherwise default to 'No Order' or empty
        status: dailyLog?.status || 'No Order',
        customStatusNote: dailyLog?.status === 'Other' ? dailyLog?.customStatusNote : '',
        avgProduction: dailyLog?.avgProduction ?? data.avgProduction ?? 0,
        dayProduction: dailyLog?.dayProduction || 0,
        remainingMfg: dailyLog?.remainingMfg || 0,
        scrap: dailyLog?.scrap || 0,
        reason: dailyLog?.reason || '',
        material: dailyLog?.fabric || '',
        client: dailyLog?.client || '',
        orderReference: dailyLog?.orderReference || '',
        futurePlans: data.futurePlans || [],
        dailyLogs: data.dailyLogs || [],
        orderIndex: data.orderIndex,
        lastLogData: dailyLog || null,
        lastLogDate: dailyLog?.date || null
      } as MachineRow;
    });
    setMachines(processedMachines);
  }, [rawMachines, selectedDate, todaysLogs]);

  // 4. Update Machine (Refactored to use MachineSS and Sub-collections)
  const handleUpdateMachine = async (updatedMachine: MachineRow, reportDate?: string) => {
    try {
      const machineId = String(updatedMachine.id);
      // Use reportDate if provided, otherwise use the currently selected date in the UI
      const date = reportDate || selectedDate;
      
      // 1. Get current machine data (Parent)
      const machineRef = doc(db, 'MachineSS', machineId);
      const docSnap = await getDoc(machineRef);
      
      if (!docSnap.exists()) {
        throw new Error("Machine not found");
      }
      
      const currentData = docSnap.data();
      
      // 2. Get existing log (Sub-collection)
      const logRef = doc(db, 'MachineSS', machineId, 'dailyLogs', date);
      const logSnap = await getDoc(logRef);
      const existingLog = logSnap.exists() ? logSnap.data() : null;
      
      // --- NEW: Running Balance Logic ---
      // We calculate the new remaining quantity based on the previous state to ensure consistency.
      // This handles "Missing Days" (by using last known remaining) and "No Production" (subtracting 0).
      let calculatedRemaining = Number(updatedMachine.remainingMfg) || 0; // Default to UI value

      // Only apply auto-calculation if we are working on the latest state or a future date
      // (Editing old history without cascading updates is complex, so we focus on the "Running Balance" of now)
      if (!currentData.lastLogDate || date >= currentData.lastLogDate) {
          const newProduction = Number(updatedMachine.dayProduction) || 0;
          
          let baseRemaining = 0;
          let shouldCalculate = false;

          if (existingLog) {
              // Editing today's log: Revert the previous subtraction to get the base
              // Base = CurrentRemaining + OldProduction
              baseRemaining = (Number(existingLog.remainingMfg) || 0) + (Number(existingLog.dayProduction) || 0);
              shouldCalculate = true;
          } else if (currentData.lastLogData) {
              // New Day: Base is the remaining from the last known state
              baseRemaining = Number(currentData.lastLogData.remainingMfg) || 0;
              shouldCalculate = true;
          }

          // Check if this is a manual override of Remaining (User changed Remaining but NOT Production)
          // If so, we trust the user's input and skip calculation
          const isManualRemainingUpdate = existingLog && 
                                          updatedMachine.remainingMfg !== existingLog.remainingMfg &&
                                          updatedMachine.dayProduction === existingLog.dayProduction;

          // Apply the subtraction if we have a valid base AND it's not a manual override
          if (shouldCalculate && !isManualRemainingUpdate) {
             calculatedRemaining = baseRemaining - newProduction;
             if (calculatedRemaining < 0) calculatedRemaining = 0; // Prevent negative
          }
      }
      // ----------------------------------

      // 3. Create Log Entry
      const newLogEntry = {
        id: date,
        machineId: Number(machineId),
        date: date,
        dayProduction: Number(updatedMachine.dayProduction) || 0,
        scrap: Number(updatedMachine.scrap) || 0,
        status: updatedMachine.status,
        fabric: updatedMachine.material || '',
        client: updatedMachine.client || '',
        avgProduction: Number(updatedMachine.avgProduction) || 0,
        remainingMfg: calculatedRemaining, // Use Calculated Value
        reason: updatedMachine.reason || '',
        customStatusNote: updatedMachine.customStatusNote || '',
        orderReference: updatedMachine.orderReference || '',
        timestamp: new Date().toISOString(),
        lastUpdatedBy: userName || user?.displayName || 'Unknown',
        lastUpdatedByEmail: user?.email || 'Unknown'
      };

      // 4. Write to Sub-collection
      await setDoc(logRef, newLogEntry, { merge: true });

      // 5. Prepare updates (Parent Document)
      // Note: We NO LONGER update the 'dailyLogs' array on the parent document.
      const updates: any = {
        name: updatedMachine.machineName,
        brand: updatedMachine.brand,
        type: updatedMachine.type,
        avgProduction: updatedMachine.avgProduction,
        futurePlans: updatedMachine.futurePlans || [],
        orderIndex: updatedMachine.orderIndex,
        lastUpdated: new Date().toISOString(),
        lastUpdatedBy: userName || user?.displayName || 'Unknown',
        lastUpdatedByEmail: user?.email || 'Unknown'
      };

      // 6. Update lastLogData if this is the latest log
      if (!currentData.lastLogDate || date >= currentData.lastLogDate) {
        updates.lastLogDate = date;
        updates.lastLogData = {
          date: date,
          dayProduction: newLogEntry.dayProduction,
          scrap: newLogEntry.scrap,
          status: newLogEntry.status,
          fabric: newLogEntry.fabric,
          client: newLogEntry.client,
          remainingMfg: newLogEntry.remainingMfg,
          reason: newLogEntry.reason,
          customStatusNote: newLogEntry.customStatusNote
        };
        // Also update top-level status for compatibility
        updates.status = newLogEntry.status;
      }

      await DataService.updateMachineInMachineSS(machineId, updates);

      // 7. Log activity for tracking
      const changes: { field: string; oldValue: any; newValue: any }[] = [];
      if (existingLog) {
        // Track what changed
        if (existingLog.dayProduction !== newLogEntry.dayProduction) {
          changes.push({ field: 'Production', oldValue: existingLog.dayProduction, newValue: newLogEntry.dayProduction });
        }
        if (existingLog.status !== newLogEntry.status) {
          changes.push({ field: 'Status', oldValue: existingLog.status, newValue: newLogEntry.status });
        }
        if (existingLog.fabric !== newLogEntry.fabric) {
          changes.push({ field: 'Fabric', oldValue: existingLog.fabric, newValue: newLogEntry.fabric });
        }
        if (existingLog.client !== newLogEntry.client) {
          changes.push({ field: 'Client', oldValue: existingLog.client, newValue: newLogEntry.client });
        }
      }
      
      await ActivityService.logActivity(
        user?.email || '',
        userName || user?.displayName || 'Unknown',
        existingLog ? 'update' : 'create',
        'machine',
        machineId,
        updatedMachine.machineName || `Machine #${machineId}`,
        `${date} - ${newLogEntry.status}${newLogEntry.fabric ? ` - ${newLogEntry.fabric}` : ''}`,
        changes
      );

    } catch (error) {
      console.error("Error updating machine:", error);
      alert("Failed to update machine.");
    }
  };

  // 5. Delete Machine
  const handleDeleteMachine = async (id: number) => {
    if (!window.confirm(`Are you sure you want to delete Machine #${id}?`)) return;
    try {
      // Get machine name before deleting
      const machineToDelete = machines.find(m => m.id === id);
      await deleteDoc(doc(db, 'MachineSS', String(id)));
      
      // Log deletion activity
      await ActivityService.logActivity(
        user?.email || '',
        userName || user?.displayName || 'Unknown',
        'delete',
        'machine',
        String(id),
        machineToDelete?.machineName || `Machine #${id}`,
        'Machine removed from system'
      );
    } catch (error) {
      console.error("Error deleting machine: ", error);
      alert("Failed to delete machine.");
    }
  };

  // 7. Update External Production
  const handleUpdateExternalProduction = async (value: number) => {
    try {
      await setDoc(doc(db, 'factory_stats', 'daily_production'), { 
        external: value,
        lastUpdatedBy: userName || user?.displayName || 'Unknown',
        lastUpdatedByEmail: user?.email || 'Unknown',
        lastUpdated: new Date().toISOString()
      }, { merge: true });
    } catch (error) {
      console.error("Error updating external production:", error);
    }
  };



  const handleAnalyze = async () => {
    setIsAnalyzing(true);
    const result = await getScheduleRecommendations(machines);
    setAiAnalysis(result);
    setIsAnalyzing(false);
    setShowInsights(true);
  };

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600"></div>
      </div>
    );
  }

  if (!user) {
    return <LoginPage />;
  }

  if (isAuthorized === false) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="bg-white p-8 rounded-xl shadow-lg max-w-md w-full text-center space-y-4">
          <div className="w-16 h-16 bg-red-100 text-red-600 rounded-full flex items-center justify-center mx-auto">
            <AlertCircle size={32} />
          </div>
          <h2 className="text-2xl font-bold text-slate-800">Access Denied</h2>
          <p className="text-slate-600">
            Your account ({user.email}) is currently <strong>Pending Approval</strong>.
          </p>
          <p className="text-sm text-slate-500">
            An administrator has been notified and will review your access request shortly.
          </p>
          <button
            onClick={() => auth.signOut()}
            className="px-4 py-2 bg-slate-800 text-white rounded-lg hover:bg-slate-900 transition-colors"
          >
            Sign Out
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-teal-100 via-slate-50 to-slate-50 pb-20">
      {/* Header */}
      <div className="bg-white/80 backdrop-blur-md border-b border-slate-200 shadow-sm sticky top-0 z-30">
        <div className="max-w-[98%] mx-auto px-4 min-h-[64px] py-2 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
             <div className="bg-slate-900 p-2 rounded-lg hidden sm:block shadow-lg shadow-slate-900/20">
                <svg className="w-6 h-6 text-teal-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                </svg>
             </div>
             <div>
               <h1 className="text-xl font-black text-slate-900 tracking-tight">JATI</h1>
               <p className="text-xs text-slate-500 font-medium hidden sm:block">Seamless Operations</p>
             </div>
          </div>
          
          <div className="flex items-center gap-3 ml-auto sm:ml-0">
             <div className="hidden sm:block">
               <StatusBadge isConnected={isConnected} error={connectionError} />
             </div>
             
             {userRole === 'admin' && (
               <button
                 onClick={() => setViewMode('users')}
                 className={`p-2 rounded-lg transition-colors ${viewMode === 'users' ? 'bg-teal-50 text-teal-700' : 'text-slate-400 hover:text-slate-600 hover:bg-slate-100'}`}
                 title="User Management"
               >
                 <Users size={20} />
               </button>
             )}
             
             <div className="flex items-center gap-3 pl-3 border-l border-slate-200">
                <div className="hidden md:flex flex-col items-end">
                    <span className="text-xs font-semibold text-slate-700">{userName || user?.displayName || 'User'}</span>
                    <span className="text-[10px] text-slate-400">{user?.email}</span>
                </div>
                <button
                  onClick={() => auth.signOut()}
                  className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                  title="Sign Out"
                >
                  <LogOut size={20} />
                </button>
             </div>

          </div>
        </div>
      </div>

      <main className="max-w-[98%] mx-auto px-2 sm:px-4 py-4 sm:py-6 space-y-4 sm:space-y-6">
        
        {/* Professional Navigation Bar - Option A: Command Center */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 sticky top-0 z-40 mb-6">
           <div className="flex items-center justify-between p-2 px-3">
             
             {/* Main Tools - Show based on role */}
             <div className="flex items-center gap-2 overflow-x-auto no-scrollbar">
                {/* Dyehouse Manager only sees Dyehouse Directory and Orders */}
                {userRole === 'dyehouse_manager' ? (
                  <>
                    <button 
                      onClick={() => { setViewMode('dyehouse-directory'); setIsMenuOpen(false); }}
                      className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-bold transition-all shadow-sm whitespace-nowrap ${
                        viewMode === 'dyehouse-directory' 
                          ? 'bg-blue-600 text-white shadow-blue-200' 
                          : 'bg-white text-slate-600 hover:bg-slate-50 border border-slate-200'
                      }`}
                    >
                      <Building size={18} className={viewMode === 'dyehouse-directory' ? 'text-white' : 'text-blue-600'} />
                      <span>Dyehouse Directory</span>
                    </button>
                    <button 
                      onClick={() => { setViewMode('orders'); setIsMenuOpen(false); }}
                      className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-bold transition-all shadow-sm whitespace-nowrap ${
                        viewMode === 'orders' 
                          ? 'bg-orange-600 text-white shadow-orange-200' 
                          : 'bg-white text-slate-600 hover:bg-slate-50 border border-slate-200'
                      }`}
                    >
                      <Package size={18} className={viewMode === 'orders' ? 'text-white' : 'text-orange-600'} />
                      <span>Orders</span>
                    </button>
                  </>
                ) : userRole === 'factory_manager' ? (
                  <>
                    <button 
                      onClick={() => { setViewMode('real-maintenance'); setIsMenuOpen(false); }}
                      className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-bold transition-all shadow-sm whitespace-nowrap ${
                        viewMode === 'real-maintenance' 
                          ? 'bg-orange-600 text-white shadow-orange-200' 
                          : 'bg-white text-slate-600 hover:bg-slate-50 border border-slate-200'
                      }`}
                    >
                      <Wrench size={18} className={viewMode === 'real-maintenance' ? 'text-white' : 'text-orange-600'} />
                      <span>Maintenance Logs</span>
                    </button>
                    <button 
                      onClick={() => { setViewMode('sample-tracking'); setIsMenuOpen(false); }}
                      className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-bold transition-all shadow-sm whitespace-nowrap ${
                        viewMode === 'sample-tracking' 
                          ? 'bg-violet-600 text-white shadow-violet-200' 
                          : 'bg-white text-slate-600 hover:bg-slate-50 border border-slate-200'
                      }`}
                    >
                      <Beaker size={18} className={viewMode === 'sample-tracking' ? 'text-white' : 'text-violet-600'} />
                      <span>عينات</span>
                    </button>
                  </>
                ) : (
                  <>
                    <button 
                      onClick={() => { setViewMode('excel'); setIsMenuOpen(false); }}
                      className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-bold transition-all shadow-sm whitespace-nowrap ${
                        viewMode === 'excel' 
                          ? 'bg-emerald-600 text-white shadow-emerald-200' 
                          : 'bg-white text-slate-600 hover:bg-slate-50 border border-slate-200'
                      }`}
                    >
                      <Table size={18} className={viewMode === 'excel' ? 'text-white' : 'text-emerald-600'} />
                      <span>Daily Machine Plan</span>
                    </button>

                    <button 
                      onClick={() => { setViewMode('orders'); setIsMenuOpen(false); }}
                      className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-bold transition-all shadow-sm whitespace-nowrap ${
                        viewMode === 'orders' 
                          ? 'bg-orange-600 text-white shadow-orange-200' 
                          : 'bg-white text-slate-600 hover:bg-slate-50 border border-slate-200'
                      }`}
                    >
                      <Package size={18} className={viewMode === 'orders' ? 'text-white' : 'text-orange-600'} />
                      <span>Orders</span>
                    </button>

                    <button 
                      onClick={() => { setViewMode('dyehouse-directory'); setIsMenuOpen(false); }}
                      className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-bold transition-all shadow-sm whitespace-nowrap ${
                        viewMode === 'dyehouse-directory' 
                          ? 'bg-blue-600 text-white shadow-blue-200' 
                          : 'bg-white text-slate-600 hover:bg-slate-50 border border-slate-200'
                      }`}
                    >
                      <Building size={18} className={viewMode === 'dyehouse-directory' ? 'text-white' : 'text-blue-600'} />
                      <span>Dyehouse Dir.</span>
                    </button>

                    <button 
                      onClick={() => setViewMode('planning')}
                      className={`px-3 py-2 rounded-lg text-sm font-medium transition-all flex items-center gap-2 ${
                        viewMode === 'planning' 
                          ? 'bg-blue-600 text-white shadow-blue-200' 
                          : 'bg-white text-slate-600 hover:bg-slate-50 border border-slate-200'
                      }`}
                    >
                      <Calendar size={18} className={viewMode === 'planning' ? 'text-white' : 'text-blue-600'} />
                      <span>Schedule</span>
                    </button>
                  </>
                )}
             </div>

             {/* App Launcher - Hide for Dyehouse Manager and Factory Manager */}
             {userRole !== 'dyehouse_manager' && userRole !== 'factory_manager' && (
             <div className="relative">
               <button 
                 onClick={() => setIsMenuOpen(!isMenuOpen)}
                 className={`p-2.5 rounded-lg transition-all flex items-center gap-2 font-medium border ${
                   isMenuOpen 
                      ? 'bg-slate-800 text-white border-slate-800 shadow-lg' 
                      : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50 hover:text-slate-900'
                 }`}
               >
                 <span className="hidden sm:inline text-sm">All Apps</span>
                 {isMenuOpen ? <X size={20} /> : <LayoutGrid size={20} />}
               </button>

               {/* Dropdown Menu */}
               {isMenuOpen && (
                 <>
                   <div 
                      className="fixed inset-0 bg-black/5 z-40" 
                      onClick={() => setIsMenuOpen(false)}
                   />
                   <div className="absolute top-full right-0 mt-2 w-[calc(100vw-32px)] sm:w-[500px] bg-white rounded-xl shadow-2xl border border-slate-200 p-4 z-50 animate-in fade-in slide-in-from-top-2 origin-top-right">
                     <div className="grid grid-cols-2 sm:grid-cols-2 gap-2 max-h-[70vh] overflow-y-auto">
                        
                        <div className="col-span-2 pb-2 mb-2 border-b border-slate-100 flex items-center gap-2 text-xs font-bold text-slate-400 uppercase tracking-wider">
                          <Calendar size={14} /> Core Planning
                        </div>
                        <button 
                          onClick={() => { setViewMode('yarn-inventory'); setIsMenuOpen(false); }}
                          className={`flex items-center gap-3 p-3 rounded-lg text-left transition-all ${viewMode === 'yarn-inventory' ? 'bg-blue-50 text-blue-700 ring-1 ring-blue-200' : 'hover:bg-slate-50 text-slate-600 hover:text-slate-900 border border-transparent hover:border-slate-100'}`}
                        >
                          <div className={`p-2 rounded-md ${viewMode === 'yarn-inventory' ? 'bg-blue-100 text-blue-600' : 'bg-slate-100 text-slate-500'}`}><LayoutGrid size={20} /></div>
                          <div>
                            <div className="font-semibold text-sm">Yarn Inventory</div>
                            <div className="text-[10px] text-slate-400 leading-tight">Stock tracking</div>
                          </div>
                        </button>
                        
                        <div className="col-span-2 py-2 mb-2 border-b border-t border-slate-100 flex items-center gap-2 text-xs font-bold text-slate-400 uppercase tracking-wider mt-2">
                          <BarChart3 size={14} /> Analysis & Reports
                        </div>
                        <button 
                          onClick={() => { setViewMode('compare'); setIsMenuOpen(false); }}
                          className={`flex items-center gap-3 p-3 rounded-lg text-left transition-all ${viewMode === 'compare' ? 'bg-purple-50 text-purple-700 ring-1 ring-purple-200' : 'hover:bg-slate-50 text-slate-600 hover:text-slate-900 border border-transparent hover:border-slate-100'}`}
                        >
                          <div className={`p-2 rounded-md ${viewMode === 'compare' ? 'bg-purple-100 text-purple-600' : 'bg-slate-100 text-slate-500'}`}><GitCompare size={20} /></div>
                          <div className="font-semibold text-sm">Compare Days</div>
                        </button>
                        <button 
                          onClick={() => { setViewMode('history'); setIsMenuOpen(false); }}
                          className={`flex items-center gap-3 p-3 rounded-lg text-left transition-all ${viewMode === 'history' ? 'bg-teal-50 text-teal-700 ring-1 ring-teal-200' : 'hover:bg-slate-50 text-slate-600 hover:text-slate-900 border border-transparent hover:border-slate-100'}`}
                        >
                          <div className={`p-2 rounded-md ${viewMode === 'history' ? 'bg-teal-100 text-teal-600' : 'bg-slate-100 text-slate-500'}`}><History size={20} /></div>
                          <div className="font-semibold text-sm">Production History</div>
                        </button>
                        <button 
                          onClick={() => { setViewMode('fabric-history'); setIsMenuOpen(false); }}
                          className={`flex items-center gap-3 p-3 rounded-lg text-left transition-all ${viewMode === 'fabric-history' ? 'bg-orange-50 text-orange-700 ring-1 ring-orange-200' : 'hover:bg-slate-50 text-slate-600 hover:text-slate-900 border border-transparent hover:border-slate-100'}`}
                        >
                          <div className={`p-2 rounded-md ${viewMode === 'fabric-history' ? 'bg-orange-100 text-orange-600' : 'bg-slate-100 text-slate-500'}`}><Package size={20} /></div>
                          <div className="font-semibold text-sm">Fabric History</div>
                        </button>
                        <button 
                          onClick={() => { setViewMode('dyehouse-inventory'); setIsMenuOpen(false); }}
                          className={`flex items-center gap-3 p-3 rounded-lg text-left transition-all ${viewMode === 'dyehouse-inventory' ? 'bg-cyan-50 text-cyan-700 ring-1 ring-cyan-200' : 'hover:bg-slate-50 text-slate-600 hover:text-slate-900 border border-transparent hover:border-slate-100'}`}
                        >
                          <div className={`p-2 rounded-md ${viewMode === 'dyehouse-inventory' ? 'bg-cyan-100 text-cyan-600' : 'bg-slate-100 text-slate-500'}`}><Layers size={20} /></div>
                          <div className="font-semibold text-sm">Dyehouse Inv.</div>
                        </button>

                        <div className="col-span-2 py-2 mb-2 border-b border-t border-slate-100 flex items-center gap-2 text-xs font-bold text-slate-400 uppercase tracking-wider mt-2">
                          <Settings size={14} /> System & Management
                        </div>
                        <button 
                          onClick={() => { setViewMode('maintenance'); setIsMenuOpen(false); }}
                          className={`flex items-center gap-3 p-3 rounded-lg text-left transition-all ${viewMode === 'maintenance' ? 'bg-slate-100 text-slate-800 ring-1 ring-slate-300' : 'hover:bg-slate-50 text-slate-600 hover:text-slate-900 border border-transparent hover:border-slate-100'}`}
                        >
                           <div className={`p-2 rounded-md ${viewMode === 'maintenance' ? 'bg-slate-200 text-slate-700' : 'bg-slate-100 text-slate-500'}`}><Calendar size={20} /></div>
                           <div className="font-semibold text-sm">Switch Schedule</div>
                        </button>
                        <button 
                          onClick={() => { setViewMode('real-maintenance'); setIsMenuOpen(false); }}
                          className={`flex items-center gap-3 p-3 rounded-lg text-left transition-all ${viewMode === 'real-maintenance' ? 'bg-orange-50 text-orange-800 ring-1 ring-orange-300' : 'hover:bg-slate-50 text-slate-600 hover:text-slate-900 border border-transparent hover:border-slate-100'}`}
                        >
                           <div className={`p-2 rounded-md ${viewMode === 'real-maintenance' ? 'bg-orange-200 text-orange-700' : 'bg-slate-100 text-slate-500'}`}><Wrench size={20} /></div>
                           <div className="font-semibold text-sm">Maintenance Logs</div>
                        </button>
                        <button 
                          onClick={() => { setViewMode('fabrics'); setIsMenuOpen(false); }}
                          className={`flex items-center gap-3 p-3 rounded-lg text-left transition-all ${viewMode === 'fabrics' ? 'bg-slate-100 text-slate-800 ring-1 ring-slate-300' : 'hover:bg-slate-50 text-slate-600 hover:text-slate-900 border border-transparent hover:border-slate-100'}`}
                        >
                           <div className={`p-2 rounded-md ${viewMode === 'fabrics' ? 'bg-green-100 text-green-600' : 'bg-slate-100 text-slate-500'}`}><FileSpreadsheet size={20} /></div>
                           <div className="font-semibold text-sm">Fabrics DB</div>
                        </button>
                        <button 
                          onClick={() => { setViewMode('machines'); setIsMenuOpen(false); }}
                          className={`flex items-center gap-3 p-3 rounded-lg text-left transition-all ${viewMode === 'machines' ? 'bg-slate-100 text-slate-800 ring-1 ring-slate-300' : 'hover:bg-slate-50 text-slate-600 hover:text-slate-900 border border-transparent hover:border-slate-100'}`}
                        >
                           <div className={`p-2 rounded-md ${viewMode === 'machines' ? 'bg-slate-200 text-slate-700' : 'bg-slate-100 text-slate-500'}`}><Settings size={20} /></div>
                           <div className="font-semibold text-sm">Machines</div>
                        </button>
                        <button 
                          onClick={() => { setViewMode('idle'); setIsMenuOpen(false); }}
                          className={`flex items-center gap-3 p-3 rounded-lg text-left transition-all ${viewMode === 'idle' ? 'bg-red-50 text-red-700 ring-1 ring-red-200' : 'hover:bg-slate-50 text-slate-600 hover:text-slate-900 border border-transparent hover:border-slate-100'}`}
                        >
                           <div className={`p-2 rounded-md ${viewMode === 'idle' ? 'bg-red-100 text-red-600' : 'bg-slate-100 text-slate-500'}`}><AlertCircle size={20} /></div>
                           <div className="font-semibold text-sm">Idle Monitor</div>
                        </button>
                        <button 
                          onClick={() => { setViewMode('sample-tracking'); setIsMenuOpen(false); }}
                          className={`flex items-center gap-3 p-3 rounded-lg text-left transition-all ${viewMode === 'sample-tracking' ? 'bg-violet-50 text-violet-700 ring-1 ring-violet-200' : 'hover:bg-slate-50 text-slate-600 hover:text-slate-900 border border-transparent hover:border-slate-100'}`}
                        >
                           <div className={`p-2 rounded-md ${viewMode === 'sample-tracking' ? 'bg-violet-100 text-violet-600' : 'bg-slate-100 text-slate-500'}`}><Beaker size={20} /></div>
                           <div className="font-semibold text-sm">Sample Tracking</div>
                        </button>
                        
                     </div>
                   </div>
                 </>
               )}
             </div>
             )}
           </div>
        </div>

        <div className="w-full overflow-hidden">
            {viewMode === 'excel' && (
              <FetchDataPage 
                selectedDate={selectedDate}
                machines={machines}
                onNavigateToPlanning={handleNavigateToPlanning}
                onNavigateToOrder={handleNavigateToOrder}
                userRole={userRole}
              />
            )}

            {viewMode === 'planning' && (
              <PlanningSchedule 
                 machines={machines}
                 onUpdate={handleUpdateMachine}
                 initialViewMode={planningInitialViewMode}
                 userRole={userRole}
              />
            )}

            {viewMode === 'maintenance' && (
              <MaintenanceDashboard 
                machines={machines}
              />
            )}

            {viewMode === 'real-maintenance' && (
              <MaintenancePage 
                machines={machines}
              />
            )}

            {viewMode === 'dyehouse-inventory' && (
              <DyehouseInventoryPage userRole={userRole} />
            )}

            {viewMode === 'dyehouse-directory' && (
              <DyehouseDirectoryPage userRole={userRole} />
            )}

            {viewMode === 'sample-tracking' && (
              <SampleTrackingPage userRole={userRole} />
            )}

            {viewMode === 'idle' && (
              <IdleMachineMonitor userRole={userRole} />
            )}

            {viewMode === 'orders' && (
              <ClientOrdersPage 
                userRole={userRole} 
                highlightTarget={highlightTarget}
                onHighlightComplete={() => setHighlightTarget(null)}
              />
            )}

            {viewMode === 'yarn-inventory' && (
              <YarnInventoryPage userRole={userRole} />
            )}

            {viewMode === 'compare' && (
              <CompareDaysPage 
                allMachineData={rawMachines}
                defaultDate1={selectedDate}
              />
            )}

            {viewMode === 'history' && (
              <ProductionHistoryPage 
                machines={machines}
              />
            )}

            {viewMode === 'fabric-history' && (
              <FabricHistoryPage 
                machines={machines}
              />
            )}

            {viewMode === 'fabrics' && (
              <FabricsPage userRole={userRole} />
            )}

            {viewMode === 'machines' && (
              <MachinesPage machines={machines} userRole={userRole} />
            )}

            {viewMode === 'users' && (
              <UserManagementPage userRole={userRole} />
            )}
        </div>
      </main>
      
      {showInsights && (
        <AIInsightsModal 
          onClose={() => setShowInsights(false)}
          recommendations={aiAnalysis}
        />
      )}

      <GlobalFabricButton machines={machines} />
    </div>
  );
};

export default App;