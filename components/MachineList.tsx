import React, { useState, useMemo } from 'react';
import { MachineRow, MachineStatus } from '../types';
import { Activity, AlertCircle, CheckCircle2, Clock, Search, Filter, MoreHorizontal } from 'lucide-react';

interface MachineListProps {
  machines: MachineRow[];
  loading: boolean;
  onUpdate?: (machine: MachineRow) => Promise<void>;
}

export const MachineList: React.FC<MachineListProps> = ({ machines, loading, onUpdate }) => {
  const [filter, setFilter] = useState<'ALL' | 'WORKING' | 'CHANGEOVER' | 'STOPPED'>('ALL');
  const [search, setSearch] = useState('');
  const [excludeBous, setExcludeBous] = useState(true);

  const stats = useMemo(() => {
    const total = machines.length;
    const working = machines.filter(m => m.status === MachineStatus.WORKING).length;
    const changeover = machines.filter(m => m.status === MachineStatus.QALB).length;
    const stopped = machines.filter(m => m.status === MachineStatus.OUT_OF_SERVICE || m.status === MachineStatus.NO_ORDER || m.status === MachineStatus.OTHER).length;
    
    // Wide Machines Stats
    const wideMachines = machines.filter(m => m.type !== 'BOUS');
    const wideTotal = wideMachines.length;
    const wideWorking = wideMachines.filter(m => m.status === MachineStatus.WORKING).length;
    const widePercentage = wideTotal > 0 ? Math.round((wideWorking / wideTotal) * 100) : 0;

    return { total, working, changeover, stopped, wideTotal, wideWorking, widePercentage };
  }, [machines]);

  const filteredMachines = useMemo(() => {
    return machines.filter(m => {
      if (excludeBous && m.type === 'BOUS') return false;

      let matchesFilter = true;
      if (filter === 'WORKING') matchesFilter = m.status === MachineStatus.WORKING;
      else if (filter === 'CHANGEOVER') matchesFilter = m.status === MachineStatus.QALB;
      else if (filter === 'STOPPED') matchesFilter = m.status === MachineStatus.OUT_OF_SERVICE || m.status === MachineStatus.NO_ORDER || m.status === MachineStatus.OTHER;

      const matchesSearch = m.machineName.toLowerCase().includes(search.toLowerCase()) ||
                          m.material?.toLowerCase().includes(search.toLowerCase()) ||
                          m.client?.toLowerCase().includes(search.toLowerCase());
      return matchesFilter && matchesSearch;
    });
  }, [machines, filter, search, excludeBous]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
      </div>
    );
  }

  return (
    <div className="space-y-4 h-full flex flex-col">
      {/* Dashboard Header */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <StatCard 
          label="Total Machines" 
          value={stats.total} 
          icon={Activity} 
          color="bg-slate-100 text-slate-700" 
          onClick={() => setFilter('ALL')}
          active={filter === 'ALL'}
        />
        <StatCard 
          label="Working" 
          value={stats.working} 
          icon={CheckCircle2} 
          color="bg-emerald-100 text-emerald-700" 
          onClick={() => setFilter('WORKING')}
          active={filter === 'WORKING'}
        />
        <StatCard 
          label="Changeover" 
          value={stats.changeover} 
          icon={Clock} 
          color="bg-amber-100 text-amber-700" 
          onClick={() => setFilter('CHANGEOVER')}
          active={filter === 'CHANGEOVER'}
        />
        <StatCard 
          label="Stopped" 
          value={stats.stopped} 
          icon={AlertCircle} 
          color="bg-rose-100 text-rose-700" 
          onClick={() => setFilter('STOPPED')}
          active={filter === 'STOPPED'}
        />
        
        {/* Wide Efficiency Card */}
        <div className="p-3 rounded-xl border border-indigo-100 bg-indigo-50/50 flex flex-col justify-center">
          <p className="text-xs font-medium text-indigo-600 uppercase tracking-wider mb-1">Wide Efficiency</p>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-bold text-indigo-900">{stats.widePercentage}%</span>
            <span className="text-xs text-indigo-700 font-medium">({stats.wideWorking}/{stats.wideTotal})</span>
          </div>
          <div className="w-full bg-indigo-200 rounded-full h-1.5 mt-2">
            <div className="bg-indigo-600 h-1.5 rounded-full transition-all duration-500" style={{ width: `${stats.widePercentage}%` }}></div>
          </div>
        </div>
      </div>

      {/* Toolbar */}
      <div className="flex gap-2 items-center bg-white p-2 rounded-lg border border-slate-200 shadow-sm">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input 
            type="text" 
            placeholder="Search machines..." 
            className="w-full pl-8 pr-3 py-1.5 text-sm border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        
        <div className="flex items-center gap-2 px-3 border-l border-slate-200">
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <div className={`w-4 h-4 rounded border flex items-center justify-center transition-colors ${excludeBous ? 'bg-indigo-600 border-indigo-600' : 'bg-white border-slate-300'}`}>
              {excludeBous && <CheckCircle2 className="w-3 h-3 text-white" />}
            </div>
            <input 
              type="checkbox" 
              className="hidden" 
              checked={excludeBous} 
              onChange={(e) => setExcludeBous(e.target.checked)} 
            />
            <span className="text-sm text-slate-600 font-medium">Exclude BOUS</span>
          </label>
        </div>

        <div className="flex-1"></div>
        <div className="text-xs text-slate-500 font-medium">
          Showing {filteredMachines.length} machines
        </div>
      </div>

      {/* Grid */}
      <div className="flex-1 overflow-y-auto min-h-0">
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-2 pb-4">
          {filteredMachines.map(machine => (
            <CompactMachineCard key={machine.id} machine={machine} />
          ))}
        </div>
      </div>
    </div>
  );
};

const StatCard = ({ label, value, icon: Icon, color, onClick, active }: any) => (
  <button 
    onClick={onClick}
    className={`p-3 rounded-xl border transition-all text-left flex items-center justify-between group ${
      active ? 'ring-2 ring-indigo-500 border-transparent shadow-md' : 'border-slate-200 hover:border-indigo-300 hover:shadow-sm bg-white'
    }`}
  >
    <div>
      <p className="text-xs font-medium text-slate-500 uppercase tracking-wider">{label}</p>
      <p className="text-2xl font-bold text-slate-800 mt-0.5">{value}</p>
    </div>
    <div className={`p-2 rounded-lg ${color} group-hover:scale-110 transition-transform`}>
      <Icon className="w-5 h-5" />
    </div>
  </button>
);

const CompactMachineCard = ({ machine }: { machine: MachineRow }) => {
  const isWorking = machine.status === MachineStatus.WORKING;
  const isChangeover = machine.status === MachineStatus.QALB;
  const isStopped = machine.status === MachineStatus.OUT_OF_SERVICE || machine.status === MachineStatus.NO_ORDER || machine.status === MachineStatus.OTHER;

  let statusColor = "bg-slate-50 border-slate-200";
  let statusIndicator = "bg-slate-400";
  
  if (isWorking) {
    statusColor = "bg-white border-emerald-200 shadow-sm";
    statusIndicator = "bg-emerald-500";
  } else if (isChangeover) {
    statusColor = "bg-amber-50/50 border-amber-200";
    statusIndicator = "bg-amber-500";
  } else if (isStopped) {
    statusColor = "bg-rose-50/50 border-rose-200";
    statusIndicator = "bg-rose-500";
  }

  return (
    <div className={`border rounded-lg p-2.5 flex flex-col gap-2 transition-all hover:shadow-md ${statusColor}`}>
      <div className="flex justify-between items-start">
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${statusIndicator} animate-pulse`} />
          <span className="font-bold text-slate-700 text-sm">{machine.machineName}</span>
        </div>
        <span className="text-[10px] font-mono text-slate-400">{machine.brand}</span>
      </div>

      <div className="space-y-1">
        {isWorking ? (
          <>
            <div className="bg-slate-50 rounded px-1.5 py-1 border border-slate-100">
              <p className="text-[10px] text-slate-400 uppercase font-bold">Client</p>
              <p className="text-xs font-medium text-slate-700 truncate" title={machine.client}>{machine.client || '-'}</p>
            </div>
            <div className="bg-slate-50 rounded px-1.5 py-1 border border-slate-100">
              <p className="text-[10px] text-slate-400 uppercase font-bold">Fabric</p>
              <p className="text-xs font-medium text-slate-700 truncate" title={machine.material}>{machine.material || '-'}</p>
            </div>
            <div className="flex justify-between items-end mt-1">
              <span className="text-[10px] text-slate-400">Rem:</span>
              <span className="text-xs font-bold text-emerald-700">{machine.remainingMfg} kg</span>
            </div>
          </>
        ) : (
          <div className="h-[4.5rem] flex items-center justify-center text-center p-1">
            <p className="text-xs font-medium text-slate-500">
              {isChangeover ? 'Changeover' : machine.status}
            </p>
          </div>
        )}
      </div>
    </div>
  );
};
