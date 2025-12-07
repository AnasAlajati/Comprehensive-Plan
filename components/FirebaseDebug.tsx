import React, { useState, useEffect } from 'react';
import { 
  collection, 
  getDocs,
  query,
  Timestamp,
  addDoc,
  updateDoc,
  doc,
  deleteDoc
} from 'firebase/firestore';
import { db } from '../services/firebase';

interface FirebaseStructure {
  collectionName: string;
  docCount: number;
  sampleDoc?: Record<string, any>;
  loading: boolean;
  error?: string;
}

const FirebaseDebug: React.FC = () => {
  const [structures, setStructures] = useState<FirebaseStructure[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedDoc, setSelectedDoc] = useState<string | null>(null);
  const [docDetails, setDocDetails] = useState<Record<string, any> | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showPlanForm, setShowPlanForm] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    brand: '',
    machineid: '',
  });
  const [dailyLogs, setDailyLogs] = useState<any[]>([]);
  const [futurePlans, setFuturePlans] = useState<any[]>([]);
  const [newLog, setNewLog] = useState({
    date: new Date().toISOString().split('T')[0],
    dayProduction: '',
    scrap: '',
    fabric: '',
    client: '',
    status: 'Working',
  });
  const [newPlan, setNewPlan] = useState({
    type: 'PRODUCTION',
    startDate: new Date().toISOString().split('T')[0],
    endDate: '',
    days: '',
    fabric: '',
    productionPerDay: '',
    quantity: '',
    remaining: '',
    orderName: '',
    originalSampleMachine: '',
    notes: '',
  });

  // Collections to inspect
  const collectionsToCheck = [
    'machines',
    'MachineSS',
    'daily_production_index',
    'client_daily_summary',
    'factory_stats',
    'orders',
  ];

  useEffect(() => {
    const fetchStructures = async () => {
      const results: FirebaseStructure[] = [];

      for (const collName of collectionsToCheck) {
        try {
          const collRef = collection(db, collName);
          const q = query(collRef);
          const snapshot = await getDocs(q);
          
          let sampleDoc = snapshot.docs.length > 0 
            ? snapshot.docs[0].data() 
            : undefined;

          // For MachineSS, show sample data if collection is empty
          if (collName === 'MachineSS' && !sampleDoc) {
            sampleDoc = {
              name: "Rieter ZR4",
              brand: "Rieter",
              machineid: 1,
              dailyLogs: [
                {
                  date: "2025-11-29",
                  dayProduction: 125,
                  scrap: 5,
                  fabric: "Cotton",
                  client: "ABC Corp",
                  status: "Working"
                },
                {
                  date: "2025-11-28",
                  dayProduction: 118,
                  scrap: 3,
                  fabric: "Polyester",
                  client: "XYZ Ltd",
                  status: "Working"
                }
              ],
              futurePlans: [
                {
                  type: "PRODUCTION",
                  startDate: "2025-11-29",
                  endDate: "2025-12-09",
                  days: 10,
                  fabric: "Silk",
                  productionPerDay: 100,
                  quantity: 5000,
                  remaining: 3500,
                  orderName: "ORDER-2025-001",
                  originalSampleMachine: "Machine-5",
                  notes: "Rush delivery needed"
                },
                {
                  type: "SETTINGS",
                  startDate: "2025-12-10",
                  endDate: "2025-12-11",
                  days: 1,
                  fabric: "N/A",
                  productionPerDay: 0,
                  quantity: 0,
                  remaining: 0,
                  orderName: "MAINT-001",
                  originalSampleMachine: "",
                  notes: "Scheduled maintenance"
                }
              ]
            };
          }

          results.push({
            collectionName: collName,
            docCount: snapshot.size,
            sampleDoc,
            loading: false,
          });
        } catch (error: any) {
          results.push({
            collectionName: collName,
            docCount: 0,
            loading: false,
            error: error.message,
          });
        }
      }

      setStructures(results);
      setLoading(false);
    };

    fetchStructures();
  }, []);

  const handleViewDetails = (collName: string) => {
    const structure = structures.find(s => s.collectionName === collName);
    if (structure?.sampleDoc) {
      setSelectedDoc(collName);
      setDocDetails(structure.sampleDoc);
    }
  };

  const handleAddMachine = async () => {
    if (!formData.name || !formData.brand || !formData.machineid) {
      alert('Please fill in machine basic info');
      return;
    }

    try {
      const newMachine = {
        name: formData.name,
        brand: formData.brand,
        machineid: parseInt(formData.machineid),
        dailyLogs: dailyLogs.map(log => ({
          date: log.date,
          dayProduction: parseInt(log.dayProduction) || 0,
          scrap: parseInt(log.scrap) || 0,
          fabric: log.fabric,
          client: log.client,
          status: log.status,
        })),
        futurePlans: futurePlans.map(plan => ({
          type: plan.type,
          startDate: plan.startDate,
          endDate: plan.endDate,
          days: parseInt(plan.days) || 0,
          fabric: plan.fabric,
          productionPerDay: parseInt(plan.productionPerDay) || 0,
          quantity: parseInt(plan.quantity) || 0,
          remaining: parseInt(plan.remaining) || 0,
          orderName: plan.orderName,
          originalSampleMachine: plan.originalSampleMachine,
          notes: plan.notes,
        })),
      };

      await addDoc(collection(db, 'MachineSS'), newMachine);
      
      // Reset form
      setFormData({ name: '', brand: '', machineid: '' });
      setDailyLogs([]);
      setFuturePlans([]);
      setNewLog({
        date: new Date().toISOString().split('T')[0],
        dayProduction: '',
        scrap: '',
        fabric: '',
        client: '',
        status: 'Working',
      });
      setNewPlan({
        type: 'PRODUCTION',
        startDate: new Date().toISOString().split('T')[0],
        endDate: '',
        days: '',
        fabric: '',
        productionPerDay: '',
        quantity: '',
        remaining: '',
        orderName: '',
        originalSampleMachine: '',
        notes: '',
      });
      setShowAddModal(false);
      
      // Refresh structures
      const results: FirebaseStructure[] = [];
      for (const collName of collectionsToCheck) {
        try {
          const collRef = collection(db, collName);
          const q = query(collRef);
          const snapshot = await getDocs(q);
          
          let sampleDoc = snapshot.docs.length > 0 
            ? snapshot.docs[0].data() 
            : undefined;

          if (collName === 'MachineSS' && !sampleDoc) {
            sampleDoc = {
              name: "Rieter ZR4",
              brand: "Rieter",
              machineid: 1,
              dailyLogs: [],
              futurePlans: [],
            };
          }

          results.push({
            collectionName: collName,
            docCount: snapshot.size,
            sampleDoc,
            loading: false,
          });
        } catch (error: any) {
          results.push({
            collectionName: collName,
            docCount: 0,
            loading: false,
            error: error.message,
          });
        }
      }
      setStructures(results);
    } catch (error: any) {
      alert(`Error adding machine: ${error.message}`);
    }
  };

  const addDailyLog = () => {
    if (!newLog.date || !newLog.fabric || !newLog.client) {
      alert('Please fill in date, fabric, and client');
      return;
    }
    setDailyLogs([...dailyLogs, { ...newLog }]);
    setNewLog({
      date: new Date().toISOString().split('T')[0],
      dayProduction: '',
      scrap: '',
      fabric: '',
      client: '',
      status: 'Working',
    });
  };

  const removeDailyLog = (index: number) => {
    setDailyLogs(dailyLogs.filter((_, i) => i !== index));
  };

  const addFuturePlan = () => {
    if (!newPlan.startDate || !newPlan.endDate || !newPlan.orderName) {
      alert('Please fill in startDate, endDate, and orderName');
      return;
    }
    setFuturePlans([...futurePlans, { ...newPlan }]);
    setNewPlan({
      type: 'PRODUCTION',
      startDate: new Date().toISOString().split('T')[0],
      endDate: '',
      days: '',
      fabric: '',
      productionPerDay: '',
      quantity: '',
      remaining: '',
      orderName: '',
      originalSampleMachine: '',
      notes: '',
    });
  };

  const removeFuturePlan = (index: number) => {
    setFuturePlans(futurePlans.filter((_, i) => i !== index));
  };

  const handleBlur = async (docId: string, field: string, value: any, dataType: 'dailyLog' | 'futurePlan', arrayIndex: number) => {
    try {
      const machineRef = doc(db, 'MachineSS', docId);
      const machineSnap = await getDocs(query(collection(db, 'MachineSS')));
      
      const machine = structures.find(s => s.collectionName === 'MachineSS')?.sampleDoc;
      if (!machine) return;

      if (dataType === 'dailyLog') {
        const updatedLogs = [...(machine.dailyLogs || [])];
        updatedLogs[arrayIndex] = { ...updatedLogs[arrayIndex], [field]: value };
        await updateDoc(machineRef, { dailyLogs: updatedLogs });
      } else if (dataType === 'futurePlan') {
        const updatedPlans = [...(machine.futurePlans || [])];
        updatedPlans[arrayIndex] = { ...updatedPlans[arrayIndex], [field]: value };
        await updateDoc(machineRef, { futurePlans: updatedPlans });
      }
      
      // Refresh data
      await refreshMachineData();
    } catch (error: any) {
      console.error('Error updating:', error);
    }
  };

  const refreshMachineData = async () => {
    try {
      const collRef = collection(db, 'MachineSS');
      const snapshot = await getDocs(query(collRef));
      
      if (snapshot.docs.length > 0) {
        const machineData = snapshot.docs[0].data();
        setFormData({
          name: machineData.name || '',
          brand: machineData.brand || '',
          machineid: machineData.machineid?.toString() || '',
        });
        setDailyLogs(machineData.dailyLogs || []);
        setFuturePlans(machineData.futurePlans || []);
      }
    } catch (error) {
      console.error('Error refreshing:', error);
    }
  };

  const formatValue = (value: any): string => {
    if (value === null || value === undefined) return 'null';
    if (value instanceof Timestamp) return value.toDate().toISOString();
    if (typeof value === 'object') return JSON.stringify(value, null, 2);
    return String(value);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 p-4 sm:p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-4xl font-bold text-white mb-2 flex items-center gap-3">
            <span className="text-3xl">📊</span> MachineSS Manager
          </h1>
          <p className="text-slate-300 text-sm">Manage machines, daily logs, and future plans</p>
        </div>

        {/* Add MachineSS Button */}
        <div className="mb-6 flex gap-3">
          <button
            onClick={() => setShowAddModal(true)}
            className="bg-gradient-to-r from-emerald-600 to-emerald-500 hover:from-emerald-500 hover:to-emerald-400 text-white px-6 py-3 rounded-lg font-bold transition-all shadow-lg hover:shadow-emerald-500/50 flex items-center gap-2"
          >
            <span>➕</span> Add New Machine
          </button>
          <button
            onClick={refreshMachineData}
            className="bg-slate-700 hover:bg-slate-600 text-white px-6 py-3 rounded-lg font-bold transition-all flex items-center gap-2"
          >
            <span>🔄</span> Refresh
          </button>
        </div>

        {/* MACHINE INFO SECTION */}
        {(formData.name || formData.brand || formData.machineid) && (
          <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-6 mb-8">
            <h2 className="text-2xl font-bold text-emerald-400 mb-4 flex items-center gap-2">
              <span>🤖</span> Machine Information
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 bg-slate-900/30 p-4 rounded-lg">
              <div>
                <p className="text-slate-400 text-xs uppercase tracking-wider mb-1">Machine Name</p>
                <p className="text-white text-lg font-bold">{formData.name}</p>
              </div>
              <div>
                <p className="text-slate-400 text-xs uppercase tracking-wider mb-1">Brand</p>
                <p className="text-white text-lg font-bold">{formData.brand}</p>
              </div>
              <div>
                <p className="text-slate-400 text-xs uppercase tracking-wider mb-1">Machine ID</p>
                <p className="text-white text-lg font-bold">{formData.machineid}</p>
              </div>
            </div>
          </div>
        )}

        {/* DAILY LOGS SECTION */}
        <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-6 mb-8">
          <h2 className="text-2xl font-bold text-blue-400 mb-4 flex items-center gap-2">
            <span>📊</span> Daily Production Logs ({dailyLogs.length})
          </h2>

          {/* Add Log Form */}
          <div className="bg-slate-900/50 border border-slate-700 rounded-lg p-4 mb-6 space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-3">
              <input
                type="date"
                value={newLog.date}
                onChange={(e) => setNewLog({ ...newLog, date: e.target.value })}
                className="bg-slate-800 border border-slate-600 rounded px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500"
                placeholder="Date"
              />
              <input
                type="number"
                value={newLog.dayProduction}
                onChange={(e) => setNewLog({ ...newLog, dayProduction: e.target.value })}
                className="bg-slate-800 border border-slate-600 rounded px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500"
                placeholder="Production"
              />
              <input
                type="number"
                value={newLog.scrap}
                onChange={(e) => setNewLog({ ...newLog, scrap: e.target.value })}
                className="bg-slate-800 border border-slate-600 rounded px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500"
                placeholder="Scrap"
              />
              <input
                type="text"
                value={newLog.fabric}
                onChange={(e) => setNewLog({ ...newLog, fabric: e.target.value })}
                className="bg-slate-800 border border-slate-600 rounded px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500"
                placeholder="Fabric"
              />
              <input
                type="text"
                value={newLog.client}
                onChange={(e) => setNewLog({ ...newLog, client: e.target.value })}
                className="bg-slate-800 border border-slate-600 rounded px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500"
                placeholder="Client"
              />
              <select
                value={newLog.status}
                onChange={(e) => setNewLog({ ...newLog, status: e.target.value })}
                className="bg-slate-800 border border-slate-600 rounded px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500"
              >
                <option>Working</option>
                <option>Idle</option>
                <option>Maintenance</option>
              </select>
            </div>
            <button
              onClick={addDailyLog}
              className="w-full bg-blue-600 hover:bg-blue-500 text-white py-2 rounded font-bold transition-colors"
            >
              Add Daily Log
            </button>
          </div>

          {/* Daily Logs Table */}
          {dailyLogs.length > 0 ? (
            <div className="overflow-x-auto border border-slate-700 rounded-lg">
              <table className="w-full text-xs text-center border-collapse bg-slate-900">
                <thead className="bg-slate-800 text-slate-300 font-bold sticky top-0">
                  <tr>
                    <th className="p-2 border border-slate-700">Date</th>
                    <th className="p-2 border border-slate-700">Production</th>
                    <th className="p-2 border border-slate-700">Scrap</th>
                    <th className="p-2 border border-slate-700">Fabric</th>
                    <th className="p-2 border border-slate-700">Client</th>
                    <th className="p-2 border border-slate-700">Status</th>
                    <th className="p-2 border border-slate-700">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {dailyLogs.map((log, idx) => (
                    <tr key={idx} className="hover:bg-slate-800/50 transition-colors">
                      <td className="p-2 border border-slate-700 text-blue-300">{log.date}</td>
                      <td className="p-2 border border-slate-700 text-slate-300">{log.dayProduction}</td>
                      <td className="p-2 border border-slate-700 text-red-300">{log.scrap}</td>
                      <td className="p-2 border border-slate-700 text-slate-300">{log.fabric}</td>
                      <td className="p-2 border border-slate-700 text-slate-300">{log.client}</td>
                      <td className="p-2 border border-slate-700 text-slate-300">{log.status}</td>
                      <td className="p-2 border border-slate-700">
                        <button
                          onClick={() => removeDailyLog(idx)}
                          className="text-red-400 hover:text-red-300 transition-colors"
                        >
                          ✕ Delete
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="text-center py-8 text-slate-400">
              <p>No daily logs yet. Add one to get started.</p>
            </div>
          )}
        </div>

        {/* FUTURE PLANS SECTION */}
        <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-6 mb-8">
          <h2 className="text-2xl font-bold text-purple-400 mb-4 flex items-center gap-2">
            <span>📅</span> Future Plans ({futurePlans.length})
          </h2>

          {/* Add Plan Form */}
          <div className="bg-slate-900/50 border border-slate-700 rounded-lg p-4 mb-6 space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
              <select
                value={newPlan.type}
                onChange={(e) => setNewPlan({ ...newPlan, type: e.target.value })}
                className="bg-slate-800 border border-slate-600 rounded px-3 py-2 text-white text-sm focus:outline-none focus:border-purple-500"
              >
                <option value="PRODUCTION">PRODUCTION</option>
                <option value="SETTINGS">SETTINGS</option>
              </select>
              <input
                type="text"
                value={newPlan.orderName}
                onChange={(e) => setNewPlan({ ...newPlan, orderName: e.target.value })}
                className="bg-slate-800 border border-slate-600 rounded px-3 py-2 text-white text-sm focus:outline-none focus:border-purple-500"
                placeholder="Order Name"
              />
              <input
                type="date"
                value={newPlan.startDate}
                onChange={(e) => setNewPlan({ ...newPlan, startDate: e.target.value })}
                className="bg-slate-800 border border-slate-600 rounded px-3 py-2 text-white text-sm focus:outline-none focus:border-purple-500"
                placeholder="Start Date"
              />
              <input
                type="date"
                value={newPlan.endDate}
                onChange={(e) => setNewPlan({ ...newPlan, endDate: e.target.value })}
                className="bg-slate-800 border border-slate-600 rounded px-3 py-2 text-white text-sm focus:outline-none focus:border-purple-500"
                placeholder="End Date"
              />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
              <input
                type="number"
                value={newPlan.days}
                onChange={(e) => setNewPlan({ ...newPlan, days: e.target.value })}
                className="bg-slate-800 border border-slate-600 rounded px-3 py-2 text-white text-sm focus:outline-none focus:border-purple-500"
                placeholder="Days"
              />
              <input
                type="text"
                value={newPlan.fabric}
                onChange={(e) => setNewPlan({ ...newPlan, fabric: e.target.value })}
                className="bg-slate-800 border border-slate-600 rounded px-3 py-2 text-white text-sm focus:outline-none focus:border-purple-500"
                placeholder="Fabric"
              />
              <input
                type="number"
                value={newPlan.productionPerDay}
                onChange={(e) => setNewPlan({ ...newPlan, productionPerDay: e.target.value })}
                className="bg-slate-800 border border-slate-600 rounded px-3 py-2 text-white text-sm focus:outline-none focus:border-purple-500"
                placeholder="Prod/Day"
              />
              <input
                type="number"
                value={newPlan.quantity}
                onChange={(e) => setNewPlan({ ...newPlan, quantity: e.target.value })}
                className="bg-slate-800 border border-slate-600 rounded px-3 py-2 text-white text-sm focus:outline-none focus:border-purple-500"
                placeholder="Quantity"
              />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
              <input
                type="number"
                value={newPlan.remaining}
                onChange={(e) => setNewPlan({ ...newPlan, remaining: e.target.value })}
                className="bg-slate-800 border border-slate-600 rounded px-3 py-2 text-white text-sm focus:outline-none focus:border-purple-500"
                placeholder="Remaining"
              />
              <input
                type="text"
                value={newPlan.originalSampleMachine}
                onChange={(e) => setNewPlan({ ...newPlan, originalSampleMachine: e.target.value })}
                className="bg-slate-800 border border-slate-600 rounded px-3 py-2 text-white text-sm focus:outline-none focus:border-purple-500"
                placeholder="Sample Machine"
              />
              <input
                type="text"
                value={newPlan.notes}
                onChange={(e) => setNewPlan({ ...newPlan, notes: e.target.value })}
                className="col-span-2 bg-slate-800 border border-slate-600 rounded px-3 py-2 text-white text-sm focus:outline-none focus:border-purple-500"
                placeholder="Notes"
              />
            </div>
            <button
              onClick={addFuturePlan}
              className="w-full bg-purple-600 hover:bg-purple-500 text-white py-2 rounded font-bold transition-colors"
            >
              Add Future Plan
            </button>
          </div>

          {/* Future Plans Table */}
          {futurePlans.length > 0 ? (
            <div className="overflow-x-auto border border-slate-700 rounded-lg">
              <table className="w-full text-xs text-center border-collapse bg-slate-900">
                <thead className="bg-slate-800 text-slate-300 font-bold sticky top-0">
                  <tr>
                    <th className="p-2 border border-slate-700">Type</th>
                    <th className="p-2 border border-slate-700">Order Name</th>
                    <th className="p-2 border border-slate-700">Start Date</th>
                    <th className="p-2 border border-slate-700">End Date</th>
                    <th className="p-2 border border-slate-700">Days</th>
                    <th className="p-2 border border-slate-700">Fabric</th>
                    <th className="p-2 border border-slate-700">Prod/Day</th>
                    <th className="p-2 border border-slate-700">Qty</th>
                    <th className="p-2 border border-slate-700">Remaining</th>
                    <th className="p-2 border border-slate-700">Sample</th>
                    <th className="p-2 border border-slate-700">Notes</th>
                    <th className="p-2 border border-slate-700">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {futurePlans.map((plan, idx) => (
                    <tr key={idx} className="hover:bg-slate-800/50 transition-colors">
                      <td className="p-2 border border-slate-700 font-bold text-purple-300">{plan.type}</td>
                      <td className="p-2 border border-slate-700 text-slate-300">{plan.orderName}</td>
                      <td className="p-2 border border-slate-700 text-blue-300">{plan.startDate}</td>
                      <td className="p-2 border border-slate-700 text-blue-300">{plan.endDate}</td>
                      <td className="p-2 border border-slate-700 text-slate-300">{plan.days}</td>
                      <td className="p-2 border border-slate-700 text-slate-300">{plan.fabric}</td>
                      <td className="p-2 border border-slate-700 text-slate-300">{plan.productionPerDay}</td>
                      <td className="p-2 border border-slate-700 text-slate-300">{plan.quantity}</td>
                      <td className="p-2 border border-slate-700 text-emerald-300 font-bold">{plan.remaining}</td>
                      <td className="p-2 border border-slate-700 text-slate-300">{plan.originalSampleMachine}</td>
                      <td className="p-2 border border-slate-700 text-slate-400 text-[10px]">{plan.notes}</td>
                      <td className="p-2 border border-slate-700">
                        <button
                          onClick={() => removeFuturePlan(idx)}
                          className="text-red-400 hover:text-red-300 transition-colors"
                        >
                          ✕ Delete
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="text-center py-8 text-slate-400">
              <p>No future plans yet. Add one to get started.</p>
            </div>
          )}
        </div>

        {/* Structures Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {structures.map((structure) => (
            <div
              key={structure.collectionName}
              className={`rounded-xl border-2 transition-all cursor-pointer hover:shadow-lg ${
                structure.error
                  ? 'bg-red-900/20 border-red-500/50 hover:border-red-500'
                  : structure.docCount > 0
                  ? 'bg-gradient-to-br from-emerald-900/30 to-emerald-800/10 border-emerald-500/50 hover:border-emerald-400'
                  : 'bg-slate-700/30 border-slate-600/50 hover:border-slate-500'
              }`}
              onClick={() => !structure.error && structure.docCount > 0 && handleViewDetails(structure.collectionName)}
            >
              <div className="p-4">
                {/* Collection Name */}
                <h2 className="text-lg font-bold text-white mb-3 font-mono text-sm break-all">
                  📁 {structure.collectionName}
                </h2>

                {/* Status */}
                {structure.error ? (
                  <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 mb-3">
                    <p className="text-red-300 text-xs font-mono">{structure.error}</p>
                  </div>
                ) : (
                  <>
                    {/* Doc Count */}
                    <div className="bg-white/5 rounded-lg p-3 mb-3">
                      <p className="text-slate-300 text-xs uppercase tracking-wider font-bold mb-1">
                        Documents
                      </p>
                      <p className="text-3xl font-bold text-emerald-400">
                        {structure.docCount}
                      </p>
                    </div>

                    {/* Sample Fields */}
                    {structure.sampleDoc && (
                      <div className="space-y-2 mb-3">
                        <p className="text-slate-300 text-xs uppercase tracking-wider font-bold">
                          Sample Fields:
                        </p>
                        <div className="bg-slate-900/40 rounded-lg p-2 space-y-1 max-h-32 overflow-y-auto">
                          {Object.keys(structure.sampleDoc).slice(0, 5).map((key) => (
                            <div key={key} className="text-xs font-mono">
                              <span className="text-blue-400">{key}:</span>{' '}
                              <span className="text-slate-300">
                                {typeof structure.sampleDoc![key] === 'object'
                                  ? '{...}'
                                  : String(structure.sampleDoc![key]).substring(0, 30)}
                              </span>
                            </div>
                          ))}
                          {Object.keys(structure.sampleDoc).length > 5 && (
                            <div className="text-xs text-slate-400">
                              +{Object.keys(structure.sampleDoc).length - 5} more fields
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    {/* View Button */}
                    {structure.docCount > 0 && (
                      <button className="w-full bg-emerald-600 hover:bg-emerald-500 text-white py-2 rounded-lg text-xs font-bold transition-colors">
                        View Details →
                      </button>
                    )}
                  </>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* Add Machine Modal */}
        {showAddModal && (
          <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <div className="bg-slate-800 rounded-xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col border border-slate-700">
              {/* Modal Header */}
              <div className="flex justify-between items-center p-6 border-b border-slate-700 bg-slate-900/50 rounded-t-xl">
                <div>
                  <h3 className="text-lg font-bold text-white">Add New MachineSS</h3>
                  <p className="text-emerald-200 text-xs">Create a new machine with logs and plans</p>
                </div>
                <button
                  onClick={() => setShowAddModal(false)}
                  className="text-emerald-200 hover:text-white text-2xl transition-colors"
                >
                  ✕
                </button>
              </div>

              {/* Modal Content */}
              <div className="p-6 space-y-6 max-h-[80vh] overflow-y-auto">
                {/* MACHINE INFO SECTION */}
                <div className="border-b border-slate-700 pb-6">
                  <h4 className="text-emerald-400 font-bold mb-4 flex items-center gap-2">
                    <span>🤖</span> Machine Information
                  </h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {/* Machine Name */}
                    <div>
                      <label className="block text-emerald-300 text-sm font-bold mb-2">
                        Machine Name *
                      </label>
                      <input
                        type="text"
                        value={formData.name}
                        onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                        placeholder="e.g., Rieter ZR4"
                        className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20"
                      />
                    </div>

                    {/* Brand */}
                    <div>
                      <label className="block text-emerald-300 text-sm font-bold mb-2">
                        Brand *
                      </label>
                      <input
                        type="text"
                        value={formData.brand}
                        onChange={(e) => setFormData({ ...formData, brand: e.target.value })}
                        placeholder="e.g., Rieter"
                        className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20"
                      />
                    </div>

                    {/* Machine ID */}
                    <div>
                      <label className="block text-emerald-300 text-sm font-bold mb-2">
                        Machine ID *
                      </label>
                      <input
                        type="number"
                        value={formData.machineid}
                        onChange={(e) => setFormData({ ...formData, machineid: e.target.value })}
                        placeholder="e.g., 1"
                        className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20"
                      />
                    </div>
                  </div>
                </div>

                {/* DAILY LOGS SECTION */}
                <div className="border-b border-slate-700 pb-6">
                  <h4 className="text-blue-400 font-bold mb-4 flex items-center gap-2">
                    <span>📊</span> Daily Logs ({dailyLogs.length})
                  </h4>
                  
                  {/* Add Log Form */}
                  <div className="bg-slate-900/50 border border-slate-700 rounded-lg p-4 mb-4 space-y-3">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-blue-300 text-xs font-bold mb-1">Date</label>
                        <input
                          type="date"
                          value={newLog.date}
                          onChange={(e) => setNewLog({ ...newLog, date: e.target.value })}
                          className="w-full bg-slate-800 border border-slate-600 rounded px-2 py-1 text-white text-sm focus:outline-none focus:border-blue-500"
                        />
                      </div>
                      <div>
                        <label className="block text-blue-300 text-xs font-bold mb-1">Day Production</label>
                        <input
                          type="number"
                          value={newLog.dayProduction}
                          onChange={(e) => setNewLog({ ...newLog, dayProduction: e.target.value })}
                          placeholder="0"
                          className="w-full bg-slate-800 border border-slate-600 rounded px-2 py-1 text-white text-sm focus:outline-none focus:border-blue-500"
                        />
                      </div>
                      <div>
                        <label className="block text-blue-300 text-xs font-bold mb-1">Scrap</label>
                        <input
                          type="number"
                          value={newLog.scrap}
                          onChange={(e) => setNewLog({ ...newLog, scrap: e.target.value })}
                          placeholder="0"
                          className="w-full bg-slate-800 border border-slate-600 rounded px-2 py-1 text-white text-sm focus:outline-none focus:border-blue-500"
                        />
                      </div>
                      <div>
                        <label className="block text-blue-300 text-xs font-bold mb-1">Fabric *</label>
                        <input
                          type="text"
                          value={newLog.fabric}
                          onChange={(e) => setNewLog({ ...newLog, fabric: e.target.value })}
                          placeholder="Cotton, Silk..."
                          className="w-full bg-slate-800 border border-slate-600 rounded px-2 py-1 text-white text-sm focus:outline-none focus:border-blue-500"
                        />
                      </div>
                      <div>
                        <label className="block text-blue-300 text-xs font-bold mb-1">Client *</label>
                        <input
                          type="text"
                          value={newLog.client}
                          onChange={(e) => setNewLog({ ...newLog, client: e.target.value })}
                          placeholder="ABC Corp..."
                          className="w-full bg-slate-800 border border-slate-600 rounded px-2 py-1 text-white text-sm focus:outline-none focus:border-blue-500"
                        />
                      </div>
                      <div>
                        <label className="block text-blue-300 text-xs font-bold mb-1">Status</label>
                        <select
                          value={newLog.status}
                          onChange={(e) => setNewLog({ ...newLog, status: e.target.value })}
                          className="w-full bg-slate-800 border border-slate-600 rounded px-2 py-1 text-white text-sm focus:outline-none focus:border-blue-500"
                        >
                          <option>Working</option>
                          <option>Idle</option>
                          <option>Maintenance</option>
                        </select>
                      </div>
                    </div>
                    <button
                      onClick={addDailyLog}
                      className="w-full bg-blue-600 hover:bg-blue-500 text-white py-2 rounded text-sm font-bold transition-colors"
                    >
                      Add Daily Log
                    </button>
                  </div>

                  {/* Listed Logs */}
                  <div className="space-y-2">
                    {dailyLogs.map((log, idx) => (
                      <div key={idx} className="bg-blue-900/20 border border-blue-700/30 rounded p-3 flex justify-between items-start">
                        <div className="text-sm">
                          <p className="text-blue-300 font-mono font-bold">{log.date}</p>
                          <p className="text-slate-400 text-xs">{log.fabric} | {log.client} | {log.dayProduction} units | {log.status}</p>
                        </div>
                        <button
                          onClick={() => removeDailyLog(idx)}
                          className="text-red-400 hover:text-red-300 text-lg"
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                  </div>
                </div>

                {/* FUTURE PLANS SECTION */}
                <div>
                  <h4 className="text-purple-400 font-bold mb-4 flex items-center gap-2">
                    <span>📅</span> Future Plans ({futurePlans.length})
                  </h4>
                  
                  {/* Add Plan Form */}
                  <div className="bg-slate-900/50 border border-slate-700 rounded-lg p-4 mb-4 space-y-3">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-purple-300 text-xs font-bold mb-1">Type</label>
                        <select
                          value={newPlan.type}
                          onChange={(e) => setNewPlan({ ...newPlan, type: e.target.value })}
                          className="w-full bg-slate-800 border border-slate-600 rounded px-2 py-1 text-white text-sm focus:outline-none focus:border-purple-500"
                        >
                          <option value="PRODUCTION">PRODUCTION</option>
                          <option value="SETTINGS">SETTINGS</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-purple-300 text-xs font-bold mb-1">Order Name *</label>
                        <input
                          type="text"
                          value={newPlan.orderName}
                          onChange={(e) => setNewPlan({ ...newPlan, orderName: e.target.value })}
                          placeholder="ORDER-2025-001"
                          className="w-full bg-slate-800 border border-slate-600 rounded px-2 py-1 text-white text-sm focus:outline-none focus:border-purple-500"
                        />
                      </div>
                      <div>
                        <label className="block text-purple-300 text-xs font-bold mb-1">Start Date *</label>
                        <input
                          type="date"
                          value={newPlan.startDate}
                          onChange={(e) => setNewPlan({ ...newPlan, startDate: e.target.value })}
                          className="w-full bg-slate-800 border border-slate-600 rounded px-2 py-1 text-white text-sm focus:outline-none focus:border-purple-500"
                        />
                      </div>
                      <div>
                        <label className="block text-purple-300 text-xs font-bold mb-1">End Date *</label>
                        <input
                          type="date"
                          value={newPlan.endDate}
                          onChange={(e) => setNewPlan({ ...newPlan, endDate: e.target.value })}
                          className="w-full bg-slate-800 border border-slate-600 rounded px-2 py-1 text-white text-sm focus:outline-none focus:border-purple-500"
                        />
                      </div>
                      <div>
                        <label className="block text-purple-300 text-xs font-bold mb-1">Days</label>
                        <input
                          type="number"
                          value={newPlan.days}
                          onChange={(e) => setNewPlan({ ...newPlan, days: e.target.value })}
                          placeholder="0"
                          className="w-full bg-slate-800 border border-slate-600 rounded px-2 py-1 text-white text-sm focus:outline-none focus:border-purple-500"
                        />
                      </div>
                      <div>
                        <label className="block text-purple-300 text-xs font-bold mb-1">Fabric</label>
                        <input
                          type="text"
                          value={newPlan.fabric}
                          onChange={(e) => setNewPlan({ ...newPlan, fabric: e.target.value })}
                          placeholder="Cotton, Silk..."
                          className="w-full bg-slate-800 border border-slate-600 rounded px-2 py-1 text-white text-sm focus:outline-none focus:border-purple-500"
                        />
                      </div>
                      <div>
                        <label className="block text-purple-300 text-xs font-bold mb-1">Production/Day</label>
                        <input
                          type="number"
                          value={newPlan.productionPerDay}
                          onChange={(e) => setNewPlan({ ...newPlan, productionPerDay: e.target.value })}
                          placeholder="0"
                          className="w-full bg-slate-800 border border-slate-600 rounded px-2 py-1 text-white text-sm focus:outline-none focus:border-purple-500"
                        />
                      </div>
                      <div>
                        <label className="block text-purple-300 text-xs font-bold mb-1">Total Quantity</label>
                        <input
                          type="number"
                          value={newPlan.quantity}
                          onChange={(e) => setNewPlan({ ...newPlan, quantity: e.target.value })}
                          placeholder="0"
                          className="w-full bg-slate-800 border border-slate-600 rounded px-2 py-1 text-white text-sm focus:outline-none focus:border-purple-500"
                        />
                      </div>
                      <div>
                        <label className="block text-purple-300 text-xs font-bold mb-1">Remaining</label>
                        <input
                          type="number"
                          value={newPlan.remaining}
                          onChange={(e) => setNewPlan({ ...newPlan, remaining: e.target.value })}
                          placeholder="0"
                          className="w-full bg-slate-800 border border-slate-600 rounded px-2 py-1 text-white text-sm focus:outline-none focus:border-purple-500"
                        />
                      </div>
                      <div>
                        <label className="block text-purple-300 text-xs font-bold mb-1">Original Sample Machine</label>
                        <input
                          type="text"
                          value={newPlan.originalSampleMachine}
                          onChange={(e) => setNewPlan({ ...newPlan, originalSampleMachine: e.target.value })}
                          placeholder="Machine-5"
                          className="w-full bg-slate-800 border border-slate-600 rounded px-2 py-1 text-white text-sm focus:outline-none focus:border-purple-500"
                        />
                      </div>
                      <div className="md:col-span-2">
                        <label className="block text-purple-300 text-xs font-bold mb-1">Notes</label>
                        <input
                          type="text"
                          value={newPlan.notes}
                          onChange={(e) => setNewPlan({ ...newPlan, notes: e.target.value })}
                          placeholder="Any notes..."
                          className="w-full bg-slate-800 border border-slate-600 rounded px-2 py-1 text-white text-sm focus:outline-none focus:border-purple-500"
                        />
                      </div>
                    </div>
                    <button
                      onClick={addFuturePlan}
                      className="w-full bg-purple-600 hover:bg-purple-500 text-white py-2 rounded text-sm font-bold transition-colors"
                    >
                      Add Future Plan
                    </button>
                  </div>

                  {/* Listed Plans */}
                  <div className="space-y-2">
                    {futurePlans.map((plan, idx) => (
                      <div key={idx} className="bg-purple-900/20 border border-purple-700/30 rounded p-3 flex justify-between items-start">
                        <div className="text-sm">
                          <p className="text-purple-300 font-mono font-bold">{plan.type} - {plan.orderName}</p>
                          <p className="text-slate-400 text-xs">{plan.startDate} to {plan.endDate} | {plan.quantity} units | {plan.remaining} remaining</p>
                        </div>
                        <button
                          onClick={() => removeFuturePlan(idx)}
                          className="text-red-400 hover:text-red-300 text-lg"
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Modal Footer */}
              <div className="bg-slate-900 border-t border-slate-700 p-4 rounded-b-xl flex justify-end gap-3 sticky bottom-0">
                <button
                  onClick={() => setShowAddModal(false)}
                  className="bg-slate-700 hover:bg-slate-600 text-white px-4 py-2 rounded-lg text-sm font-bold transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleAddMachine}
                  className="bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2 rounded-lg text-sm font-bold transition-colors"
                >
                  Create Machine
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Schema Reference */}
        <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-6 mb-8">
          <h2 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
            <span>📋</span> Firestore Schema Reference
          </h2>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* machines Collection */}
            <div className="bg-slate-900/50 rounded-lg p-4 border border-slate-700">
              <h3 className="font-mono text-blue-400 font-bold mb-3">machines/</h3>
              <div className="space-y-2 text-xs font-mono text-slate-300">
                <div><span className="text-slate-500">├─</span> id: number</div>
                <div><span className="text-slate-500">├─</span> machineName: string</div>
                <div><span className="text-slate-500">├─</span> brand: string</div>
                <div><span className="text-slate-500">├─</span> type: string</div>
                <div><span className="text-slate-500">├─</span> status: MachineStatus</div>
                <div><span className="text-slate-500">├─</span> dayProduction: number</div>
                <div><span className="text-slate-500">├─</span> scrap: number</div>
                <div><span className="text-slate-500">├─</span> material: string</div>
                <div><span className="text-slate-500">├─</span> client: string</div>
                <div><span className="text-slate-500">├─</span> futurePlans: PlanItem[]</div>
                <div><span className="text-slate-500">└─</span> orderIndex?: number</div>
              </div>
            </div>

            {/* MachineSS Collection */}
            <div className="bg-slate-900/50 rounded-lg p-4 border border-emerald-700/50 bg-gradient-to-br from-emerald-900/20">
              <h3 className="font-mono text-emerald-400 font-bold mb-3">📌 MachineSS/</h3>
              <div className="space-y-2 text-xs font-mono text-slate-300">
                <div><span className="text-emerald-500">├─</span> <span className="text-emerald-300">name: string</span></div>
                <div><span className="text-emerald-500">├─</span> <span className="text-emerald-300">brand: string</span></div>
                <div><span className="text-emerald-500">├─</span> <span className="text-emerald-300">machineid: number</span></div>
                <div><span className="text-emerald-500">├─</span> <span className="text-emerald-300">dailyLogs: Log[]</span></div>
                <div className="text-emerald-400 ml-4 text-xs">
                  <div>└─ Log: {'{'}</div>
                  <div className="ml-4">date: string,</div>
                  <div className="ml-4">dayProduction: number,</div>
                  <div className="ml-4">scrap: number,</div>
                  <div className="ml-4">fabric: string,</div>
                  <div className="ml-4">client: string,</div>
                  <div className="ml-4">status: string</div>
                  <div>{'}'}</div>
                </div>
                <div><span className="text-emerald-500">└─</span> <span className="text-emerald-300">futurePlans: Plan[]</span></div>
                <div className="text-emerald-400 ml-4 text-xs">
                  <div>└─ Plan: {'{'}</div>
                  <div className="ml-4">type: "PRODUCTION" | "SETTINGS",</div>
                  <div className="ml-4">startDate: string,</div>
                  <div className="ml-4">endDate: string,</div>
                  <div className="ml-4">days: number,</div>
                  <div className="ml-4">fabric: string,</div>
                  <div className="ml-4">productionPerDay: number,</div>
                  <div className="ml-4">quantity: number,</div>
                  <div className="ml-4">remaining: number,</div>
                  <div className="ml-4">orderName: string,</div>
                  <div className="ml-4">originalSampleMachine: string,</div>
                  <div className="ml-4">notes: string</div>
                  <div>{'}'}</div>
                </div>
              </div>
            </div>

            {/* daily_logs Sub-collection */}
            <div className="bg-slate-900/50 rounded-lg p-4 border border-slate-700">
              <h3 className="font-mono text-blue-400 font-bold mb-3">machines/id/daily_logs/</h3>
              <div className="space-y-2 text-xs font-mono text-slate-300">
                <div><span className="text-slate-500">├─</span> date: string (YYYY-MM-DD)</div>
                <div><span className="text-slate-500">├─</span> dayProduction: number</div>
                <div><span className="text-slate-500">├─</span> scrap: number</div>
                <div><span className="text-slate-500">├─</span> fabric: string</div>
                <div><span className="text-slate-500">├─</span> client: string</div>
                <div><span className="text-slate-500">├─</span> status: string</div>
                <div><span className="text-slate-500">└─</span> timestamp: Timestamp</div>
              </div>
            </div>

            {/* Indexes */}
            <div className="bg-slate-900/50 rounded-lg p-4 border border-slate-700">
              <h3 className="font-mono text-blue-400 font-bold mb-3">daily_production_index/</h3>
              <div className="space-y-2 text-xs font-mono text-slate-300">
                <div><span className="text-slate-500">├─</span> date: string</div>
                <div><span className="text-slate-500">├─</span> machineIds: number[]</div>
                <div><span className="text-slate-500">└─</span> timestamp: Timestamp</div>
              </div>
              <p className="text-slate-400 text-xs mt-3">
                📊 <strong>Purpose:</strong> O(1) lookup of which machines logged data today
              </p>
            </div>
          </div>
        </div>

        {/* Performance Notes */}
        <div className="bg-blue-900/20 border border-blue-700/50 rounded-xl p-6">
          <h2 className="text-lg font-bold text-blue-300 mb-4 flex items-center gap-2">
            <span>⚡</span> Optimization Notes
          </h2>
          <ul className="space-y-2 text-sm text-blue-200">
            <li>✅ <strong>MachineSS</strong> stores static machine info (name, brand, id) separately from daily data</li>
            <li>✅ <strong>dailyLogs</strong> contains all date-specific data (production, scrap, fabric, client, status)</li>
            <li>✅ <strong>futurePlans</strong> stored as array of plans (production schedule, settings)</li>
            <li>✅ <strong>daily_production_index</strong> enables O(1) queries: "Which machines logged data today?"</li>
            <li>✅ Batch writes ensure atomicity: all updates succeed or all fail</li>
            <li>✅ Sub-collections keep daily data isolated and queryable by date</li>
          </ul>
        </div>
      </div>
    </div>
  );
};

export default FirebaseDebug;
