import React, { useState, useEffect } from 'react';
import {
  collection,
  getDocs,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
} from 'firebase/firestore';
import { db } from '../services/firebase';

interface DailyLog {
  date: string;
  dayProduction: number;
  scrap: number;
  fabric: string;
  client: string;
  status: string;
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
  const [newMachine, setNewMachine] = useState({
    name: '',
    brand: '',
    machineid: '',
  });

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
        [field]: field === 'dayProduction' || field === 'scrap' ? parseInt(value) || 0 : value,
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
          <div className="flex gap-3">
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
          </div>
        </div>

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
      </div>
    </div>
  );
};

export default MachineSS;
