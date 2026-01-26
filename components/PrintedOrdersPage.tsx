import React, { useState, useEffect, useMemo } from 'react';
import { 
  collection, 
  query, 
  orderBy, 
  onSnapshot,
  where,
  limit
} from 'firebase/firestore';
import { db } from '../services/firebase';
import { ProductionTicket } from '../types';
import { 
  Search, 
  Calendar, 
  Filter, 
  Printer, 
  Clock, 
  CheckCircle2, 
  XCircle, 
  AlertCircle,
  FileText,
  User,
  Hash,
  ArrowUpRight,
  ChevronDown,
  ChevronUp
} from 'lucide-react';

interface PrintedOrdersPageProps {
  onNavigateToOrder?: (orderId: string) => void;
}

export const PrintedOrdersPage: React.FC<PrintedOrdersPageProps> = ({ onNavigateToOrder }) => {
  const [tickets, setTickets] = useState<ProductionTicket[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'All' | 'In Production' | 'Finished' | 'Cancelled'>('All');
  const [dateFilter, setDateFilter] = useState<string>('all'); // 'all', 'today', 'week', 'month'

  // Fetch Tickets
  useEffect(() => {
    // Basic query for recent tickets (limit to last 200 for performance initially)
    const q = query(
      collection(db, 'ProductionTickets'),
      orderBy('printedAt', 'desc'),
      limit(200)
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
    return tickets.filter(ticket => {
      // Status Filter
      if (statusFilter !== 'All' && ticket.status !== statusFilter) return false;

      // Text Search
      const searchLower = searchTerm.toLowerCase();
      const matchesSearch = 
        ticket.customerName?.toLowerCase().includes(searchLower) ||
        ticket.fabricName?.toLowerCase().includes(searchLower) ||
        ticket.printedBy?.toLowerCase().includes(searchLower) ||
        ticket.ticketNumber?.toLowerCase().includes(searchLower) ||
        ticket.id?.toLowerCase().includes(searchLower);

      if (!matchesSearch) return false;

      // Date Filter
      if (dateFilter !== 'all') {
        const ticketDate = new Date(ticket.printedAt);
        const now = new Date();
        const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        
        if (dateFilter === 'today') {
          if (ticketDate < startOfDay) return false;
        } else if (dateFilter === 'week') {
            const lastWeek = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
            if (ticketDate < lastWeek) return false;
        }
      }

      return true;
    });
  }, [tickets, searchTerm, statusFilter, dateFilter]);

  // Group by Date for UI
  const groupedTickets = useMemo(() => {
    const groups: Record<string, ProductionTicket[]> = {};
    
    filteredTickets.forEach(ticket => {
      const date = new Date(ticket.printedAt).toLocaleDateString('en-GB', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
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
      total: tickets.length,
      active: tickets.filter(t => t.status === 'In Production').length,
      today: tickets.filter(t => {
        const ticketDate = new Date(t.printedAt);
        const now = new Date();
        return ticketDate.getDate() === now.getDate() && 
               ticketDate.getMonth() === now.getMonth() && 
               ticketDate.getFullYear() === now.getFullYear();
      }).length
    };
  }, [tickets]);

  return (
    <div className="min-h-screen bg-slate-50 pb-20">
      {/* Header & Stats */}
      <div className="bg-white border-b border-slate-200 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-3">
                <Printer className="w-8 h-8 text-indigo-600" />
                Printed Orders Log
              </h1>
              <p className="text-sm text-slate-500 mt-1">
                Track and manage all production tickets generated from orders.
              </p>
            </div>
            
            {/* KPI Cards */}
            <div className="flex gap-4">
              <div className="bg-indigo-50 border border-indigo-100 rounded-lg px-4 py-2">
                <div className="text-xs font-semibold text-indigo-600 uppercase tracking-wider">Today</div>
                <div className="text-2xl font-bold text-indigo-900">{stats.today}</div>
              </div>
              <div className="bg-emerald-50 border border-emerald-100 rounded-lg px-4 py-2">
                <div className="text-xs font-semibold text-emerald-600 uppercase tracking-wider">Active</div>
                <div className="text-2xl font-bold text-emerald-900">{stats.active}</div>
              </div>
            </div>
          </div>

          {/* Controls Bar */}
          <div className="mt-6 flex flex-col sm:flex-row gap-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-5 h-5" />
              <input
                type="text"
                placeholder="Search tickets, customers, fabrics, users..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-10 pr-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
              />
            </div>
            
            <div className="flex gap-2 overflow-x-auto pb-2 sm:pb-0">
               <select 
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as any)}
                className="border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 bg-white"
               >
                 <option value="All">All Status</option>
                 <option value="In Production">In Production</option>
                 <option value="Finished">Finished</option>
                 <option value="Cancelled">Cancelled</option>
               </select>

               <select 
                value={dateFilter}
                onChange={(e) => setDateFilter(e.target.value)}
                className="border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 bg-white"
               >
                 <option value="all">All Time</option>
                 <option value="today">Today</option>
                 <option value="week">This Week</option>
               </select>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {loading ? (
             <div className="flex items-center justify-center py-20">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600"></div>
             </div>
        ) : filteredTickets.length === 0 ? (
            <div className="text-center py-20 bg-white rounded-xl border border-dashed border-slate-300">
                <Printer className="w-16 h-16 text-slate-300 mx-auto mb-4" />
                <h3 className="text-lg font-medium text-slate-900">No tickets found</h3>
                <p className="text-slate-500">Try adjusting your filters or search terms.</p>
            </div>
        ) : (
            <div className="space-y-8">
                {Object.entries(groupedTickets).map(([date, dateTickets]) => (
                    <div key={date}>
                        <div className="flex items-center gap-2 mb-4">
                            <Calendar className="w-5 h-5 text-slate-400" />
                            <h3 className="text-lg font-semibold text-slate-800">{date}</h3>
                            <span className="text-xs font-medium bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full">
                                {dateTickets.length}
                            </span>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                            {dateTickets.map((ticket) => (
                                <TicketCard key={ticket.id} ticket={ticket} />
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

const TicketCard: React.FC<{ ticket: ProductionTicket }> = ({ ticket }) => {
    const isNew = (Date.now() - new Date(ticket.printedAt).getTime()) < 1000 * 60 * 60; // < 1 hour old

    return (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm hover:shadow-md transition-shadow duration-200 overflow-hidden flex flex-col">
            <div className="p-5 flex-1">
                <div className="flex justify-between items-start mb-3">
                    <div className="flex items-center gap-2">
                         <span className={`inline-flex items-center px-2 py-1 rounded text-xs font-medium 
                            ${ticket.status === 'In Production' ? 'bg-amber-100 text-amber-800' : 
                              ticket.status === 'Finished' ? 'bg-emerald-100 text-emerald-800' : 
                              'bg-slate-100 text-slate-600'}`}>
                            {ticket.status}
                         </span>
                         {isNew && (
                             <span className="inline-flex items-center px-2 py-1 rounded text-xs font-medium bg-blue-100 text-blue-800 animate-pulse">
                                New
                             </span>
                         )}
                    </div>
                    <span className="text-xs text-slate-400 font-mono">
                        {new Date(ticket.printedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                </div>

                <h4 className="font-bold text-lg text-slate-900 mb-1 truncate" title={ticket.customerName}>
                    {ticket.customerName}
                </h4>
                <div className="text-sm font-medium text-indigo-600 mb-4 truncate" title={ticket.fabricName}>
                    {ticket.fabricName}
                </div>

                <div className="space-y-2 text-sm text-slate-600">
                    <div className="flex justify-between items-center py-1 border-b border-slate-50">
                        <span className="flex items-center gap-2 text-slate-400">
                            <Hash className="w-4 h-4" />
                            Required Qty
                        </span>
                        <span className="font-medium text-slate-900">{ticket.snapshot.requiredQty?.toLocaleString()} kg</span>
                    </div>
                    
                    <div className="flex justify-between items-start py-1 border-b border-slate-50">
                        <span className="flex items-center gap-2 text-slate-400 mt-0.5">
                            <Hash className="w-4 h-4" />
                            Machines
                        </span>
                        <div className="text-right">
                             {ticket.snapshot.activeMachines.length > 0 ? (
                                <div className="flex flex-wrap justify-end gap-1">
                                    {ticket.snapshot.activeMachines.slice(0, 3).map(m => (
                                        <span key={m} className="px-1.5 py-0.5 bg-slate-100 text-slate-600 text-[10px] rounded">
                                            {m}
                                        </span>
                                    ))}
                                    {ticket.snapshot.activeMachines.length > 3 && (
                                        <span className="px-1.5 py-0.5 bg-slate-100 text-slate-500 text-[10px] rounded">
                                            +{ticket.snapshot.activeMachines.length - 3}
                                        </span>
                                    )}
                                </div>
                             ) : (
                                 <span className="text-slate-400 italic">None assigned</span>
                             )}
                        </div>
                    </div>
                </div>
            </div>

            <div className="bg-slate-50 px-5 py-3 border-t border-slate-100 flex justify-between items-center">
                <div className="flex items-center gap-2 text-xs text-slate-500">
                    <User className="w-3 h-3" />
                    <span className="font-medium">{ticket.printedBy || 'Unknown'}</span>
                </div>
                {/* Future: Add Action Buttons here like 'Reprint' or 'View Snapshot' */}
            </div>
        </div>
    );
};