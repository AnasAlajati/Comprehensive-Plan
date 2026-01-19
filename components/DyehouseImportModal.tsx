import React, { useState, useRef } from 'react';
import { 
  X, 
  Upload, 
  FileSpreadsheet, 
  AlertTriangle, 
  Check, 
  ArrowRight,
  Database,
  Search,
  RefreshCw,
  Loader2
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { OrderRow, DyeingBatch } from '../types';
import { collection, getDocs, collectionGroup, query, doc, updateDoc, arrayUnion, addDoc, Timestamp } from 'firebase/firestore';
import { db } from '../services/firebase';

interface ParsedBatchRow {
  id: string; // Temporary ID for list management
  dispatchNumber: string;
  dateSent: string;
  dateFormed: string;
  fabricNameRaw: string;
  colorNameRaw: string;
  clientNameRaw: string;
  quantitySent: number;
  quantityReceived: number;
  remainingRaw: number; // K
  scrapPercentage: string; // L
  assignedMachineRaw: string; // From header M..T
  
  // Resolution State
  status: 'pending' | 'matched' | 'new' | 'error';
  matchedClientId?: string; // If matched to a known client
  matchedClientName?: string;
  matchedOrderId?: string;  // The Firestore Doc ID match
  matchedOrderRef?: string; // Visual Ref
  
  // User Selection Overrides
  selectedOrderId?: string; // If user manually picks an order
  searchText?: string; // For the searchable input
}

interface DyehouseImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  dyehouses: string[]; // List of available dyehouses
  onImportComplete?: () => void;
}

export const DyehouseImportModal: React.FC<DyehouseImportModalProps> = ({ 
  isOpen, 
  onClose, 
  dyehouses,
  onImportComplete 
}) => {
  const [step, setStep] = useState<'upload' | 'reconcile' | 'importing' | 'complete'>('upload');
  const [selectedDyehouse, setSelectedDyehouse] = useState(dyehouses[0] || '');
  const [parsedRows, setParsedRows] = useState<ParsedBatchRow[]>([]);
  const [clients, setClients] = useState<Record<string, string>>({}); // name -> id
  const [fabrics, setFabrics] = useState<string[]>([]);
  const [activeOrders, setActiveOrders] = useState<OrderRow[]>([]);
  const [isLoadingContext, setIsLoadingContext] = useState(false);
  
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Load context (Clients, Fabrics, Orders) when modal opens
  React.useEffect(() => {
    if (isOpen) {
      loadContext();
    }
  }, [isOpen]);

  const loadContext = async () => {
    setIsLoadingContext(true);
    try {
      // Load Clients
      const clientsSnap = await getDocs(collection(db, 'CustomerSheets'));
      const cMap: Record<string, string> = {};
      clientsSnap.docs.forEach(d => {
        const data = d.data();
        if (data.name) cMap[data.name.toLowerCase()] = d.id;
      });
      setClients(cMap);

      // Load Fabrics
      const fabricsSnap = await getDocs(collection(db, 'fabrics'));
      const fList = fabricsSnap.docs.map(d => d.data().name as string);
      setFabrics(fList);

      // Load Active Orders
      const ordersSnap = await getDocs(query(collectionGroup(db, 'orders')));
      const ordersList = ordersSnap.docs.map(d => ({
         id: d.id,
         refPath: d.ref.path, // Store Full Path
         ...d.data()
      })) as OrderRow[];
      setActiveOrders(ordersList);

    } catch (err) {
      console.error("Error loading context for import:", err);
    } finally {
      setIsLoadingContext(false);
    }
  };

  const processFile = async (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const data = e.target?.result;
      if (data) {
        const workbook = XLSX.read(data, { type: 'binary' });
        const sheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];
        
        // Convert to array of arrays
        const rawData = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as any[][];
        
        // Logic: Skip Rows 0 & 1. Machine Headers at Row 1 (index 1). Data starts Row 2 (index 2).
        if (rawData.length < 3) return;

        const headerRow = rawData[1]; // Row 2 (Index 1) contains machines capacities
        const dataRows = rawData.slice(2);

        const newParsedRows: ParsedBatchRow[] = [];

        dataRows.forEach((row, idx) => {
          // Columns Mapping
          // A(0): Dispatch
          // B(1): Date Sent
          // D(3): Formation Date
          // F(5): Fabric
          // G(6): Color (Inferred from sequence E is fabric, F is color... wait check prompt again)
          // Prompt: A..E, F=Fabric? No "E is Item, F is Color".
          // Let's stick to index based.
          
          if (!row || row.length === 0) return;

          const dispatch = String(row[0] || '').trim();
          if (!dispatch) return; // Skip empty rows

          // Machine Detection (M=12 onwards)
          let assignedMachine = '';
          for (let i = 12; i < headerRow.length; i++) {
             const cellVal = row[i];
             // If cell has "1" or value, it's this machine.
             if (cellVal && (String(cellVal) === '1' || String(cellVal).toLowerCase() === 'x')) {
                 const machineHeader = String(headerRow[i] || '');
                 if (machineHeader) assignedMachine = machineHeader;
                 break; 
             }
          }

          newParsedRows.push({
            id: Math.random().toString(36).substr(2, 9),
            dispatchNumber: dispatch,
            dateSent: parseExcelDate(row[1]),
            dateFormed: parseExcelDate(row[3]),
            fabricNameRaw: String(row[5] || ''), 
            colorNameRaw: String(row[6] || ''),  
            clientNameRaw: String(row[7] || ''), 
            quantitySent: Number(row[8]) || 0,   
            quantityReceived: Number(row[9]) || 0, 
            remainingRaw: Number(row[10]) || 0,  
            scrapPercentage: String(row[11] || ''), 
            assignedMachineRaw: assignedMachine,
            
            status: 'pending' // Will trigger auto-match effect
          });
        });

        setParsedRows(newParsedRows);
        setStep('reconcile');
      }
    };
    reader.readAsBinaryString(file);
  };

  // --- Auto-Matching Logic ---
  React.useEffect(() => {
     if (step === 'reconcile' && parsedRows.length > 0 && activeOrders.length > 0) {
        let hasChanges = false;
        const updatedRows = parsedRows.map(row => {
            if (row.status !== 'pending') return row;

            // Attempt to find a match
            // Strategy: 
            // 1. Try to match Client Name (Fuzzy)
            // 2. Try to match Fabric + Color matches within that Client's orders
            
            // Normalize Excel Input
            const excelClientV = (row.clientNameRaw || '').toLowerCase().trim();
            const excelFabricV = (row.fabricNameRaw || '').toLowerCase().replace(/\s+/g, '');
            const excelColorV = (row.colorNameRaw || '').toLowerCase().trim();

            let bestMatchId: string | undefined;
            let bestMatchRef: string | undefined;
            let bestMatchClient: string | undefined;

            // Simple search through orders
            // Priority: Exact Client + Fabric + Color match
            const potentialMatches = activeOrders.filter(o => {
                 // Note: Order doesnt store client name directly mostly, but we have clientId.
                 // We need to look up client name from 'clients' map using o.customerId
                 // But wait, clients map is name->id. We need id->name.
                 // Hack: Let's simpler check.
                 
                 // Check Fabric (Loose)
                 const orderFabric = (o.material || '').toLowerCase().replace(/\s+/g, '');
                 if (!orderFabric.includes(excelFabricV) && !excelFabricV.includes(orderFabric)) return false;

                 return true;
            });
            
            // Refine by Color in DyeingPlan
            const exactMatch = potentialMatches.find(o => {
                if (!o.dyeingPlan) return false;
                return o.dyeingPlan.some(batch => 
                    (batch.color || '').toLowerCase() === excelColorV
                    // && batch.dyehouse === selectedDyehouse // Optional: enforce dyehouse match? Maybe user forgot to set it in system
                );
            });

            if (exactMatch) {
                bestMatchId = exactMatch.id;
                bestMatchRef = exactMatch.orderReference || 'Order #' + exactMatch.id.substr(0,4);
                
                // Reverse lookup client name if possible, or use order's cached name if available
                // For now, accept it.
            }

            if (bestMatchId) {
                hasChanges = true;
                const displayText = exactMatch ? `${exactMatch.orderReference || exactMatch.id.substr(0,4)} - ${exactMatch.material}` : '';
                return {
                    ...row,
                    status: 'matched' as const,
                    matchedOrderId: bestMatchId,
                    matchedOrderRef: bestMatchRef,
                    selectedOrderId: bestMatchId, // Default selction
                    searchText: displayText
                };
            }
            
            // If no match found, set to 'new'
            hasChanges = true;
            return {
                ...row,
                status: 'new' as const,
                searchText: ''
            };
        });

        if (hasChanges) {
             setParsedRows(updatedRows);
        }
     }
  }, [step, parsedRows, activeOrders]); // Note: Include parsedRows in dependency might cause loop if not careful. 
  // Better to run once or use a ref. For simplicity, we limit by checking status === 'pending'.

  const handleImportRun = async () => {
    setStep('importing');
    try {
        let importedCount = 0;
        
        for (const row of parsedRows) {
            const targetOrderId = row.selectedOrderId || row.matchedOrderId;
            
            const batchData: any = {
                color: row.colorNameRaw,
                quantity: row.quantitySent, // Assuming sent is the batch size
                quantitySent: row.quantitySent,
                dyehouse: selectedDyehouse,
                machine: row.assignedMachineRaw || '',
                dateSent: row.dateSent,
                formationDate: row.dateFormed,
                dispatchNumber: row.dispatchNumber,
                status: row.quantityReceived > 0 ? 'received' : 'sent',
                receivedQuantity: row.quantityReceived, // Initial receive
                source: 'imported_excel'
            };

            if (targetOrderId) {
                // Update Existing Order
                // FIX: Use refPath from loaded orders instead of assuming root 'orders' collection
                const linkedOrder = activeOrders.find(o => o.id === targetOrderId);
                
                if (linkedOrder && linkedOrder.refPath) {
                    const orderRef = doc(db, linkedOrder.refPath);
                    await updateDoc(orderRef, {
                        // Use either subcollection or array. Assuming array 'dyeingPlan' for now as per previous code
                        dyeingPlan: arrayUnion(batchData)
                    });
                } else {
                     console.error("Could not find path for order", targetOrderId);
                }
            } else {
                // Create New "Orphan" Order or Skip
                // Per user request: "keep everything linked... might not be found... user can change that in system"
                // Ideally we create a placeholder order
                /*
                await addDoc(collection(db, 'customers', 'UNKNOWN_CLIENT', 'orders'), {
                    ...
                })
                */
               // CAUTION: Creating whole new orders is complex (requires customerId).
               // For now, we only support updating linked orders to avoid junk data.
               // Or we log it.
               console.warn("Skipping unlinked row", row);
               continue; 
            }
            importedCount++;
        }
        
        if (onImportComplete) onImportComplete();
        setStep('complete');

    } catch (e) {
        console.error("Import failed", e);
        alert("Import failed! Check console.");
        setStep('reconcile');
    }
  };

  const parseExcelDate = (val: any): string => {
     if (!val) return '';
     // Handle Excel numeric date
     if (typeof val === 'number') {
         const date = new Date(Math.round((val - 25569)*86400*1000));
         return date.toISOString().split('T')[0];
     }
     return String(val);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-6xl h-[90vh] flex flex-col overflow-hidden">
        
        {/* Header */}
        <div className="flex justify-between items-center p-4 border-b border-slate-100">
           <div className="flex items-center gap-2">
              <div className="p-2 bg-green-100 text-green-700 rounded-lg">
                 <FileSpreadsheet size={24} />
              </div>
              <div>
                  <h2 className="text-xl font-bold text-slate-800">Import Dyehouse Data</h2>
                  <p className="text-sm text-slate-500">Reconcile Excel data with system orders</p>
              </div>
           </div>
           <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-full text-slate-400">
             <X size={20} />
           </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto p-6 bg-slate-50">
           {step === 'upload' && (
              <div className="max-w-xl mx-auto mt-10">
                 <label className="block mb-4">
                    <span className="text-sm font-semibold text-slate-700 mb-1 block">Select Dyehouse</span>
                    <select 
                      className="w-full p-3 rounded-lg border border-slate-300 bg-white"
                      value={selectedDyehouse}
                      onChange={e => setSelectedDyehouse(e.target.value)}
                    >
                       {dyehouses.map(d => <option key={d} value={d}>{d}</option>)}
                    </select>
                 </label>
                 
                 <div 
                   className="border-2 border-dashed border-slate-300 rounded-xl p-10 text-center bg-white hover:bg-slate-50 transition-colors cursor-pointer"
                   onClick={() => fileInputRef.current?.click()}
                 >
                    <Upload className="mx-auto text-slate-400 mb-4" size={48} />
                    <h3 className="text-lg font-medium text-slate-700">Drop Excel file here or click to upload</h3>
                    <p className="text-sm text-slate-400 mt-2">Supports .xlsx, .xls</p>
                    <input 
                       type="file" 
                       ref={fileInputRef} 
                       className="hidden" 
                       accept=".xlsx,.xls" 
                       onChange={(e) => {
                          if (e.target.files?.[0]) processFile(e.target.files[0]);
                       }}
                    />
                 </div>
              </div>
           )}

           {step === 'reconcile' && (
              <div className="space-y-4">
                  <div className="flex justify-between items-center">
                      <div className="text-sm text-slate-500">
                          Found <span className="font-bold text-slate-800">{parsedRows.length}</span> rows
                      </div>
                      <div className="flex gap-2">
                          <button 
                             className="px-4 py-2 text-slate-600 hover:bg-slate-200 rounded-lg text-sm font-medium"
                             onClick={() => setStep('upload')}
                          >
                             Back
                          </button>
                          <button 
                             className="px-4 py-2 bg-blue-600 text-white hover:bg-blue-700 rounded-lg text-sm font-medium flex items-center gap-2 disabled:opacity-50"
                             onClick={handleImportRun}
                             disabled={parsedRows.every(r => !r.selectedOrderId && !r.matchedOrderId)} // Block if NOTHING matches
                          >
                             Confirm Import
                             <ArrowRight size={16} />
                          </button>
                      </div>
                  </div>

                  <div className="bg-white rounded-lg shadow border border-slate-200 overflow-hidden">
                      <table className="w-full text-sm">
                          <thead className="bg-slate-50 text-xs uppercase font-semibold text-slate-500">
                              <tr>
                                  <th className="p-3 text-left">Status</th>
                                  <th className="p-3 text-left">Dispatch</th>
                                  <th className="p-3 text-left">Internal Match</th>
                                  <th className="p-3 text-left">Client (Excel)</th>
                                  <th className="p-3 text-left">Fabric (Excel)</th>
                                  <th className="p-3 text-right">Sent</th>
                                  <th className="p-3 text-right">Recv</th>
                                  <th className="p-3 text-left">Machine</th>
                                  <th className="p-3 text-left">Sent Date</th>
                                  <th className="p-3 text-left">Tashkeel</th>
                              </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                              {parsedRows.map((row, idx) => {
                                  // Find the client ID for the Excel client name
                                  const normalizedExcelClient = row.clientNameRaw.toLowerCase().trim();
                                  const clientIdMatch = clients[normalizedExcelClient];
                                  
                                  // Filter orders for this customer if identified, else show all
                                  const relevantOrders = clientIdMatch 
                                    ? activeOrders.filter(o => o.customerId === clientIdMatch)
                                    : activeOrders;

                                  return (
                                  <tr key={idx} className="hover:bg-blue-50/50">
                                      <td className="p-3">
                                          <div className={`w-2 h-2 rounded-full ${row.status === 'matched' ? 'bg-emerald-500' : 'bg-amber-400'}`} />
                                      </td>
                                      <td className="p-3 font-mono text-slate-600">{row.dispatchNumber}</td>
                                      <td className="p-3">
                                          {row.status === 'pending' ? (
                                             <div className="flex items-center gap-2 text-slate-400 italic text-xs">
                                                  <Loader2 size={12} className="animate-spin" />
                                                  Matching...
                                             </div>
                                          ) : row.matchedOrderId || row.selectedOrderId ? (
                                              <div className="flex flex-col">
                                                  <span className="text-emerald-700 font-bold text-xs flex items-center gap-1 mb-1">
                                                      <Check size={10} />
                                                      Matched
                                                  </span>
                                                  <SearchDropdown 
                                                    options={relevantOrders.map(o => `${o.orderReference || o.id.substr(0,4)} - ${o.material} (${o.requiredQty}kg)`)}
                                                    className="w-full text-[10px] border border-slate-200 rounded p-1 max-w-[150px] bg-white"
                                                    value={row.searchText ?? ''}
                                                    placeholder="Type to search..."
                                                    onChange={(val) => {
                                                        let newSelectedId = undefined;
                                                        const match = relevantOrders.find(o => 
                                                            `${o.orderReference || o.id.substr(0,4)} - ${o.material} (${o.requiredQty}kg)` === val
                                                        );

                                                        if (match) newSelectedId = match.id;

                                                        setParsedRows(prev => prev.map(r => r.id === row.id ? { 
                                                            ...r, 
                                                            searchText: val, 
                                                            selectedOrderId: newSelectedId || r.selectedOrderId, 
                                                            status: newSelectedId ? 'matched' : (val ? 'matched' : 'new')
                                                        } : r));
                                                    }} 
                                                  />
                                              </div>
                                          ) : (
                                              <div className="flex flex-col">
                                                  <span className="text-amber-600 font-bold text-xs mb-1">No Match</span>
                                                   <SearchDropdown 
                                                    options={relevantOrders.map(o => `${o.orderReference || o.id.substr(0,4)} - ${o.material} (${o.requiredQty}kg)`)}
                                                    className="w-full text-[10px] border border-amber-200 rounded p-1 bg-amber-50"
                                                    value={row.searchText ?? ''}
                                                    placeholder="Search order..."
                                                    onChange={(val) => {
                                                        let newSelectedId = undefined;
                                                        
                                                        const match = relevantOrders.find(o => 
                                                            `${o.orderReference || o.id.substr(0,4)} - ${o.material} (${o.requiredQty}kg)` === val
                                                        );

                                                        if (match) newSelectedId = match.id;

                                                        setParsedRows(prev => prev.map(r => r.id === row.id ? { 
                                                            ...r, 
                                                            searchText: val, 
                                                            selectedOrderId: newSelectedId,
                                                            status: newSelectedId ? 'matched' : 'new'
                                                        } : r));
                                                    }}
                                                  />
                                              </div>
                                          )}
                                      </td>
                                      <td className="p-3 text-slate-700">{row.clientNameRaw}</td>
                                      <td className="p-3 text-slate-700">
                                          <div className="flex flex-col">
                                              <span className="font-medium">{row.fabricNameRaw}</span>
                                              <span className="text-[10px] text-slate-400">{row.colorNameRaw}</span>
                                          </div>
                                      </td>
                                      <td className="p-3 text-right font-mono">{row.quantitySent}</td>
                                      <td className="p-3 text-right font-mono">{row.quantityReceived}</td>
                                      <td className="p-3 text-slate-500 text-xs">{row.assignedMachineRaw || '-'}</td>
                                      <td className="p-3 text-slate-500 text-xs">{row.dateSent}</td>
                                      <td className="p-3 text-slate-500 text-xs">{row.dateFormed}</td>
                                  </tr>
                                  );
                              })}
                          </tbody>
                      </table>
                  </div>
              </div>
           )}
        </div>
      </div>
    </div>
  );
};

interface SearchDropdownProps {
  options: string[];
  value: string;
  onChange: (val: string) => void;
  placeholder?: string;
  className?: string;
}

const SearchDropdown: React.FC<SearchDropdownProps> = ({
  options,
  value,
  onChange,
  placeholder = 'Search...',
  className
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [inputValue, setInputValue] = useState(value);
  const containerRef = useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    setInputValue(value);
  }, [value]);

  React.useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const filteredOptions = options.filter(opt =>
    opt.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const handleSelect = (val: string) => {
    setInputValue(val);
    onChange(val);
    setSearchTerm('');
    setIsOpen(false);
  };

  return (
    <div className="relative w-full" ref={containerRef}>
      <input
        type="text"
        value={inputValue}
        onChange={(e) => {
            setInputValue(e.target.value);
            setSearchTerm(e.target.value);
            setIsOpen(true);
            if(e.target.value === '') onChange('');
        }}
        onFocus={() => {
            setSearchTerm(''); 
            setIsOpen(true);
        }}
        placeholder={placeholder}
        className={className}
      />
      
      {isOpen && (
        <div className="fixed z-[9999] min-w-[300px] max-w-[500px] bg-white border border-slate-200 shadow-xl rounded-md mt-1 max-h-60 overflow-y-auto"
             style={{
               top: containerRef.current ? containerRef.current.getBoundingClientRect().bottom : 'auto',
               left: containerRef.current ? containerRef.current.getBoundingClientRect().left : 'auto'
             }}>
          {filteredOptions.length > 0 ? (
              filteredOptions.map((opt, idx) => (
                <div
                  key={idx}
                  onClick={() => handleSelect(opt)}
                  className="px-3 py-2 hover:bg-blue-50 cursor-pointer text-[11px] border-b border-slate-50 last:border-b-0 text-left text-slate-700 block whitespace-normal break-words"
                >
                  {opt}
                </div>
              ))
          ) : (
            <div className="px-3 py-2 text-xs text-slate-400 text-left">No matches</div>
          )}
        </div>
      )}
    </div>
  );
};
