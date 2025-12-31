import React, { useState, useEffect } from 'react';
import { Factory, Layout, Upload, FileSpreadsheet, AlertCircle, Check, X } from 'lucide-react';
import * as XLSX from 'xlsx';
import ExternalProductionSheet from './ExternalProductionSheet';
import {
  collection,
  getDocs,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  writeBatch,
  onSnapshot
} from 'firebase/firestore';
import { db } from '../services/firebase';

interface DailyLog {
  date: string;
  dayProduction: number;
  scrap: number;
  fabric: string;
  client: string;
  status: string;
  remaining?: number;
  note?: string; // Added for split runs or extra info
}

interface MachineSSD {
  id?: string;
  name: string;
  brand: string;
  machineid: number;
  dailyLogs: DailyLog[];
}

interface StagedLog {
  id: string; // Unique ID for the staging row (machineId)
  machineId: string;
  machineName: string;
  
  // Context (Yesterday/Previous)
  previousDate: string;
  previousClient: string;
  previousFabric: string;
  previousRemaining: number;
  previousStatus: string;
  isStale: boolean; // If previous log is older than 1 day

  // Imported Data (The Change)
  hasImportData: boolean; // True if found in Excel
  importDate: string;
  importProduction: number;
  importScrap: number;
  importClient: string;
  importFabric: string;
  
  // Split Run Handling
  isSplit: boolean; // If multiple rows for this machine in Excel
  splitDetails?: { client: string; fabric: string; production: number }[]; // Details of the split

  // Resulting State (Calculated/User Edited)
  newRemaining: number;
  newStatus: string;
  note: string;

  // Validation
  validationStatus: 'SAFE' | 'WARNING' | 'ERROR';
  validationMessage: string;
  
  // User Control
  selected: boolean; // If checked, will be imported
}

type FilterType = 'ALL' | 'WARNINGS' | 'ERRORS' | 'SAFE' | 'MISSING';

const MachineSS: React.FC = () => {
  const [machines, setMachines] = useState<(MachineSSD & { id: string })[]>([]);
  const [loading, setLoading] = useState(false);
  const [showAddMachine, setShowAddMachine] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [importDate, setImportDate] = useState(new Date().toISOString().split('T')[0]); // Default to today
  const [importPreview, setImportPreview] = useState<StagedLog[]>([]);
  const [filter, setFilter] = useState<FilterType>('ALL');
  const [newMachine, setNewMachine] = useState({
    name: '',
    brand: '',
    machineid: '',
  });
  const [viewMode, setViewMode] = useState<'INTERNAL' | 'EXTERNAL'>('INTERNAL');

  // Load machines on mount
  useEffect(() => {
    setLoading(true);
    const unsubscribe = onSnapshot(collection(db, 'MachineSS'), (snapshot) => {
      const data = snapshot.docs.map(doc => ({
        id: doc.id,
        ...(doc.data() as MachineSSD),
      }));
      // Sort by machineid (numeric) if possible, or name
      data.sort((a, b) => Number(a.machineid) - Number(b.machineid));
      setMachines(data);
      setLoading(false);
    }, (error) => {
      console.error('Error loading machines:', error);
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  const refreshMachines = async () => {
    // Legacy function kept for compatibility
  };

  const addMachine = async () => {
    if (!newMachine.name || !newMachine.brand || !newMachine.machineid) {
      alert('Please fill in all fields');
      return;
    }

    try {
      await addDoc(collection(db, 'MachineSS'), {
        name: newMachine.name,
        brand: newMachine.brand,
        machineid: parseInt(newMachine.machineid),
        dailyLogs: [],
      });
      setNewMachine({ name: '', brand: '', machineid: '' });
      setShowAddMachine(false);
      await refreshMachines();
    } catch (error) {
      console.error('Error adding machine:', error);
      alert('Error adding machine');
    }
  };

  const addDailyLog = async (machineId: string) => {
    const newLog: DailyLog = {
      date: new Date().toISOString().split('T')[0],
      dayProduction: 0,
      scrap: 0,
      fabric: '',
      client: '',
      status: 'عمل',
    };

    try {
      const machine = machines.find(m => m.id === machineId);
      if (!machine) return;

      await updateDoc(doc(db, 'MachineSS', machineId), {
        dailyLogs: [...machine.dailyLogs, newLog],
      });
      await refreshMachines();
    } catch (error) {
      console.error('Error adding log:', error);
    }
  };

  const updateLog = async (machineId: string, logIndex: number, field: keyof DailyLog, value: any) => {
    try {
      const machine = machines.find(m => m.id === machineId);
      if (!machine) return;

      const updatedLogs = [...machine.dailyLogs];
      updatedLogs[logIndex] = {
        ...updatedLogs[logIndex],
        [field]: field === 'dayProduction' || field === 'scrap' || field === 'remaining' ? parseFloat(value) || 0 : value,
      };

      await updateDoc(doc(db, 'MachineSS', machineId), {
        dailyLogs: updatedLogs,
      });
      await refreshMachines();
    } catch (error) {
      console.error('Error updating log:', error);
    }
  };

  const deleteLog = async (machineId: string, logIndex: number) => {
    try {
      const machine = machines.find(m => m.id === machineId);
      if (!machine) return;

      const updatedLogs = machine.dailyLogs.filter((_, i) => i !== logIndex);
      await updateDoc(doc(db, 'MachineSS', machineId), {
        dailyLogs: updatedLogs,
      });
      await refreshMachines();
    } catch (error) {
      console.error('Error deleting log:', error);
    }
  };

  const deleteMachine = async (machineId: string) => {
    if (!window.confirm('Delete this machine?')) return;
    try {
      await deleteDoc(doc(db, 'MachineSS', machineId));
      await refreshMachines();
    } catch (error) {
      console.error('Error deleting machine:', error);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (evt) => {
      const bstr = evt.target?.result;
      const wb = XLSX.read(bstr, { type: 'binary' });
      const wsname = wb.SheetNames[0];
      const ws = wb.Sheets[wsname];
      const data = XLSX.utils.sheet_to_json(ws, { header: 1 });
      
      // Skip header (row 0, 1), start from row 2 (index 2)
      const rows = data.slice(2);
      
      const previewData: StagedLog[] = [];
      // Use selected importDate
      const targetDate = importDate;
      const targetDateObj = new Date(targetDate);
      const yesterdayDate = new Date(targetDateObj);
      yesterdayDate.setDate(yesterdayDate.getDate() - 1);
      const yesterdayStr = yesterdayDate.toISOString().split('T')[0];

      // 1. Group Excel rows by Machine Name/ID
      const excelMap = new Map<string, any[]>();

      rows.forEach((row: any) => {
        const workCenter = row[3]; // Column D: Work Center
        if (!workCenter) return;
        
        // Normalize key
        const key = String(workCenter).trim().toLowerCase();
        if (!excelMap.has(key)) {
          excelMap.set(key, []);
        }
        excelMap.get(key)?.push(row);
      });

      // 2. Iterate through ALL Machines in Firestore (Machine-First Approach)
      machines.forEach(machine => {
        // Try to find matching Excel data
        const machineKeyName = machine.name.toLowerCase();
        const machineKeyId = machine.machineid.toString();
        
        const groupRows = excelMap.get(machineKeyName) || excelMap.get(machineKeyId);
        const hasImportData = !!groupRows && groupRows.length > 0;

        // --- Context (Yesterday) ---
        const sortedLogs = [...machine.dailyLogs].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
        const previousLog = sortedLogs.find(l => l.date < targetDate);
        
        const previousRemaining = previousLog?.remaining || 0;
        const previousStatus = previousLog?.status || 'Stopped';
        const previousDate = previousLog?.date || 'No Data';
        const previousClient = previousLog?.client || '';
        const previousFabric = previousLog?.fabric || '';
        const isStale = previousDate !== yesterdayStr && previousDate !== 'No Data';

        // --- Import Data (Today) ---
        let totalProduction = 0;
        let totalScrap = 0;
        let primaryClient = '';
        let primaryFabric = '';
        let note = '';
        let isSplit = false;
        let splitDetails: { client: string; fabric: string; production: number }[] = [];

        if (hasImportData && groupRows) {
          isSplit = groupRows.length > 1;
          const clients: string[] = [];
          const fabrics: string[] = [];
          const details: string[] = [];

          groupRows.forEach((row: any) => {
            const prod = parseFloat(row[1]) || 0;
            const scrap = parseFloat(row[4]) || 0; 
            const client = row[2] ? String(row[2]).trim() : '';
            const fabric = row[0] ? String(row[0]).trim() : '';

            totalProduction += prod;
            totalScrap += scrap;
            
            if (client && !clients.includes(client)) clients.push(client);
            if (fabric && !fabrics.includes(fabric)) fabrics.push(fabric);
            
            if (prod > 0) {
               details.push(`${client}: ${prod}kg`);
               splitDetails.push({ client, fabric, production: prod });
            }
          });

          // Default to first client/fabric found
          primaryClient = clients[0] || ''; 
          primaryFabric = fabrics[0] || '';
          
          if (isSplit) {
            note = `Split Run: ${details.join(', ')}. Total Scrap: ${totalScrap}`;
          }
        } else {
          // No Data in Excel -> Assume Stopped or Maintenance?
          // For now, we leave it blank, but user can set it.
          // If machine was working yesterday, this is a "Missing Data" warning.
        }

        // --- Result (Forecast) ---
        const netProduction = Math.max(0, totalProduction - totalScrap);
        let newRemaining = Math.max(0, previousRemaining - netProduction);
        
        let newStatus = previousStatus;
        if (hasImportData) {
          if (totalProduction > 0) {
            newStatus = 'Working'; 
          } else if (totalProduction === 0 && previousStatus === 'Working') {
            newStatus = 'Stopped'; 
          }
        } else {
           // If no data, keep previous status? Or default to Stopped?
           // Let's keep previous status but flag it.
        }

        // --- Validation Logic ---
        let validationStatus: 'SAFE' | 'WARNING' | 'ERROR' = 'SAFE';
        let validationMessage = '';

        if (!hasImportData) {
          if (previousStatus === 'Working') {
            validationStatus = 'WARNING';
            validationMessage = 'Missing in Excel (Was Working).';
          }
        } else {
          // Rule 1: Unexpected Changeover
          if (previousRemaining > 0 && previousClient && primaryClient && previousClient !== primaryClient) {
            validationStatus = 'WARNING';
            validationMessage = `Client changed (${previousClient} -> ${primaryClient}) but ${previousRemaining}kg remained.`;
          }

          // Rule 2: Stale History
          if (isStale) {
             if (validationStatus === 'SAFE') validationStatus = 'WARNING';
             validationMessage += ` Previous data is from ${previousDate}.`;
          }

          // Rule 3: Overwrite Check
          const exists = machine.dailyLogs.some(l => l.date === targetDate);
          if (exists) {
             validationStatus = 'WARNING';
             validationMessage += ` Data already exists for ${targetDate}.`;
          }

          // Rule 4: Negative Remaining
          if (netProduction > previousRemaining + 50 && previousRemaining > 0) { 
             validationStatus = 'WARNING';
             validationMessage += ` Production (${netProduction}) > Remaining (${previousRemaining}).`;
          }
          
          // Rule 5: Split Run
          if (isSplit) {
             validationStatus = 'WARNING';
             validationMessage += ` Split Run detected (${groupRows?.length} entries).`;
          }
        }

        previewData.push({
          id: machine.id,
          machineId: machine.id,
          machineName: machine.name,
          previousDate,
          previousClient,
          previousFabric,
          previousRemaining,
          previousStatus,
          isStale,
          hasImportData,
          importDate: targetDate,
          importProduction: totalProduction,
          importScrap: totalScrap,
          importClient: primaryClient,
          importFabric: primaryFabric,
          isSplit,
          splitDetails,
          newRemaining,
          newStatus,
          note,
          validationStatus,
          validationMessage,
          selected: hasImportData // Only select if data exists by default
        });
      });

      // Sort: Issues first, then by Name
      previewData.sort((a, b) => {
        if (a.validationStatus !== 'SAFE' && b.validationStatus === 'SAFE') return -1;
        if (a.validationStatus === 'SAFE' && b.validationStatus !== 'SAFE') return 1;
        return a.machineName.localeCompare(b.machineName);
      });

      setImportPreview(previewData);
    };
    reader.readAsBinaryString(file);
  };

  const applyImport = async () => {
    const selectedItems = importPreview.filter(i => i.selected);
    if (selectedItems.length === 0) return;
    
    try {
      const batch = writeBatch(db);
      
      for (const item of selectedItems) {
        const machine = machines.find(m => m.id === item.machineId);
        if (!machine) continue;

        const newLog: DailyLog = {
          date: item.importDate,
          dayProduction: item.importProduction,
          scrap: item.importScrap || 0,
          fabric: item.importFabric || '',
          client: item.importClient || '',
          status: item.newStatus,
          remaining: item.newRemaining,
          note: item.note || ''
        };

        // Check if log for target date already exists
        const existingLogIndex = machine.dailyLogs.findIndex(l => l.date === item.importDate);
        let updatedLogs = [...machine.dailyLogs];

        if (existingLogIndex >= 0) {
          updatedLogs[existingLogIndex] = { ...updatedLogs[existingLogIndex], ...newLog };
        } else {
          updatedLogs.push(newLog);
        }

        const docRef = doc(db, 'MachineSS', machine.id);
        batch.update(docRef, { dailyLogs: updatedLogs });
      }

      await batch.commit();
      setImportPreview([]);
      setShowImportModal(false);
      await refreshMachines();
      alert('Import successful!');
    } catch (error) {
      console.error('Error applying import:', error);
      alert('Error applying import');
    }
  };

  // Flatten all logs with machine info
  const allRows = machines.flatMap(machine =>
    machine.dailyLogs.length === 0
      ? [{
          machineId: machine.id,
          machineName: machine.name,
          brand: machine.brand,
          machineNum: machine.machineid,
          log: null,
          logIndex: -1,
        }]
      : machine.dailyLogs.map((log, logIndex) => ({
          machineId: machine.id,
          machineName: machine.name,
          brand: machine.brand,
          machineNum: machine.machineid,
          log,
          logIndex,
        }))
  );

  return (
    <div className="min-h-screen bg-white p-4">
      <div className="max-w-full mx-auto">
        {/* Header */}
        <div className="flex justify-between items-center mb-6">
          <div>
            <h1 className="text-3xl font-bold text-slate-800">📊 MachineSS Manager</h1>
            <p className="text-slate-500 text-sm">إدارة الماكينات والإنتاج اليومي</p>
          </div>
          
          {/* View Toggle */}
          <div className="bg-slate-100 p-1 rounded-lg flex items-center border border-slate-200 mx-4">
            <button
              onClick={() => setViewMode('INTERNAL')}
              className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-all ${
                viewMode === 'INTERNAL'
                  ? 'bg-white text-blue-600 shadow-sm'
                  : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              <Layout size={16} />
              Internal Schedule
            </button>
            <button
              onClick={() => setViewMode('EXTERNAL')}
              className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-all ${
                viewMode === 'EXTERNAL'
                  ? 'bg-white text-indigo-600 shadow-sm'
                  : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              <Factory size={16} />
              External Schedule
            </button>
          </div>

          <div className="flex gap-3">
            {viewMode === 'INTERNAL' && (
              <>
                <button
                  onClick={() => setShowImportModal(true)}
                  className="bg-[#714B67] hover:bg-[#5d3d54] text-white px-4 py-2 rounded-lg font-medium transition-colors flex items-center gap-2"
                >
                  <FileSpreadsheet size={18} />
                  Import from ODOO
                </button>
                <button
                  onClick={refreshMachines}
                  className="bg-slate-600 hover:bg-slate-700 text-white px-4 py-2 rounded-lg font-medium transition-colors"
                >
                  🔄 تحديث
                </button>
                <button
                  onClick={() => setShowAddMachine(true)}
                  className="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-lg font-medium transition-colors"
                >
                  ➕ إضافة ماكينة
                </button>
              </>
            )}
          </div>
        </div>

        {viewMode === 'INTERNAL' ? (
          <>
            {/* Add Machine Modal */}
            {showAddMachine && (
              <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
                <div className="bg-white rounded-lg shadow-2xl p-6 w-full max-w-md border border-slate-200">
                  <h2 className="text-xl font-bold text-slate-800 mb-4">إضافة ماكينة جديدة</h2>
                  <div className="space-y-4">
                    <input
                      type="text"
                      placeholder="اسم الماكينة"
                      value={newMachine.name}
                      onChange={(e) => setNewMachine({ ...newMachine, name: e.target.value })}
                      className="w-full border border-slate-300 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    />
                    <input
                      type="text"
                      placeholder="الماركة"
                      value={newMachine.brand}
                      onChange={(e) => setNewMachine({ ...newMachine, brand: e.target.value })}
                      className="w-full border border-slate-300 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    />
                    <input
                      type="number"
                      placeholder="رقم الماكينة"
                      value={newMachine.machineid}
                      onChange={(e) => setNewMachine({ ...newMachine, machineid: e.target.value })}
                      className="w-full border border-slate-300 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    />
                  </div>
                  <div className="flex gap-3 mt-6">
                    <button
                      onClick={() => setShowAddMachine(false)}
                      className="flex-1 bg-slate-300 hover:bg-slate-400 text-slate-800 px-4 py-2 rounded font-medium transition-colors"
                    >
                      إلغاء
                    </button>
                    <button
                      onClick={addMachine}
                      className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded font-medium transition-colors"
                    >
                      حفظ
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Table */}
            {loading ? (
              <div className="text-center text-slate-500 py-8">جاري التحميل...</div>
            ) : machines.length === 0 ? (
              <div className="text-center text-slate-400 py-12">
                <p className="text-lg mb-4">لا توجد ماكينات</p>
                <button
                  onClick={() => setShowAddMachine(true)}
                  className="bg-emerald-600 hover:bg-emerald-700 text-white px-6 py-2 rounded-lg font-medium"
                >
                  إضافة الماكينة الأولى
                </button>
              </div>
            ) : (
              <>
                {/* Mobile Card View */}
                <div className="md:hidden grid grid-cols-2 gap-2 mb-4">
                  {allRows.map((row, idx) => {
                    const isWorking = row.log?.status === 'عمل';
                    return (
                      <div 
                        key={`${row.machineId}-${row.logIndex}-mobile`}
                        className={`bg-white border rounded-lg p-2 shadow-sm ${
                          !isWorking ? 'border-slate-200 bg-slate-50' : 'border-blue-200'
                        }`}
                      >
                        <div className="flex justify-between items-start mb-2">
                          <div>
                            <div className="font-bold text-slate-800 text-sm">{row.machineName}</div>
                            <div className="text-[10px] text-slate-500">{row.brand} #{row.machineNum}</div>
                          </div>
                          {row.log ? (
                             <select
                                value={row.log.status}
                                onChange={(e) => updateLog(row.machineId, row.logIndex, 'status', e.target.value)}
                                className={`text-[10px] font-bold rounded px-1 py-0.5 ${
                                  row.log.status === 'عمل' ? 'bg-green-100 text-green-800' : 
                                  row.log.status === 'صيانة' ? 'bg-orange-100 text-orange-800' : 
                                  'bg-red-100 text-red-800'
                                }`}
                              >
                                <option>عمل</option>
                                <option>متوقفة</option>
                                <option>صيانة</option>
                              </select>
                          ) : (
                            <button
                                onClick={() => addDailyLog(row.machineId)}
                                className="bg-blue-600 text-white px-2 py-0.5 rounded text-[10px]"
                              >
                                +
                              </button>
                          )}
                        </div>

                        {row.log ? (
                          isWorking ? (
                            <div className="space-y-2">
                              <div className="grid grid-cols-2 gap-1">
                                <div>
                                  <label className="text-[9px] text-slate-400 block">Prod</label>
                                  <input
                                    type="number"
                                    value={row.log.dayProduction}
                                    onChange={(e) => updateLog(row.machineId, row.logIndex, 'dayProduction', e.target.value)}
                                    className="w-full border border-slate-200 rounded px-1 py-0.5 text-xs font-bold text-center"
                                  />
                                </div>
                                <div>
                                  <label className="text-[9px] text-slate-400 block">Scrap</label>
                                  <input
                                    type="number"
                                    value={row.log.scrap}
                                    onChange={(e) => updateLog(row.machineId, row.logIndex, 'scrap', e.target.value)}
                                    className="w-full border border-slate-200 rounded px-1 py-0.5 text-xs text-red-600 text-center"
                                  />
                                </div>
                              </div>
                              
                              <div>
                                <label className="text-[9px] text-slate-400 block">Client / Fabric</label>
                                <div className="grid grid-cols-2 gap-1">
                                  <input
                                    type="text"
                                    value={row.log.client}
                                    onChange={(e) => updateLog(row.machineId, row.logIndex, 'client', e.target.value)}
                                    className="w-full border border-slate-200 rounded px-1 py-0.5 text-[10px]"
                                    placeholder="Client"
                                  />
                                  <input
                                    type="text"
                                    value={row.log.fabric}
                                    onChange={(e) => updateLog(row.machineId, row.logIndex, 'fabric', e.target.value)}
                                    className="w-full border border-slate-200 rounded px-1 py-0.5 text-[10px]"
                                    placeholder="Fabric"
                                  />
                                </div>
                              </div>

                              <div className="flex justify-between items-center">
                                 <div className="flex-1">
                                    <label className="text-[9px] text-slate-400 block">Rem</label>
                                    <input
                                      type="number"
                                      value={row.log.remaining || 0}
                                      onChange={(e) => updateLog(row.machineId, row.logIndex, 'remaining', e.target.value)}
                                      className="w-full border border-slate-200 rounded px-1 py-0.5 text-xs text-blue-600 font-bold text-center"
                                    />
                                 </div>
                                 <button
                                  onClick={() => deleteLog(row.machineId, row.logIndex)}
                                  className="ml-2 text-red-400 hover:text-red-600"
                                >
                                  <X size={14} />
                                </button>
                              </div>
                            </div>
                          ) : (
                            <div className="text-[10px] text-slate-400 text-center py-1">
                              {row.log.status} - No Production
                              <button
                                  onClick={() => deleteLog(row.machineId, row.logIndex)}
                                  className="ml-2 text-red-400 hover:text-red-600 align-middle"
                                >
                                  <X size={12} />
                                </button>
                            </div>
                          )
                        ) : (
                          <div className="text-[10px] text-slate-400 text-center py-2">
                            No Data
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* Desktop Table View */}
                <div className="hidden md:block overflow-x-auto border border-slate-200 rounded-lg shadow-sm bg-white">
                  <table className="w-full text-xs border-collapse min-w-[1200px]">
                  <thead className="bg-slate-50 text-slate-700 font-bold">
                    <tr>
                      <th className="p-2 border border-slate-200 w-12">م</th>
                      <th className="p-2 border border-slate-200 w-24">الماركة</th>
                      <th className="p-2 border border-slate-200 w-32">اسم الماكينة</th>
                      <th className="p-2 border border-slate-200 w-16">رقم</th>
                      <th className="p-2 border border-slate-200 w-20">التاريخ</th>
                      <th className="p-2 border border-slate-200 w-20">إنتاج اليوم</th>
                      <th className="p-2 border border-slate-200 w-16">السقط</th>
                      <th className="p-2 border border-slate-200 w-24">الخامة</th>
                      <th className="p-2 border border-slate-200 w-24">العميل</th>
                      <th className="p-2 border border-slate-200 w-20">المتبقي</th>
                      <th className="p-2 border border-slate-200 w-20">الحالة</th>
                      <th className="p-2 border border-slate-200 w-16">إجراءات</th>
                    </tr>
                  </thead>
                  <tbody>
                    {allRows.map((row, idx) => (
                      <tr key={`${row.machineId}-${row.logIndex}`} className="hover:bg-blue-50/50 transition-colors">
                        <td className="border border-slate-200 p-2 text-slate-500 text-center">{idx + 1}</td>
                        <td className="border border-slate-200 p-0">
                          <input
                            value={row.brand}
                            readOnly
                            className="w-full h-full p-2 text-center bg-slate-50 text-slate-700 font-medium"
                          />
                        </td>
                        <td className="border border-slate-200 p-0">
                          <input
                            value={row.machineName}
                            readOnly
                            className="w-full h-full p-2 text-center bg-slate-50 text-slate-700 font-medium"
                          />
                        </td>
                        <td className="border border-slate-200 p-2 text-center text-slate-600">{row.machineNum}</td>

                        {row.log ? (
                          <>
                            <td className="border border-slate-200 p-0">
                              <input
                                type="date"
                                value={row.log.date}
                                onChange={(e) => updateLog(row.machineId, row.logIndex, 'date', e.target.value)}
                                className="w-full h-full p-2 text-center bg-transparent focus:bg-blue-50 focus:outline-none"
                              />
                            </td>
                            <td className="border border-slate-200 p-0">
                              <input
                                type="number"
                                value={row.log.dayProduction}
                                onChange={(e) => updateLog(row.machineId, row.logIndex, 'dayProduction', e.target.value)}
                                className="w-full h-full p-2 text-center bg-transparent focus:bg-blue-50 focus:outline-none font-semibold text-slate-800"
                              />
                            </td>
                            <td className="border border-slate-200 p-0">
                              <input
                                type="number"
                                value={row.log.scrap}
                                onChange={(e) => updateLog(row.machineId, row.logIndex, 'scrap', e.target.value)}
                                className={`w-full h-full p-2 text-center bg-transparent focus:bg-blue-50 focus:outline-none ${row.log.scrap > 0 ? 'text-red-600 font-bold' : ''}`}
                              />
                            </td>
                            <td className="border border-slate-200 p-0">
                              <input
                                type="text"
                                value={row.log.fabric}
                                onChange={(e) => updateLog(row.machineId, row.logIndex, 'fabric', e.target.value)}
                                className="w-full h-full p-2 text-center bg-transparent focus:bg-blue-50 focus:outline-none"
                              />
                            </td>
                            <td className="border border-slate-200 p-0 relative">
                              <input
                                type="text"
                                value={row.log.client}
                                onChange={(e) => updateLog(row.machineId, row.logIndex, 'client', e.target.value)}
                                className={`w-full h-full p-2 text-center bg-transparent focus:bg-blue-50 focus:outline-none ${row.log.note ? 'text-blue-700 font-medium' : ''}`}
                                title={row.log.note || ''}
                              />
                              {row.log.note && (
                                <div className="absolute top-1 right-1 w-1.5 h-1.5 bg-blue-500 rounded-full pointer-events-none"></div>
                              )}
                            </td>
                            <td className="border border-slate-200 p-0">
                              <input
                                type="number"
                                value={row.log.remaining || 0}
                                onChange={(e) => updateLog(row.machineId, row.logIndex, 'remaining', e.target.value)}
                                className="w-full h-full p-2 text-center bg-transparent focus:bg-blue-50 focus:outline-none font-semibold text-blue-600"
                              />
                            </td>
                            <td className="border border-slate-200 p-0">
                              <select
                                value={row.log.status}
                                onChange={(e) => updateLog(row.machineId, row.logIndex, 'status', e.target.value)}
                                className="w-full h-full p-2 text-center bg-transparent focus:bg-blue-50 focus:outline-none appearance-none"
                              >
                                <option>عمل</option>
                                <option>متوقفة</option>
                                <option>صيانة</option>
                              </select>
                            </td>
                            <td className="border border-slate-200 p-2 text-center">
                              <button
                                onClick={() => deleteLog(row.machineId, row.logIndex)}
                                className="text-red-600 hover:text-red-800 font-bold transition-colors"
                              >
                                ✕
                              </button>
                            </td>
                          </>
                        ) : (
                          <>
                            <td colSpan={6} className="border border-slate-200 p-4 text-center text-slate-400 bg-slate-50">
                              لا توجد سجلات يومية
                            </td>
                            <td className="border border-slate-200 p-2 text-center">
                              <button
                                onClick={() => addDailyLog(row.machineId)}
                                className="bg-blue-600 hover:bg-blue-700 text-white px-3 py-1 rounded font-medium text-xs transition-colors"
                              >
                                ➕ إضافة
                              </button>
                            </td>
                          </>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              </>
            )}

            {/* Machines List View (For deleting) */}
            {machines.length > 0 && (
              <div className="mt-8 p-4 bg-slate-50 border border-slate-200 rounded-lg">
                <h2 className="text-lg font-bold text-slate-800 mb-4">الماكينات</h2>
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                  {machines.map(machine => (
                    <div key={machine.id} className="bg-white border border-slate-200 rounded p-4 hover:shadow-md transition-shadow">
                      <h3 className="font-bold text-slate-800">{machine.name}</h3>
                      <p className="text-sm text-slate-600">{machine.brand}</p>
                      <p className="text-xs text-slate-500 mb-3">ID: {machine.machineid}</p>
                      <div className="flex gap-2">
                        <button
                          onClick={() => addDailyLog(machine.id)}
                          className="flex-1 bg-blue-600 hover:bg-blue-700 text-white px-2 py-1 rounded text-xs font-medium transition-colors"
                        >
                          ➕ سجل
                        </button>
                        <button
                          onClick={() => deleteMachine(machine.id)}
                          className="flex-1 bg-red-600 hover:bg-red-700 text-white px-2 py-1 rounded text-xs font-medium transition-colors"
                        >
                          🗑️ حذف
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        ) : (
          <ExternalProductionSheet />
        )}

        {/* Import Modal */}
        {showImportModal && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-[95vw] h-[90vh] flex flex-col">
              <div className="p-4 border-b border-slate-200 flex justify-between items-center bg-slate-50">
                <div>
                  <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2">
                    <FileSpreadsheet className="text-[#714B67]" />
                    Data Staging & Validation Wizard
                  </h2>
                  <p className="text-sm text-slate-500 mt-1">Review, correct, and validate Odoo data before importing.</p>
                </div>
                <button 
                  onClick={() => {
                    setShowImportModal(false);
                    setImportPreview([]);
                  }}
                  className="text-slate-400 hover:text-slate-600 transition-colors"
                >
                  <X size={24} />
                </button>
              </div>
              
              <div className="p-4 overflow-hidden flex-1 flex flex-col">
                {/* Date Selection & Summary */}
                <div className="mb-4 flex items-center justify-between bg-blue-50 p-3 rounded-lg border border-blue-100">
                  <div className="flex items-center gap-4">
                    <div>
                      <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider">Target Date</label>
                      <input 
                        type="date" 
                        value={importDate}
                        onChange={(e) => setImportDate(e.target.value)}
                        className="border border-slate-300 rounded px-2 py-1 text-sm font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                    <div className="h-8 w-px bg-blue-200 mx-2"></div>
                    <div>
                      <div className="text-xs text-slate-500">Total Machines</div>
                      <div className="font-bold text-slate-800">{importPreview.length}</div>
                    </div>
                    <div>
                      <div className="text-xs text-slate-500">Matched</div>
                      <div className="font-bold text-green-600">{importPreview.filter(i => i.hasImportData).length}</div>
                    </div>
                    <div>
                      <div className="text-xs text-slate-500">Missing</div>
                      <div className="font-bold text-slate-400">{importPreview.filter(i => !i.hasImportData).length}</div>
                    </div>
                    <div>
                      <div className="text-xs text-slate-500">Warnings</div>
                      <div className="font-bold text-amber-600">{importPreview.filter(i => i.validationStatus === 'WARNING').length}</div>
                    </div>
                  </div>

                  {/* Filters */}
                  <div className="flex bg-white rounded-md border border-slate-200 p-1">
                    {(['ALL', 'SAFE', 'WARNINGS', 'ERRORS', 'MISSING'] as FilterType[]).map(f => (
                      <button
                        key={f}
                        onClick={() => setFilter(f)}
                        className={`px-3 py-1 text-xs font-bold rounded ${
                          filter === f 
                            ? 'bg-slate-800 text-white' 
                            : 'text-slate-500 hover:bg-slate-100'
                        }`}
                      >
                        {f}
                      </button>
                    ))}
                  </div>
                </div>

                {importPreview.length === 0 ? (
                  <div className="flex-1 flex flex-col items-center justify-center border-2 border-dashed border-slate-300 rounded-xl bg-slate-50 hover:bg-slate-100 transition-colors cursor-pointer relative">
                    <input 
                      type="file" 
                      accept=".xlsx, .xls" 
                      onChange={handleFileUpload}
                      className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                    />
                    <Upload size={48} className="text-slate-400 mb-4" />
                    <p className="text-lg font-medium text-slate-700">Click to upload Excel file</p>
                    <p className="text-sm text-slate-500 mt-2">Supported formats: .xlsx, .xls</p>
                  </div>
                ) : (
                  <div className="flex-1 overflow-auto border border-slate-300 rounded-lg shadow-inner bg-slate-100">
                    <table className="w-full text-xs border-collapse">
                      <thead className="bg-slate-200 text-slate-700 font-bold sticky top-0 z-20 shadow-sm">
                        <tr>
                          <th className="p-2 border border-slate-300 w-8 text-center bg-slate-200">
                            <input 
                              type="checkbox" 
                              checked={importPreview.every(p => p.selected)}
                              onChange={(e) => setImportPreview(prev => prev.map(p => ({...p, selected: e.target.checked})))}
                            />
                          </th>
                          <th className="p-2 border border-slate-300 text-left w-32 bg-slate-200">Machine</th>
                          
                          {/* Yesterday Header */}
                          <th colSpan={3} className="p-2 border border-slate-300 text-center bg-slate-300/50 text-slate-600">
                            Yesterday (Context)
                          </th>
                          
                          {/* Today Header */}
                          <th colSpan={4} className="p-2 border border-slate-300 text-center bg-blue-100 text-blue-800 border-l-2 border-l-blue-400">
                            Today (Imported Data)
                          </th>
                          
                          {/* Result Header */}
                          <th colSpan={2} className="p-2 border border-slate-300 text-center bg-green-100 text-green-800 border-l-2 border-l-green-400">
                            Forecast (Result)
                          </th>
                          
                          <th className="p-2 border border-slate-300 text-left bg-slate-200">Validation</th>
                        </tr>
                        <tr>
                          {/* Sub-headers */}
                          <th className="p-1 border border-slate-300 bg-slate-100"></th>
                          <th className="p-1 border border-slate-300 bg-slate-100">Name/ID</th>
                          
                          <th className="p-1 border border-slate-300 bg-slate-50 text-slate-500 font-normal">Date</th>
                          <th className="p-1 border border-slate-300 bg-slate-50 text-slate-500 font-normal">Client/Fabric</th>
                          <th className="p-1 border border-slate-300 bg-slate-50 text-slate-500 font-normal">Rem.</th>

                          <th className="p-1 border border-slate-300 bg-white text-blue-600 border-l-2 border-l-blue-400">Client</th>
                          <th className="p-1 border border-slate-300 bg-white text-blue-600">Fabric</th>
                          <th className="p-1 border border-slate-300 bg-white text-blue-600">Prod.</th>
                          <th className="p-1 border border-slate-300 bg-white text-blue-600">Scrap</th>

                          <th className="p-1 border border-slate-300 bg-green-50 text-green-700 border-l-2 border-l-green-400">New Rem.</th>
                          <th className="p-1 border border-slate-300 bg-green-50 text-green-700">Status</th>
                          
                          <th className="p-1 border border-slate-300 bg-slate-100">Message</th>
                        </tr>
                      </thead>
                      <tbody className="bg-white divide-y divide-slate-200">
                        {importPreview
                          .filter(item => {
                            if (filter === 'ALL') return true;
                            if (filter === 'SAFE') return item.validationStatus === 'SAFE';
                            if (filter === 'WARNINGS') return item.validationStatus === 'WARNING';
                            if (filter === 'ERRORS') return item.validationStatus === 'ERROR';
                            if (filter === 'MISSING') return !item.hasImportData;
                            return true;
                          })
                          .map((item, idx) => {
                            // Find original index for updates
                            const realIndex = importPreview.findIndex(p => p.id === item.id);
                            
                            return (
                            <tr key={item.id} className={`hover:bg-blue-50 transition-colors ${!item.selected ? 'opacity-40 bg-slate-50 grayscale' : ''}`}>
                              <td className="p-2 border border-slate-200 text-center bg-slate-50">
                                <input 
                                  type="checkbox" 
                                  checked={item.selected}
                                  onChange={(e) => {
                                    const newPreview = [...importPreview];
                                    newPreview[realIndex].selected = e.target.checked;
                                    setImportPreview(newPreview);
                                  }}
                                />
                              </td>
                              <td className="p-2 border border-slate-200 font-bold text-slate-700">
                                {item.machineName}
                                {item.isSplit && <span className="ml-2 px-1 bg-amber-100 text-amber-700 text-[10px] rounded border border-amber-200">SPLIT</span>}
                              </td>
                              
                              {/* Yesterday */}
                              <td className="p-2 border border-slate-200 text-slate-500 bg-slate-50/50">
                                {item.isStale ? <span className="text-red-500 font-bold">⚠ {item.previousDate}</span> : item.previousDate}
                              </td>
                              <td className="p-2 border border-slate-200 text-slate-500 bg-slate-50/50 truncate max-w-[100px]" title={`${item.previousClient} / ${item.previousFabric}`}>
                                {item.previousClient}
                              </td>
                              <td className="p-2 border border-slate-200 text-slate-500 bg-slate-50/50 font-mono text-right">
                                {item.previousRemaining}
                              </td>

                              {/* Today (Editable) */}
                              {item.hasImportData ? (
                                <>
                                  <td className={`p-1 border border-slate-200 border-l-2 border-l-blue-400 ${item.previousClient && item.importClient !== item.previousClient ? 'bg-amber-50' : ''}`}>
                                    <input 
                                      type="text" 
                                      value={item.importClient}
                                      onChange={(e) => {
                                        const newPreview = [...importPreview];
                                        newPreview[realIndex].importClient = e.target.value;
                                        setImportPreview(newPreview);
                                      }}
                                      className="w-full bg-transparent p-1 focus:bg-white focus:ring-1 focus:ring-blue-500 outline-none rounded"
                                    />
                                    {item.isSplit && (
                                      <div className="text-[9px] text-slate-400 mt-1">
                                        {item.splitDetails?.map((d, i) => (
                                          <div key={i}>{d.client}: {d.production}kg</div>
                                        ))}
                                      </div>
                                    )}
                                  </td>
                                  <td className="p-1 border border-slate-200">
                                    <input 
                                      type="text" 
                                      value={item.importFabric}
                                      onChange={(e) => {
                                        const newPreview = [...importPreview];
                                        newPreview[realIndex].importFabric = e.target.value;
                                        setImportPreview(newPreview);
                                      }}
                                      className="w-full bg-transparent p-1 focus:bg-white focus:ring-1 focus:ring-blue-500 outline-none rounded"
                                    />
                                  </td>
                                  <td className="p-1 border border-slate-200 font-mono font-bold text-right text-blue-700">
                                    {item.importProduction}
                                  </td>
                                  <td className="p-1 border border-slate-200 font-mono text-right text-red-500">
                                    {item.importScrap > 0 ? item.importScrap : '-'}
                                  </td>
                                </>
                              ) : (
                                <td colSpan={4} className="p-2 border border-slate-200 text-center text-slate-400 italic bg-slate-50 border-l-2 border-l-slate-300">
                                  No Data in Excel
                                </td>
                              )}

                              {/* Result */}
                              <td className="p-1 border border-slate-200 border-l-2 border-l-green-400 bg-green-50/30">
                                <input 
                                  type="number" 
                                  value={item.newRemaining}
                                  onChange={(e) => {
                                    const newPreview = [...importPreview];
                                    newPreview[realIndex].newRemaining = parseFloat(e.target.value) || 0;
                                    setImportPreview(newPreview);
                                  }}
                                  className="w-full text-right font-bold text-green-700 bg-transparent p-1 focus:bg-white focus:ring-1 focus:ring-green-500 outline-none rounded"
                                />
                              </td>
                              <td className="p-2 border border-slate-200 text-center">
                                <span className={`text-[10px] px-1 rounded font-bold ${item.newStatus === 'Working' ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'}`}>
                                  {item.newStatus}
                                </span>
                              </td>

                              {/* Validation */}
                              <td className="p-2 border border-slate-200">
                                {item.validationStatus !== 'SAFE' && (
                                  <div className={`flex items-center gap-1 text-[10px] font-bold p-1 rounded border ${
                                    item.validationStatus === 'WARNING' ? 'bg-amber-50 text-amber-700 border-amber-200' : 'bg-red-50 text-red-700 border-red-200'
                                  }`}>
                                    {item.validationStatus === 'WARNING' ? <AlertCircle size={10} /> : <X size={10} />}
                                    {item.validationMessage}
                                  </div>
                                )}
                              </td>
                            </tr>
                          )})}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
              
              <div className="p-4 border-t border-slate-200 bg-slate-50 flex justify-between items-center">
                <div className="text-xs text-slate-500">
                  {importPreview.filter(i => i.selected).length} rows selected for import.
                </div>
                <div className="flex gap-3">
                  <button
                    onClick={() => {
                      setShowImportModal(false);
                      setImportPreview([]);
                    }}
                    className="px-4 py-2 text-slate-600 hover:text-slate-800 font-medium transition-colors"
                  >
                    Cancel
                  </button>
                  {importPreview.length > 0 && (
                    <button
                      onClick={applyImport}
                      className="px-6 py-2 bg-[#714B67] hover:bg-[#5d3d54] text-white font-bold rounded-lg shadow-sm transition-colors flex items-center gap-2"
                    >
                      <Check size={18} />
                      Confirm & Import Data
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default MachineSS;
