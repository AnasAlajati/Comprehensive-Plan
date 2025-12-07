

import React, { useState, useEffect, useMemo } from 'react';
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
import { AddMachineForm } from './components/AddMachineForm';
import { PlanningSchedule } from './components/PlanningSchedule';
import { MaintenanceDashboard } from './components/MaintenanceDashboard';
import { IdleMachineMonitor } from './components/IdleMachineMonitor';
import { AIInsightsModal } from './components/AIInsightsModal';
import { getScheduleRecommendations } from './services/ai';
import AddDataPage from './components/AddDataPage';
import FetchDataPage from './components/FetchDataPage';
import { CustomersPage } from './components/CustomersPage';

const App: React.FC = () => {
  const [rawMachines, setRawMachines] = useState<any[]>([]);
  const [machines, setMachines] = useState<MachineRow[]>([]);
  const [selectedDate, setSelectedDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [isConnected, setIsConnected] = useState<boolean | null>(null);
  const [connectionError, setConnectionError] = useState<string>('');
  const [machineLoading, setMachineLoading] = useState<boolean>(true);
  
  // AI State
  const [showInsights, setShowInsights] = useState(false);
  const [aiAnalysis, setAiAnalysis] = useState<any[]>([]);
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  // View Modes
  const [viewMode, setViewMode] = useState<'card' | 'excel' | 'planning' | 'maintenance' | 'idle' | 'add' | 'customers'>('planning'); 
  
  // External Production State
  const [externalProduction, setExternalProduction] = useState<number>(0);

  // UI State
  const [isAddMachineOpen, setIsAddMachineOpen] = useState(false);

  // 1. Test Connection on Mount
  useEffect(() => {
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

    // Listen to Active Day from Settings
    const unsubSettings = onSnapshot(doc(db, 'settings', 'global'), (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        if (data.activeDay) {
          setSelectedDate(data.activeDay);
        }
      }
    });

    return () => unsubSettings();
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
        avgProduction: data.avgProduction || 0,
        dayProduction: dailyLog?.dayProduction || 0,
        remainingMfg: dailyLog?.remainingMfg || 0,
        scrap: dailyLog?.scrap || 0,
        reason: dailyLog?.reason || '',
        material: dailyLog?.fabric || '',
        client: dailyLog?.client || '',
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

          // Apply the subtraction if we have a valid base to work from
          if (shouldCalculate) {
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

      const updatedLogs = [...currentLogs];
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

  // 6. Add Single Machine (Updated to use Service for initial create)
  const handleAddSingleMachine = async (machine: MachineRow) => {
    try {
      // Convert MachineRow to MachineSS format
      // Machine metadata should NOT include dayProduction - that goes in dailyLogs
      const today = new Date().toISOString().split('T')[0];
      
      const machineForMachineSS = {
        id: machine.id,
        machineid: machine.id,
        name: machine.machineName,
        brand: machine.brand || 'Generic',
        type: machine.type,
        status: machine.status,
        avgProduction: machine.avgProduction || 0,
        futurePlans: machine.futurePlans || [],
        dailyLogs: [
          {
            id: `log-${Date.now()}`,
            date: today,
            dayProduction: machine.dayProduction || 0,
            scrap: machine.scrap || 0,
            status: machine.status,
            fabric: machine.material || '',
            client: machine.client || '',
            avgProduction: machine.avgProduction || 0,
            remainingMfg: machine.remainingMfg || 0,
            reason: machine.reason || '',
            timestamp: new Date().toISOString()
          }
        ],
        lastLogDate: today,
        lastLogData: {
          date: today,
          dayProduction: machine.dayProduction || 0,
          scrap: machine.scrap || 0,
          status: machine.status,
          fabric: machine.material || '',
          client: machine.client || ''
        },
        lastUpdated: new Date().toISOString()
      };

      // Add to MachineSS collection
      await DataService.addMachineToMachineSS(machineForMachineSS);
      
      setIsAddMachineOpen(false);
      return true;
    } catch (error) {
      console.error("Error adding machine: ", error);
      alert("Failed to add machine. Check console for details.");
      return false;
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
                className="flex items-center gap-2 bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700 text-white px-3 py-1.5 rounded-full text-xs sm:text-sm font-bold shadow-md transition-all disabled:opacity-50 hover:shadow-lg transform hover:-translate-y-0.5 whitespace-nowrap border border-white/10"
             >
                {isAnalyzing ? (
                   <span className="flex items-center gap-2">Analyzing...</span>
                ) : (
                   <>
                     <span className="text-lg">✨</span>
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
        
        {/* Actions & Filters Bar */}
        <div className="bg-white p-3 sm:p-4 rounded-xl shadow-sm border border-slate-200 flex flex-col xl:flex-row justify-between items-start gap-4">
           
           {/* View Modes */}
           <div className="flex flex-col gap-2 w-full xl:w-auto">
             <span className="text-xs font-bold text-slate-400 uppercase tracking-wider whitespace-nowrap">Modules:</span>
             <div className="flex flex-wrap gap-2">
               <div className="bg-slate-100/50 p-1 rounded-lg flex gap-1 border border-slate-100">
                  <button 
                    onClick={() => setViewMode('planning')}
                    className={`px-3 py-1.5 rounded-md text-sm font-medium transition-all whitespace-nowrap ${viewMode === 'planning' ? 'bg-white shadow text-slate-800 ring-1 ring-black/5' : 'text-slate-500 hover:text-slate-700 hover:bg-slate-200/50'}`}
                  >
                    Schedule
                  </button>
                  <button 
                    onClick={() => setViewMode('excel')}
                    className={`px-3 py-1.5 rounded-md text-sm font-medium transition-all whitespace-nowrap ${viewMode === 'excel' ? 'bg-white shadow text-slate-800 ring-1 ring-black/5' : 'text-slate-500 hover:text-slate-700 hover:bg-slate-200/50'}`}
                  >
                    Excel
                  </button>
                  <button 
                    onClick={() => setViewMode('card')}
                    className={`px-3 py-1.5 rounded-md text-sm font-medium transition-all whitespace-nowrap ${viewMode === 'card' ? 'bg-white shadow text-slate-800 ring-1 ring-black/5' : 'text-slate-500 hover:text-slate-700 hover:bg-slate-200/50'}`}
                  >
                    Cards
                  </button>
               </div>
               
               <div className="bg-slate-100/50 p-1 rounded-lg flex gap-1 border border-slate-100">
                  <button 
                    onClick={() => setViewMode('customers')}
                    className={`px-3 py-1.5 rounded-md text-sm font-medium transition-all whitespace-nowrap ${viewMode === 'customers' ? 'bg-blue-100 text-blue-900 ring-1 ring-blue-300 shadow' : 'text-slate-500 hover:text-blue-700 hover:bg-blue-50'}`}
                  >
                    👥 Customers
                  </button>
                  <button 
                    onClick={() => setViewMode('maintenance')}
                    className={`px-3 py-1.5 rounded-md text-sm font-medium transition-all whitespace-nowrap ${viewMode === 'maintenance' ? 'bg-purple-100 text-purple-900 ring-1 ring-purple-300 shadow' : 'text-slate-500 hover:text-purple-700 hover:bg-purple-50'}`}
                  >
                    🔄 Changeovers
                  </button>
                  <button 
                    onClick={() => setViewMode('idle')}
                    className={`px-3 py-1.5 rounded-md text-sm font-medium transition-all whitespace-nowrap ${viewMode === 'idle' ? 'bg-red-100 text-red-900 ring-1 ring-red-300 shadow' : 'text-slate-500 hover:text-red-700 hover:bg-red-50'}`}
                  >
                    Idle Machines
                  </button>
                  <button 
                    onClick={() => setViewMode('add')}
                    className={`px-3 py-1.5 rounded-md text-sm font-medium transition-all whitespace-nowrap ${viewMode === 'add' ? 'bg-emerald-100 text-emerald-900 ring-1 ring-emerald-300 shadow' : 'text-slate-500 hover:text-emerald-700 hover:bg-emerald-50'}`}
                  >
                    ➕ ADD Data
                  </button>
               </div>
               
               <button 
                  onClick={() => setIsAddMachineOpen(true)}
                  className="bg-slate-800 hover:bg-slate-700 text-white px-4 py-2 rounded-lg text-sm font-bold shadow-sm flex items-center gap-2 whitespace-nowrap transition-colors"
                >
                  <span>+</span> <span className="hidden sm:inline">New Machine</span><span className="sm:hidden">Add</span>
                </button>
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
              />
            )}

            {viewMode === 'planning' && (
              <PlanningSchedule 
                 machines={machines}
                 onUpdate={handleUpdateMachine}
              />
            )}

            {viewMode === 'maintenance' && (
              <MaintenanceDashboard />
            )}

            {viewMode === 'idle' && (
              <IdleMachineMonitor />
            )}

            {viewMode === 'customers' && (
              <CustomersPage machines={machines} />
            )}

            {viewMode === 'add' && (
              <AddDataPage />
            )}
        </div>
      </main>
      
      {showInsights && (
        <AIInsightsModal 
          onClose={() => setShowInsights(false)}
          recommendations={aiAnalysis}
        />
      )}

      {isAddMachineOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4 overflow-y-auto">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl my-auto animate-fadeIn">
             <div className="flex justify-between items-center p-4 border-b border-slate-100 bg-slate-50 rounded-t-xl sticky top-0 z-10">
                <h3 className="font-bold text-lg text-slate-800">Add New Machine</h3>
                <button onClick={() => setIsAddMachineOpen(false)} className="text-slate-400 hover:text-slate-600 p-2">✕</button>
             </div>
             <div className="p-2 max-h-[80vh] overflow-y-auto">
               <AddMachineForm onAdd={handleAddSingleMachine} isConnected={isConnected === true} />
             </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;