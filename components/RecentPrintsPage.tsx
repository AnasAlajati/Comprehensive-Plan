import React, { useState, useEffect, useMemo } from 'react';
import { collection, query, orderBy, onSnapshot, limit, doc, getDoc } from 'firebase/firestore';
import { db } from '../services/firebase';
import { ProductionTicket, MachineRow } from '../types';
import {
  Printer,
  Calendar,
  Filter,
  Search,
  Clock,
  User,
  Package,
  Zap,
  TrendingUp,
  AlertCircle,
  CheckCircle,
} from 'lucide-react';

interface RecentPrintsPageProps {
  machines?: MachineRow[];
  selectedDate?: string;
  onNavigateToOrder?: (order: any) => void;
}

export const RecentPrintsPage: React.FC<RecentPrintsPageProps> = ({ machines = [], selectedDate, onNavigateToOrder }) => {
  const [tickets, setTickets] = useState<ProductionTicket[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [dayFilter, setDayFilter] = useState<string>('all'); // 'all', 'today', '3days', '7days', 'custom'
  const [activeDay, setActiveDay] = useState<string>('');

  // Fetch active day on mount
  useEffect(() => {
    const fetchActiveDay = async () => {
      try {
        const settingsDoc = await getDoc(doc(db, 'settings', 'global'));
        if (settingsDoc.exists()) {
          const data = settingsDoc.data();
          if (data.activeDay) {
            setActiveDay(data.activeDay);
          }
        }
      } catch (error) {
        console.error("Error fetching active day:", error);
      }
    };
    fetchActiveDay();
  }, []);

  // Fetch Recent Tickets
  useEffect(() => {
    const q = query(
      collection(db, 'ProductionTickets'),
      orderBy('printedAt', 'desc'),
      limit(500)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const fetchedTickets = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      } as ProductionTicket));
      setTickets(fetchedTickets);
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  // Filter Logic
  const filteredTickets = useMemo(() => {
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    return tickets.filter(ticket => {
      // Search Filter
      const searchLower = searchTerm.toLowerCase();
      const matchesSearch =
        ticket.customerName?.toLowerCase().includes(searchLower) ||
        ticket.fabricName?.toLowerCase().includes(searchLower) ||
        ticket.printedBy?.toLowerCase().includes(searchLower) ||
        ticket.color?.toLowerCase().includes(searchLower);

      if (!matchesSearch) return false;

      // Day Filter
      if (dayFilter !== 'all') {
        const ticketDate = new Date(ticket.printedAt);
        const daysDiff = Math.floor((now.getTime() - ticketDate.getTime()) / (1000 * 60 * 60 * 24));

        switch (dayFilter) {
          case 'today':
            return ticketDate >= startOfToday;
          case '3days':
            return daysDiff < 3;
          case '7days':
            return daysDiff < 7;
          default:
            return true;
        }
      }

      return true;
    });
  }, [tickets, searchTerm, dayFilter]);

  // Group by Day
  const groupedByDay = useMemo(() => {
    const groups: Record<string, ProductionTicket[]> = {};

    filteredTickets.forEach(ticket => {
      const date = new Date(ticket.printedAt).toLocaleDateString('en-GB', {
        weekday: 'short',
        year: 'numeric',
        month: 'short',
        day: 'numeric'
      });

      if (!groups[date]) groups[date] = [];
      groups[date].push(ticket);
    });

    return groups;
  }, [filteredTickets]);

  // Statistics
  const stats = useMemo(() => {
    return {
      totalPrints: filteredTickets.length,
      daysRepresented: Object.keys(groupedByDay).length,
      totalQty: filteredTickets.reduce((sum, t) => sum + (t.snapshot?.requiredQty || 0), 0),
      inProduction: filteredTickets.filter(t => t.status === 'In Production').length
    };
  }, [filteredTickets, groupedByDay]);

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <div className="sticky top-0 z-20 bg-white border-b border-slate-200 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 mb-6">
            <div>
              <h1 className="text-4xl font-black text-slate-900 flex items-center gap-3">
                <div className="p-2 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-lg">
                  <Printer className="w-8 h-8 text-white" />
                </div>
                Recent Production Prints
              </h1>
              <p className="text-slate-500 mt-2">Track and review all production orders printed today and earlier</p>
            </div>

            {/* KPI Cards */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="bg-gradient-to-br from-indigo-50 to-indigo-100 border border-indigo-200 rounded-lg p-4">
                <div className="text-xs text-indigo-700 font-semibold uppercase tracking-wider mb-1">Total Prints</div>
                <div className="text-2xl font-bold text-indigo-900">{stats.totalPrints}</div>
              </div>
              <div className="bg-gradient-to-br from-emerald-50 to-emerald-100 border border-emerald-200 rounded-lg p-4">
                <div className="text-xs text-emerald-700 font-semibold uppercase tracking-wider mb-1">In Production</div>
                <div className="text-2xl font-bold text-emerald-900">{stats.inProduction}</div>
              </div>
              <div className="bg-gradient-to-br from-amber-50 to-amber-100 border border-amber-200 rounded-lg p-4">
                <div className="text-xs text-amber-700 font-semibold uppercase tracking-wider mb-1">Days</div>
                <div className="text-2xl font-bold text-amber-900">{stats.daysRepresented}</div>
              </div>
              <div className="bg-gradient-to-br from-cyan-50 to-cyan-100 border border-cyan-200 rounded-lg p-4">
                <div className="text-xs text-cyan-700 font-semibold uppercase tracking-wider mb-1">Total Qty (kg)</div>
                <div className="text-2xl font-bold text-cyan-900">{stats.totalQty.toLocaleString()}</div>
              </div>
            </div>
          </div>

          {/* Filters */}
          <div className="flex flex-col sm:flex-row gap-3 items-center">
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
              <input
                type="text"
                placeholder="Search by customer, fabric, color, or user..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-10 pr-4 py-2.5 bg-white border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent text-slate-900 placeholder-slate-500 transition-all"
              />
            </div>

            <div className="flex gap-2 flex-wrap">
              {['all', 'today', '3days', '7days'].map(filter => (
                <button
                  key={filter}
                  onClick={() => setDayFilter(filter)}
                  className={`px-4 py-2.5 rounded-lg font-medium transition-all flex items-center gap-2 ${
                    dayFilter === filter
                      ? 'bg-indigo-600 text-white shadow-lg'
                      : 'bg-slate-100 text-slate-700 border border-slate-300 hover:bg-slate-50'
                  }`}
                >
                  <Calendar className="w-4 h-4" />
                  {filter === 'all' ? 'All Time' : filter === 'today' ? 'Today' : filter === '3days' ? 'Last 3 Days' : 'Last 7 Days'}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        {loading ? (
          <div className="flex items-center justify-center py-32">
            <div className="relative w-16 h-16">
              <div className="absolute inset-0 bg-gradient-to-r from-indigo-500 to-purple-600 rounded-full animate-spin"></div>
              <div className="absolute inset-2 bg-white rounded-full"></div>
            </div>
          </div>
        ) : filteredTickets.length === 0 ? (
          <div className="text-center py-24">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-slate-100 mb-4">
              <Printer className="w-8 h-8 text-slate-400" />
            </div>
            <h3 className="text-xl font-semibold text-slate-900 mb-2">No prints found</h3>
            <p className="text-slate-500">Try adjusting your filters or search terms.</p>
          </div>
        ) : (
          <div className="space-y-10">
            {Object.entries(groupedByDay).map(([date, dayTickets]: [string, ProductionTicket[]]) => (
              <div key={date}>
                {/* Day Header */}
                <div className="flex items-center gap-4 mb-6">
                  <div className="flex-1 h-px bg-gradient-to-r from-slate-300 to-transparent"></div>
                  <div className="flex items-center gap-3 px-4 py-2 bg-slate-100 border border-slate-300 rounded-full">
                    <Calendar className="w-5 h-5 text-indigo-600" />
                    <span className="font-bold text-slate-900">{date}</span>
                    <span className="text-sm text-slate-600 font-medium bg-white px-2 py-0.5 rounded-full border border-slate-200">
                      {dayTickets.length}
                    </span>
                  </div>
                  <div className="flex-1 h-px bg-gradient-to-l from-slate-300 to-transparent"></div>
                </div>

                {/* Report Cards Grid */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {dayTickets.map(ticket => (
                    <ReportCard
                      key={ticket.id}
                      ticket={ticket}
                      machines={machines}
                      activeDay={activeDay}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

const ReportCard: React.FC<{
  ticket: ProductionTicket;
  machines: MachineRow[];
  activeDay: string;
}> = ({ ticket, machines, activeDay }) => {
  const printTime = new Date(ticket.printedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const printDate = new Date(ticket.printedAt).toLocaleDateString('en-GB');
  const isNew = (Date.now() - new Date(ticket.printedAt).getTime()) < 1000 * 60 * 60; // < 1 hour

  // Check if this order is currently being worked on
  const isCurrentlyWorking = useMemo(() => {
    if (!activeDay || !machines.length) return false;
    
    const normalize = (s: string) => s ? s.trim().toLowerCase() : '';
    const ticketClient = normalize(ticket.customerName);
    const ticketFabric = normalize(ticket.fabricName);
    
    return machines.some(machine => {
      const activeLog = machine.dailyLogs?.find(l => l.date === activeDay);
      if (!activeLog) return false;
      
      const logClient = normalize(activeLog.client);
      const logFabric = normalize(activeLog.fabric);
      
      return logClient === ticketClient && logFabric === ticketFabric;
    });
  }, [machines, activeDay, ticket]);

  // Calculate remaining quantity from active day log
  const remainingQty = useMemo(() => {
    if (!activeDay) return null;
    
    const normalize = (s: string) => s ? s.trim().toLowerCase() : '';
    const ticketClient = normalize(ticket.customerName);
    const ticketFabric = normalize(ticket.fabricName);
    
    for (const machine of machines) {
      const activeLog = machine.dailyLogs?.find(l => l.date === activeDay);
      if (activeLog) {
        const logClient = normalize(activeLog.client);
        const logFabric = normalize(activeLog.fabric);
        
        if (logClient === ticketClient && logFabric === ticketFabric) {
          // Try both 'remaining' and 'remainingMfg' fields
          return activeLog.remaining !== undefined ? activeLog.remaining : (activeLog.remainingMfg || null);
        }
      }
    }
    return null;
  }, [machines, activeDay, ticket]);

  const statusConfig = {
    'In Production': { 
      bg: 'bg-white', 
      border: 'border-l-4 border-l-amber-500 border-y border-r border-slate-200', 
      text: 'text-amber-700', 
      badge: 'bg-amber-100/80 text-amber-800' 
    },
    'Finished': { 
      bg: 'bg-white', 
      border: 'border-l-4 border-l-emerald-500 border-y border-r border-slate-200', 
      text: 'text-emerald-700', 
      badge: 'bg-emerald-100/80 text-emerald-800' 
    },
    'Cancelled': { 
      bg: 'bg-white', 
      border: 'border-l-4 border-l-red-500 border-y border-r border-slate-200', 
      text: 'text-red-700', 
      badge: 'bg-red-100/80 text-red-800' 
    }
  };

  const config = statusConfig[ticket.status as keyof typeof statusConfig] || statusConfig['In Production'];

  return (
    <div className={`group relative ${config.bg} ${config.border} rounded-xl shadow-sm hover:shadow-md transition-all duration-200`}>
      {/* Accent Line removed, using left border instead for cleaner look */}

      {/* Card Content */}
      <div className="p-5">
        {/* Header: Customer + Fabric + Machines + Status */}
        <div className="flex items-start justify-between mb-4">
          <div className="flex-1 min-w-0 pr-2">
            <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-1 flex items-center gap-2">
              <span className="truncate">{ticket.customerName}</span>
              {ticket.color && (
                <>
                  <span className="w-1 h-1 rounded-full bg-slate-300"></span>
                  <span className="text-slate-400 font-normal capitalize">{ticket.color}</span>
                </>
              )}
            </h3>
            <p className="text-base font-extrabold text-slate-800 leading-tight line-clamp-2">{ticket.fabricName}</p>
            
            {/* Planned Machines - More subtle */}
            {ticket.snapshot?.plannedMachines && ticket.snapshot.plannedMachines.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-2.5">
                {ticket.snapshot.plannedMachines.map(m => (
                  <span key={m} className="px-2 py-0.5 bg-slate-100 text-slate-600 text-[10px] font-bold uppercase rounded border border-slate-200">
                    {m}
                  </span>
                ))}
              </div>
            )}
          </div>
          
          {/* Status Column */}
          <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
            <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-[10px] font-bold ${config.badge} uppercase tracking-wide`}>
              {ticket.status}
            </span>
            
            {isCurrentlyWorking && (
                 <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-600 bg-emerald-50 px-2 py-1 rounded-full border border-emerald-100">
                  <CheckCircle className="w-3 h-3" />
                  Working
                 </span>
            )}

            {isNew && (
              <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold text-blue-600 bg-blue-50">
                NEW
              </span>
            )}
          </div>
        </div>

        {/* Updated Divider */}
        <div className="h-px bg-slate-100 my-4 w-full" />

        {/* Required Qty */}
        <div className="flex items-baseline justify-between mb-4">
             <span className="text-xs font-semibold text-slate-400 uppercase">Required Qty</span>
             <span className="text-xl font-bold text-slate-900 tracking-tight">
                {ticket.snapshot?.requiredQty?.toLocaleString()} <span className="text-sm font-medium text-slate-400 ml-0.5">kg</span>
             </span>
        </div>

        {/* Details Section */}
        <div className="space-y-3">
          {/* Remaining Quantity (Active) */}
          {remainingQty !== null && (
            <div className="bg-gradient-to-r from-blue-50 to-indigo-50/50 border border-blue-100 rounded-lg p-3">
              <div className="flex items-center justify-between mb-1">
                 <h4 className="text-[10px] font-bold text-blue-500 uppercase tracking-wider">Remaining (Log)</h4>
                 {isCurrentlyWorking && <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></div>}
              </div>
              <div className="text-2xl font-bold text-blue-700 leading-none">
                 {remainingQty.toLocaleString()} <span className="text-sm font-medium text-blue-400">kg</span>
              </div>
            </div>
          )}

          {/* Notes - more subtle */}
          {ticket.snapshot?.notes && (
            <div className="bg-amber-50/50 border border-amber-100 rounded p-2 text-xs text-amber-900 italic">
               "{ticket.snapshot.notes}"
            </div>
          )}

          {/* Footer Metadata - Clean Row */}
          <div className="pt-3 mt-1 flex items-center justify-between text-xs text-slate-400 border-t border-slate-50">
            <div className="flex items-center gap-3">
                <span className="flex items-center gap-1.5" title="Print Time">
                    <Clock className="w-3.5 h-3.5 text-slate-300" />
                    {printTime}
                </span>
                <span className="w-px h-3 bg-slate-200"></span>
                <span className="flex items-center gap-1.5" title="Printed By">
                    <User className="w-3.5 h-3.5 text-slate-300" />
                    <span className="font-medium text-slate-600">{ticket.printedBy || 'Unknown'}</span>
                </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
