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
  writeBatch
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
}

interface MachineSSD {
  id?: string;
  name: string;
  brand: string;
  machineid: number;
  dailyLogs: DailyLog[];
}

const MachineSS: React.FC = () => {
  const [machines, setMachines] = useState<(MachineSSD & { id: string })[]>([]);
  const [loading, setLoading] = useState(false);
  const [showAddMachine, setShowAddMachine] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [importPreview, setImportPreview] = useState<any[]>([]);
  const [newMachine, setNewMachine] = useState({
    name: '',
    brand: '',
    machineid: '',
  });
  const [viewMode, setViewMode] = useState<'INTERNAL' | 'EXTERNAL'>('INTERNAL');

  // Load machines on mount
  useEffect(() => {
    refreshMachines();
  }, []);

  const refreshMachines = async () => {
    try {
      setLoading(true);
      const snapshot = await getDocs(collection(db, 'MachineSS'));
      const data = snapshot.docs.map(doc => ({
        id: doc.id,
        ...(doc.data() as MachineSSD),
      }));
      setMachines(data);
    } catch (error) {
      console.error('Error loading machines:', error);
    } finally {
      setLoading(false);
    }
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
      
      // Skip header (row 0), start from row 1
      const rows = data.slice(1);
      
      const previewData: any[] = [];
      const today = new Date().toISOString().split('T')[0];
      const yesterdayDate = new Date();
      yesterdayDate.setDate(yesterdayDate.getDate() - 1);
      const yesterdayStr = yesterdayDate.toISOString().split('T')[0];

      rows.forEach((row: any) => {
        // Column mapping based on user request:
        // A: Fabric (index 0)
        // B: Daily production (index 1)
        // C: Customer (index 2)
        // D: Work center (index 3)
        
        const fabric = row[0];
        const dailyProduction = parseFloat(row[1]) || 0;
        const customer = row[2];
        const workCenter = row[3];

        if (!workCenter) return;

        // Find machine
        const machine = machines.find(m => 
          m.name.toLowerCase() === String(workCenter).toLowerCase() || 
          m.machineid.toString() === String(workCenter)
        );

        if (machine) {
          // Find yesterday's log or latest log
          // Sort logs by date descending
          const sortedLogs = [...machine.dailyLogs].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
          
          // Try to find yesterday's log specifically, or fallback to latest
          const previousLog = sortedLogs.find(l => l.date === yesterdayStr) || sortedLogs[0];
          
          const previousRemaining = previousLog?.remaining || 0;
          const previousStatus = previousLog?.status || 'Stopped';
          
          const newRemaining = Math.max(0, previousRemaining - dailyProduction);
          
          let newStatus = previousStatus;
          if (dailyProduction > 0) {
            newStatus = 'Working'; // 'عمل'
          } else if (dailyProduction === 0 && previousStatus === 'Working') {
            newStatus = 'Stopped'; // 'توقف'
          }

          previewData.push({
            machineId: machine.id,
            machineName: machine.name,
            fabric,
            customer,
            dailyProduction,
            previousRemaining,
            newRemaining,
            previousStatus,
            newStatus,
            date: today
          });
        }
      });

      setImportPreview(previewData);
    };
    reader.readAsBinaryString(file);
  };

  const applyImport = async () => {
    if (importPreview.length === 0) return;
    
    try {
      const batch = writeBatch(db);
      
      for (const item of importPreview) {
        const machine = machines.find(m => m.id === item.machineId);
        if (!machine) continue;

        const newLog: DailyLog = {
          date: item.date,
          dayProduction: item.dailyProduction,
          scrap: 0, // Default
          fabric: item.fabric || '',
          client: item.customer || '',
          status: item.newStatus,
          remaining: item.newRemaining
        };

        // Check if log for today already exists
        const existingLogIndex = machine.dailyLogs.findIndex(l => l.date === item.date);
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
                  className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-lg font-medium transition-colors flex items-center gap-2"
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
              <div className="overflow-x-auto border border-slate-200 rounded-lg shadow-sm bg-white">
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
                            <td className="border border-slate-200 p-0">
                              <input
                                type="text"
                                value={row.log.client}
                                onChange={(e) => updateLog(row.machineId, row.logIndex, 'client', e.target.value)}
                                className="w-full h-full p-2 text-center bg-transparent focus:bg-blue-50 focus:outline-none"
                              />
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
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
              <div className="p-6 border-b border-slate-200 flex justify-between items-center bg-slate-50">
                <div>
                  <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2">
                    <FileSpreadsheet className="text-green-600" />
                    Import from ODOO
                  </h2>
                  <p className="text-sm text-slate-500 mt-1">Upload Excel file to update machine plans</p>
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
              
              <div className="p-6 overflow-y-auto flex-1">
                {importPreview.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-12 border-2 border-dashed border-slate-300 rounded-xl bg-slate-50 hover:bg-slate-100 transition-colors cursor-pointer relative">
                    <input 
                      type="file" 
                      accept=".xlsx, .xls" 
                      onChange={handleFileUpload}
                      className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                    />
                    <Upload size={48} className="text-slate-400 mb-4" />
                    <p className="text-lg font-medium text-slate-700">Click to upload Excel file</p>
                    <p className="text-sm text-slate-500 mt-2">Supported formats: .xlsx, .xls</p>
                    <div className="mt-6 text-left text-sm text-slate-500 bg-white p-4 rounded border border-slate-200">
                      <p className="font-bold mb-2">Expected Format:</p>
                      <ul className="list-disc pl-5 space-y-1">
                        <li>Column A: Fabric</li>
                        <li>Column B: Daily Production</li>
                        <li>Column C: Customer</li>
                        <li>Column D: Work Center (Machine Name)</li>
                        <li>Row 1: Header (skipped)</li>
                      </ul>
                    </div>
                  </div>
                ) : (
                  <div>
                    <div className="flex justify-between items-center mb-4">
                      <h3 className="font-bold text-slate-800">Preview Changes ({importPreview.length} items)</h3>
                      <div className="text-sm text-slate-500">
                        Review the changes below before applying
                      </div>
                    </div>
                    
                    <div className="overflow-x-auto border border-slate-200 rounded-lg">
                      <table className="w-full text-sm text-left">
                        <thead className="bg-slate-50 text-slate-700 font-bold">
                          <tr>
                            <th className="p-3 border-b">Machine</th>
                            <th className="p-3 border-b">Fabric</th>
                            <th className="p-3 border-b">Customer</th>
                            <th className="p-3 border-b text-center">Production</th>
                            <th className="p-3 border-b text-center">Remaining</th>
                            <th className="p-3 border-b text-center">Status</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-200">
                          {importPreview.map((item, idx) => (
                            <tr key={idx} className="hover:bg-slate-50">
                              <td className="p-3 font-medium text-slate-800">{item.machineName}</td>
                              <td className="p-3 text-slate-600">{item.fabric}</td>
                              <td className="p-3 text-slate-600">{item.customer}</td>
                              <td className="p-3 text-center font-mono">
                                {item.dailyProduction}
                              </td>
                              <td className="p-3 text-center">
                                <div className="flex flex-col items-center">
                                  <span className="text-xs text-slate-400 line-through">{item.previousRemaining}</span>
                                  <span className="font-bold text-blue-600">{item.newRemaining}</span>
                                </div>
                              </td>
                              <td className="p-3 text-center">
                                <div className="flex flex-col items-center">
                                  <span className="text-xs text-slate-400">{item.previousStatus}</span>
                                  <span className={`font-bold ${item.newStatus === 'Working' ? 'text-green-600' : 'text-red-600'}`}>
                                    ↓ {item.newStatus}
                                  </span>
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
              
              <div className="p-6 border-t border-slate-200 bg-slate-50 flex justify-end gap-3">
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
                    className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-lg shadow-sm transition-colors flex items-center gap-2"
                  >
                    <Check size={18} />
                    Apply Changes
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default MachineSS;
