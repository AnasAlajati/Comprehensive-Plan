import React, { useState, useEffect, useMemo, useRef } from 'react';
import { collection, collectionGroup, getDocs } from 'firebase/firestore';
import { db } from '../services/firebase';
import { DataService } from '../services/dataService';
import { X } from 'lucide-react';

/**
 * A narrow, selection-only picker: season -> client -> fabric/order.
 * Deliberately does NOT expose the full Orders page (editing, dyeing plans,
 * machine assignment, etc.) — just enough to pick which order a report is for.
 *
 * Mirrors the "Link Order to Schedule" picker in PlanningSchedule.tsx
 * (season pills -> gated client select -> gated order cards -> preview ->
 * Cancel/Apply) so both pickers in the app look and behave the same way.
 */
interface Props {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (order: { id: string; material: string; requiredQty: number; remainingQty: number }, clientName: string) => void;
}

export const OrderPickerModal: React.FC<Props> = ({ isOpen, onClose, onSelect }) => {
  const [flatOrders, setFlatOrders] = useState<any[]>([]);
  const [clients, setClients] = useState<{ id: string; name: string }[]>([]);
  const [seasonOptions, setSeasonOptions] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const [season, setSeason] = useState<string>('');
  const [clientId, setClientId] = useState<string>('');
  const [orderId, setOrderId] = useState<string>('');
  const loadedRef = useRef(false);

  useEffect(() => {
    if (!isOpen || loadedRef.current) return;
    loadedRef.current = true;
    setLoading(true);
    Promise.all([
      getDocs(collectionGroup(db, 'orders')),
      DataService.getClients(),
      getDocs(collection(db, 'Seasons')),
    ]).then(([ordersSnap, clientList, seasonsSnap]) => {
      const orders = ordersSnap.docs.map(d => ({
        id: d.id, ...d.data(), customerId: d.ref.parent.parent?.id,
      }));
      setFlatOrders(orders);
      setClients(clientList.map(c => ({ id: c.id || c.clientId, name: c.name })));
      // Same canonical source PlanningSchedule's "Link Order" picker uses —
      // real Season docs, not each order's own embedded seasonId/seasonName,
      // which can be a raw slug or point at a season that no longer exists.
      setSeasonOptions(seasonsSnap.docs.map(d => ({ id: d.id, name: (d.data() as any).name || d.id })));
    }).finally(() => setLoading(false));
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) {
      loadedRef.current = false;
      setSeason(''); setClientId(''); setOrderId('');
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

  const orderMatchesSeason = (o: any) => !season || o.seasonId === season;

  const filteredClients = useMemo(() => {
    const list = clients.filter(c => liveOrders.some(o => o.customerId === c.id && orderMatchesSeason(o)));
    return list.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  }, [clients, liveOrders, season]);

  const clientOrders = useMemo(() => {
    if (!clientId) return [];
    return liveOrders.filter(o => o.customerId === clientId && orderMatchesSeason(o));
  }, [liveOrders, clientId, season]);

  const selectedOrder = clientOrders.find(o => o.id === orderId);
  const selectedClientName = clients.find(c => c.id === clientId)?.name || '';
  const canApply = !!selectedOrder;

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/60 z-[9999] flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md flex flex-col overflow-hidden" onClick={e => e.stopPropagation()} dir="rtl">
        {/* Header */}
        <div className="bg-gradient-to-r from-indigo-600 to-purple-600 px-5 py-4 flex items-center justify-between">
          <div>
            <p className="text-indigo-200 text-xs font-medium uppercase tracking-wide">تقرير جديد</p>
            <h2 className="text-white font-bold text-lg leading-tight">إنشاء تقرير</h2>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-indigo-200 hover:text-white hover:bg-white/20 rounded-full transition"
          >
            <X size={18} />
          </button>
        </div>

        <div className="p-5 space-y-4 overflow-auto max-h-[70vh]">
          {loading ? (
            <div className="py-10 text-center text-sm text-slate-400">جارٍ التحميل...</div>
          ) : (
            <>
              {/* Season */}
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wide mb-1.5">الموسم</label>
                <div className="flex flex-wrap gap-2">
                  {seasonOptions.length === 0 && <span className="text-sm text-slate-400 italic">لا توجد مواسم</span>}
                  {seasonOptions.map(s => (
                    <button
                      key={s.id}
                      onClick={() => { setSeason(s.id === season ? '' : s.id); setClientId(''); setOrderId(''); }}
                      className={`px-3 py-1.5 rounded-full text-sm font-medium border transition-all ${
                        season === s.id
                          ? 'bg-indigo-600 text-white border-indigo-600 shadow-sm'
                          : 'bg-white text-slate-600 border-slate-300 hover:border-indigo-400 hover:text-indigo-600'
                      }`}
                    >
                      {s.name}
                    </button>
                  ))}
                </div>
              </div>

              {/* Client */}
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wide mb-1.5">
                  العميل
                  {season && filteredClients.length > 0 && (
                    <span className="mr-2 text-slate-400 font-normal normal-case">{filteredClients.length} متاح</span>
                  )}
                </label>
                {!season ? (
                  <p className="text-sm text-slate-400 italic">اختر موسمًا أولاً</p>
                ) : filteredClients.length === 0 ? (
                  <p className="text-sm text-amber-600">لا يوجد عملاء لديهم طلبيات في هذا الموسم.</p>
                ) : (
                  <select
                    value={clientId}
                    onChange={e => { setClientId(e.target.value); setOrderId(''); }}
                    className="w-full border-2 border-slate-200 rounded-xl px-3 py-2.5 text-sm bg-white focus:outline-none focus:border-indigo-500 transition-colors"
                  >
                    <option value="">— اختر عميل —</option>
                    {filteredClients.map(c => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                )}
              </div>

              {/* Fabric / Order */}
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wide mb-1.5">
                  الخامة / الطلبية
                  {clientId && clientOrders.length > 0 && (
                    <span className="mr-2 text-slate-400 font-normal normal-case">{clientOrders.length} طلبية</span>
                  )}
                </label>
                {!clientId ? (
                  <p className="text-sm text-slate-400 italic">اختر عميلاً أولاً</p>
                ) : clientOrders.length === 0 ? (
                  <p className="text-sm text-amber-600">لا توجد طلبيات لهذا العميل والموسم.</p>
                ) : (
                  <div className="flex flex-col gap-1.5 max-h-48 overflow-y-auto pr-1">
                    {clientOrders.map(o => {
                      const isSelected = orderId === o.id;
                      return (
                        <button
                          key={o.id}
                          onClick={() => setOrderId(o.id)}
                          className={`w-full text-right px-4 py-3 rounded-xl border-2 transition-all ${
                            isSelected
                              ? 'border-indigo-500 bg-indigo-50 shadow-sm'
                              : 'border-slate-200 bg-white hover:border-indigo-300 hover:bg-slate-50'
                          }`}
                        >
                          <div className={`font-semibold text-sm leading-snug ${isSelected ? 'text-indigo-700' : 'text-slate-800'}`}>{o.material}</div>
                          <div className="flex gap-3 mt-1 flex-wrap">
                            <span className="text-[11px] text-slate-400 font-mono">#{o.id.slice(0, 8)}</span>
                            {o.requiredQty > 0 && <span className="text-[11px] text-slate-500">مطلوب: <span className="font-medium">{Number(o.requiredQty).toLocaleString()} كجم</span></span>}
                            {o.remainingQty > 0 && <span className="text-[11px] text-slate-500">متبقي: <span className="font-medium text-amber-600">{Number(o.remainingQty).toLocaleString()} كجم</span></span>}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Preview */}
              {canApply && (
                <div className="bg-gradient-to-r from-indigo-50 to-purple-50 border border-indigo-200 rounded-xl px-4 py-3 flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-[10px] text-indigo-500 font-bold uppercase tracking-wide mb-0.5">سيتم الحفظ باسم</p>
                    <p className="text-sm font-bold text-indigo-800 truncate">{selectedClientName}</p>
                    <p className="text-xs text-indigo-600 truncate">{selectedOrder!.material}</p>
                  </div>
                  <div className="text-indigo-400 text-xl">←</div>
                  <div className="shrink-0 font-bold text-indigo-700 text-sm">تقرير</div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-slate-100 px-5 py-4 flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 py-2.5 rounded-xl border-2 border-slate-200 text-slate-600 font-semibold text-sm hover:bg-slate-50 transition"
          >
            إلغاء
          </button>
          <button
            disabled={!canApply}
            onClick={() => {
              if (!selectedOrder) return;
              onSelect(
                { id: selectedOrder.id, material: selectedOrder.material, requiredQty: selectedOrder.requiredQty || 0, remainingQty: selectedOrder.remainingQty || 0 },
                selectedClientName,
              );
            }}
            className="flex-1 py-2.5 rounded-xl bg-indigo-600 text-white font-semibold text-sm hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed transition"
          >
            إنشاء التقرير
          </button>
        </div>
      </div>
    </div>
  );
};
