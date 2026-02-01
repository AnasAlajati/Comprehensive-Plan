import React, { useState, useEffect, useRef, useMemo } from 'react';
import { X, Plus, Trash2, Search, Factory, CheckCircle2, AlertCircle, ArrowRight } from 'lucide-react';
import { collection, query, where, getDocs, addDoc, deleteDoc, doc, updateDoc, getDoc } from 'firebase/firestore';
import { db } from '../services/firebase';
import { DataService } from '../services/dataService';

interface ExternalProductionSheetProps {
  date: string;
  onClose: () => void;
  onUpdateTotal: (total: number) => void;
  isEmbedded?: boolean;
  onNavigateToPlanning?: (mode: 'INTERNAL' | 'EXTERNAL') => void;
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
// -----------------------------------------------------------

export const ExternalProductionSheet: React.FC<ExternalProductionSheetProps> = ({ date, onClose, onUpdateTotal, isEmbedded = false, onNavigateToPlanning }) => {
  const [entries, setEntries] = useState<ExternalEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [externalPlans, setExternalPlans] = useState<ExternalFactory[]>([]);
  
  // Selection State
  const [selectedClient, setSelectedClient] = useState('');
  const [selectedPlan, setSelectedPlan] = useState<{ factoryId: string, factoryName: string, planIndex: number, plan: ExternalPlanItem } | null>(null);
  const [receivedQty, setReceivedQty] = useState<number | ''>('');
  const [scrapQty, setScrapQty] = useState<number | ''>('');
  const [notes, setNotes] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Load Data
  useEffect(() => {
    const loadData = async () => {
      setLoading(true);
      try {
        // Load Today's Entries
        const q = query(collection(db, 'externalProduction'), where('date', '==', date));
        const snapshot = await getDocs(q);
        const loadedEntries = snapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        })) as ExternalEntry[];
        setEntries(loadedEntries);
        onUpdateTotal(loadedEntries.reduce((sum, e) => sum + (Number(e.receivedQty) || 0), 0));

        // Load External Plans
        const plansSnapshot = await getDocs(collection(db, 'ExternalPlans'));
        const factories = plansSnapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        })) as ExternalFactory[];
        setExternalPlans(factories);

      } catch (error) {
        console.error("Error loading data:", error);
      } finally {
        setLoading(false);
      }
    };
    loadData();
  }, [date]);

  // Derived Lists
  const clientOptions = useMemo(() => {
    const clients = new Set<string>();
    externalPlans.forEach(factory => {
      factory.plans.forEach(plan => {
        if (plan.client) clients.add(plan.client);
      });
    });
    return Array.from(clients).map(c => ({ name: c }));
  }, [externalPlans]);

  const availablePlans = useMemo(() => {
    if (!selectedClient) return [];
    const plans: { factoryId: string, factoryName: string, planIndex: number, plan: ExternalPlanItem }[] = [];
    
    externalPlans.forEach(factory => {
      factory.plans.forEach((plan, index) => {
        if (plan.client === selectedClient) {
          plans.push({
            factoryId: factory.id,
            factoryName: factory.name,
            planIndex: index,
            plan
          });
        }
      });
    });
    return plans;
  }, [selectedClient, externalPlans]);

  const handleSaveEntry = async () => {
    if (!selectedPlan || !receivedQty) return;
    
    setIsSubmitting(true);
    try {
      const { factoryId, factoryName, planIndex, plan } = selectedPlan;
      const newRemaining = Math.max(0, (plan.remaining || 0) - Number(receivedQty));

      // 1. Add to External Production
      const newEntry = {
        date,
        factory: factoryName,
        client: plan.client || selectedClient,
        fabric: plan.fabric,
        receivedQty: Number(receivedQty),
        scrap: Number(scrapQty) || 0,
        remainingQty: newRemaining,
        notes: notes
      };
      
      const docRef = await addDoc(collection(db, 'externalProduction'), newEntry);
      const savedEntry = { ...newEntry, id: docRef.id };
      
      const updatedEntries = [...entries, savedEntry];
      setEntries(updatedEntries);
      onUpdateTotal(updatedEntries.reduce((sum, e) => sum + (Number(e.receivedQty) || 0), 0));

      // 2. Update External Plan
      const factoryRef = doc(db, 'ExternalPlans', factoryId);
      const factoryDoc = await getDoc(factoryRef);
      
      if (factoryDoc.exists()) {
        const factoryData = factoryDoc.data() as ExternalFactory;
        const updatedPlans = [...factoryData.plans];
        
        // Update the specific plan
        if (updatedPlans[planIndex]) {
          updatedPlans[planIndex] = {
            ...updatedPlans[planIndex],
            remaining: newRemaining
          };
          
          await updateDoc(factoryRef, { plans: updatedPlans });
          
          // Update local state
          setExternalPlans(prev => prev.map(f => {
            if (f.id === factoryId) {
              return { ...f, plans: updatedPlans };
            }
            return f;
          }));
        }
      }

      // Reset Form
      setReceivedQty('');
      setScrapQty('');
      setNotes('');
      setSelectedPlan(null); 
      
    } catch (error) {
      console.error("Error saving entry:", error);
      alert("Failed to save entry. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteEntry = async (id: string) => {
    if (!window.confirm('Are you sure you want to delete this entry?')) return;
    try {
      await deleteDoc(doc(db, 'externalProduction', id));
      const updatedEntries = entries.filter(e => e.id !== id);
      setEntries(updatedEntries);
      onUpdateTotal(updatedEntries.reduce((sum, e) => sum + (Number(e.receivedQty) || 0), 0));
    } catch (error) {
      console.error("Error deleting entry:", error);
    }
  };

  const totalQuantity = entries.reduce((sum, entry) => sum + (Number(entry.receivedQty) || 0), 0);

  const content = (
    <div className={`bg-white flex flex-col ${isEmbedded ? 'rounded-xl border border-slate-200 shadow-sm h-full' : 'rounded-lg shadow-xl w-full max-w-6xl max-h-[90vh]'}`}>
      <div className={`px-6 py-4 border-b border-slate-200 flex justify-between items-center bg-white ${isEmbedded ? 'rounded-t-xl' : 'rounded-t-lg'}`}>
        <div className="flex items-center gap-4">
          <div className="p-2 bg-blue-50 rounded-lg">
            <Factory className="w-6 h-6 text-blue-600" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-slate-800">External Production</h2>
            <div className="text-sm text-slate-500 font-medium">{date}</div>
          </div>
        </div>
        
        <div className="flex items-center gap-3">
          {onNavigateToPlanning && (
             <button 
               onClick={() => onNavigateToPlanning('EXTERNAL')}
               className="flex items-center gap-2 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-medium rounded-lg transition-colors"
             >
               <ArrowRight className="w-4 h-4" />
               Go to Plans
             </button>
          )}
          {!isEmbedded && (
            <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-full text-slate-400 hover:text-slate-600 transition-colors">
              <X size={20} />
            </button>
          )}
        </div>
      </div>

      <div className="p-6 overflow-y-auto flex-grow space-y-8">
        
        {/* --- New Entry Section --- */}
        <div className="bg-slate-50 p-6 rounded-xl border border-slate-200 shadow-sm">
          <h3 className="text-lg font-bold text-slate-800 mb-4 flex items-center gap-2">
            <Plus className="w-5 h-5 text-blue-600" />
            New Production Entry
          </h3>

          <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
            {/* Step 1: Select Client */}
            <div className="md:col-span-3">
              <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5">1. Select Client</label>
              <div className="relative group">
                <SearchDropdown
                  id="client-select"
                  options={clientOptions}
                  value={selectedClient}
                  onChange={setSelectedClient}
                  placeholder="Type to search..."
                  className="w-full pl-9 pr-3 py-2.5 text-sm font-bold text-slate-700 bg-white border border-slate-300 rounded-lg shadow-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all hover:border-blue-400"
                />
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4 pointer-events-none group-focus-within:text-blue-500 transition-colors" />
              </div>
            </div>

            {/* Step 2: Select Plan (Factory & Fabric) */}
            <div className="md:col-span-9">
              <label className="block text-sm font-medium text-slate-700 mb-2">
                2. Select Factory & Fabric 
                {selectedClient && <span className="text-slate-400 font-normal ml-2">({availablePlans.length} active plans)</span>}
              </label>
              
              {!selectedClient ? (
                <div className="h-32 bg-slate-100 rounded-lg border border-dashed border-slate-300 flex items-center justify-center text-slate-400">
                  Select a client first
                </div>
              ) : availablePlans.length === 0 ? (
                <div className="h-32 bg-white rounded-lg border border-slate-200 flex items-center justify-center text-slate-500">
                  No active plans found for this client
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 max-h-60 overflow-y-auto p-1">
                  {availablePlans.map((item, idx) => {
                    const isSelected = selectedPlan?.factoryId === item.factoryId && selectedPlan?.planIndex === item.planIndex;
                    return (
                      <div 
                        key={`${item.factoryId}-${idx}`}
                        onClick={() => setSelectedPlan(item)}
                        className={`cursor-pointer p-3 rounded-lg border transition-all relative overflow-hidden ${
                          isSelected 
                            ? 'bg-blue-50 border-blue-500 shadow-md ring-1 ring-blue-500' 
                            : 'bg-white border-slate-200 hover:border-blue-300 hover:shadow-sm'
                        }`}
                      >
                        <div className="flex justify-between items-start mb-1">
                          <div className="font-bold text-slate-800 text-sm truncate" title={item.factoryName}>
                            {item.factoryName}
                          </div>
                          {isSelected && <CheckCircle2 className="w-4 h-4 text-blue-600" />}
                        </div>
                        <div className="text-xs text-slate-500 mb-2 truncate" title={item.plan.fabric}>
                          {item.plan.fabric}
                        </div>
                        <div className="flex justify-between items-end">
                          <div className="text-[10px] text-slate-400 uppercase font-bold tracking-wider">Remaining</div>
                          <div className={`font-mono font-bold ${item.plan.remaining < 100 ? 'text-red-600' : 'text-emerald-600'}`}>
                            {item.plan.remaining} kg
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Step 3: Enter Details & Save */}
          {selectedPlan && (
            <div className="mt-6 pt-6 border-t border-slate-200 animate-in fade-in slide-in-from-top-4 duration-300">
              <div className="flex flex-col md:flex-row items-end gap-4">
                <div className="flex-1">
                  <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Received Quantity (kg)</label>
                  <input
                    type="number"
                    value={receivedQty}
                    onChange={(e) => setReceivedQty(Number(e.target.value))}
                    className="w-full p-3 text-lg font-bold text-blue-600 bg-white border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                    placeholder="0.00"
                    autoFocus
                  />
                </div>

                <div className="flex-1">
                  <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Scrap (kg)</label>
                  <input
                    type="number"
                    value={scrapQty}
                    onChange={(e) => setScrapQty(Number(e.target.value))}
                    className="w-full p-3 text-lg font-bold text-red-600 bg-white border border-slate-300 rounded-lg focus:ring-2 focus:ring-red-500 outline-none"
                    placeholder="0.00"
                  />
                </div>

                <div className="flex-1">
                  <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">New Remaining</label>
                  <div className="w-full p-3 text-lg font-bold text-slate-700 bg-slate-100 border border-slate-200 rounded-lg">
                    {selectedPlan.plan.remaining - (Number(receivedQty) || 0)} kg
                  </div>
                </div>

                <div className="flex-[2]">
                  <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Notes (Optional)</label>
                  <input
                    type="text"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    className="w-full p-3 text-sm bg-white border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                    placeholder="Any comments..."
                  />
                </div>

                <button
                  onClick={handleSaveEntry}
                  disabled={!receivedQty || isSubmitting}
                  className="h-[50px] px-8 bg-blue-600 text-white font-bold rounded-lg shadow-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center gap-2"
                >
                  {isSubmitting ? 'Saving...' : (
                    <>
                      <span>Confirm</span>
                      <ArrowRight className="w-5 h-5" />
                    </>
                  )}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* --- History Table --- */}
        <div>
          <h3 className="text-lg font-bold text-slate-800 mb-4">Today's Entries</h3>
          <div className="overflow-x-auto border border-slate-200 rounded-lg shadow-sm bg-white">
            <table className="w-full text-sm text-left border-collapse">
              <thead className="bg-slate-50 text-slate-700 font-bold uppercase text-xs tracking-wider">
                <tr>
                  <th className="p-3 border-b border-slate-200 w-10 text-center">#</th>
                  <th className="p-3 border-b border-slate-200">Factory</th>
                  <th className="p-3 border-b border-slate-200">Client</th>
                  <th className="p-3 border-b border-slate-200">Fabric</th>
                  <th className="p-3 border-b border-slate-200 text-right">Received</th>
                  <th className="p-3 border-b border-slate-200 text-right">Scrap</th>
                  <th className="p-3 border-b border-slate-200 text-right">Remaining</th>
                  <th className="p-3 border-b border-slate-200">Notes</th>
                  <th className="p-3 border-b border-slate-200 w-10"></th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={8} className="text-center py-8 text-slate-500">Loading...</td></tr>
                ) : entries.length === 0 ? (
                  <tr><td colSpan={8} className="text-center py-8 text-slate-400 italic">No entries for today</td></tr>
                ) : (
                  entries.map((entry, idx) => (
                    <tr key={entry.id} className="hover:bg-slate-50 transition-colors border-b border-slate-100 last:border-0">
                      <td className="p-3 text-center text-slate-400 font-mono text-xs">{idx + 1}</td>
                      <td className="p-3 font-medium text-slate-800">{entry.factory}</td>
                      <td className="p-3 text-slate-600">{entry.client}</td>
                      <td className="p-3 text-slate-600">{entry.fabric}</td>
                      <td className="p-3 text-right font-bold text-blue-600">{entry.receivedQty}</td>
                      <td className="p-3 text-right font-bold text-red-600">{entry.scrap || 0}</td>
                      <td className="p-3 text-right font-mono text-slate-500">{entry.remainingQty}</td>
                      <td className="p-3 text-slate-500 italic text-xs">{entry.notes || '-'}</td>
                      <td className="p-3 text-center">
                        <button 
                          onClick={() => entry.id && handleDeleteEntry(entry.id)}
                          className="text-slate-300 hover:text-red-600 transition-colors"
                          title="Delete Entry"
                        >
                          <Trash2 size={16} />
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
              <tfoot className="bg-slate-50 font-bold text-slate-800">
                <tr>
                  <td colSpan={4} className="p-3 text-right uppercase text-xs tracking-wider">Total Received:</td>
                  <td className="p-3 text-right text-blue-700">{totalQuantity} kg</td>
                  <td colSpan={3}></td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      </div>
      
      {!isEmbedded && (
        <div className="p-4 border-t bg-gray-50 rounded-b-lg flex justify-end">
          <button 
            onClick={onClose}
            className="bg-white border border-slate-300 text-slate-700 px-6 py-2 rounded-lg hover:bg-slate-50 text-sm font-bold shadow-sm transition-all"
          >
            Close
          </button>
        </div>
      )}
    </div>
  );

  if (isEmbedded) return content;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      {content}
    </div>
  );
};
