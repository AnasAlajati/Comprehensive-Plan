import React, { useState, useEffect, useMemo, useRef } from 'react';
import { collectionGroup, getDocs } from 'firebase/firestore';
import { db } from '../services/firebase';
import { DataService } from '../services/dataService';
import { X, Search, FileText } from 'lucide-react';

/**
 * A narrow, selection-only picker: season -> client -> fabric/order.
 * Deliberately does NOT expose the full Orders page (editing, dyeing plans,
 * machine assignment, etc.) — just enough to pick which order a report is for.
 */
interface Props {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (order: { id: string; material: string; requiredQty: number; remainingQty: number }, clientName: string) => void;
}

export const OrderPickerModal: React.FC<Props> = ({ isOpen, onClose, onSelect }) => {
  const [flatOrders, setFlatOrders] = useState<any[]>([]);
  const [clients, setClients] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const [season, setSeason] = useState<string>('');
  const [clientId, setClientId] = useState<string>('');
  const [orderId, setOrderId] = useState<string>('');
  const [search, setSearch] = useState('');
  const loadedRef = useRef(false);

  useEffect(() => {
    if (!isOpen || loadedRef.current) return;
    loadedRef.current = true;
    setLoading(true);
    Promise.all([
      getDocs(collectionGroup(db, 'orders')),
      DataService.getClients(),
    ]).then(([ordersSnap, clientList]) => {
      const orders = ordersSnap.docs.map(d => ({
        id: d.id, ...d.data(), customerId: d.ref.parent.parent?.id,
      }));
      setFlatOrders(orders);
      setClients(clientList.map(c => ({ id: c.id || c.clientId, name: c.name })));
    }).finally(() => setLoading(false));
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) {
      loadedRef.current = false;
      setSeason(''); setClientId(''); setOrderId(''); setSearch('');
    }
  }, [isOpen]);

  // Firestore doesn't cascade-delete a client's `orders` subcollection when the
  // CustomerSheets doc itself is deleted, so orphaned orders can outlive their
  // client. Cross-reference against real, existing clients so a deleted client's
  // leftover orders can't leak a stale season/client/order into the picker.
  const liveOrders = useMemo(() => {
    const validCustomerIds = new Set(clients.map(c => c.id));
    return flatOrders.filter(o => o.customerId && validCustomerIds.has(o.customerId) && o.material);
  }, [flatOrders, clients]);

  const seasonOptions = useMemo(() => {
    const seen = new Map<string, string>();
    liveOrders.forEach(o => {
      if (o.seasonId && !seen.has(o.seasonId)) seen.set(o.seasonId, o.seasonName || o.seasonId);
    });
    return Array.from(seen.entries()).map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [liveOrders]);

  const orderMatchesSeason = (o: any) => !season || o.seasonId === season;

  // Only clients with at least one live order (matching the season, if one is picked).
  const filteredClients = useMemo(() => {
    const list = clients.filter(c => liveOrders.some(o => o.customerId === c.id && orderMatchesSeason(o)));
    return list.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  }, [clients, liveOrders, season]);

  const clientOrders = useMemo(() => {
    if (!clientId) return [];
    const term = search.trim().toLowerCase();
    return liveOrders
      .filter(o => o.customerId === clientId && orderMatchesSeason(o))
      .filter(o => !term || o.material.toLowerCase().includes(term) || o.id.toLowerCase().includes(term));
  }, [flatOrders, clientId, season, search]);

  const selectedOrder = clientOrders.find(o => o.id === orderId);
  const selectedClientName = clients.find(c => c.id === clientId)?.name || '';
  const canApply = !!selectedOrder;

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/60 z-[9999] flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md flex flex-col overflow-hidden max-h-[85vh]" onClick={e => e.stopPropagation()} dir="rtl">
        {/* Header */}
        <div className="bg-gradient-to-r from-indigo-600 to-purple-600 px-5 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2 text-white">
            <FileText size={18} />
            <span className="font-bold">إنشاء تقرير جديد</span>
          </div>
          <button onClick={onClose} className="text-white/80 hover:text-white"><X size={20} /></button>
        </div>

        <div className="p-5 space-y-4 overflow-y-auto flex-1">
          {loading ? (
            <div className="py-10 text-center text-sm text-slate-400">جارٍ التحميل...</div>
          ) : (
            <>
              {seasonOptions.length > 0 && (
                <div>
                  <label className="text-xs font-bold text-slate-500 uppercase tracking-wide">الموسم</label>
                  <div className="flex flex-wrap gap-2 mt-1.5">
                    {seasonOptions.map(s => (
                      <button key={s.id}
                        onClick={() => { setSeason(s.id === season ? '' : s.id); setClientId(''); setOrderId(''); }}
                        className={`px-3 py-1.5 rounded-full text-sm font-medium border transition-colors ${
                          season === s.id ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-slate-600 border-slate-200 hover:border-indigo-300'
                        }`}>
                        {s.name}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div>
                <label className="text-xs font-bold text-slate-500 uppercase tracking-wide">العميل</label>
                <select value={clientId} onChange={e => { setClientId(e.target.value); setOrderId(''); }}
                  className="w-full mt-1.5 px-3 py-2 rounded-lg border border-slate-200 bg-slate-50 focus:bg-white focus:border-indigo-400 outline-none text-sm">
                  <option value="">اختر عميل...</option>
                  {filteredClients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>

              {clientId && (
                <div>
                  <label className="text-xs font-bold text-slate-500 uppercase tracking-wide">الخامة / الطلبية</label>
                  <div className="relative mt-1.5">
                    <Search size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-300" />
                    <input value={search} onChange={e => setSearch(e.target.value)} placeholder="بحث..."
                      className="w-full pr-9 pl-3 py-2 rounded-lg border border-slate-200 bg-slate-50 focus:bg-white focus:border-indigo-400 outline-none text-sm" />
                  </div>
                  <div className="flex flex-col gap-1.5 max-h-52 overflow-y-auto mt-2 pl-1">
                    {clientOrders.length === 0 && (
                      <div className="text-xs text-slate-400 text-center py-4">لا توجد طلبيات لهذا العميل</div>
                    )}
                    {clientOrders.map(o => {
                      const isSelected = orderId === o.id;
                      return (
                        <button key={o.id} onClick={() => setOrderId(o.id)}
                          className={`text-right px-3 py-2 rounded-lg border text-sm transition-colors ${
                            isSelected ? 'bg-indigo-50 border-indigo-300' : 'bg-white border-slate-200 hover:border-indigo-200'
                          }`}>
                          <div className="font-semibold text-slate-800">{o.material}</div>
                          <div className="flex gap-3 mt-1 flex-wrap text-[11px] text-slate-400">
                            <span className="font-mono">#{o.id.slice(0, 8)}</span>
                            {o.requiredQty > 0 && <span>مطلوب: {Number(o.requiredQty).toLocaleString()} كجم</span>}
                            {o.remainingQty > 0 && <span>متبقي: {Number(o.remainingQty).toLocaleString()} كجم</span>}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {selectedOrder && (
                <div className="bg-gradient-to-r from-indigo-50 to-purple-50 border border-indigo-200 rounded-xl px-4 py-3">
                  <p className="text-[10px] text-indigo-500 font-bold uppercase mb-1">سيتم إنشاء التقرير لـ</p>
                  <p className="text-sm font-bold text-indigo-800">{selectedClientName}</p>
                  <p className="text-xs text-indigo-600">{selectedOrder.material}</p>
                </div>
              )}
            </>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-slate-100 bg-slate-50">
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-100">إلغاء</button>
          <button
            disabled={!canApply}
            onClick={() => {
              if (!selectedOrder) return;
              onSelect(
                { id: selectedOrder.id, material: selectedOrder.material, requiredQty: selectedOrder.requiredQty || 0, remainingQty: selectedOrder.remainingQty || 0 },
                selectedClientName,
              );
            }}
            className={`px-4 py-2 rounded-lg text-sm font-bold text-white transition-colors ${
              canApply ? 'bg-indigo-600 hover:bg-indigo-700' : 'bg-slate-300 cursor-not-allowed'
            }`}
          >
            إنشاء التقرير
          </button>
        </div>
      </div>
    </div>
  );
};
