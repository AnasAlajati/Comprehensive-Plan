import React, { useState, useEffect, useRef, useMemo } from 'react';
import { 
  collection, 
  onSnapshot, 
  doc, 
  addDoc, 
  updateDoc,
  deleteDoc,
  query,
  where,
  or,
  getDocs
} from 'firebase/firestore';
import { db } from '../services/firebase';
import { DataService } from '../services/dataService';
import { CustomerSheet, OrderRow, MachineSS, MachineStatus, Fabric, Yarn, YarnInventoryItem, YarnAllocationItem } from '../types';
import { FabricDetailsModal } from './FabricDetailsModal';
import { 
  Plus, 
  Trash2, 
  UserPlus, 
  Search,
  FileSpreadsheet,
  MapPin,
  CheckCircle2,
  AlertCircle,
  X,
  Calendar,
  Calculator,
  CheckSquare,
  Square,
  Droplets,
  ChevronDown,
  ChevronRight,
  Package,
  Users,
  ArrowRight
} from 'lucide-react';

const ALL_CLIENTS_ID = 'ALL_CLIENTS';
const ALL_YARNS_ID = 'ALL_YARNS';

// Global CSS to hide number input spinners
const globalStyles = `
  input[type="number"]::-webkit-inner-spin-button,
  input[type="number"]::-webkit-outer-spin-button {
    -webkit-appearance: none;
    margin: 0;
  }
  input[type="number"] {
    -moz-appearance: textfield;
  }
`;

interface SearchDropdownProps {
  id: string;
  options: any[];
  value: string;
  onChange: (value: string) => void;
  onCreateNew?: (newValue: string) => void;
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

  useEffect(() => {
    setInputValue(value);
  }, [value]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Close on scroll to prevent detached fixed element
  useEffect(() => {
    const handleScroll = () => {
      if (isOpen) setIsOpen(false);
    };
    window.addEventListener('scroll', handleScroll, true);
    return () => window.removeEventListener('scroll', handleScroll, true);
  }, [isOpen]);

  const filteredOptions = options.filter(opt =>
    opt.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const handleSelect = (optionName: string) => {
    setInputValue(optionName);
    onChange(optionName);
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

  return (
    <div className="relative w-full h-full" ref={containerRef}>
      <input
        id={id}
        type="text"
        value={inputValue}
        onChange={handleInputChange}
        onFocus={() => {
          setIsOpen(true);
          if (onFocus) onFocus();
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && filteredOptions.length > 0) {
             handleSelect(filteredOptions[0].name);
          } else if (e.key === 'Enter' && onCreateNew && searchTerm) {
             onCreateNew(searchTerm);
             setIsOpen(false);
          }
          if (onKeyDown) onKeyDown(e);
        }}
        placeholder={placeholder}
        className={className || "w-full h-full px-2 py-1 bg-transparent outline-none focus:bg-blue-50 text-center"}
        autoComplete="off"
      />
      {isOpen && (searchTerm || filteredOptions.length > 0) && (
        <div className="fixed z-[9999] min-w-[200px] bg-white border border-slate-200 shadow-xl rounded-md mt-1 max-h-60 overflow-y-auto"
             style={{
               top: containerRef.current ? containerRef.current.getBoundingClientRect().bottom : 'auto',
               left: containerRef.current ? containerRef.current.getBoundingClientRect().left : 'auto'
             }}>
          {filteredOptions.length > 0 ? (
            <>
              {filteredOptions.map((opt, idx) => (
                <div
                  key={idx}
                  onClick={() => handleSelect(opt.name)}
                  className="px-3 py-2 hover:bg-blue-50 cursor-pointer text-sm border-b border-slate-50 last:border-b-0 text-left"
                >
                  {opt.name}
                </div>
              ))}
              {onCreateNew && searchTerm && !options.some(o => o.name.toLowerCase() === searchTerm.toLowerCase()) && (
                <div
                  onClick={() => {
                    onCreateNew(searchTerm);
                    setIsOpen(false);
                  }}
                  className="px-3 py-2 hover:bg-emerald-50 cursor-pointer text-sm border-t border-slate-100 text-emerald-600 font-medium text-left"
                >
                  + Add "{searchTerm}"
                </div>
              )}
            </>
          ) : onCreateNew && searchTerm ? (
            <div
              onClick={() => {
                onCreateNew(searchTerm);
                setIsOpen(false);
              }}
              className="px-3 py-2 hover:bg-emerald-50 cursor-pointer text-sm text-emerald-600 font-medium text-left"
            >
              + Add "{searchTerm}"
            </div>
          ) : (
            <div className="px-3 py-2 text-sm text-slate-400 text-left">No options</div>
          )}
        </div>
      )}
    </div>
  );
};

// --- Optimized Row Component ---
const MemoizedOrderRow = React.memo(({
  row,
  statusInfo,
  fabrics,
  isSelected,
  toggleSelectRow,
  handleUpdateOrder,
  handleCreateFabric,
  handlePlanSearch,
  handleDeleteRow,
  selectedCustomerName,
  onOpenFabricDetails,
  showDyehouse
}: {
  row: OrderRow;
  statusInfo: any;
  fabrics: any[];
  isSelected: boolean;
  toggleSelectRow: (id: string) => void;
  handleUpdateOrder: (id: string, updates: Partial<OrderRow>) => void;
  handleCreateFabric: (name: string) => void;
  handlePlanSearch: (client: string, material: string) => void;
  handleDeleteRow: (id: string) => void;
  selectedCustomerName: string;
  onOpenFabricDetails: (fabricName: string, qty: number, orderId: string) => void;
  showDyehouse: boolean;
}) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const refCode = row.material ? `${selectedCustomerName}-${row.material}` : '-';
  const hasActive = statusInfo && statusInfo.active.length > 0;
  const displayRemaining = hasActive ? statusInfo.remaining : row.remainingQty;

  // Calculate Total Yarn for this order if fabric has composition
  const fabricDetails = fabrics.find(f => f.name === row.material);
  const hasComposition = fabricDetails?.yarnComposition && fabricDetails.yarnComposition.length > 0;
  
  let totalYarnForOrder = 0;
  if (hasComposition && row.requiredQty > 0) {
    totalYarnForOrder = fabricDetails.yarnComposition.reduce((sum: number, comp: any) => {
      const base = (row.requiredQty * (comp.percentage || 0)) / 100;
      const scrap = 1 + ((comp.scrapPercentage || 0) / 100);
      return sum + (base * scrap);
    }, 0);
  }

  // Calculate Assigned Machines Summary
  const assignedMachinesSummary = useMemo(() => {
    if (!row.dyeingPlan || row.dyeingPlan.length === 0) return '-';
    
    const machineCounts = new Map<string, number>();
    row.dyeingPlan.forEach(batch => {
      if (batch.machine) {
        const current = machineCounts.get(batch.machine) || 0;
        machineCounts.set(batch.machine, current + 1);
      }
    });

    if (machineCounts.size === 0) return '-';

    return Array.from(machineCounts.entries())
      .map(([machine, count]) => `${machine}*${count}`)
      .join(' + ');
  }, [row.dyeingPlan]);

  return (
    <>
    <tr className={`transition-colors group text-sm ${isSelected ? 'bg-blue-50' : 'hover:bg-blue-50/30'}`}>
      {/* Checkbox */}
      <td className="p-0 border-r border-slate-200 text-center align-middle">
        <button onClick={() => toggleSelectRow(row.id)} className="p-2 w-full h-full flex items-center justify-center text-slate-400 hover:text-blue-600">
          {isSelected ? <CheckSquare className="w-4 h-4 text-blue-600" /> : <Square className="w-4 h-4" />}
        </button>
      </td>

      {showDyehouse ? (
        <>
          {/* Fabric (Read-only in Dyehouse View) */}
          <td className="p-0 border-r border-slate-200 relative group/fabric" title={refCode}>
             <div className="flex items-center h-full w-full px-3 py-2 text-slate-700 font-medium">
                {row.material || '-'}
             </div>
          </td>
          {/* Dyehouse */}
          <td className="p-0 border-r border-slate-200">
            <input 
              type="text"
              className="w-full h-full px-3 py-2 bg-transparent outline-none focus:bg-blue-50"
              value={row.dyehouse || ''}
              onChange={(e) => handleUpdateOrder(row.id, { dyehouse: e.target.value })}
              placeholder="Dyehouse..."
            />
          </td>
          {/* Assigned Machines (Calculated) */}
          <td className="p-0 border-r border-slate-200">
             <div className="flex items-center h-full w-full px-3 py-2 text-slate-700 font-mono text-xs">
                {assignedMachinesSummary}
             </div>
          </td>
          {/* Expand Button */}
          <td className="p-0 text-center border-r border-slate-200">
            <button 
              onClick={() => setIsExpanded(!isExpanded)}
              className={`p-2 rounded-full transition-colors ${isExpanded ? 'bg-blue-100 text-blue-600' : 'text-slate-400 hover:bg-slate-100'}`}
              title="Manage Colors"
            >
              {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
            </button>
          </td>
        </>
      ) : (
        <>
          {/* Fabric */}
          <td className="p-0 border-r border-slate-200 relative group/fabric" title={refCode}>
            <div className="flex items-center h-full w-full">
              <div className="flex-1 h-full flex flex-col justify-center">
                <SearchDropdown
                  id={`fabric-${row.id}`}
                  options={fabrics}
                  value={row.material}
                  onChange={(val) => handleUpdateOrder(row.id, { material: val })}
                  onCreateNew={handleCreateFabric}
                  placeholder="Select Fabric..."
                />
                {hasComposition && (
                   <div className="px-2 pb-1 text-[10px] text-slate-500 font-mono flex items-center gap-1 opacity-0 group-hover/fabric:opacity-100 transition-opacity">
                     <CheckCircle2 className="w-3 h-3 text-emerald-500" />
                     <span>Verified</span>
                   </div>
                )}
              </div>
              {row.material && (
                <button
                  onClick={() => onOpenFabricDetails(row.material, row.requiredQty, row.id)}
                  className={`absolute right-1 top-1/2 -translate-y-1/2 p-1 rounded transition-all z-10 ${hasComposition ? 'text-emerald-600 bg-emerald-50 opacity-100' : 'text-slate-400 hover:text-blue-600 hover:bg-blue-50 opacity-0 group-hover/fabric:opacity-100'}`}
                  title="Yarn Composition"
                >
                  <Calculator className="w-3 h-3" />
                </button>
              )}
            </div>
          </td>

          {/* Accessories */}
          <td className="p-0 border-r border-slate-200 relative">
            <input 
              type="text"
              className="w-full h-full px-3 py-2 bg-transparent outline-none focus:bg-blue-50"
              value={row.accessory}
              onChange={(e) => handleUpdateOrder(row.id, { accessory: e.target.value })}
              placeholder=""
            />
            {row.accessoryPercentage != null && row.accessoryPercentage > 0 && (
              <div className="absolute right-1 top-1/2 -translate-y-1/2 text-[10px] bg-slate-100 text-slate-500 px-1 rounded pointer-events-none">
                {row.accessoryPercentage}%
              </div>
            )}
          </td>

          {/* Acc. Qty */}
          <td className="p-0 border-r border-slate-200">
              <input 
              type="number"
              className="w-full h-full px-2 py-2 text-right bg-transparent outline-none focus:bg-blue-50 font-mono text-slate-600 text-xs"
              value={row.accessoryQty ?? ''}
              onChange={(e) => handleUpdateOrder(row.id, { accessoryQty: Number(e.target.value) })}
              placeholder="-"
            />
          </td>
        </>
      )}

      {!showDyehouse && (
        <>
          {/* Status / Plan (Combined) */}
          <td className="p-2 border-r border-slate-200 align-middle">
            <div className="flex items-center justify-between gap-2">
              <div className="flex flex-col gap-1 flex-1 min-w-0">
                {statusInfo ? (
                  <>
                    {statusInfo.active.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {statusInfo.active.map((m: string, i: number) => (
                          <span key={`a-${i}`} className="text-[10px] px-1.5 py-0.5 bg-emerald-100 text-emerald-700 rounded-full font-medium whitespace-nowrap border border-emerald-200">
                            {m}
                          </span>
                        ))}
                      </div>
                    )}
                    {statusInfo.planned.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {statusInfo.planned.map((m: string, i: number) => (
                          <span key={`p-${i}`} className="text-[10px] px-1.5 py-0.5 bg-blue-100 text-blue-700 rounded-full font-medium whitespace-nowrap border border-blue-200">
                            {m}
                          </span>
                        ))}
                      </div>
                    )}
                    {/* Fallback if no active/planned but statusInfo exists */}
                    {statusInfo.active.length === 0 && statusInfo.planned.length === 0 && (
                       (displayRemaining || 0) > 0 ? (
                        <span className="text-[10px] text-amber-600 font-medium bg-amber-50 px-2 py-0.5 rounded-full whitespace-nowrap border border-amber-100 w-fit">
                          Not Planned
                        </span>
                      ) : (
                        <span className="text-[10px] text-slate-400 font-medium bg-slate-100 px-2 py-0.5 rounded-full whitespace-nowrap border border-slate-200 w-fit">
                          Finished
                        </span>
                      )
                    )}
                  </>
                ) : (
                  (displayRemaining || 0) > 0 ? (
                    <span className="text-[10px] text-amber-600 font-medium bg-amber-50 px-2 py-0.5 rounded-full whitespace-nowrap border border-amber-100 w-fit">
                      Not Planned
                    </span>
                  ) : (
                    <span className="text-[10px] text-slate-400 font-medium bg-slate-100 px-2 py-0.5 rounded-full whitespace-nowrap border border-slate-200 w-fit">
                      Finished
                    </span>
                  )
                )}
              </div>
              
              <button
                onClick={() => handlePlanSearch(selectedCustomerName, row.material)}
                className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-md transition-all flex-shrink-0"
                title="Search Plan"
              >
                <Search className="w-4 h-4" />
              </button>
            </div>
          </td>
        </>
      )}

      {/* Ordered Qty */}
      <td className="p-0 border-r border-slate-200">
        <input 
          type="number"
          className="w-full h-full px-2 py-2 text-right bg-transparent outline-none focus:bg-blue-50 font-mono text-slate-700"
          value={row.requiredQty ?? ''}
          onChange={(e) => {
            const val = e.target.value === '' ? 0 : Number(e.target.value);
            const updates: Partial<OrderRow> = { requiredQty: val };
            // If not active, update remaining too
            if (!statusInfo || (statusInfo.active.length === 0)) {
                updates.remainingQty = val;
            }
            handleUpdateOrder(row.id, updates);
          }}
        />
      </td>

      {!showDyehouse && (
        <>
          {/* Remaining Qty */}
          <td className={`p-0 border-r border-slate-200 font-mono font-bold ${hasActive ? 'bg-emerald-50/30' : ''}`}>
            <input 
              type="number"
              className={`w-full h-full px-2 py-2 text-right bg-transparent outline-none focus:bg-blue-50 ${hasActive ? 'text-emerald-600' : 'text-slate-600'}`}
              value={displayRemaining ?? ''}
              onChange={(e) => handleUpdateOrder(row.id, { remainingQty: Number(e.target.value) })}
            />
          </td>

          {/* Order Receive Date */}
          <td className="p-0 border-r border-slate-200">
            <input 
              type="date"
              className="w-full h-full px-2 py-2 text-center bg-transparent outline-none focus:bg-blue-50 text-xs text-slate-600"
              value={row.orderReceiptDate || ''}
              onChange={(e) => handleUpdateOrder(row.id, { orderReceiptDate: e.target.value })}
            />
          </td>

          {/* Start Date (Auto) */}
          <td className="p-2 text-center border-r border-slate-200 text-xs text-slate-500">
            {statusInfo?.startDate || '-'}
          </td>

          {/* End Date (Auto) */}
          <td className="p-2 text-center border-r border-slate-200 text-xs text-slate-500">
            {statusInfo?.endDate || '-'}
          </td>

          {/* Scrap (Auto) */}
          <td className="p-2 text-right border-r border-slate-200 text-xs text-red-500 font-mono">
            {statusInfo?.scrap ? statusInfo.scrap.toFixed(1) : '-'}
          </td>

          {/* Others (Auto) */}
          <td className="p-2 text-left border-r border-slate-200 text-xs text-slate-500 truncate max-w-[100px]" title={statusInfo?.others}>
            {statusInfo?.others || '-'}
          </td>

          {/* Notes */}
          <td className="p-0 border-r border-slate-200">
            <textarea
              className="w-full h-full px-2 py-1 bg-transparent outline-none focus:bg-blue-50 text-xs resize-none overflow-hidden"
              value={row.notes || ''}
              onChange={(e) => handleUpdateOrder(row.id, { notes: e.target.value })}
              placeholder="Notes..."
              rows={1}
            />
          </td>

          {/* Fabric Delivery */}
          <td className="p-0 border-r border-slate-200 bg-orange-50/50">
            <input 
              type="number"
              className="w-full h-full px-2 py-2 text-right bg-transparent outline-none focus:bg-orange-100 font-mono text-slate-700 text-xs"
              value={row.batchDeliveries ?? ''}
              onChange={(e) => handleUpdateOrder(row.id, { batchDeliveries: Number(e.target.value) })}
              placeholder="-"
            />
          </td>

          {/* Accessory Delivery */}
          <td className="p-0 border-r border-slate-200 bg-purple-50/50">
            <input 
              type="number"
              className="w-full h-full px-2 py-2 text-right bg-transparent outline-none focus:bg-purple-100 font-mono text-slate-700 text-xs"
              value={row.accessoryDeliveries ?? ''}
              onChange={(e) => handleUpdateOrder(row.id, { accessoryDeliveries: Number(e.target.value) })}
              placeholder="-"
            />
          </td>
        </>
      )}

      {/* Actions */}
      <td className="p-0 text-center">
        <button 
          onClick={() => handleDeleteRow(row.id)}
          className="p-2 text-slate-400 hover:text-red-500 transition-colors opacity-0 group-hover:opacity-100"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </td>
    </tr>
    
    {/* Expanded Dyehouse Plan Row */}
    {showDyehouse && isExpanded && (
      <tr className="bg-slate-50/50 animate-in slide-in-from-top-2">
        <td colSpan={1} className="border-r border-slate-200"></td>
        <td colSpan={5} className="p-4 border-b border-slate-200 shadow-inner">
            <div className="bg-white rounded border border-slate-200 overflow-hidden">
              <table className="w-full text-xs">
                <thead className="bg-slate-50 text-slate-500 font-semibold border-b border-slate-200">
                  <tr>
                    <th className="px-3 py-2 text-left w-1/4">Color</th>
                    <th className="px-3 py-2 text-right w-24">Qty (kg)</th>
                    <th className="px-3 py-2 text-left w-1/4">Assigned Machine</th>
                    <th className="px-3 py-2 text-left">Notes</th>
                    <th className="px-3 py-2 w-10"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {(row.dyeingPlan || []).map((batch, idx) => (
                    <tr key={batch.id || idx} className="group/batch hover:bg-blue-50/30">
                      <td className="p-0">
                        <input
                          type="text"
                          className="w-full px-3 py-2 bg-transparent outline-none focus:bg-blue-50"
                          value={batch.color}
                          onChange={(e) => {
                            const newPlan = [...(row.dyeingPlan || [])];
                            newPlan[idx] = { ...batch, color: e.target.value };
                            handleUpdateOrder(row.id, { dyeingPlan: newPlan });
                          }}
                          placeholder="Color Name..."
                        />
                      </td>
                      <td className="p-0">
                        <input
                          type="number"
                          className="w-full px-3 py-2 text-right bg-transparent outline-none focus:bg-blue-50 font-mono"
                          value={batch.quantity || ''}
                          onChange={(e) => {
                            const newPlan = [...(row.dyeingPlan || [])];
                            newPlan[idx] = { ...batch, quantity: Number(e.target.value) };
                            handleUpdateOrder(row.id, { dyeingPlan: newPlan });
                          }}
                          placeholder="0"
                        />
                      </td>
                      <td className="p-0">
                        <input
                          type="text"
                          className="w-full px-3 py-2 bg-transparent outline-none focus:bg-blue-50"
                          value={batch.machine}
                          onChange={(e) => {
                            const newPlan = [...(row.dyeingPlan || [])];
                            newPlan[idx] = { ...batch, machine: e.target.value };
                            handleUpdateOrder(row.id, { dyeingPlan: newPlan });
                          }}
                          placeholder="Machine..."
                        />
                      </td>
                      <td className="p-0">
                        <input
                          type="text"
                          className="w-full px-3 py-2 bg-transparent outline-none focus:bg-blue-50"
                          value={batch.notes}
                          onChange={(e) => {
                            const newPlan = [...(row.dyeingPlan || [])];
                            newPlan[idx] = { ...batch, notes: e.target.value };
                            handleUpdateOrder(row.id, { dyeingPlan: newPlan });
                          }}
                          placeholder="Notes..."
                        />
                      </td>
                      <td className="p-0 text-center">
                        <button
                          onClick={() => {
                            const newPlan = row.dyeingPlan?.filter((_, i) => i !== idx);
                            handleUpdateOrder(row.id, { dyeingPlan: newPlan });
                          }}
                          className="p-2 text-slate-400 hover:text-red-500 opacity-0 group-hover/batch:opacity-100 transition-opacity"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </td>
                    </tr>
                  ))}
                  {/* Add Button Row */}
                  <tr>
                    <td colSpan={5} className="p-2">
                      <button
                        onClick={() => {
                          const newBatch = {
                            id: crypto.randomUUID(),
                            color: '',
                            quantity: 0,
                            machine: '',
                            notes: ''
                          };
                          handleUpdateOrder(row.id, { 
                            dyeingPlan: [...(row.dyeingPlan || []), newBatch] 
                          });
                        }}
                        className="flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-700 px-2 py-1 rounded hover:bg-blue-50 transition-colors"
                      >
                        <Plus className="w-3 h-3" />
                        Add Color
                      </button>
                    </td>
                  </tr>
                </tbody>
              </table>
        </div>
        </td>
      </tr>
    )}
    </>
  );
});

export const ClientOrdersPage: React.FC = () => {
  const [customers, setCustomers] = useState<CustomerSheet[]>([]);
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [newCustomerName, setNewCustomerName] = useState('');
  const [isAddingCustomer, setIsAddingCustomer] = useState(false);
  const [fabrics, setFabrics] = useState<Fabric[]>([]);
  const [yarns, setYarns] = useState<Yarn[]>([]);
  const [inventory, setInventory] = useState<YarnInventoryItem[]>([]);
  const [machines, setMachines] = useState<MachineSS[]>([]);
  const [activeDay, setActiveDay] = useState<string>(new Date().toISOString().split('T')[0]);
  const [showYarnRequirements, setShowYarnRequirements] = useState(false);
  const [selectedYarnDetails, setSelectedYarnDetails] = useState<any>(null);
  const [showDyehouse, setShowDyehouse] = useState(false);
  
  // Fabric Details Modal State
  const [fabricDetailsModal, setFabricDetailsModal] = useState<{
    isOpen: boolean;
    fabric: Fabric | null;
    orderQuantity: number;
    orderId?: string;
    customerId?: string;
    allocations?: Record<string, YarnAllocationItem[]>;
  }>({ isOpen: false, fabric: null, orderQuantity: 0 });

  // Fix for state reset issue
  const initialSelectionMade = useRef(false);

  // Bulk Selection State
  const [selectedRows, setSelectedRows] = useState<Set<string>>(new Set());
  const [bulkDate, setBulkDate] = useState<string>('');
  const [showBulkDateInput, setShowBulkDateInput] = useState(false);

  // Plan Search Modal State
  const [planSearchModal, setPlanSearchModal] = useState<{
    isOpen: boolean;
    reference: string;
    results: { machineName: string; type: 'ACTIVE' | 'PLANNED'; details: string; date?: string }[];
  }>({ isOpen: false, reference: '', results: [] });

  // Inventory View Modal State
  const [inventoryViewModal, setInventoryViewModal] = useState<{
    isOpen: boolean;
    yarnName: string;
    yarnId?: string;
  }>({ isOpen: false, yarnName: '' });

  // Yarn Breakdown Modal State
  const [yarnBreakdownModal, setYarnBreakdownModal] = useState<{
    isOpen: boolean;
    yarnName: string;
    totalWeight: number;
    fabrics: { name: string; weight: number }[];
  }>({ isOpen: false, yarnName: '', totalWeight: 0, fabrics: [] });

  // Fetch Data
  useEffect(() => {
    // Customers
    const unsubCustomers = onSnapshot(collection(db, 'CustomerSheets'), (snapshot) => {
      const data = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as CustomerSheet));
      data.sort((a, b) => a.name.localeCompare(b.name));
      setCustomers(data);
      
      // Only set initial selection once
      if (!initialSelectionMade.current && data.length > 0) {
        setSelectedCustomerId(data[0].id);
        initialSelectionMade.current = true;
      }
    });

    // Machines (for active status)
    const unsubMachines = onSnapshot(collection(db, 'MachineSS'), (snapshot) => {
      const data = snapshot.docs.map(d => d.data() as MachineSS);
      setMachines(data);
    });

    // Fabrics
    DataService.getFabrics().then(setFabrics);

    // Yarns
    DataService.getYarns().then(setYarns);

    // Inventory
    const unsubInventory = onSnapshot(collection(db, 'yarn_inventory'), (snapshot) => {
      const data = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as YarnInventoryItem));
      setInventory(data);
    });

    // Active Day
    const unsubSettings = onSnapshot(doc(db, 'settings', 'global'), (doc) => {
      if (doc.exists() && doc.data().activeDay) {
        setActiveDay(doc.data().activeDay);
      }
    });

    return () => {
      unsubCustomers();
      unsubMachines();
      unsubInventory();
      unsubSettings();
    };
  }, []);

  const selectedCustomer = customers.find(c => c.id === selectedCustomerId);

  // --- Optimization: Pre-calculate Stats Map ---
  const statsMap = useMemo(() => {
    if (!selectedCustomer) return new Map();
    
    const map = new Map<string, any>();
    const clientName = selectedCustomer.name;

    // We only care about fabrics in the current order list to save time
    const relevantFabrics = new Set(selectedCustomer.orders.map(o => o.material).filter(Boolean));

    relevantFabrics.forEach(fabric => {
        const refCode = `${clientName}-${fabric}`;
        const activeMachines: string[] = [];
        const plannedMachines: string[] = [];
        let remaining = 0;
        let scrap = 0;
        let minDate: string | null = null;
        let maxDate: string | null = null;

        // 1. Scan Machines
        machines.forEach(m => {
            // Helper for robust comparison
            const normalize = (s: string) => s ? s.trim().toLowerCase() : '';
            const normClient = normalize(clientName);
            const normFabric = normalize(fabric);

            // Check Active Logs
            const activeLog = m.dailyLogs?.find(l => l.date === activeDay);
            if (activeLog && (activeLog.status === 'Working' || activeLog.status === 'تعمل')) {
                // Robust Match: Check Reference OR (Client AND Fabric)
                // We normalize client/fabric to handle case/whitespace differences
                const logClient = normalize(activeLog.client);
                const logFabric = normalize(activeLog.fabric);
                
                const isMatch = (activeLog.orderReference === refCode) || 
                                (logClient === normClient && logFabric === normFabric);
                                
                if (isMatch) {
                    activeMachines.push(m.name);
                    remaining += (Number(activeLog.remainingMfg) || 0);

                    // Calculate End Date for Active Machine
                    const prod = Number(activeLog.dayProduction) || 0;
                    const rem = Number(activeLog.remainingMfg) || 0;
                    if (prod > 0 && rem > 0) {
                        const daysNeeded = Math.ceil(rem / prod);
                        const d = new Date(activeDay);
                        d.setDate(d.getDate() + daysNeeded);
                        const dateStr = d.toISOString().split('T')[0];
                        if (!maxDate || dateStr > maxDate) {
                            maxDate = dateStr;
                        }
                        // Also update minDate if it's the first date we see (start date is today/activeDay)
                        if (!minDate || activeDay < minDate) {
                            minDate = activeDay;
                        }
                    }
                }
            }

            // Check All Logs (Scrap)
            m.dailyLogs?.forEach(log => {
                const logClient = normalize(log.client);
                const logFabric = normalize(log.fabric);
                const isMatch = (log.orderReference === refCode) || 
                                (logClient === normClient && logFabric === normFabric);
                if (isMatch) {
                    scrap += (Number(log.scrap) || 0);
                }
            });

            // Check Future Plans
            m.futurePlans?.forEach(plan => {
                const planClient = normalize(plan.client);
                const planFabric = normalize(plan.fabric);
                
                if (planClient === normClient && planFabric === normFabric) {
                    if (!plannedMachines.includes(m.name)) plannedMachines.push(m.name);
                    
                    if (plan.startDate && (!minDate || plan.startDate < minDate)) minDate = plan.startDate;
                    if (plan.endDate && (!maxDate || plan.endDate > maxDate)) maxDate = plan.endDate;
                }
            });
        });

        // 2. Scan Other Customers
        const otherClients = new Set<string>();
        customers.forEach(c => {
            if (c.id === selectedCustomer.id) return;
            const hasFabric = c.orders.some(o => o.material === fabric);
            if (hasFabric) otherClients.add(c.name);
        });

        map.set(fabric, {
            active: activeMachines,
            planned: plannedMachines,
            remaining,
            startDate: minDate || '-',
            endDate: maxDate || '-',
            scrap,
            others: Array.from(otherClients).join(', ')
        });
    });

    return map;
  }, [selectedCustomer, machines, customers, activeDay]);

  const allClientsStats = useMemo(() => {
    if (selectedCustomerId !== ALL_CLIENTS_ID) return [];

    return customers.map(client => {
      const ordered = client.orders.reduce((sum, o) => sum + (o.requiredQty || 0), 0);
      const remaining = client.orders.reduce((sum, o) => sum + (o.remainingQty || 0), 0);
      const delivery = client.orders.reduce((sum, o) => sum + (o.batchDeliveries || 0), 0);
      
      const manufactured = Math.max(0, ordered - remaining);
      const remainingDelivery = Math.max(0, ordered - delivery);
      
      const dates = Array.from(new Set(client.orders.map(o => o.orderReceiptDate).filter(Boolean))).sort();

      return {
        ...client,
        stats: { ordered, manufactured, remaining, delivery, remainingDelivery, dates }
      };
    }).sort((a, b) => b.stats.ordered - a.stats.ordered);
  }, [customers, selectedCustomerId]);

  const allYarnStats = useMemo(() => {
    if (selectedCustomerId !== ALL_YARNS_ID) return [];

    const requirements = new Map<string, { 
      total: number, 
      allocations: { 
        clientName: string, 
        orderId: string, 
        fabricName: string, 
        requiredQty: number,
        percentage: number
      }[] 
    }>();

    // Calculate Requirements across ALL customers
    customers.forEach(client => {
      client.orders?.forEach(order => {
        if (!order.material || !order.requiredQty) return;
        
        const fabric = fabrics.find(f => f.name === order.material);
        if (!fabric?.yarnComposition) return;

        fabric.yarnComposition.forEach(comp => {
          // Use yarnId if available, otherwise fallback to name
          const key = comp.yarnId || comp.yarnName;
          if (!key) return;
          
          const baseQty = (order.requiredQty * (comp.percentage || 0)) / 100;
          const scrapMultiplier = 1 + ((comp.scrapPercentage || 0) / 100);
          const totalNeeded = baseQty * scrapMultiplier;

          const current = requirements.get(key) || { total: 0, allocations: [] };
          
          current.total += totalNeeded;
          current.allocations.push({
            clientName: client.name,
            orderId: order.id,
            fabricName: order.material,
            requiredQty: totalNeeded,
            percentage: comp.percentage || 0
          });
          
          requirements.set(key, current);
        });
      });
    });

    // Aggregate Inventory
    const stock = new Map<string, number>();
    inventory.forEach(item => {
      // Inventory items usually have yarnName. If we have yarnId in inventory, use it.
      // Assuming inventory is linked by name for now if ID is missing, but ideally ID.
      // Let's try to match by ID first, then name.
      // The inventory structure has `yarnName`. Let's see if we can map it.
      // The `yarns` array has `id` and `name`.
      
      // Strategy: Map inventory yarnName to yarnId if possible
      const yarnDef = yarns.find(y => y.name === item.yarnName);
      const key = yarnDef ? yarnDef.id : item.yarnName; // Fallback to name if no ID found
      
      const current = stock.get(key) || 0;
      stock.set(key, current + item.quantity);
    });

    // Combine
    const allKeys = new Set([...requirements.keys()]); // Only care about what we NEED
    const result = Array.from(allKeys).map(key => {
      // Resolve Name
      const yarnDef = yarns.find(y => y.id === key) || yarns.find(y => y.name === key);
      const name = yarnDef ? yarnDef.name : key;

      const reqData = requirements.get(key) || { total: 0, allocations: [] };
      const required = reqData.total;
      const inStock = stock.get(key) || 0;
      const balance = inStock - required;
      const toBuy = Math.max(0, required - inStock);

      return {
        id: key,
        name,
        required,
        inStock,
        balance,
        toBuy,
        allocations: reqData.allocations
      };
    });

    return result.sort((a, b) => b.toBuy - a.toBuy); // Show biggest "To Buy" first
  }, [customers, fabrics, inventory, yarns, selectedCustomerId]);

  const orderTotals = useMemo(() => {
    if (!selectedCustomer || !selectedCustomer.orders) {
      return { ordered: 0, manufactured: 0, remaining: 0, progress: 0 };
    }

    let totalOrdered = 0;
    let totalRemaining = 0;

    selectedCustomer.orders.forEach(order => {
        const required = order.requiredQty || 0;
        totalOrdered += required;

        const statusInfo = order.material ? statsMap.get(order.material) : null;
        const hasActive = statusInfo && statusInfo.active.length > 0;
        
        // Use the same logic as the row display
        const displayRemaining = hasActive ? statusInfo.remaining : (order.remainingQty ?? (required - (order.producedQty || 0)));
        totalRemaining += displayRemaining;
    });

    // Manufactured = Ordered - Remaining (as requested)
    const totalManufactured = Math.max(0, totalOrdered - totalRemaining);
    const progress = totalOrdered > 0 ? (totalManufactured / totalOrdered) * 100 : 0;

    return { ordered: totalOrdered, manufactured: totalManufactured, remaining: totalRemaining, progress };
  }, [selectedCustomer, statsMap]);

  const handleAddCustomer = async () => {
    if (!newCustomerName.trim()) return;
    try {
      await addDoc(collection(db, 'CustomerSheets'), {
        name: newCustomerName.trim(),
        orders: []
      });
      setNewCustomerName('');
      setIsAddingCustomer(false);
    } catch (error) {
      console.error("Error adding customer:", error);
    }
  };

  const handleDeleteCustomer = async (id: string) => {
    if (!window.confirm("Delete customer and all orders?")) return;
    try {
      await deleteDoc(doc(db, 'CustomerSheets', id));
      if (selectedCustomerId === id) setSelectedCustomerId(null);
    } catch (error) {
      console.error("Error deleting customer:", error);
    }
  };

  const handleAddRow = async () => {
    if (!selectedCustomerId || !selectedCustomer) return;
    const newRow: OrderRow = {
      id: crypto.randomUUID(),
      material: '',
      machine: '',
      requiredQty: 0,
      accessory: '',
      manufacturedQty: 0,
      remainingQty: 0,
      orderReceiptDate: new Date().toISOString().split('T')[0],
      startDate: '',
      endDate: '',
      scrapQty: 0,
      others: '',
      notes: '',
      batchDeliveries: '',
      accessoryDeliveries: ''
    };
    const updatedOrders = [...selectedCustomer.orders, newRow];
    await updateDoc(doc(db, 'CustomerSheets', selectedCustomerId), { orders: updatedOrders });
  };

  const handleUpdateOrder = async (rowId: string, updates: Partial<OrderRow>) => {
    if (!selectedCustomerId || !selectedCustomer) return;
    
    let finalUpdates = { ...updates };
    const currentRow = selectedCustomer.orders.find(o => o.id === rowId);
    
    // Smart Accessory Logic
    if (currentRow && (updates.accessory !== undefined || updates.requiredQty !== undefined)) {
       const newAccessory = updates.accessory !== undefined ? updates.accessory : currentRow.accessory;
       const newRequiredQty = updates.requiredQty !== undefined ? updates.requiredQty : currentRow.requiredQty;
       
       // Parse percentage if accessory text changed or qty changed
       if (newAccessory) {
          const match = newAccessory.match(/(\d+(?:\.\d+)?)%\s*(.*)/);
          if (match) {
             const pct = parseFloat(match[1]);
             const type = match[2] || 'Accessory';
             finalUpdates.accessoryPercentage = pct;
             finalUpdates.accessoryType = type;
             // Auto-calculate quantity
             finalUpdates.accessoryQty = Math.round(newRequiredQty * (pct / 100));
          }
       }
    }

    // Optimistic Update
    const updatedOrders = selectedCustomer.orders.map(order => {
      if (order.id === rowId) {
        return { ...order, ...finalUpdates };
      }
      return order;
    });

    // Update local state immediately
    setCustomers(prev => prev.map(c => {
      if (c.id === selectedCustomerId) {
        return { ...c, orders: updatedOrders };
      }
      return c;
    }));

    // Send to Firestore
    await updateDoc(doc(db, 'CustomerSheets', selectedCustomerId), { orders: updatedOrders });
  };

  const toggleSelectAll = () => {
    if (!selectedCustomer) return;
    if (selectedRows.size === selectedCustomer.orders.length) {
      setSelectedRows(new Set());
    } else {
      setSelectedRows(new Set(selectedCustomer.orders.map(o => o.id)));
    }
  };

  const toggleSelectRow = (id: string) => {
    const newSet = new Set(selectedRows);
    if (newSet.has(id)) {
      newSet.delete(id);
    } else {
      newSet.add(id);
    }
    setSelectedRows(newSet);
  };

  const handleBulkUpdateDate = async () => {
    if (!selectedCustomerId || !selectedCustomer || !bulkDate) return;
    
    const updatedOrders = selectedCustomer.orders.map(order => {
      if (selectedRows.has(order.id)) {
        return { ...order, orderReceiptDate: bulkDate };
      }
      return order;
    });

    // Optimistic Update
    setCustomers(prev => prev.map(c => {
      if (c.id === selectedCustomerId) {
        return { ...c, orders: updatedOrders };
      }
      return c;
    }));

    await updateDoc(doc(db, 'CustomerSheets', selectedCustomerId), { orders: updatedOrders });
    setShowBulkDateInput(false);
    setBulkDate('');
    setSelectedRows(new Set());
  };

  // Removed getOrderStats in favor of statsMap

  const handleDeleteRow = async (rowId: string) => {
    if (!selectedCustomerId || !selectedCustomer) return;
    if (!window.confirm("Delete this order row?")) return;
    const updatedOrders = selectedCustomer.orders.filter(o => o.id !== rowId);
    await updateDoc(doc(db, 'CustomerSheets', selectedCustomerId), { orders: updatedOrders });
  };

  const handlePlanSearch = (clientName: string, fabricName: string) => {
    const reference = `${clientName}-${fabricName}`;
    const results: { machineName: string; type: 'ACTIVE' | 'PLANNED'; details: string; date?: string }[] = [];
  
    machines.forEach(machine => {
      // Check Active (Daily Logs)
      const activeLog = machine.dailyLogs?.find(l => l.date === activeDay);
      if (activeLog) {
         // Check match by explicit reference OR by client/fabric combination
         const isMatch = (activeLog.client === clientName && activeLog.fabric === fabricName) || 
                         (activeLog.orderReference === reference);
         
         if (isMatch) {
           results.push({
             machineName: machine.name,
             type: 'ACTIVE',
             details: `Running on ${activeDay} (Rem: ${activeLog.remainingMfg})`,
             date: activeDay
           });
         }
      }
  
      // Check Future Plans
      if (machine.futurePlans) {
        machine.futurePlans.forEach(plan => {
           // Check if plan matches
           if (plan.client === clientName && plan.fabric === fabricName) {
              results.push({
                machineName: machine.name,
                type: 'PLANNED',
                details: `Planned for ${plan.days} days (Qty: ${plan.quantity})`,
                date: plan.startDate
              });
           }
        });
      }
    });
  
    setPlanSearchModal({
      isOpen: true,
      reference,
      results
    });
  };

  const handleCreateFabric = async (name: string) => {
    await DataService.addFabric({ 
      name,
      fabricId: crypto.randomUUID(),
      type: 'General'
    });
    setFabrics(await DataService.getFabrics());
  };

  const handleOpenFabricDetails = (fabricName: string, qty: number, orderId?: string) => {
    const fabric = fabrics.find(f => f.name === fabricName);
    let allocations: Record<string, YarnAllocationItem[]> | undefined;

    if (orderId && selectedCustomer) {
        const order = selectedCustomer.orders.find(o => o.id === orderId);
        if (order) {
            allocations = order.yarnAllocations;
        }
    }

    if (fabric) {
      setFabricDetailsModal({
        isOpen: true,
        fabric,
        orderQuantity: qty,
        orderId,
        customerId: selectedCustomerId || undefined,
        allocations
      });
    }
  };

  const handleUpdateOrderAllocations = async (orderId: string, allocations: Record<string, YarnAllocationItem[]>) => {
    if (!selectedCustomerId || !selectedCustomer) return;
    
    const updatedOrders = selectedCustomer.orders.map(order => {
      if (order.id === orderId) {
        return { ...order, yarnAllocations: allocations };
      }
      return order;
    });

    // Optimistic Update
    setCustomers(prev => prev.map(c => {
      if (c.id === selectedCustomerId) {
        return { ...c, orders: updatedOrders };
      }
      return c;
    }));

    await updateDoc(doc(db, 'CustomerSheets', selectedCustomerId), { orders: updatedOrders });
  };

  const handleUpdateFabric = async (fabricId: string, updates: Partial<Fabric>) => {
    await DataService.updateFabric(fabricId, updates);
    // Refresh fabrics
    setFabrics(await DataService.getFabrics());
  };

  const handleAddYarn = async (name: string): Promise<string> => {
    const newId = await DataService.addYarn({
      name,
      yarnId: crypto.randomUUID()
    });
    setYarns(await DataService.getYarns());
    return newId;
  };

  const filteredCustomers = customers.filter(c => 
    c.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  // Calculate Total Yarn Requirements for the selected customer
  const totalYarnRequirements = useMemo(() => {
    if (!selectedCustomer) return [];
    
    // Map<yarnId, { totalWeight: number, fabrics: Map<fabricName, number> }>
    const totals = new Map<string, { totalWeight: number, fabrics: Map<string, number> }>();
    
    selectedCustomer.orders.forEach(order => {
      if (!order.material || !order.requiredQty) return;
      
      const fabric = fabrics.find(f => f.name === order.material);
      if (fabric && fabric.yarnComposition) {
        fabric.yarnComposition.forEach(comp => {
          const baseWeight = (order.requiredQty * (comp.percentage || 0)) / 100;
          const scrapFactor = 1 + ((comp.scrapPercentage || 0) / 100);
          const totalWeight = baseWeight * scrapFactor;
          
          if (!totals.has(comp.yarnId)) {
            totals.set(comp.yarnId, { totalWeight: 0, fabrics: new Map() });
          }
          
          const entry = totals.get(comp.yarnId)!;
          entry.totalWeight += totalWeight;
          
          const currentFabricWeight = entry.fabrics.get(order.material) || 0;
          entry.fabrics.set(order.material, currentFabricWeight + totalWeight);
        });
      }
    });

    return Array.from(totals.entries()).map(([yarnId, data]) => {
      const yarn = yarns.find(y => y.id === yarnId);
      return {
        id: yarnId,
        name: yarn ? yarn.name : 'Unknown Yarn',
        weight: data.totalWeight,
        fabrics: Array.from(data.fabrics.entries()).map(([fabricName, weight]) => ({
            name: fabricName,
            weight
        })).sort((a, b) => b.weight - a.weight)
      };
    }).sort((a, b) => b.weight - a.weight);
  }, [selectedCustomer, fabrics, yarns]);

  return (
    <div className="flex flex-col h-[calc(100vh-100px)] bg-slate-50 rounded-xl overflow-hidden border border-slate-200 shadow-sm">
      <style>{globalStyles}</style>
      
      {/* Top Bar: Client Selection */}
      <div className="bg-white border-b border-slate-200 p-4 flex items-center justify-between gap-4 shadow-sm z-20">
        <div className="flex items-center gap-4 flex-1">
          <div className="flex items-center gap-2 text-slate-700 font-bold">
            <UserPlus className="w-5 h-5 text-blue-600" />
            <span className="hidden sm:inline">Client:</span>
          </div>
          
          <div className="relative max-w-xs w-full">
             <select 
               value={selectedCustomerId || ''} 
               onChange={(e) => setSelectedCustomerId(e.target.value)}
               className="w-full pl-3 pr-10 py-2 bg-slate-50 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 appearance-none cursor-pointer font-medium text-slate-700"
             >
               <option value={ALL_CLIENTS_ID} className="font-bold text-blue-600">All Clients Overview</option>
               <option value={ALL_YARNS_ID} className="font-bold text-purple-600">All Yarn Requirements</option>
               <option value="" disabled>Select a client...</option>
               {customers.map(c => (
                 <option key={c.id} value={c.id}>{c.name}</option>
               ))}
             </select>
             <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-slate-500">
               <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"></path></svg>
             </div>
          </div>

          <button 
            onClick={() => setIsAddingCustomer(true)} 
            className="p-2 hover:bg-blue-50 text-blue-600 rounded-lg transition-colors" 
            title="Add New Client"
          >
            <Plus className="w-5 h-5" />
          </button>
          
          {isAddingCustomer && (
             <div className="flex items-center gap-2 animate-in fade-in slide-in-from-left-2 bg-white p-1 rounded-lg border border-slate-200 shadow-sm absolute top-16 left-4 z-30 sm:static sm:top-auto sm:left-auto sm:border-0 sm:shadow-none sm:p-0">
                <input
                  autoFocus
                  type="text"
                  placeholder="New Client Name..."
                  className="px-3 py-1.5 border border-slate-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  value={newCustomerName}
                  onChange={e => setNewCustomerName(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleAddCustomer()}
                />
                <button onClick={handleAddCustomer} className="px-3 py-1.5 bg-green-600 text-white rounded-md text-sm hover:bg-green-700">
                  Save
                </button>
                <button onClick={() => setIsAddingCustomer(false)} className="p-1.5 text-slate-400 hover:text-slate-600">
                  <X className="w-4 h-4" />
                </button>
             </div>
          )}

          <div className="h-6 w-px bg-slate-200 hidden sm:block mx-2"></div>

          <button 
            onClick={() => setShowDyehouse(!showDyehouse)}
            className={`flex items-center gap-2 px-3 py-2 border text-sm rounded-lg transition-colors font-medium ${showDyehouse ? 'bg-purple-100 border-purple-300 text-purple-800' : 'bg-white border-slate-300 text-slate-600 hover:bg-slate-50'}`}
          >
            <Droplets className="w-4 h-4" />
            {showDyehouse ? 'Show Fabric Info' : 'Show Dyehouse Info'}
          </button>
        </div>

        {/* Right Actions */}
        {selectedCustomer && (
          <div className="flex items-center gap-3">
             <button 
                onClick={() => handleDeleteCustomer(selectedCustomer.id)}
                className="flex items-center gap-2 px-3 py-2 text-slate-500 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors text-sm font-medium"
              >
                <Trash2 className="w-4 h-4" />
                <span className="hidden sm:inline">Delete Client</span>
              </button>
             <div className="h-6 w-px bg-slate-200 hidden sm:block"></div>
             <button 
                onClick={handleAddRow}
                className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors shadow-sm font-medium"
              >
                <Plus className="w-4 h-4" />
                <span className="hidden sm:inline">Add Order</span>
              </button>
          </div>
        )}
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col overflow-hidden bg-white relative">
        {selectedCustomerId === ALL_CLIENTS_ID ? (
          <div className="flex-1 overflow-auto p-6 bg-slate-50">
             <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                <div className="p-4 border-b border-slate-200 bg-slate-50 flex justify-between items-center">
                   <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                      <Users className="w-5 h-5 text-blue-600" />
                      All Clients Overview
                   </h2>
                   <div className="text-sm text-slate-500">
                      {allClientsStats.length} Active Clients
                   </div>
                </div>
                <table className="w-full text-left text-sm">
                  <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 font-semibold">
                    <tr>
                      <th className="px-4 py-3">Client Name</th>
                      <th className="px-4 py-3">Order Receive Date</th>
                      <th className="px-4 py-3 text-right">Ordered</th>
                      <th className="px-4 py-3 text-right">Manufactured</th>
                      <th className="px-4 py-3 text-right">Remaining</th>
                      <th className="px-4 py-3 text-right bg-orange-50">Delivery</th>
                      <th className="px-4 py-3 text-right bg-red-50">Rem. Delivery</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {allClientsStats.map((client) => (
                      <tr key={client.id} className="hover:bg-slate-50 transition-colors">
                        <td className="px-4 py-3 font-medium text-slate-800">{client.name}</td>
                        <td className="px-4 py-3 text-slate-600">
                          <div className="flex flex-wrap gap-1">
                            {client.stats.dates.length > 0 ? client.stats.dates.map((d, i) => (
                              <span key={i} className="px-1.5 py-0.5 bg-slate-100 rounded text-xs border border-slate-200">{d}</span>
                            )) : '-'}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-slate-700">{client.stats.ordered.toLocaleString()}</td>
                        <td className="px-4 py-3 text-right font-mono text-emerald-600">{client.stats.manufactured.toLocaleString()}</td>
                        <td className="px-4 py-3 text-right font-mono text-amber-600 font-bold">{client.stats.remaining.toLocaleString()}</td>
                        <td className="px-4 py-3 text-right font-mono text-orange-600 bg-orange-50/30">{client.stats.delivery.toLocaleString()}</td>
                        <td className="px-4 py-3 text-right font-mono text-red-600 bg-red-50/30 font-bold">{client.stats.remainingDelivery.toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
             </div>
          </div>
        ) : selectedCustomerId === ALL_YARNS_ID ? (
          <div className="flex-1 overflow-auto p-6 bg-slate-50">
             <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                <div className="p-4 border-b border-slate-200 bg-slate-50 flex justify-between items-center">
                   <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                      <Package className="w-5 h-5 text-purple-600" />
                      All Yarn Requirements
                   </h2>
                   <div className="text-sm text-slate-500">
                      Based on all active orders
                   </div>
                </div>
                <table className="w-full text-left text-sm">
                  <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 font-semibold">
                    <tr>
                      <th className="px-4 py-3">Yarn Name</th>
                      <th className="px-4 py-3 text-right">Total Required</th>
                      <th className="px-4 py-3 text-right">In Stock</th>
                      <th className="px-4 py-3 text-right">Balance</th>
                      <th className="px-4 py-3 text-right bg-red-50">To Buy</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {allYarnStats.map((yarn) => (
                      <tr 
                        key={yarn.id} 
                        className="hover:bg-slate-50 transition-colors cursor-pointer group"
                        onClick={() => setSelectedYarnDetails(yarn)}
                      >
                        <td className="px-4 py-3 font-medium text-slate-800 group-hover:text-blue-600 transition-colors">{yarn.name}</td>
                        <td className="px-4 py-3 text-right font-mono text-slate-700">{yarn.required.toLocaleString(undefined, { maximumFractionDigits: 1 })}</td>
                        <td className="px-4 py-3 text-right font-mono text-blue-600">{yarn.inStock.toLocaleString(undefined, { maximumFractionDigits: 1 })}</td>
                        <td className={`px-4 py-3 text-right font-mono font-bold ${yarn.balance >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                          {yarn.balance > 0 ? '+' : ''}{yarn.balance.toLocaleString(undefined, { maximumFractionDigits: 1 })}
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-red-600 bg-red-50/30 font-bold">
                          {yarn.toBuy > 0 ? yarn.toBuy.toLocaleString(undefined, { maximumFractionDigits: 1 }) : '-'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
             </div>
          </div>
        ) : selectedCustomer ? (
          <>
            {/* Bulk Actions */}
            {selectedRows.size > 0 && (
              <div className="absolute top-0 left-0 right-0 z-20 px-4 py-2 bg-blue-50 border-b border-blue-100 flex items-center gap-4 animate-in slide-in-from-top-2 shadow-sm">
                <span className="text-sm font-medium text-blue-700">{selectedRows.size} rows selected</span>
                <div className="h-4 w-px bg-blue-200"></div>
                
                {showBulkDateInput ? (
                  <div className="flex items-center gap-2">
                    <input 
                      type="date" 
                      value={bulkDate}
                      onChange={(e) => setBulkDate(e.target.value)}
                      className="px-2 py-1 text-sm border border-blue-200 rounded bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                    <button 
                      onClick={handleBulkUpdateDate}
                      disabled={!bulkDate}
                      className="px-3 py-1 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 disabled:opacity-50"
                    >
                      Apply
                    </button>
                    <button 
                      onClick={() => setShowBulkDateInput(false)}
                      className="p-1 text-slate-500 hover:text-slate-700"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ) : (
                  <button 
                    onClick={() => setShowBulkDateInput(true)}
                    className="flex items-center gap-2 px-3 py-1 bg-white border border-blue-200 text-blue-700 text-sm rounded hover:bg-blue-100"
                  >
                    <Calendar className="w-4 h-4" />
                    Set Receive Date
                  </button>
                )}

                <div className="h-6 w-px bg-slate-300 mx-2"></div>
              </div>
            )}

            <div className="flex-1 overflow-auto p-4 bg-slate-50">
              <div className="bg-white rounded-lg shadow border border-slate-200 overflow-visible min-w-max mb-4">
                <table className="w-full text-sm border-collapse">
                  <thead className="bg-slate-100 text-slate-600 font-semibold sticky top-0 z-10 shadow-sm text-xs uppercase tracking-wider">
                    <tr>
                      <th className="p-3 w-10 border-b border-r border-slate-200 text-center">
                        <button onClick={toggleSelectAll} className="text-slate-400 hover:text-slate-600">
                          {selectedCustomer.orders.length > 0 && selectedRows.size === selectedCustomer.orders.length ? (
                            <CheckSquare className="w-4 h-4 text-blue-600" />
                          ) : (
                            <Square className="w-4 h-4" />
                          )}
                        </button>
                      </th>
                      {showDyehouse ? (
                        <>
                          <th className="p-3 text-left border-b border-r border-slate-200 min-w-[120px]">Fabric</th>
                          <th className="p-3 text-left border-b border-r border-slate-200 min-w-[120px]">Dyehouse</th>
                          <th className="p-3 text-left border-b border-r border-slate-200 min-w-[200px]">Assigned Machines</th>
                          <th className="p-3 text-center border-b border-r border-slate-200 w-10"></th>
                        </>
                      ) : (
                        <>
                          <th className="p-3 text-left border-b border-r border-slate-200 min-w-[120px]">Fabric</th>
                          <th className="p-3 text-left border-b border-r border-slate-200 min-w-[140px]">Accessories</th>
                          <th className="p-3 text-right border-b border-r border-slate-200 w-20">Acc. Qty</th>
                        </>
                      )}
                      {!showDyehouse && (
                        <>
                          <th className="p-3 text-center border-b border-r border-slate-200 min-w-[140px]">Status</th>
                          <th className="p-3 text-right border-b border-r border-slate-200 w-24">Ordered</th>
                          <th className="p-3 text-right border-b border-r border-slate-200 w-24 bg-slate-50">Remaining</th>
                          <th className="p-3 text-center border-b border-r border-slate-200 w-24">Receive Date</th>
                          <th className="p-3 text-center border-b border-r border-slate-200 w-24">Start Date</th>
                          <th className="p-3 text-center border-b border-r border-slate-200 w-24">End Date</th>
                          <th className="p-3 text-right border-b border-r border-slate-200 w-20">Scrap</th>
                          <th className="p-3 text-left border-b border-r border-slate-200 min-w-[100px]">Others</th>
                          <th className="p-3 text-left border-b border-r border-slate-200 min-w-[150px]">Notes</th>
                          <th className="p-3 text-right border-b border-r border-slate-200 w-24 bg-orange-50">Fab. Deliv</th>
                          <th className="p-3 text-right border-b border-r border-slate-200 w-24 bg-purple-50">Acc. Deliv</th>
                        </>
                      )}
                      {showDyehouse && (
                         <th className="p-3 text-right border-b border-r border-slate-200 w-24">Ordered</th>
                      )}
                      <th className="p-3 w-10 border-b border-slate-200"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {selectedCustomer.orders.map((row) => {
                      const statusInfo = row.material ? statsMap.get(row.material) : null;
                      // If we have active machines, override the remaining qty
                      if (statusInfo && statusInfo.active.length > 0) {
                          // statusInfo.remaining is already calculated in the map
                      }
                      
                      const isSelected = selectedRows.has(row.id);

                      return (
                        <MemoizedOrderRow
                          key={row.id}
                          row={row}
                          statusInfo={statusInfo}
                          fabrics={fabrics}
                          isSelected={isSelected}
                          toggleSelectRow={toggleSelectRow}
                          handleUpdateOrder={handleUpdateOrder}
                          handleCreateFabric={handleCreateFabric}
                          handlePlanSearch={handlePlanSearch}
                          handleDeleteRow={handleDeleteRow}
                          selectedCustomerName={selectedCustomer.name}
                          onOpenFabricDetails={handleOpenFabricDetails}
                          showDyehouse={showDyehouse}
                        />
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Order Summary & Yarn Requirements */}
              <div className="mt-4 space-y-4">
                {/* Order Summary Cards */}
                <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
                    <div className="bg-white p-4 rounded-lg border border-slate-200 shadow-sm flex items-center justify-between">
                        <div>
                            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Total Ordered</p>
                            <p className="text-2xl font-bold text-slate-800 mt-1">{orderTotals.ordered.toLocaleString()} <span className="text-sm font-normal text-slate-400">kg</span></p>
                        </div>
                        <div className="p-3 bg-blue-50 rounded-full">
                            <Package className="w-6 h-6 text-blue-600" />
                        </div>
                    </div>
                    
                    <div className="bg-white p-4 rounded-lg border border-slate-200 shadow-sm flex items-center justify-between">
                        <div>
                            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Manufactured</p>
                            <p className="text-2xl font-bold text-emerald-600 mt-1">{orderTotals.manufactured.toLocaleString()} <span className="text-sm font-normal text-slate-400">kg</span></p>
                        </div>
                        <div className="p-3 bg-emerald-50 rounded-full">
                            <CheckCircle2 className="w-6 h-6 text-emerald-600" />
                        </div>
                    </div>

                    <div className="bg-white p-4 rounded-lg border border-slate-200 shadow-sm flex items-center justify-between">
                        <div>
                            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Remaining</p>
                            <p className="text-2xl font-bold text-amber-600 mt-1">{orderTotals.remaining.toLocaleString()} <span className="text-sm font-normal text-slate-400">kg</span></p>
                        </div>
                        <div className="p-3 bg-amber-50 rounded-full">
                            <AlertCircle className="w-6 h-6 text-amber-600" />
                        </div>
                    </div>

                    <div className="bg-white p-4 rounded-lg border border-slate-200 shadow-sm flex flex-col justify-center">
                        <div className="flex justify-between items-end mb-2">
                            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Progress</p>
                            <p className="text-lg font-bold text-blue-600">{orderTotals.progress.toFixed(1)}%</p>
                        </div>
                        <div className="w-full bg-slate-100 rounded-full h-2.5 overflow-hidden">
                            <div 
                                className="bg-blue-600 h-2.5 rounded-full transition-all duration-500" 
                                style={{ width: `${Math.min(100, Math.max(0, orderTotals.progress))}%` }}
                            ></div>
                        </div>
                    </div>
                </div>

                {/* Yarn Requirements Toggle */}
                <div className="flex justify-end">
                    <button 
                        onClick={() => setShowYarnRequirements(!showYarnRequirements)}
                        className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50 font-medium transition-colors shadow-sm"
                    >
                        <Calculator className="w-4 h-4 text-blue-600" />
                        {showYarnRequirements ? 'Hide Yarn Requirements' : 'View Yarn Requirements'}
                    </button>
                </div>

                {/* Total Yarn Requirements Footer */}
                {showYarnRequirements && totalYarnRequirements.length > 0 && (
                    <div className="bg-white rounded-lg shadow border border-slate-200 p-4 animate-in slide-in-from-bottom-4">
                    <h3 className="text-sm font-bold text-slate-700 mb-3 flex items-center gap-2">
                        <Calculator className="w-4 h-4 text-blue-600" />
                        Total Yarn Requirements for <span className="truncate max-w-[200px] inline-block align-bottom" title={selectedCustomer.name}>{selectedCustomer.name}</span>
                    </h3>
                    <div className="overflow-hidden rounded-lg border border-slate-200">
                      <table className="w-full text-sm text-left">
                        <thead className="bg-slate-50 text-slate-500 font-medium border-b border-slate-200">
                          <tr>
                            <th className="px-4 py-3">Yarn Name</th>
                            <th className="px-4 py-3 text-right">Total Requirement (kg)</th>
                            <th className="px-4 py-3 w-20 text-center">Action</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 bg-white">
                          {totalYarnRequirements.map((yarn, idx) => (
                            <tr 
                              key={idx}
                              onClick={() => setYarnBreakdownModal({ 
                                isOpen: true, 
                                yarnName: yarn.name, 
                                totalWeight: yarn.weight,
                                fabrics: yarn.fabrics
                              })}
                              className="hover:bg-blue-50 cursor-pointer transition-colors group"
                            >
                              <td className="px-4 py-3 font-medium text-slate-700 group-hover:text-blue-700">
                                {yarn.name}
                              </td>
                              <td className="px-4 py-3 text-right font-mono font-bold text-slate-700 group-hover:text-blue-700">
                                {yarn.weight.toLocaleString(undefined, { maximumFractionDigits: 1 })}
                              </td>
                              <td className="px-4 py-3 text-center">
                                <button className="p-1 rounded-full bg-slate-100 text-slate-500 group-hover:bg-blue-100 group-hover:text-blue-600 transition-colors">
                                  <Search className="w-4 h-4" />
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    </div>
                )}
              </div>
            </div>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-slate-400 bg-slate-50/50">
            <FileSpreadsheet className="w-16 h-16 mb-4 text-slate-300" />
            <p className="text-lg font-medium text-slate-500">Select a client from the top bar to view orders</p>
            <p className="text-sm text-slate-400 mt-2">Or create a new client to get started</p>
          </div>
        )}

        {/* Plan Search Modal */}
        {planSearchModal.isOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
            <div className="bg-white rounded-lg shadow-xl w-full max-w-md p-6 m-4">
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-lg font-bold text-slate-800">
                  Plan Search: {planSearchModal.reference}
                </h3>
                <button onClick={() => setPlanSearchModal(prev => ({ ...prev, isOpen: false }))}>
                  <X className="w-5 h-5 text-slate-500" />
                </button>
              </div>
              
              <div className="max-h-[60vh] overflow-y-auto">
                {planSearchModal.results.length > 0 ? (
                  <div className="space-y-3">
                    {planSearchModal.results.map((res, idx) => (
                      <div key={idx} className={`p-3 rounded border ${res.type === 'ACTIVE' ? 'bg-emerald-50 border-emerald-200' : 'bg-blue-50 border-blue-200'}`}>
                        <div className="flex justify-between items-start">
                          <span className="font-bold text-slate-700">{res.machineName}</span>
                          <span className={`text-xs px-2 py-1 rounded-full font-bold ${res.type === 'ACTIVE' ? 'bg-emerald-100 text-emerald-700' : 'bg-blue-100 text-blue-700'}`}>
                            {res.type}
                          </span>
                        </div>
                        <div className="text-sm text-slate-600 mt-1">{res.details}</div>
                        {res.date && <div className="text-xs text-slate-400 mt-1">Date: {res.date}</div>}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-8 text-slate-500">
                    <AlertCircle className="w-12 h-12 mx-auto mb-2 text-slate-300" />
                    <p>No active or planned records found for this reference.</p>
                  </div>
                )}
              </div>
              
              <div className="mt-6 flex justify-end">
                <button 
                  onClick={() => setPlanSearchModal(prev => ({ ...prev, isOpen: false }))}
                  className="px-4 py-2 bg-slate-100 text-slate-700 rounded hover:bg-slate-200"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Inventory View Modal */}
        {inventoryViewModal.isOpen && (
          <InventoryViewModal 
            isOpen={inventoryViewModal.isOpen}
            onClose={() => setInventoryViewModal({ isOpen: false, yarnName: '' })}
            yarnName={inventoryViewModal.yarnName}
            yarnId={inventoryViewModal.yarnId}
          />
        )}

        {/* Yarn Breakdown Modal */}
        {yarnBreakdownModal.isOpen && (
          <YarnBreakdownModal
            isOpen={yarnBreakdownModal.isOpen}
            onClose={() => setYarnBreakdownModal(prev => ({ ...prev, isOpen: false }))}
            yarnName={yarnBreakdownModal.yarnName}
            totalWeight={yarnBreakdownModal.totalWeight}
            fabrics={yarnBreakdownModal.fabrics}
          />
        )}

        {/* Fabric Details Modal */}
        {fabricDetailsModal.isOpen && fabricDetailsModal.fabric && (
          <FabricDetailsModal
            isOpen={fabricDetailsModal.isOpen}
            onClose={() => setFabricDetailsModal(prev => ({ ...prev, isOpen: false }))}
            fabric={fabricDetailsModal.fabric}
            orderQuantity={fabricDetailsModal.orderQuantity}
            allYarns={yarns}
            onUpdateFabric={handleUpdateFabric}
            onAddYarn={handleAddYarn}
            orderId={fabricDetailsModal.orderId}
            customerId={fabricDetailsModal.customerId}
            customerName={selectedCustomer?.name}
            existingAllocations={fabricDetailsModal.allocations}
            onUpdateOrderAllocations={handleUpdateOrderAllocations}
          />
        )}

        {/* Inventory View Modal */}
        {inventoryViewModal.isOpen && (
          <InventoryViewModal 
            isOpen={inventoryViewModal.isOpen}
            onClose={() => setInventoryViewModal({ isOpen: false, yarnName: '' })}
            yarnName={inventoryViewModal.yarnName}
            yarnId={inventoryViewModal.yarnId}
          />
        )}

        {/* Yarn Details Modal */}
        {selectedYarnDetails && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden animate-in zoom-in-95 duration-200">
              <div className="p-4 border-b border-slate-200 flex justify-between items-center bg-slate-50">
                <div>
                  <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2">
                    <Package className="w-6 h-6 text-purple-600" />
                    {selectedYarnDetails.name}
                  </h2>
                  <div className="text-sm text-slate-500 mt-1">
                    Detailed allocation and inventory breakdown
                  </div>
                </div>
                <button 
                  onClick={() => setSelectedYarnDetails(null)}
                  className="p-2 hover:bg-slate-200 rounded-full transition-colors"
                >
                  <X className="w-5 h-5 text-slate-500" />
                </button>
              </div>
              
              <div className="flex-1 overflow-y-auto p-6 space-y-8">
                {/* Summary Cards */}
                <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
                  <div className="bg-blue-50 p-4 rounded-lg border border-blue-100">
                    <div className="text-sm text-blue-600 font-medium mb-1">Total Required</div>
                    <div className="text-2xl font-bold text-blue-800">
                      {selectedYarnDetails.required.toLocaleString(undefined, { maximumFractionDigits: 1 })} <span className="text-sm font-normal text-blue-600">kg</span>
                    </div>
                  </div>
                  <div className="bg-emerald-50 p-4 rounded-lg border border-emerald-100">
                    <div className="text-sm text-emerald-600 font-medium mb-1">In Stock</div>
                    <div className="text-2xl font-bold text-emerald-800">
                      {selectedYarnDetails.inStock.toLocaleString(undefined, { maximumFractionDigits: 1 })} <span className="text-sm font-normal text-emerald-600">kg</span>
                    </div>
                  </div>
                  <div className={`p-4 rounded-lg border ${selectedYarnDetails.balance >= 0 ? 'bg-green-50 border-green-100' : 'bg-red-50 border-red-100'}`}>
                    <div className={`text-sm font-medium mb-1 ${selectedYarnDetails.balance >= 0 ? 'text-green-600' : 'text-red-600'}`}>Balance</div>
                    <div className={`text-2xl font-bold ${selectedYarnDetails.balance >= 0 ? 'text-green-800' : 'text-red-800'}`}>
                      {selectedYarnDetails.balance > 0 ? '+' : ''}{selectedYarnDetails.balance.toLocaleString(undefined, { maximumFractionDigits: 1 })} <span className="text-sm font-normal">kg</span>
                    </div>
                  </div>
                  <div className="bg-orange-50 p-4 rounded-lg border border-orange-100">
                    <div className="text-sm text-orange-600 font-medium mb-1">To Buy</div>
                    <div className="text-2xl font-bold text-orange-800">
                      {selectedYarnDetails.toBuy.toLocaleString(undefined, { maximumFractionDigits: 1 })} <span className="text-sm font-normal text-orange-600">kg</span>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                  {/* Allocations Table */}
                  <div className="space-y-4">
                    <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                      <Users className="w-5 h-5 text-blue-600" />
                      Allocations (Required by Orders)
                    </h3>
                    <div className="bg-white border border-slate-200 rounded-lg overflow-hidden shadow-sm">
                      <table className="w-full text-sm text-left">
                        <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 font-semibold">
                          <tr>
                            <th className="px-4 py-2">Client</th>
                            <th className="px-4 py-2">Fabric</th>
                            <th className="px-4 py-2 text-right">Comp %</th>
                            <th className="px-4 py-2 text-right">Required</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {selectedYarnDetails.allocations && selectedYarnDetails.allocations.length > 0 ? (
                            selectedYarnDetails.allocations.map((alloc: any, idx: number) => (
                              <tr key={idx} className="hover:bg-slate-50">
                                <td className="px-4 py-2 font-medium text-slate-800">{alloc.clientName}</td>
                                <td className="px-4 py-2 text-slate-600">{alloc.fabricName}</td>
                                <td className="px-4 py-2 text-right text-slate-500">{alloc.percentage}%</td>
                                <td className="px-4 py-2 text-right font-mono font-medium text-slate-700">
                                  {alloc.requiredQty.toLocaleString(undefined, { maximumFractionDigits: 1 })}
                                </td>
                              </tr>
                            ))
                          ) : (
                            <tr>
                              <td colSpan={4} className="px-4 py-8 text-center text-slate-400 italic">
                                No active allocations found.
                              </td>
                            </tr>
                          )}
                        </tbody>
                        <tfoot className="bg-slate-50 border-t border-slate-200 font-semibold text-slate-700">
                          <tr>
                            <td colSpan={3} className="px-4 py-2 text-right">Total Allocated:</td>
                            <td className="px-4 py-2 text-right font-mono">
                              {selectedYarnDetails.required.toLocaleString(undefined, { maximumFractionDigits: 1 })}
                            </td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  </div>

                  {/* Inventory Lots Table */}
                  <div className="space-y-4">
                    <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                      <Package className="w-5 h-5 text-emerald-600" />
                      Available Inventory Lots
                    </h3>
                    <div className="bg-white border border-slate-200 rounded-lg overflow-hidden shadow-sm">
                      <table className="w-full text-sm text-left">
                        <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 font-semibold">
                          <tr>
                            <th className="px-4 py-2">Lot Number</th>
                            <th className="px-4 py-2 text-right">Quantity</th>
                            <th className="px-4 py-2 text-right">Last Updated</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {inventory
                            .filter(item => item.yarnName === selectedYarnDetails.name || (selectedYarnDetails.id && item.yarnName === yarns.find(y => y.id === selectedYarnDetails.id)?.name))
                            .length > 0 ? (
                              inventory
                                .filter(item => item.yarnName === selectedYarnDetails.name || (selectedYarnDetails.id && item.yarnName === yarns.find(y => y.id === selectedYarnDetails.id)?.name))
                                .map((item) => (
                                  <tr key={item.id} className="hover:bg-slate-50">
                                    <td className="px-4 py-2 font-medium text-slate-800">{item.lotNumber || 'N/A'}</td>
                                    <td className="px-4 py-2 text-right font-mono font-medium text-emerald-600">
                                      {item.quantity.toLocaleString(undefined, { maximumFractionDigits: 1 })}
                                    </td>
                                    <td className="px-4 py-2 text-right text-slate-500 text-xs">
                                      {item.lastUpdated ? new Date(item.lastUpdated).toLocaleDateString() : '-'}
                                    </td>
                                  </tr>
                                ))
                            ) : (
                              <tr>
                                <td colSpan={3} className="px-4 py-8 text-center text-slate-400 italic">
                                  No inventory lots found for this yarn.
                                </td>
                              </tr>
                            )}
                        </tbody>
                        <tfoot className="bg-slate-50 border-t border-slate-200 font-semibold text-slate-700">
                          <tr>
                            <td className="px-4 py-2 text-right">Total In Stock:</td>
                            <td className="px-4 py-2 text-right font-mono text-emerald-600">
                              {selectedYarnDetails.inStock.toLocaleString(undefined, { maximumFractionDigits: 1 })}
                            </td>
                            <td></td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  </div>
                </div>
              </div>
              
              <div className="p-4 border-t border-slate-200 bg-slate-50 flex justify-end">
                <button 
                  onClick={() => setSelectedYarnDetails(null)}
                  className="px-4 py-2 bg-white border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50 font-medium shadow-sm"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

const YarnBreakdownModal: React.FC<{
  isOpen: boolean;
  onClose: () => void;
  yarnName: string;
  totalWeight: number;
  fabrics: { name: string; weight: number }[];
}> = ({ isOpen, onClose, yarnName, totalWeight, fabrics }) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md overflow-hidden flex flex-col max-h-[80vh]">
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
          <div>
            <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2">
              <Package className="w-5 h-5 text-blue-600" />
              {yarnName}
            </h2>
            <p className="text-sm text-slate-500">
              Total Requirement: <span className="font-bold text-slate-700">{totalWeight.toLocaleString(undefined, { maximumFractionDigits: 1 })} kg</span>
            </p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-full transition-colors">
            <X className="w-5 h-5 text-slate-400" />
          </button>
        </div>

        <div className="p-0 overflow-y-auto flex-1">
            <table className="w-full text-sm text-left">
              <thead className="bg-slate-50 text-slate-500 font-medium border-b border-slate-200">
                <tr>
                  <th className="px-6 py-3">Fabric Name</th>
                  <th className="px-6 py-3 text-right">Quantity (kg)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {fabrics.map((fabric, idx) => (
                  <tr key={idx} className="hover:bg-slate-50 transition-colors">
                    <td className="px-6 py-3 font-medium text-slate-700">{fabric.name}</td>
                    <td className="px-6 py-3 text-right font-mono text-slate-600">
                      {fabric.weight.toLocaleString(undefined, { maximumFractionDigits: 1 })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
        </div>
        
        <div className="px-6 py-4 bg-slate-50 border-t border-slate-200 flex justify-end">
          <button 
            onClick={onClose}
            className="px-4 py-2 bg-white border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50 font-medium transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

const InventoryViewModal: React.FC<{
  isOpen: boolean;
  onClose: () => void;
  yarnName: string;
  yarnId?: string;
}> = ({ isOpen, onClose, yarnName, yarnId }) => {
  const [items, setItems] = useState<YarnInventoryItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (isOpen && (yarnName || yarnId)) {
      const fetchInventory = async () => {
        setLoading(true);
        try {
          let q;
          if (yarnId) {
             // Try to find by ID or Name
             q = query(collection(db, 'yarn_inventory'), 
                or(
                    where('yarnName', '==', yarnName),
                    where('yarnId', '==', yarnId)
                )
             );
          } else {
             q = query(collection(db, 'yarn_inventory'), where('yarnName', '==', yarnName));
          }
          const snapshot = await getDocs(q);
          const data = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as YarnInventoryItem));
          setItems(data);
        } catch (err) {
          console.error("Error fetching inventory:", err);
          // Fallback to name only if OR query fails (e.g. old SDK or index issues)
          try {
             const qFallback = query(collection(db, 'yarn_inventory'), where('yarnName', '==', yarnName));
             const snapshotFallback = await getDocs(qFallback);
             const dataFallback = snapshotFallback.docs.map(d => ({ id: d.id, ...d.data() } as YarnInventoryItem));
             setItems(dataFallback);
          } catch (e) {
             console.error("Fallback failed:", e);
          }
        } finally {
          setLoading(false);
        }
      };
      fetchInventory();
    }
  }, [isOpen, yarnName, yarnId]);

  if (!isOpen) return null;

  const totalQty = items.reduce((sum, item) => sum + item.quantity, 0);

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[80vh]">
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
          <div>
            <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2">
              <Package className="w-5 h-5 text-blue-600" />
              Inventory: {yarnName}
            </h2>
            <p className="text-sm text-slate-500">
              Total Available: <span className="font-bold text-slate-700">{totalQty.toLocaleString()} kg</span>
            </p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-full transition-colors">
            <X className="w-5 h-5 text-slate-400" />
          </button>
        </div>

        <div className="p-0 overflow-y-auto flex-1">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
            </div>
          ) : items.length > 0 ? (
            <table className="w-full text-sm text-left">
              <thead className="bg-slate-50 text-slate-500 font-medium border-b border-slate-200">
                <tr>
                  <th className="px-6 py-3">Lot Number</th>
                  <th className="px-6 py-3 text-right">Quantity (kg)</th>
                  <th className="px-6 py-3 text-right">Last Updated</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {items.map((item) => (
                  <tr key={item.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-6 py-3 font-medium text-slate-700">{item.lotNumber}</td>
                    <td className="px-6 py-3 text-right font-mono text-slate-600">
                      {item.quantity.toLocaleString()}
                    </td>
                    <td className="px-6 py-3 text-right text-slate-400 text-xs">
                      {new Date(item.lastUpdated).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="text-center py-12 text-slate-400">
              <AlertCircle className="w-12 h-12 mx-auto mb-2 text-slate-200" />
              <p>No inventory records found for this yarn.</p>
            </div>
          )}
        </div>
        
        <div className="px-6 py-4 bg-slate-50 border-t border-slate-200 flex justify-end">
          <button 
            onClick={onClose}
            className="px-4 py-2 bg-white border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50 font-medium transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

