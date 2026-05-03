import React, { useState, useEffect, useRef, useMemo } from 'react';
import { X, Plus, Trash2, Factory, CheckCircle2, ArrowRight, ChevronDown, Search } from 'lucide-react';
import { collection, query, where, getDocs, addDoc, deleteDoc, doc, collectionGroup } from 'firebase/firestore';
import { db } from '../services/firebase';

interface ExternalProductionSheetProps {
  date: string;
  onClose: () => void;
  onUpdateTotal: (total: number, scrap?: number) => void;
  isEmbedded?: boolean;
  onNavigateToPlanning?: (mode: 'INTERNAL' | 'EXTERNAL') => void;
  seasonId?: string;
  seasonName?: string;
}

interface ExternalEntry {
  id?: string;
  factory: string;
  client: string;
  fabric: string;
  receivedQty: number;
  remainingQty: number;
  scrap?: number;
  notes: string;
  orderId?: string;
  orderReference?: string;
}

export const ExternalProductionSheet: React.FC<ExternalProductionSheetProps> = ({
  date, onClose, onUpdateTotal, isEmbedded = false, onNavigateToPlanning, seasonId, seasonName
}) => {
  // ── Entries ──────────────────────────────────────────────────────────
  const [entries, setEntries] = useState<ExternalEntry[]>([]);
  const [loading, setLoading] = useState(true);

  // ── Master data ───────────────────────────────────────────────────────
  const [allCustomers, setAllCustomers] = useState<{ id: string; name: string }[]>([]);
  const [allFlatOrders, setAllFlatOrders] = useState<any[]>([]);
  const [seasons, setSeasons] = useState<{ id: string; name: string }[]>([]);
  const [factoryNames, setFactoryNames] = useState<string[]>([]);

  // ── Picker popup ──────────────────────────────────────────────────────
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerSeason, setPickerSeason] = useState(seasonId || '');
  const [pickerClientId, setPickerClientId] = useState('');
  const [pickerClientSearch, setPickerClientSearch] = useState('');
  const [pendingOrder, setPendingOrder] = useState<any>(null); // order selected but not applied yet

  // ── Form fields ───────────────────────────────────────────────────────
  const [selectedOrder, setSelectedOrder] = useState<any>(null);
  const [selectedClientName, setSelectedClientName] = useState('');
  const [factoryInput, setFactoryInput] = useState('');
  const [receivedQty, setReceivedQty] = useState<number | ''>('');
  const [scrapQty, setScrapQty] = useState<number | ''>('');
  const [notes, setNotes] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // ── Load data ─────────────────────────────────────────────────────────
  useEffect(() => {
    const loadData = async () => {
      setLoading(true);
      try {
        const [entriesSnap, customersSnap, seasonsSnap, plansSnap, ordersSnap] = await Promise.all([
          getDocs(query(collection(db, 'externalProduction'), where('date', '==', date))),
          getDocs(collection(db, 'CustomerSheets')),
          getDocs(collection(db, 'Seasons')),
          getDocs(collection(db, 'ExternalPlans')),
          getDocs(collectionGroup(db, 'orders')),
        ]);

        const loadedEntries = entriesSnap.docs.map(d => ({ id: d.id, ...d.data() })) as ExternalEntry[];
        setEntries(loadedEntries);
        onUpdateTotal(
          loadedEntries.reduce((s, e) => s + (Number(e.receivedQty) || 0), 0),
          loadedEntries.reduce((s, e) => s + (Number(e.scrap) || 0), 0),
        );
        setAllCustomers(customersSnap.docs.map(d => ({ id: d.id, name: (d.data() as any).name || d.id })));
        setSeasons(seasonsSnap.docs.map(d => ({ id: d.id, name: (d.data() as any).name || d.id })));
        setFactoryNames(plansSnap.docs.map(d => (d.data() as any).name).filter(Boolean));
        setAllFlatOrders(ordersSnap.docs.map(d => ({ id: d.id, ...d.data() })));
      } catch (err) {
        console.error('ExternalProductionSheet load error', err);
      } finally {
        setLoading(false);
      }
    };
    loadData();
  }, [date]);

  // ── Picker derived data ───────────────────────────────────────────────
  const pickerSeasonOrders = useMemo(() => {
    if (!pickerSeason) return allFlatOrders;
    return allFlatOrders.filter((o: any) =>
      o.seasonId === pickerSeason || o.clientSeason === pickerSeason || o.seasonName === pickerSeason
    );
  }, [allFlatOrders, pickerSeason]);

  const pickerClients = useMemo(() => {
    const ids = new Set(pickerSeasonOrders.map((o: any) => o.customerId).filter(Boolean));
    const filtered = allCustomers.filter(c => ids.has(c.id));
    if (!pickerClientSearch.trim()) return filtered;
    return filtered.filter(c => c.name.toLowerCase().includes(pickerClientSearch.toLowerCase()));
  }, [allCustomers, pickerSeasonOrders, pickerClientSearch]);

  const pickerOrders = useMemo(() => {
    if (!pickerClientId) return [];
    return pickerSeasonOrders.filter((o: any) => o.customerId === pickerClientId && o.material);
  }, [pickerSeasonOrders, pickerClientId]);

  // ── Save ──────────────────────────────────────────────────────────────
  const handleSaveEntry = async () => {
    if (!selectedOrder || !factoryInput.trim() || !receivedQty) return;
    setIsSubmitting(true);
    try {
      const orderRef = selectedOrder.orderReference || `#${selectedOrder.id.slice(0, 8)}`;
      const newRemaining = Math.max(0, (Number(selectedOrder.remainingQty) || 0) - Number(receivedQty));
      const newEntry: Record<string, any> = {
        date, factory: factoryInput.trim(), client: selectedClientName,
        fabric: selectedOrder.material || '', orderId: selectedOrder.id,
        orderReference: orderRef, receivedQty: Number(receivedQty),
        scrap: Number(scrapQty) || 0, remainingQty: newRemaining, notes,
      };
      if (seasonId) newEntry.clientSeason = seasonId;
      else if (seasonName) newEntry.clientSeason = seasonName;

      const docRef = await addDoc(collection(db, 'externalProduction'), newEntry);
      const saved = { ...newEntry, id: docRef.id } as ExternalEntry;
      const updated = [...entries, saved];
      setEntries(updated);
      onUpdateTotal(
        updated.reduce((s, e) => s + (Number(e.receivedQty) || 0), 0),
        updated.reduce((s, e) => s + (Number(e.scrap) || 0), 0),
      );
      setReceivedQty(''); setScrapQty(''); setNotes('');
    } catch (err) {
      console.error(err);
      alert('Failed to save. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteEntry = async (id: string) => {
    if (!window.confirm('Delete this entry?')) return;
    await deleteDoc(doc(db, 'externalProduction', id));
    const updated = entries.filter(e => e.id !== id);
    setEntries(updated);
    onUpdateTotal(
      updated.reduce((s, e) => s + (Number(e.receivedQty) || 0), 0),
      updated.reduce((s, e) => s + (Number(e.scrap) || 0), 0),
    );
  };

  const totalQuantity = entries.reduce((s, e) => s + (Number(e.receivedQty) || 0), 0);

  // ── Picker popup ──────────────────────────────────────────────────────
  const openPicker = () => {
    setPickerSeason(seasonId || (seasons[0]?.id || ''));
    setPickerClientId('');
    setPickerClientSearch('');
    setPendingOrder(null);
    setPickerOpen(true);
  };

  const applyPicker = () => {
    if (!pendingOrder) return;
    const clientName = allCustomers.find(c => c.id === pickerClientId)?.name || '';
    setSelectedOrder(pendingOrder);
    setSelectedClientName(clientName);
    setPickerOpen(false);
  };

  const pickerPopup = pickerOpen ? (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 flex flex-col overflow-hidden" style={{ maxHeight: '90vh' }}>
        {/* Header */}
        <div className="bg-gradient-to-r from-violet-600 to-indigo-600 px-5 py-4 flex items-center justify-between">
          <div>
            <p className="text-[11px] text-violet-200 font-semibold uppercase tracking-widest">External Production</p>
            <p className="text-white font-bold text-lg leading-tight">Select Order</p>
          </div>
          <button onClick={() => setPickerOpen(false)} className="text-white/70 hover:text-white p-1 rounded-full hover:bg-white/10 transition">
            <X size={18} />
          </button>
        </div>

        <div className="p-5 overflow-y-auto flex-1 space-y-5">
          {/* Season pills */}
          <div>
            <p className="text-[11px] font-bold text-slate-500 uppercase tracking-widest mb-2">Season</p>
            <div className="flex flex-wrap gap-2">
              {seasons.map(s => (
                <button
                  key={s.id}
                  onClick={() => { setPickerSeason(s.id); setPickerClientId(''); setPendingOrder(null); }}
                  className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-all ${
                    pickerSeason === s.id
                      ? 'bg-indigo-600 text-white border-indigo-600 shadow'
                      : 'bg-white text-slate-600 border-slate-300 hover:border-indigo-400'
                  }`}
                >{s.name}</button>
              ))}
            </div>
          </div>

          {/* Client */}
          <div>
            <p className="text-[11px] font-bold text-slate-500 uppercase tracking-widest mb-2">Client</p>
            {!pickerSeason ? (
              <p className="text-sm text-slate-400 italic">Select a season first</p>
            ) : (
              <>
                <div className="relative mb-2">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-3.5 h-3.5" />
                  <input
                    type="text"
                    value={pickerClientSearch}
                    onChange={e => setPickerClientSearch(e.target.value)}
                    placeholder="Search client..."
                    className="w-full pl-8 pr-3 py-2 text-sm border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-indigo-300"
                  />
                </div>
                <select
                  value={pickerClientId}
                  onChange={e => { setPickerClientId(e.target.value); setPendingOrder(null); }}
                  className="w-full p-2.5 text-sm border border-slate-300 rounded-lg outline-none focus:ring-2 focus:ring-indigo-400 bg-white"
                >
                  <option value="">-- Select client --</option>
                  {pickerClients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </>
            )}
          </div>

          {/* Orders */}
          <div>
            <p className="text-[11px] font-bold text-slate-500 uppercase tracking-widest mb-2">Fabric / Order</p>
            {!pickerClientId ? (
              <p className="text-sm text-slate-400 italic">Select a client first</p>
            ) : pickerOrders.length === 0 ? (
              <p className="text-sm text-amber-600">No orders found for this client &amp; season.</p>
            ) : (
              <div className="flex flex-col gap-2">
                {pickerOrders.map((o: any) => {
                  const ref = o.orderReference || `#${o.id.slice(0, 8)}`;
                  const isSelected = pendingOrder?.id === o.id;
                  return (
                    <button
                      key={o.id}
                      onClick={() => setPendingOrder(o)}
                      className={`text-left px-4 py-3 rounded-xl border-2 transition-all ${
                        isSelected
                          ? 'border-indigo-500 bg-indigo-50 shadow-sm'
                          : 'border-slate-200 bg-white hover:border-indigo-300 hover:bg-slate-50'
                      }`}
                    >
                      <div className={`font-semibold text-sm ${isSelected ? 'text-indigo-800' : 'text-slate-800'}`}>
                        {o.material}
                      </div>
                      <div className="flex gap-3 mt-1 flex-wrap items-center">
                        <span className="text-[11px] font-mono text-indigo-500">{ref}</span>
                        {o.requiredQty > 0 && <span className="text-[11px] text-slate-500">Req: <b>{Number(o.requiredQty).toLocaleString()} kg</b></span>}
                        {o.remainingQty > 0 && <span className="text-[11px] text-amber-600">Rem: <b>{Number(o.remainingQty).toLocaleString()} kg</b></span>}
                        {isSelected && <CheckCircle2 className="w-4 h-4 text-indigo-500 ml-auto" />}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="border-t px-5 py-4 flex gap-3">
          <button onClick={() => setPickerOpen(false)} className="flex-1 py-2.5 rounded-xl border-2 border-slate-200 text-slate-600 font-semibold text-sm hover:bg-slate-50 transition">Cancel</button>
          <button
            onClick={applyPicker}
            disabled={!pendingOrder}
            className="flex-1 py-2.5 rounded-xl bg-indigo-600 text-white font-semibold text-sm hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed transition"
          >Apply</button>
        </div>
      </div>
    </div>
  ) : null;

  // ── Content ───────────────────────────────────────────────────────────
  const content = (
    <div className={`bg-white flex flex-col ${isEmbedded ? 'rounded-xl border border-slate-200 shadow-sm h-full' : 'rounded-lg shadow-xl w-full max-w-6xl max-h-[90vh]'}`}>
      {pickerPopup}

      {/* Header */}
      <div className={`px-6 py-4 border-b border-slate-200 flex justify-between items-center bg-white ${isEmbedded ? 'rounded-t-xl' : 'rounded-t-lg'}`}>
        <div className="flex items-center gap-4">
          <div className="p-2 bg-blue-50 rounded-lg"><Factory className="w-6 h-6 text-blue-600" /></div>
          <div>
            <h2 className="text-lg font-bold text-slate-800">External Production</h2>
            <div className="text-sm text-slate-500 font-medium">{date}</div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {onNavigateToPlanning && (
            <button onClick={() => onNavigateToPlanning('EXTERNAL')} className="flex items-center gap-2 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-medium rounded-lg transition-colors">
              <ArrowRight className="w-4 h-4" />Go to Plans
            </button>
          )}
          {!isEmbedded && (
            <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-full text-slate-400 hover:text-slate-600 transition-colors">
              <X size={20} />
            </button>
          )}
        </div>
      </div>

      <div className="p-6 overflow-y-auto flex-grow space-y-6">
        {/* ── New Entry ────────────────────────────────── */}
        <div className="bg-slate-50 rounded-xl border border-slate-200 shadow-sm p-5">
          <h3 className="text-base font-bold text-slate-800 mb-4 flex items-center gap-2">
            <Plus className="w-4 h-4 text-blue-600" />New Production Entry
          </h3>

          {/* Order selector button */}
          <div className="mb-4">
            <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5">Order / Fabric</label>
            <button
              onClick={openPicker}
              className={`w-full flex items-center justify-between px-4 py-3 rounded-xl border-2 transition-all text-left ${
                selectedOrder
                  ? 'border-indigo-400 bg-indigo-50'
                  : 'border-dashed border-slate-300 bg-white hover:border-indigo-400 hover:bg-indigo-50/40'
              }`}
            >
              {selectedOrder ? (
                <div className="flex items-center gap-3 min-w-0">
                  <CheckCircle2 className="w-5 h-5 text-indigo-500 shrink-0" />
                  <div className="min-w-0">
                    <div className="font-semibold text-sm text-indigo-900 truncate">{selectedOrder.material}</div>
                    <div className="text-[11px] text-indigo-500 font-mono">{selectedClientName} · {selectedOrder.orderReference || `#${selectedOrder.id.slice(0, 8)}`}</div>
                  </div>
                </div>
              ) : (
                <span className="text-slate-400 text-sm">Tap to select client &amp; order...</span>
              )}
              <ChevronDown className="w-4 h-4 text-slate-400 shrink-0 ml-2" />
            </button>
          </div>

          {/* Factory + quantities row */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
            <div className="col-span-2 md:col-span-1">
              <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Factory</label>
              <input
                type="text"
                list="factory-suggestions"
                value={factoryInput}
                onChange={e => setFactoryInput(e.target.value)}
                placeholder="Factory name..."
                className="w-full px-3 py-2.5 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
              />
              <datalist id="factory-suggestions">
                {factoryNames.map(n => <option key={n} value={n} />)}
              </datalist>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Received (kg)</label>
              <input
                type="number"
                value={receivedQty}
                onChange={e => setReceivedQty(Number(e.target.value))}
                placeholder="0"
                className="w-full px-3 py-2.5 text-base font-bold text-blue-600 bg-white border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Scrap (kg)</label>
              <input
                type="number"
                value={scrapQty}
                onChange={e => setScrapQty(Number(e.target.value))}
                placeholder="0"
                className="w-full px-3 py-2.5 text-base font-bold text-red-500 bg-white border border-slate-300 rounded-lg focus:ring-2 focus:ring-red-400 outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Notes</label>
              <input
                type="text"
                value={notes}
                onChange={e => setNotes(e.target.value)}
                placeholder="Optional..."
                className="w-full px-3 py-2.5 text-sm bg-white border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
              />
            </div>
          </div>

          <button
            onClick={handleSaveEntry}
            disabled={!selectedOrder || !factoryInput.trim() || !receivedQty || isSubmitting}
            className="w-full py-3 bg-blue-600 text-white font-bold rounded-xl shadow hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2"
          >
            {isSubmitting ? 'Saving...' : <><span>Confirm Entry</span><ArrowRight className="w-4 h-4" /></>}
          </button>
        </div>

        {/* ── Today's Entries ──────────────────────────── */}
        <div>
          <h3 className="text-base font-bold text-slate-800 mb-3">Today's Entries</h3>
          <div className="overflow-x-auto border border-slate-200 rounded-xl shadow-sm bg-white">
            <table className="w-full text-sm text-left border-collapse">
              <thead className="bg-slate-50 text-slate-600 font-bold uppercase text-[11px] tracking-wider">
                <tr>
                  <th className="p-3 border-b border-slate-200 w-8 text-center">#</th>
                  <th className="p-3 border-b border-slate-200">Factory</th>
                  <th className="p-3 border-b border-slate-200">Client</th>
                  <th className="p-3 border-b border-slate-200">Fabric / Order</th>
                  <th className="p-3 border-b border-slate-200 text-right">Received</th>
                  <th className="p-3 border-b border-slate-200 text-right">Scrap</th>
                  <th className="p-3 border-b border-slate-200 text-right">Remaining</th>
                  <th className="p-3 border-b border-slate-200">Notes</th>
                  <th className="p-3 border-b border-slate-200 w-8"></th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={9} className="text-center py-10 text-slate-400">Loading...</td></tr>
                ) : entries.length === 0 ? (
                  <tr><td colSpan={9} className="text-center py-10 text-slate-400 italic">No entries for today</td></tr>
                ) : entries.map((entry, idx) => (
                  <tr key={entry.id} className="hover:bg-slate-50 border-b border-slate-100 last:border-0">
                    <td className="p-3 text-center text-slate-400 font-mono text-xs">{idx + 1}</td>
                    <td className="p-3 font-medium text-slate-800">{entry.factory}</td>
                    <td className="p-3 text-slate-600">{entry.client}</td>
                    <td className="p-3">
                      <div className="text-slate-700 font-medium">{entry.fabric}</div>
                      {(entry as any).orderReference && (
                        <div className="text-[10px] font-mono text-indigo-500 mt-0.5">{(entry as any).orderReference}</div>
                      )}
                    </td>
                    <td className="p-3 text-right font-bold text-blue-600">{entry.receivedQty}</td>
                    <td className="p-3 text-right font-bold text-red-500">{entry.scrap || 0}</td>
                    <td className="p-3 text-right font-mono text-slate-500">{entry.remainingQty}</td>
                    <td className="p-3 text-slate-500 italic text-xs">{entry.notes || '-'}</td>
                    <td className="p-3 text-center">
                      <button onClick={() => entry.id && handleDeleteEntry(entry.id)} className="text-slate-300 hover:text-red-500 transition-colors" title="Delete">
                        <Trash2 size={15} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-slate-50 font-bold text-slate-700">
                <tr>
                  <td colSpan={4} className="p-3 text-right text-xs uppercase tracking-wider">Total Received:</td>
                  <td className="p-3 text-right text-blue-600">{totalQuantity} kg</td>
                  <td colSpan={4}></td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      </div>

      {!isEmbedded && (
        <div className="p-4 border-t bg-gray-50 rounded-b-lg flex justify-end">
          <button onClick={onClose} className="bg-white border border-slate-300 text-slate-700 px-6 py-2 rounded-lg hover:bg-slate-50 text-sm font-bold shadow-sm transition-all">Close</button>
        </div>
      )}
    </div>
  );

  if (isEmbedded) return content;
  return <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">{content}</div>;
};

interface ExternalProductionSheetProps {
  date: string;
  onClose: () => void;
  onUpdateTotal: (total: number, scrap?: number) => void;
  isEmbedded?: boolean;
  onNavigateToPlanning?: (mode: 'INTERNAL' | 'EXTERNAL') => void;
  seasonId?: string;   // e.g. "2026-winter"
  seasonName?: string; // e.g. "2026 Winter"
}

interface ExternalEntry {
  id?: string;
  factory: string;
  client: string;
  fabric: string;
  receivedQty: number;
  remainingQty: number;
  scrap?: number; // Added scrap field
  notes: string;
}

interface ExternalPlanItem {
  fabric: string;
  client?: string;
  remaining: number;
  quantity: number;
  productionPerDay: number;
  days: number;
  startDate: string;
  endDate: string;
  orderName?: string;
  notes?: string;
}

interface ExternalFactory {
  id: string;
  name: string;
  plans: ExternalPlanItem[];
}

// --- SearchDropdown Component (Copied from FetchDataPage.tsx) ---
interface SearchDropdownProps {
  id: string;
  options: any[];
  value: string;
  onChange: (value: string) => void;
  onCreateNew?: () => void;
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  onFocus?: () => void;
  placeholder?: string;
  className?: string;
}

const SearchDropdown: React.FC<SearchDropdownProps> = ({
  id,
  options,
  value,
  onChange,
  onCreateNew,
  onKeyDown,
  onFocus,
  placeholder = '---',
  className
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [inputValue, setInputValue] = useState(value);
  const containerRef = useRef<HTMLDivElement>(null);

  // Helper to get display label
  const getLabel = (opt: any) => opt.shortName || opt.name;

  useEffect(() => {
    const selected = options.find(o => o.name === value);
    setInputValue(selected ? getLabel(selected) : value);
  }, [value, options]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Ensure only one dropdown is open at a time
  useEffect(() => {
    const handleOtherOpen = (e: Event) => {
      const detail = (e as CustomEvent).detail as { id: string } | undefined;
      if (detail?.id !== id) {
        setIsOpen(false);
      }
    };
    window.addEventListener('searchdropdown:open', handleOtherOpen);
    return () => window.removeEventListener('searchdropdown:open', handleOtherOpen);
  }, [id]);

  const filteredOptions = options.filter(opt =>
    getLabel(opt).toLowerCase().includes(searchTerm.toLowerCase())
  );

  const handleSelect = (option: any) => {
    setInputValue(getLabel(option));
    onChange(option.name); // Save full name
    setSearchTerm('');
    setIsOpen(false);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setInputValue(val);
    setSearchTerm(val);
    setIsOpen(true);
    if (!val) {
      onChange('');
    }
  };

  const handleCreateNew = () => {
    if (inputValue.trim() && onCreateNew) {
      onCreateNew();
      setInputValue('');
      setSearchTerm('');
      setIsOpen(false);
    }
  };

  const handleInputBlur = () => {
    // Delay closing to allow clicks on dropdown items to register
    setTimeout(() => setIsOpen(false), 150);
  };

  // Listen for explicit close events from keyboard navigation
  useEffect(() => {
    const handleForceClose = () => setIsOpen(false);
    window.addEventListener('searchdropdown:forceclose', handleForceClose);
    return () => window.removeEventListener('searchdropdown:forceclose', handleForceClose);
  }, []);

  return (
    <div ref={containerRef} className="relative w-full h-full">
      <input
        id={id}
        type="text"
        value={inputValue}
        onChange={handleInputChange}
        onFocus={() => {
          window.dispatchEvent(new CustomEvent('searchdropdown:open', { detail: { id } }));
          setIsOpen(true);
          onFocus?.();
        }}
        onBlur={handleInputBlur}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        className={className || "w-full h-full px-2 py-1 text-xs outline-none bg-transparent text-center"}
      />
      {isOpen && (
        <div className="fixed bg-white border border-slate-300 rounded shadow-lg z-[9999] max-h-48 overflow-y-auto min-w-[150px]" style={{
          top: `${containerRef.current?.getBoundingClientRect().bottom || 0}px`,
          left: `${containerRef.current?.getBoundingClientRect().left || 0}px`,
          width: `${containerRef.current?.getBoundingClientRect().width || 150}px`
        }}>
          {filteredOptions.length > 0 ? (
            <>
              {filteredOptions.map((opt) => (
                <div
                  key={opt.id}
                  onClick={() => handleSelect(opt)}
                  className="px-2 py-1.5 hover:bg-blue-50 cursor-pointer text-xs border-b border-slate-100 last:border-b-0 text-left"
                >
                  <div className="font-medium">{getLabel(opt)}</div>
                  {opt.code && <div className="text-[10px] text-slate-400">{opt.code}</div>}
                </div>
              ))}
              {searchTerm && !options.some(o => getLabel(o).toLowerCase() === searchTerm.toLowerCase()) && onCreateNew && (
                <div
                  onClick={handleCreateNew}
                  className="px-2 py-1.5 hover:bg-emerald-50 cursor-pointer text-xs border-t border-slate-200 text-emerald-600 font-medium text-left"
                >
                  + Add "{inputValue}"
                </div>
              )}
            </>
          ) : searchTerm ? (
            onCreateNew ? (
              <div
                onClick={handleCreateNew}
                className="px-2 py-1.5 hover:bg-emerald-50 cursor-pointer text-xs text-emerald-600 font-medium text-left"
              >
                + Add "{inputValue}"
              </div>
            ) : (
              <div className="px-2 py-1.5 text-xs text-slate-400 text-left">No options found</div>
            )
          ) : (
            <div className="px-2 py-1.5 text-xs text-slate-400 text-left">لا يوجد</div>
          )}
        </div>
      )}
    </div>
  );
};
