import React, { useState, useEffect, useRef } from 'react';
import { X, Plus, Trash2 } from 'lucide-react';
import { collection, query, where, getDocs, addDoc, deleteDoc, doc, updateDoc } from 'firebase/firestore';
import { db } from '../services/firebase';
import { DataService } from '../services/dataService';

interface ExternalProductionSheetProps {
  date: string;
  onClose: () => void;
  onUpdateTotal: (total: number) => void;
  isEmbedded?: boolean;
}

interface ExternalEntry {
  id?: string;
  factory: string;
  client: string;
  fabric: string;
  receivedQty: number;
  remainingQty: number;
  notes: string;
}

// --- SearchDropdown Component (Copied from FetchDataPage.tsx) ---
interface SearchDropdownProps {
  id: string;
  options: any[];
  value: string;
  onChange: (value: string) => void;
  onCreateNew: () => void;
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  onFocus?: () => void;
  placeholder?: string;
}

const SearchDropdown: React.FC<SearchDropdownProps> = ({
  id,
  options,
  value,
  onChange,
  onCreateNew,
  onKeyDown,
  onFocus,
  placeholder = '---'
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
    if (inputValue.trim()) {
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
        className="w-full h-full px-2 py-1 text-xs outline-none bg-transparent text-center"
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
              {searchTerm && !options.some(o => getLabel(o).toLowerCase() === searchTerm.toLowerCase()) && (
                <div
                  onClick={handleCreateNew}
                  className="px-2 py-1.5 hover:bg-emerald-50 cursor-pointer text-xs border-t border-slate-200 text-emerald-600 font-medium text-left"
                >
                  + اضافة "{inputValue}"
                </div>
              )}
            </>
          ) : searchTerm ? (
            <div
              onClick={handleCreateNew}
              className="px-2 py-1.5 hover:bg-emerald-50 cursor-pointer text-xs text-emerald-600 font-medium text-left"
            >
              + اضافة "{inputValue}"
            </div>
          ) : (
            <div className="px-2 py-1.5 text-xs text-slate-400 text-left">لا يوجد</div>
          )}
        </div>
      )}
    </div>
  );
};
// -----------------------------------------------------------

export const ExternalProductionSheet: React.FC<ExternalProductionSheetProps> = ({ date, onClose, onUpdateTotal, isEmbedded = false }) => {
  const [entries, setEntries] = useState<ExternalEntry[]>([]);
  const [loading, setLoading] = useState(true);
  
  const [fabrics, setFabrics] = useState<any[]>([]);
  const [clients, setClients] = useState<any[]>([]);
  const [factories, setFactories] = useState<any[]>([]);

  useEffect(() => {
    fetchEntries();
    fetchDropdownData();
  }, [date]);

  const fetchDropdownData = async () => {
    try {
      const [fabricsData, clientsData] = await Promise.all([
        DataService.getFabrics(),
        DataService.getClients()
      ]);
      setFabrics(fabricsData);
      setClients(clientsData);
    } catch (error) {
      console.error("Error fetching dropdown data:", error);
    }
  };

  const fetchEntries = async () => {
    try {
      setLoading(true);
      const q = query(
        collection(db, 'externalProduction'),
        where('date', '==', date)
      );
      const querySnapshot = await getDocs(q);
      const fetchedEntries: ExternalEntry[] = [];
      let total = 0;
      const uniqueFactories = new Set<string>();
      
      querySnapshot.forEach((doc) => {
        const data = doc.data();
        // Map old fields to new fields if necessary
        const entry: ExternalEntry = {
          id: doc.id,
          factory: data.factory || data.contractorName || '',
          client: data.client || '',
          fabric: data.fabric || data.fabricType || '',
          receivedQty: Number(data.receivedQty) || Number(data.quantity) || 0,
          remainingQty: Number(data.remainingQty) || 0,
          notes: data.notes || ''
        };
        
        if (entry.factory) uniqueFactories.add(entry.factory);
        fetchedEntries.push(entry);
        total += entry.receivedQty;
      });
      
      setEntries(fetchedEntries);
      setFactories(Array.from(uniqueFactories).map(f => ({ id: f, name: f })));
      onUpdateTotal(total);
    } catch (error) {
      console.error("Error fetching external production:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleAddRow = async () => {
    try {
      const newEntry = {
        factory: '',
        client: '',
        fabric: '',
        receivedQty: 0,
        remainingQty: 0,
        notes: '',
        date,
        createdAt: new Date().toISOString()
      };
      
      const docRef = await addDoc(collection(db, 'externalProduction'), newEntry);
      
      setEntries([...entries, { ...newEntry, id: docRef.id }]);
    } catch (error) {
      console.error("Error adding row:", error);
    }
  };

  const handleUpdateEntry = async (id: string, field: keyof ExternalEntry, value: any) => {
    try {
      const entryIndex = entries.findIndex(e => e.id === id);
      if (entryIndex === -1) return;

      const updatedEntries = [...entries];
      updatedEntries[entryIndex] = { ...updatedEntries[entryIndex], [field]: value };
      setEntries(updatedEntries);

      // Calculate new total if quantity changed
      if (field === 'receivedQty') {
        const total = updatedEntries.reduce((sum, e) => sum + (Number(e.receivedQty) || 0), 0);
        onUpdateTotal(total);
      }

      await updateDoc(doc(db, 'externalProduction', id), {
        [field]: value,
        lastUpdated: new Date().toISOString()
      });

      // If updating factory, add to local factories list if new
      if (field === 'factory' && value && !factories.some(f => f.name === value)) {
        setFactories([...factories, { id: value, name: value }]);
      }

    } catch (error) {
      console.error("Error updating entry:", error);
    }
  };

  const handleDeleteEntry = async (id: string) => {
    if (!window.confirm('Are you sure you want to delete this row?')) return;
    try {
      await deleteDoc(doc(db, 'externalProduction', id));
      const updatedEntries = entries.filter(e => e.id !== id);
      setEntries(updatedEntries);
      const total = updatedEntries.reduce((sum, e) => sum + (Number(e.receivedQty) || 0), 0);
      onUpdateTotal(total);
    } catch (error) {
      console.error("Error deleting entry:", error);
    }
  };

  const handleCreateItem = async (type: 'factory' | 'client' | 'fabric', name: string) => {
    try {
      if (type === 'fabric') {
        await DataService.addFabric({ name });
        const updated = await DataService.getFabrics();
        setFabrics(updated);
      } else if (type === 'client') {
        await DataService.addClient({ name });
        const updated = await DataService.getClients();
        setClients(updated);
      } else if (type === 'factory') {
        // Just add to local state for now as we don't have a factories collection
        setFactories([...factories, { id: name, name }]);
      }
    } catch (error) {
      console.error(`Error creating ${type}:`, error);
    }
  };

  const totalQuantity = entries.reduce((sum, entry) => sum + (Number(entry.receivedQty) || 0), 0);

  const content = (
    <div className={`bg-white flex flex-col ${isEmbedded ? 'rounded-xl border border-slate-200 shadow-sm h-full' : 'rounded-lg shadow-xl w-full max-w-6xl max-h-[90vh]'}`}>
      <div className={`p-4 border-b flex justify-between items-center bg-gray-50 ${isEmbedded ? 'rounded-t-xl' : 'rounded-t-lg'}`}>
        <h2 className="text-xl font-bold text-gray-800">External Production - {date}</h2>
        {!isEmbedded && (
          <button onClick={onClose} className="text-gray-500 hover:text-gray-700">
            <X size={24} />
          </button>
        )}
      </div>

      <div className="p-6 overflow-y-auto flex-grow">
          <div className="overflow-x-auto border border-slate-200 rounded-lg shadow-sm bg-white">
            <table className="w-full text-xs text-center border-collapse">
              <thead className="bg-slate-50 text-slate-700 font-bold">
                <tr>
                  <th className="p-2 border border-slate-200 w-10">#</th>
                  <th className="p-2 border border-slate-200 min-w-[150px]">Factory</th>
                  <th className="p-2 border border-slate-200 min-w-[150px]">Client</th>
                  <th className="p-2 border border-slate-200 min-w-[150px]">Fabric</th>
                  <th className="p-2 border border-slate-200 w-24">Received Qty</th>
                  <th className="p-2 border border-slate-200 w-24">Remaining Qty</th>
                  <th className="p-2 border border-slate-200 min-w-[150px]">Notes</th>
                  <th className="p-2 border border-slate-200 w-10"></th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={8} className="text-center py-4">Loading...</td></tr>
                ) : entries.length === 0 ? (
                  <tr><td colSpan={8} className="text-center py-4 text-gray-500">No external production entries for this date</td></tr>
                ) : (
                  entries.map((entry, idx) => (
                    <tr key={entry.id} className={`hover:bg-blue-50/50 transition-colors align-middle ${idx % 2 === 0 ? 'bg-white' : 'bg-slate-50/70'}`}>
                      <td className="border border-slate-200 p-2 font-semibold text-slate-500">{idx + 1}</td>
                      
                      {/* Factory */}
                      <td className="border border-slate-200 p-0 h-8">
                        <SearchDropdown
                          id={`factory-${entry.id}`}
                          options={factories}
                          value={entry.factory}
                          onChange={(val) => entry.id && handleUpdateEntry(entry.id, 'factory', val)}
                          onCreateNew={() => {
                             const el = document.getElementById(`factory-${entry.id}`) as HTMLInputElement;
                             if (el && entry.id) {
                               handleCreateItem('factory', el.value);
                               handleUpdateEntry(entry.id, 'factory', el.value);
                             }
                          }}
                          placeholder="---"
                        />
                      </td>

                      {/* Client */}
                      <td className="border border-slate-200 p-0 h-8 relative group">
                        <SearchDropdown
                          id={`client-${entry.id}`}
                          options={clients}
                          value={entry.client}
                          onChange={(val) => entry.id && handleUpdateEntry(entry.id, 'client', val)}
                          onCreateNew={() => {
                             const el = document.getElementById(`client-${entry.id}`) as HTMLInputElement;
                             if (el && entry.id) {
                               handleCreateItem('client', el.value);
                               handleUpdateEntry(entry.id, 'client', el.value);
                             }
                          }}
                          placeholder="---"
                        />
                        {/* Reference Code Tooltip */}
                        {entry.client && entry.fabric && (
                          <div className="hidden group-hover:block absolute bottom-full left-1/2 -translate-x-1/2 mb-1 px-2 py-1 bg-slate-800 text-white text-xs rounded shadow-lg z-20 whitespace-nowrap pointer-events-none">
                            {entry.client}-{entry.fabric}
                            <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-slate-800"></div>
                          </div>
                        )}
                      </td>

                      {/* Fabric */}
                      <td className="border border-slate-200 p-0 h-8">
                        <SearchDropdown
                          id={`fabric-${entry.id}`}
                          options={fabrics}
                          value={entry.fabric}
                          onChange={(val) => entry.id && handleUpdateEntry(entry.id, 'fabric', val)}
                          onCreateNew={() => {
                             const el = document.getElementById(`fabric-${entry.id}`) as HTMLInputElement;
                             if (el && entry.id) {
                               handleCreateItem('fabric', el.value);
                               handleUpdateEntry(entry.id, 'fabric', el.value);
                             }
                          }}
                          placeholder="---"
                        />
                      </td>

                      {/* Received Qty */}
                      <td className="border border-slate-200 p-0 h-8">
                        <input
                          type="number"
                          className="w-full h-full text-center bg-transparent outline-none focus:bg-blue-50 font-bold text-slate-800"
                          value={entry.receivedQty || ''}
                          onChange={(e) => entry.id && handleUpdateEntry(entry.id, 'receivedQty', Number(e.target.value))}
                        />
                      </td>

                      {/* Remaining Qty */}
                      <td className="border border-slate-200 p-0 h-8">
                        <input
                          type="number"
                          className="w-full h-full text-center bg-transparent outline-none focus:bg-blue-50 text-slate-600"
                          value={entry.remainingQty || ''}
                          onChange={(e) => entry.id && handleUpdateEntry(entry.id, 'remainingQty', Number(e.target.value))}
                        />
                      </td>

                      {/* Notes */}
                      <td className="border border-slate-200 p-0 h-8">
                        <input
                          type="text"
                          className="w-full h-full text-center bg-transparent outline-none focus:bg-blue-50 text-gray-500"
                          value={entry.notes}
                          onChange={(e) => entry.id && handleUpdateEntry(entry.id, 'notes', e.target.value)}
                        />
                      </td>

                      {/* Actions */}
                      <td className="border border-slate-200 p-0 h-8">
                        <button 
                          onClick={() => entry.id && handleDeleteEntry(entry.id)}
                          className="w-full h-full flex items-center justify-center text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                          title="Delete Row"
                        >
                          <Trash2 size={14} />
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
              <tfoot className="bg-slate-50 font-bold">
                <tr>
                  <td colSpan={4} className="p-2 border border-slate-200 text-right">Total Received:</td>
                  <td className="p-2 border border-slate-200 text-blue-600">{totalQuantity} kg</td>
                  <td colSpan={3} className="border border-slate-200"></td>
                </tr>
              </tfoot>
            </table>
          </div>

          <div className="mt-4">
            <button
              onClick={handleAddRow}
              className="flex items-center gap-2 text-blue-600 hover:text-blue-800 font-medium text-sm px-2 py-1 rounded hover:bg-blue-50 transition-colors"
            >
              <Plus size={16} /> Add Row
            </button>
          </div>
        </div>
        
        {!isEmbedded && (
          <div className="p-4 border-t bg-gray-50 rounded-b-lg flex justify-end">
            <button 
              onClick={onClose}
              className="bg-gray-200 text-gray-800 px-4 py-2 rounded hover:bg-gray-300 text-sm font-medium"
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
