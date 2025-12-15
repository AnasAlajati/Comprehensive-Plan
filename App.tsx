

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
  getDoc
} from 'firebase/firestore';
import { db } from './services/firebase';
import { DataService } from './services/dataService';
import { MachineRow } from './types';
import { StatusBadge } from './components/StatusBadge';
import { MachineList } from './components/MachineList';
import { PlanningSchedule } from './components/PlanningSchedule';
import { MaintenanceDashboard } from './components/MaintenanceDashboard';
import { IdleMachineMonitor } from './components/IdleMachineMonitor';
import { AIInsightsModal } from './components/AIInsightsModal';
import { getScheduleRecommendations } from './services/ai';
import AddDataPage from './components/AddDataPage';
import FetchDataPage from './components/FetchDataPage';
import { ClientOrdersPage } from './components/ClientOrdersPage';
import { CompareDaysPage } from './components/CompareDaysPage';
import { ProductionHistoryPage } from './components/ProductionHistoryPage';
import { OrderFulfillmentPage } from './components/OrderFulfillmentPage';
import { AnalyticsPage } from './components/AnalyticsPage';
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
  Truck
} from 'lucide-react';
import { MachineStatus } from './types';

const App: React.FC = () => {
  const [rawMachines, setRawMachines] = useState<any[]>([]);
  const [machines, setMachines] = useState<MachineRow[]>([]);
  const [selectedDate, setSelectedDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [isConnected, setIsConnected] = useState<boolean | null>(null);
  const [connectionError, setConnectionError] = useState<string>('');
  const [machineLoading, setMachineLoading] = useState<boolean>(true);
  const [globalActiveDay, setGlobalActiveDay] = useState<string | null>(null);
  const notificationCooldown = useRef<Set<string>>(new Set()); // Prevent notification loops

  // AI State
  const [showInsights, setShowInsights] = useState(false);
  const [aiAnalysis, setAiAnalysis] = useState<any[]>([]);
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  // View Modes
  const [viewMode, setViewMode] = useState<'card' | 'excel' | 'planning' | 'maintenance' | 'idle' | 'add' | 'orders' | 'compare' | 'history' | 'fulfillment' | 'analytics'>('planning'); 
  
  // External Production State
  const [externalProduction, setExternalProduction] = useState<number>(0);

  // 1. Test Connection on Mount & Monitor Network Status
  useEffect(() => {
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
    if (!navigator.onLine) {
      handleOffline();
    } else {
      // If physically connected, verify Firestore access
      const testConnection = async () => {
        try {
          const machinesRef = collection(db, 'MachineSS');
          await getDocs(query(machinesRef, limit(1)));
          setIsConnected(true);
        } catch (error: any) {
          console.error("Firebase Connection Error:", error);
          setIsConnected(false);
          setConnectionError(error.message || "Unknown error occurred");
        }
      };
      testConnection();
    }

    // Listen to Active Day from Settings
    const unsubSettings = onSnapshot(doc(db, 'settings', 'global'), (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        if (data.activeDay) {
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

  // 2. Setup Real-time Listeners
  useEffect(() => {
    if (isConnected === false) return;

    // Machines Listener (Now listening to MachineSS)
    const qMachines = query(collection(db, 'MachineSS'));
    const unsubscribeMachines = onSnapshot(qMachines, (snapshot) => {
      const fetchedRawMachines = snapshot.docs.map(doc => ({
        ...doc.data(),
        id: Number(doc.id) || 0
      }));
      setRawMachines(fetchedRawMachines);
      setMachineLoading(false);
      
      if (snapshot.docs.length > 0) setIsConnected(true);
    }, (error) => {
      console.error("Snapshot Error (MachineSS):", error);
      setIsConnected(false);
      setConnectionError(error.message);
      setMachineLoading(false);
    });

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
      unsubscribeStats();
    };
  }, [isConnected]);

  // 3. Process Machines based on Selected Date
  useEffect(() => {
    const processedMachines: MachineRow[] = rawMachines.map(data => {
      // Find log for selectedDate
      const dailyLog = (data.dailyLogs || []).find((l: any) => l.date === selectedDate);
      
      return {
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
  }, [rawMachines, selectedDate]);

  // 4. Update Machine (Refactored to use MachineSS)
  const handleUpdateMachine = async (updatedMachine: MachineRow, reportDate?: string) => {
    try {
      const machineId = String(updatedMachine.id);
      // Use reportDate if provided, otherwise use the currently selected date in the UI
      const date = reportDate || selectedDate;
      
      // 1. Get current machine data to preserve logs
      const machineRef = doc(db, 'MachineSS', machineId);
      const docSnap = await import('firebase/firestore').then(mod => mod.getDoc(machineRef));
      
      if (!docSnap.exists()) {
        throw new Error("Machine not found");
      }
      
      const currentData = docSnap.data();
      const currentLogs = currentData.dailyLogs || [];
      
      // --- NEW: Running Balance Logic ---
      // We calculate the new remaining quantity based on the previous state to ensure consistency.
      // This handles "Missing Days" (by using last known remaining) and "No Production" (subtracting 0).
      let calculatedRemaining = Number(updatedMachine.remainingMfg) || 0; // Default to UI value

      // Only apply auto-calculation if we are working on the latest state or a future date
      // (Editing old history without cascading updates is complex, so we focus on the "Running Balance" of now)
      if (!currentData.lastLogDate || date >= currentData.lastLogDate) {
          const existingLog = currentLogs.find((l: any) => l.date === date);
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

      // 2. Update or Create Log for the date
      const logIndex = currentLogs.findIndex((l: any) => l.date === date);
      
      const newLogEntry = {
        id: date,
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
        timestamp: new Date().toISOString()
      };

      if (logIndex >= 0) {
        updatedLogs[logIndex] = { ...updatedLogs[logIndex], ...newLogEntry };
      } else {
        updatedLogs.push(newLogEntry);
      }

      // 3. Prepare updates
      const updates: any = {
        name: updatedMachine.machineName,
        brand: updatedMachine.brand,
        type: updatedMachine.type,
        avgProduction: updatedMachine.avgProduction,
        futurePlans: updatedMachine.futurePlans || [],
        orderIndex: updatedMachine.orderIndex,
        dailyLogs: updatedLogs,
        lastUpdated: new Date().toISOString()
      };

      // 4. Update lastLogData if this is the latest log
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

    } catch (error) {
      console.error("Error updating machine:", error);
      alert("Failed to update machine.");
    }
  };

  // 5. Delete Machine
  const handleDeleteMachine = async (id: number) => {
    if (!window.confirm(`Are you sure you want to delete Machine #${id}?`)) return;
    try {
      await deleteDoc(doc(db, 'MachineSS', String(id)));
    } catch (error) {
      console.error("Error deleting machine: ", error);
      alert("Failed to delete machine.");
    }
  };

  // 7. Update External Production
  const handleUpdateExternalProduction = async (value: number) => {
    try {
      await setDoc(doc(db, 'factory_stats', 'daily_production'), { external: value }, { merge: true });
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

  return (
    <div className="min-h-screen bg-slate-50 pb-20">
      {/* Header */}
      <div className="bg-white border-b border-slate-200 shadow-sm sticky top-0 z-30">
        <div className="max-w-[98%] mx-auto px-4 min-h-[64px] py-2 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
             <div className="bg-slate-800 p-2 rounded-lg hidden sm:block shadow-sm">
                <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                </svg>
             </div>
             <div>
               <h1 className="text-xl font-bold text-slate-800 tracking-tight">Production Planning</h1>
               <p className="text-xs text-slate-400 font-medium hidden sm:block">Real-time Factory Management</p>
             </div>
          </div>
          
          <div className="flex items-center gap-3 ml-auto sm:ml-0">
             <button
                onClick={handleAnalyze}
                disabled={isAnalyzing || machines.length === 0}
                className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg text-sm font-medium shadow-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed"
             >
                {isAnalyzing ? (
                   <span className="flex items-center gap-2">Analyzing...</span>
                ) : (
                   <>
                     <Sparkles size={16} />
                     <span className="hidden sm:inline">AI Analyst</span>
                   </>
                )}
             </button>
             <div className="hidden sm:block">
               <StatusBadge isConnected={isConnected} error={connectionError} />
             </div>
          </div>
        </div>
      </div>

      <main className="max-w-[98%] mx-auto px-2 sm:px-4 py-4 sm:py-6 space-y-4 sm:space-y-6">
        
        {/* Professional Navigation Bar */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
           <div className="flex flex-col lg:flex-row items-center justify-between p-2 gap-2">
             
             {/* Primary Modules (Schedule & Excel) */}
             <div className="flex items-center gap-2 w-full lg:w-auto p-1 bg-slate-100/50 rounded-lg">
                <button 
                  onClick={() => setViewMode('planning')}
                  className={`flex-1 lg:flex-none flex items-center justify-center gap-2 px-6 py-2.5 rounded-md text-sm font-semibold transition-all ${
                    viewMode === 'planning' 
                      ? 'bg-white text-indigo-600 shadow-sm ring-1 ring-black/5' 
                      : 'text-slate-500 hover:text-slate-700 hover:bg-slate-200/50'
                  }`}
                >
                  <Calendar size={18} />
                  Schedule
                </button>
                <button 
                  onClick={() => setViewMode('orders')}
                  className={`flex-1 lg:flex-none flex items-center justify-center gap-2 px-6 py-2.5 rounded-md text-sm font-semibold transition-all ${
                    viewMode === 'orders' 
                      ? 'bg-white text-orange-600 shadow-sm ring-1 ring-black/5' 
                      : 'text-slate-500 hover:text-slate-700 hover:bg-slate-200/50'
                  }`}
                >
                  <Package size={18} />
                  Orders
                </button>
                <button 
                  onClick={() => setViewMode('excel')}
                  className={`flex-1 lg:flex-none flex items-center justify-center gap-2 px-6 py-2.5 rounded-md text-sm font-semibold transition-all ${
                    viewMode === 'excel' 
                      ? 'bg-white text-emerald-600 shadow-sm ring-1 ring-black/5' 
                      : 'text-slate-500 hover:text-slate-700 hover:bg-slate-200/50'
                  }`}
                >
                  <Table size={18} />
                  Excel View
                </button>
             </div>

             <div className="h-8 w-px bg-slate-200 hidden lg:block mx-2"></div>

             {/* Secondary Tools */}
             <div className="flex flex-wrap items-center justify-center gap-1 w-full lg:w-auto overflow-x-auto pb-1 lg:pb-0">
                
                {/* Management Group */}
                <div className="flex items-center gap-1 px-2 border-r border-slate-100 last:border-0">
                  <button 
                    onClick={() => setViewMode('card')}
                    title="Machine Cards"
                    className={`p-2.5 rounded-lg transition-all ${viewMode === 'card' ? 'bg-indigo-50 text-indigo-600' : 'text-slate-400 hover:text-slate-600 hover:bg-slate-50'}`}
                  >
                    <LayoutGrid size={20} />
                  </button>
                  <button 
                    onClick={() => setViewMode('add')}
                    title="Add Data"
                    className={`p-2.5 rounded-lg transition-all ${viewMode === 'add' ? 'bg-emerald-50 text-emerald-600' : 'text-slate-400 hover:text-slate-600 hover:bg-slate-50'}`}
                  >
                    <PlusCircle size={20} />
                  </button>
                </div>

                {/* Analysis Group */}
                <div className="flex items-center gap-1 px-2 border-r border-slate-100 last:border-0">
                  <button 
                    onClick={() => setViewMode('compare')}
                    title="Compare Days"
                    className={`p-2.5 rounded-lg transition-all ${viewMode === 'compare' ? 'bg-blue-50 text-blue-600' : 'text-slate-400 hover:text-slate-600 hover:bg-slate-50'}`}
                  >
                    <GitCompare size={20} />
                  </button>
                  <button 
                    onClick={() => setViewMode('history')}
                    title="Production History"
                    className={`p-2.5 rounded-lg transition-all ${viewMode === 'history' ? 'bg-teal-50 text-teal-600' : 'text-slate-400 hover:text-slate-600 hover:bg-slate-50'}`}
                  >
                    <History size={20} />
                  </button>
                  <button 
                    onClick={() => setViewMode('analytics')}
                    title="Performance Analytics"
                    className={`p-2.5 rounded-lg transition-all ${viewMode === 'analytics' ? 'bg-pink-50 text-pink-600' : 'text-slate-400 hover:text-slate-600 hover:bg-slate-50'}`}
                  >
                    <PieChart size={20} />
                  </button>
                </div>

                {/* Monitoring Group */}
                <div className="flex items-center gap-1 px-2">
                  <button 
                    onClick={() => setViewMode('fulfillment')}
                    title="Order Fulfillment"
                    className={`p-2.5 rounded-lg transition-all ${viewMode === 'fulfillment' ? 'bg-cyan-50 text-cyan-600' : 'text-slate-400 hover:text-slate-600 hover:bg-slate-50'}`}
                  >
                    <Truck size={20} />
                  </button>
                  <button 
                    onClick={() => setViewMode('maintenance')}
                    title="Maintenance & Changeovers"
                    className={`p-2.5 rounded-lg transition-all ${viewMode === 'maintenance' ? 'bg-purple-50 text-purple-600' : 'text-slate-400 hover:text-slate-600 hover:bg-slate-50'}`}
                  >
                    <Wrench size={20} />
                  </button>
                  <button 
                    onClick={() => setViewMode('idle')}
                    title="Idle Machines"
                    className={`p-2.5 rounded-lg transition-all ${viewMode === 'idle' ? 'bg-red-50 text-red-600' : 'text-slate-400 hover:text-slate-600 hover:bg-slate-50'}`}
                  >
                    <AlertCircle size={20} />
                  </button>
                </div>

             </div>
           </div>
        </div>

        <div className="w-full overflow-hidden">
            {viewMode === 'card' && (
              <MachineList 
                machines={machines} 
                loading={machineLoading}
                onDelete={handleDeleteMachine}
                onUpdate={handleUpdateMachine}
              />
            )}

            {viewMode === 'excel' && (
              <FetchDataPage 
                selectedDate={selectedDate}
                machines={machines}
              />
            )}

            {viewMode === 'planning' && (
              <PlanningSchedule 
                 machines={machines}
                 onUpdate={handleUpdateMachine}
              />
            )}

            {viewMode === 'maintenance' && (
              <MaintenanceDashboard 
                machines={machines}
              />
            )}

            {viewMode === 'idle' && (
              <IdleMachineMonitor />
            )}

            {viewMode === 'add' && (
              <AddDataPage />
            )}

            {viewMode === 'orders' && (
              <ClientOrdersPage />
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

            {viewMode === 'fulfillment' && (
              <OrderFulfillmentPage 
                machines={machines}
              />
            )}

            {viewMode === 'analytics' && (
              <AnalyticsPage 
                machines={machines}
              />
            )}
        </div>
      </main>
      
      {showInsights && (
        <AIInsightsModal 
          onClose={() => setShowInsights(false)}
          recommendations={aiAnalysis}
        />
      )}
    </div>
  );
};

export default App;