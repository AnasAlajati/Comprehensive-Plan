import React, { useState, useEffect, useRef, useMemo } from 'react';
import { 
  collection, 
  onSnapshot, 
  doc, 
  addDoc, 
  setDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  or,
  getDocs,
  collectionGroup,
  writeBatch,
  deleteField
} from 'firebase/firestore';
import { db } from '../services/firebase';
import { DataService } from '../services/dataService';
import { CustomerSheet, OrderRow, MachineSS, MachineStatus, Fabric, Yarn, YarnInventoryItem, YarnAllocationItem, FabricDefinition, Dyehouse, DyehouseMachine, Season } from '../types';
import { FabricDetailsModal } from './FabricDetailsModal';
import { FabricFormModal } from './FabricFormModal';
import { CreatePlanModal } from './CreatePlanModal';
import { FabricProductionOrderModal } from './FabricProductionOrderModal';
import { OrderProductionHistoryModal } from './OrderProductionHistoryModal';
import { 
  Plus, 
  Trash2, 
  UserPlus, 
  Search,
  FileSpreadsheet,
  MapPin,
  Layers,
  CheckCircle2,
  AlertCircle,
  X,
  Calendar,
  Calculator,
  CheckSquare,
  Square,
  Droplets,
  ChevronDown,
  ChevronUp,
  ChevronRight,
  Package,
  Users,
  ArrowRight,
  Sparkles,
  Factory,
  FileText,
  History,
  Trophy
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

// --- Smart Allocation Logic ---

interface DyehouseOption {
  dyehouse: Dyehouse;
  assignments: { quantity: number; machineCapacity: number; currentLoad: number }[];
  score: number;
  reasons: string[];
  machineLoad: Record<number, number>; // Capacity -> Count
}

const findAllDyehouseOptions = (
  plan: { quantity: number }[], 
  dyehouses: Dyehouse[],
  loadMap: Record<string, Record<number, number>>
): DyehouseOption[] => {
  if (!plan.length || !dyehouses.length) return [];

  const results: DyehouseOption[] = [];

  for (const dh of dyehouses) {
    if (!dh.machines || dh.machines.length === 0) continue;

    let currentScore = 0;
    let currentAssignments: { quantity: number; machineCapacity: number; currentLoad: number }[] = [];
    let reasons: string[] = [];
    
    // Get current load for this dyehouse
    const dhLoad = loadMap[dh.name] || {};

    // Create a pool of available machines
    // We just look at available capacities.
    let availableCapacities = dh.machines.map(m => m.capacity).sort((a, b) => a - b);
    
    let totalWastedSpace = 0;
    let underCapacityCount = 0;
    let totalLoadPenalty = 0;

    for (const batch of plan) {
      const qty = Number(batch.quantity) || 0;
      if (qty <= 0) continue;
      
      // Find best fit
      let bestCap = -1;
      
      // 1. Try to find exact or larger
      for (const cap of availableCapacities) {
        if (cap >= qty) {
          bestCap = cap;
          break;
        }
      }

      // 2. If no larger machine, find largest available
      if (bestCap === -1) {
         if (availableCapacities.length > 0) {
             bestCap = availableCapacities[availableCapacities.length - 1];
             currentScore += 10000; 
             underCapacityCount++;
         } else {
             currentScore += 100000; 
         }
      }

      if (bestCap !== -1) {
        const diff = bestCap - qty;
        if (diff >= 0) {
            currentScore += diff; 
            totalWastedSpace += diff;
        }
        
        // Load Penalty
        const currentLoad = dhLoad[bestCap] || 0;
        const loadPenalty = currentLoad * 500; // 1 order = 500 points of "badness"
        currentScore += loadPenalty;
        totalLoadPenalty += loadPenalty;

        currentAssignments.push({ quantity: qty, machineCapacity: bestCap, currentLoad });
      }
    }

    // Generate Reasons
    if (underCapacityCount > 0) {
        reasons.push(`⚠️ Capacity Issue`);
    } else if (totalLoadPenalty === 0 && totalWastedSpace === 0) {
        reasons.push("✨ Perfect Match");
    } else if (totalLoadPenalty > 0) {
        reasons.push(`⚠️ High Load`);
    } else {
        reasons.push("✅ Available");
    }

    results.push({
        dyehouse: dh,
        assignments: currentAssignments,
        score: currentScore,
        reasons,
        machineLoad: dhLoad
    });
  }

  // Sort by score (lower is better)
  return results.sort((a, b) => a.score - b.score);
};

const SmartAllocationPanel: React.FC<{
  plan: any[];
  dyehouses: Dyehouse[];
  allOrders: OrderRow[];
  onApply: (dyehouseName: string) => void;
  context?: {
      customer: string;
      fabric: string;
      qty: number;
      requiredColors?: number;
  };
}> = ({ plan, dyehouses, allOrders, onApply, context }) => {
  const [expanded, setExpanded] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [showColorDetails, setShowColorDetails] = useState(false);
  
  // Calculate Global Load Map
  const loadMap = useMemo(() => {
      const map: Record<string, Record<number, number>> = {};
      allOrders.forEach(order => {
          if (!order.dyeingPlan) return;
          order.dyeingPlan.forEach(batch => {
              if (batch.dyehouse && batch.plannedCapacity) {
                  if (!map[batch.dyehouse]) map[batch.dyehouse] = {};
                  if (!map[batch.dyehouse][batch.plannedCapacity]) map[batch.dyehouse][batch.plannedCapacity] = 0;
                  map[batch.dyehouse][batch.plannedCapacity]++;
              }
          });
      });
      return map;
  }, [allOrders]);

  const options = useMemo(() => {
    return findAllDyehouseOptions(plan, dyehouses, loadMap);
  }, [plan, dyehouses, loadMap]);

  if (options.length === 0) return null;

  const bestOption = options[0];
  const otherOptions = options.slice(1);

  const renderMachineBadges = (option: DyehouseOption, large: boolean = false) => {
      // Get all machine types for this dyehouse
      const machines = option.dyehouse.machines || [];
      const sortedMachines = [...machines].sort((a, b) => a.capacity - b.capacity);
      
      return (
          <div className={`flex flex-wrap gap-1 ${large ? 'mt-2' : 'mt-1'}`}>
              {sortedMachines.map((m, idx) => {
                  const load = option.machineLoad[m.capacity] || 0;
                  // Check if this machine is being suggested for any batch in the current plan
                  const isSuggested = option.assignments.some(a => a.machineCapacity === m.capacity);
                  
                  return (
                      <span 
                        key={idx} 
                        className={`rounded border flex items-center gap-1 ${
                            large ? 'text-[11px] px-2 py-1' : 'text-[9px] px-1.5 py-0.5'
                        } ${
                            isSuggested 
                                ? "bg-indigo-600 text-white border-indigo-600 font-bold shadow-sm" 
                                : "bg-slate-50 text-slate-500 border-slate-200"
                        }`}
                        title={`${load} active orders on ${m.capacity}kg machines`}
                      >
                          {m.capacity}kg
                          <span className={`ml-0.5 ${isSuggested ? "text-indigo-100" : "text-slate-400"}`}>
                              ({load})
                          </span>
                      </span>
                  );
              })}
          </div>
      );
  };

  return (
    <>
        {/* Inline Trigger - Compact & Clean */}
        <div className="mt-3 pt-2 border-t border-slate-100 flex items-center justify-between">
            <div className="flex items-center gap-3">
                <div className="flex items-center gap-2 bg-indigo-50 text-indigo-700 px-2 py-1 rounded-md border border-indigo-100">
                    <Sparkles size={12} />
                    <span className="text-[10px] font-bold uppercase tracking-wide">Smart Suggestion</span>
                </div>
                <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-slate-700">{bestOption.dyehouse.name}</span>
                    <div className="flex flex-wrap items-center gap-2 border-l border-slate-200 pl-2">
                        {bestOption.assignments.map((a, i) => (
                            <span key={i} className="flex items-center gap-1.5 text-[10px] text-slate-600 bg-white px-2 py-1 rounded-md border border-slate-200 shadow-sm whitespace-nowrap">
                                <span className="font-bold text-slate-700">{a.quantity}kg</span>
                                <ArrowRight size={10} className="text-slate-400" />
                                <span className="font-bold text-indigo-600 bg-indigo-50 px-1 rounded">{a.machineCapacity}kg Vessel</span>
                            </span>
                        ))}
                    </div>
                    <span className="text-[10px] text-slate-400 border-l border-slate-200 pl-2">
                        {bestOption.reasons[0]}
                    </span>
                </div>
            </div>
            <div className="flex items-center gap-2">
                <button
                    onClick={() => setShowModal(true)}
                    className="text-[10px] text-slate-500 hover:text-indigo-600 font-medium px-2 py-1 hover:bg-slate-50 rounded transition-colors"
                >
                    View Details
                </button>
                <button
                    onClick={() => onApply(bestOption.dyehouse.name)}
                    className="text-[10px] bg-indigo-600 hover:bg-indigo-700 text-white px-2.5 py-1 rounded shadow-sm font-medium transition-colors flex items-center gap-1"
                >
                    <CheckCircle2 size={12} />
                    Apply
                </button>
            </div>
        </div>

        {/* Modal */}
        {showModal && (
            <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4 animate-in fade-in duration-200">
                <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
                    {/* Modal Header */}
                    <div className="p-4 border-b border-slate-100 bg-slate-50/50">
                        <div className="flex items-start justify-between">
                            <div className="flex items-center gap-3">
                                <div className="bg-indigo-100 p-2 rounded-lg text-indigo-600">
                                    <Sparkles size={20} />
                                </div>
                                <div>
                                    <h3 className="font-bold text-slate-800 text-lg">Smart Allocation Analysis</h3>
                                    <div className="flex items-center gap-2 text-xs text-slate-500 mt-0.5">
                                        <span>Comparing capacity & load for optimal efficiency</span>
                                    </div>
                                </div>
                            </div>
                            <button onClick={() => setShowModal(false)} className="p-2 hover:bg-slate-100 rounded-full text-slate-400 hover:text-slate-600 transition-colors">
                                <X size={20} />
                            </button>
                        </div>
                        
                        {/* Context Bar */}
                        {context && (
                            <div className="mt-4 flex items-center gap-4 bg-white border border-slate-200 rounded-lg p-2 text-xs">
                                <div className="flex flex-col px-2 border-r border-slate-100">
                                    <span className="text-[10px] text-slate-400 uppercase font-bold">Customer</span>
                                    <span className="font-medium text-slate-700">{context.customer}</span>
                                </div>
                                <div className="flex flex-col px-2 border-r border-slate-100">
                                    <span className="text-[10px] text-slate-400 uppercase font-bold">Fabric</span>
                                    <span className="font-medium text-slate-700">{context.fabric}</span>
                                </div>
                                <div 
                                    className="flex flex-col px-2 border-r border-slate-100 cursor-pointer hover:bg-slate-50 transition-colors relative group select-none"
                                    onClick={() => setShowColorDetails(!showColorDetails)}
                                    title="Click to view color breakdown"
                                >
                                    <span className="text-[10px] text-slate-400 uppercase font-bold flex items-center gap-1">
                                        Required Colors
                                        <ChevronDown size={10} className={`transition-transform ${showColorDetails ? 'rotate-180' : ''}`} />
                                    </span>
                                    <span className="font-medium text-slate-700">{context.requiredColors || 0}</span>
                                    
                                    {/* Dropdown/Popover for colors */}
                                    {showColorDetails && (
                                        <div className="absolute top-full left-0 mt-2 bg-white border border-slate-200 shadow-xl rounded-lg p-2 z-50 min-w-[200px] animate-in fade-in zoom-in-95">
                                            <div className="text-[10px] font-bold text-slate-400 mb-2 uppercase border-b border-slate-100 pb-1">Color Breakdown</div>
                                            <div className="space-y-1 max-h-[200px] overflow-y-auto custom-scrollbar">
                                                {plan.map((batch, idx) => (
                                                    <div key={idx} className="flex items-center justify-between text-xs hover:bg-slate-50 p-1 rounded">
                                                        <div className="flex items-center gap-2">
                                                            <div 
                                                                className="w-2 h-2 rounded-full border border-slate-200 shadow-sm" 
                                                                style={{ backgroundColor: batch.color ? '#6366f1' : '#cbd5e1' }} // Placeholder color logic
                                                            ></div>
                                                            <span className="font-medium text-slate-700">{batch.color || 'Unspecified'}</span>
                                                        </div>
                                                        <span className="font-mono text-slate-500 bg-slate-100 px-1.5 rounded text-[10px]">{batch.quantity}kg</span>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                </div>
                                <div className="flex flex-col px-2">
                                    <span className="text-[10px] text-slate-400 uppercase font-bold">Total Qty</span>
                                    <span className="font-medium text-slate-700 font-mono">{context.qty}kg</span>
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Modal Body */}
                    <div className="p-6 overflow-y-auto bg-slate-50/30 space-y-6">
                        
                        {/* Top Recommendation */}
                        <div className="space-y-2">
                            <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-2">
                                <Trophy size={14} className="text-amber-500" />
                                Top Recommendation
                            </h4>
                            <div className="bg-white rounded-lg border-2 border-indigo-500 shadow-lg p-4 relative overflow-hidden group">
                                <div className="absolute top-0 right-0 bg-indigo-500 text-white text-[10px] font-bold px-3 py-1 rounded-bl-lg shadow-sm">
                                    BEST MATCH
                                </div>
                                
                                <div className="flex items-start justify-between mb-4">
                                    <div>
                                        <h2 className="text-xl font-bold text-slate-800">{bestOption.dyehouse.name}</h2>
                                        <div className="flex flex-wrap gap-2 mt-1">
                                            {bestOption.reasons.map((r, i) => (
                                                <span key={i} className="text-[10px] px-2 py-0.5 bg-indigo-50 text-indigo-700 rounded-full font-medium border border-indigo-100">
                                                    {r}
                                                </span>
                                            ))}
                                        </div>
                                    </div>
                                    <button
                                        onClick={() => { onApply(bestOption.dyehouse.name); setShowModal(false); }}
                                        className="mt-6 bg-indigo-600 hover:bg-indigo-700 text-white px-6 py-2 rounded-lg shadow-md font-medium transition-all transform active:scale-95 flex items-center gap-2"
                                    >
                                        Select This Option
                                        <ArrowRight size={16} />
                                    </button>
                                </div>

                                <div className="bg-slate-50 rounded border border-slate-100 p-3">
                                    <div className="text-[10px] font-medium text-slate-400 mb-2 uppercase">Machine Availability & Load</div>
                                    {renderMachineBadges(bestOption, true)} 
                                </div>
                            </div>
                        </div>

                        {/* Other Options */}
                        {options.length > 1 && (
                            <div className="space-y-2">
                                <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Other Possibilities</h4>
                                <div className="grid grid-cols-1 gap-3">
                                    {options.slice(1).map((opt, idx) => (
                                        <div key={idx} className="bg-white rounded-lg border border-slate-200 p-4 hover:border-indigo-300 transition-all hover:shadow-md group">
                                            <div className="flex items-center justify-between mb-3">
                                                <div>
                                                    <h3 className="font-bold text-slate-700">{opt.dyehouse.name}</h3>
                                                    <div className="flex gap-2 mt-0.5">
                                                        {opt.reasons.map((r, i) => (
                                                            <span key={i} className="text-[10px] text-slate-500">
                                                                {r}
                                                            </span>
                                                        ))}
                                                    </div>
                                                </div>
                                                <button
                                                    onClick={() => { onApply(opt.dyehouse.name); setShowModal(false); }}
                                                    className="text-xs text-indigo-600 bg-indigo-50 hover:bg-indigo-100 px-3 py-1.5 rounded font-medium transition-colors opacity-0 group-hover:opacity-100"
                                                >
                                                    Select
                                                </button>
                                            </div>
                                            {renderMachineBadges(opt, false)}
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        )}
    </>
  );
};

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
             handleSelect(filteredOptions[0]);
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
                  onClick={() => handleSelect(opt)}
                  className="px-3 py-2 hover:bg-blue-50 cursor-pointer text-sm border-b border-slate-50 last:border-b-0 text-left"
                >
                  <div className="font-medium">{getLabel(opt)}</div>
                  {opt.code && <div className="text-[10px] text-slate-400">{opt.code}</div>}
                </div>
              ))}
              {onCreateNew && searchTerm && !options.some(o => getLabel(o).toLowerCase() === searchTerm.toLowerCase()) && (
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

const formatDateShort = (dateStr: string) => {
  if (!dateStr || dateStr === '-') return '-';
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return dateStr;
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
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
  showDyehouse,
  onOpenCreatePlan,
  dyehouses,
  handleCreateDyehouse,
  machines,
  externalFactories,
  onOpenProductionOrder,
  onOpenHistory,
  hasHistory,
  onFilterMachine,
  allOrders
}: {
  row: OrderRow;
  statusInfo: any;
  fabrics: FabricDefinition[];
  isSelected: boolean;
  toggleSelectRow: (id: string) => void;
  handleUpdateOrder: (id: string, updates: Partial<OrderRow>) => void;
  handleCreateFabric: (name: string) => void;
  handlePlanSearch: (client: string, material: string) => void;
  handleDeleteRow: (id: string) => void;
  selectedCustomerName: string;
  onOpenFabricDetails: (fabricName: string, qty: number, orderId: string) => void;
  showDyehouse: boolean;
  onOpenCreatePlan: (order: OrderRow) => void;
  dyehouses: any[];
  handleCreateDyehouse: (name: string) => void;
  machines: MachineSS[];
  externalFactories: any[];
  onOpenProductionOrder: (order: OrderRow, active: string[], planned: string[]) => void;
  onOpenHistory: (order: OrderRow) => void;
  hasHistory: boolean;
  onFilterMachine?: (capacity: string) => void;
  allOrders: OrderRow[];
}) => {
  const [showMachineDetails, setShowMachineDetails] = useState<{ capacity: number; batches: any[] } | null>(null);
  const [isExpanded, setIsExpanded] = useState(false);
  const refCode = row.material ? `${selectedCustomerName}-${row.material}` : '-';
  const hasActive = statusInfo && statusInfo.active.length > 0;
  const displayRemaining = hasActive ? statusInfo.remaining : row.remainingQty;

  // Calculate Total Yarn for this order if fabric has composition
  const fabricDetails = fabrics.find(f => f.name === row.material);
  
  // Determine active composition based on variantId or fallback to legacy
  let activeComposition: any[] = [];
  if (fabricDetails) {
      if (row.variantId) {
          // Strict variant matching
          if (fabricDetails.variants) {
              const variant = fabricDetails.variants.find(v => v.id === row.variantId);
              if (variant) activeComposition = variant.yarns;
          }
      } else if (fabricDetails.variants && fabricDetails.variants.length > 0) {
          // Auto-select first variant if no specific variant is selected
          // This ensures we always show *some* composition if variants exist
          activeComposition = fabricDetails.variants[0].yarns;
      } else if (fabricDetails.yarnComposition) {
          // Legacy fallback
          activeComposition = fabricDetails.yarnComposition;
      }
  }

  const hasComposition = activeComposition.length > 0;
  
  let totalYarnForOrder = 0;
  if (hasComposition && row.requiredQty > 0) {
    totalYarnForOrder = activeComposition.reduce((sum: number, comp: any) => {
      const base = (row.requiredQty * (comp.percentage || 0)) / 100;
      const scrap = 1 + ((comp.scrapPercentage || 0) / 100);
      return sum + (base * scrap);
    }, 0);
  }

  // Calculate Assigned Machines Summary & Total Capacity
  const { summary: assignedMachinesSummary, totalCapacity, totalSent, totalReceived, groupedBatches } = useMemo(() => {
    if (!row.dyeingPlan || row.dyeingPlan.length === 0) return { summary: '-', totalCapacity: 0, totalSent: 0, totalReceived: 0, groupedBatches: new Map() };
    
    const machineCounts = new Map<number, number>();
    const grouped = new Map<number, any[]>();
    let total = 0;
    let sent = 0;
    let received = 0;

    row.dyeingPlan.forEach(batch => {
      if (batch.plannedCapacity) {
        const current = machineCounts.get(batch.plannedCapacity) || 0;
        machineCounts.set(batch.plannedCapacity, current + 1);
        
        const list = grouped.get(batch.plannedCapacity) || [];
        list.push(batch);
        grouped.set(batch.plannedCapacity, list);
      }
      total += batch.quantity || 0;
      sent += batch.quantitySent || 0;
      received += batch.receivedQuantity || 0;
    });

    if (machineCounts.size === 0 && total === 0) return { summary: '-', totalCapacity: 0, totalSent: 0, totalReceived: 0, groupedBatches: new Map() };

    const summary = Array.from(machineCounts.entries())
      .map(([capacity, count]) => ({ capacity, count }));
      
    return { summary, totalCapacity: total, totalSent: sent, totalReceived: received, groupedBatches: grouped };
  }, [row.dyeingPlan]);

  // Calculate Finished Details (Audit Trail)
  const finishedDetails = useMemo(() => {
      const hasActive = statusInfo && statusInfo.active.length > 0;
      const displayRemaining = hasActive ? statusInfo.remaining : row.remainingQty;
      const hasAnyPlan = (statusInfo?.active?.length > 0) || (statusInfo?.planned?.length > 0);
      
      // Only calculate if potentially finished
      if (hasAnyPlan || (displayRemaining > 0)) return null;

      const logs: { date: string; machine: string; qty: number }[] = [];
      
      // 1. Internal Logs
      machines.forEach(m => {
          m.dailyLogs?.forEach(log => {
              const normalize = (s: string) => s ? s.trim().toLowerCase() : '';
              const logClient = normalize(log.client);
              const logFabric = normalize(log.fabric);
              const normClient = normalize(selectedCustomerName);
              const normFabric = normalize(row.material);
              
              const isMatch = (log.orderReference && row.material && log.orderReference.includes(row.material)) || 
                              (logClient === normClient && logFabric === normFabric);

              if (isMatch && log.dayProduction > 0) {
                  logs.push({
                      date: log.date,
                      machine: m.name,
                      qty: log.dayProduction
                  });
              }
          });
      });

      // 2. External Plans
      externalFactories.forEach(factory => {
          factory.plans?.forEach((plan: any) => {
              const normalize = (s: string) => s ? s.trim().toLowerCase() : '';
              const planClient = normalize(plan.client);
              const planFabric = normalize(plan.fabric);
              const normClient = normalize(selectedCustomerName);
              const normFabric = normalize(row.material);

              if (planClient === normClient && planFabric === normFabric) {
                  logs.push({
                      date: plan.endDate || plan.startDate || 'Unknown',
                      machine: `${factory.name} (Ext)`,
                      qty: plan.quantity || 0
                  });
              }
          });
      });

      if (logs.length === 0) return null;

      logs.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

      const lastDate = logs[0].date;
      const uniqueMachines = Array.from(new Set(logs.map(l => l.machine)));
      
      return { lastDate, uniqueMachines, logs };
  }, [machines, externalFactories, row, selectedCustomerName, statusInfo]);

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
                {(() => {
                  const fabricDef = fabrics.find(f => f.name === row.material);
                  return fabricDef ? (fabricDef.shortName || fabricDef.name) : (row.material || '-');
                })()}
             </div>
          </td>
          {/* Dyehouse (Computed Read-Only) */}
          <td className="p-0 border-r border-slate-200 bg-slate-50/50">
             <div className="flex items-center h-full w-full px-3 py-2 text-slate-600 text-xs font-medium">
                {(() => {
                   const plan = row.dyeingPlan || [];
                   const uniqueDyehouses = Array.from(new Set(plan.map(b => b.dyehouse).filter(Boolean)));
                   
                   if (uniqueDyehouses.length === 0) return <span className="text-slate-400 italic">Unassigned</span>;
                   // Join with " + " as requested
                   return (
                     <span title={uniqueDyehouses.join(' + ')} className="truncate max-w-[150px] block">
                       {uniqueDyehouses.join(' + ')}
                     </span>
                   );
                })()}
             </div>
          </td>
          {/* Assigned Machines (Calculated) */}
          <td className="p-0 border-r border-slate-200 relative">
             <div className="flex flex-col justify-center h-full w-full px-3 py-2">
                <div className="flex flex-wrap gap-2 justify-center items-center">
                    {Array.isArray(assignedMachinesSummary) ? (
                        assignedMachinesSummary.map((part, idx) => (
                            <span 
                                key={idx} 
                                className="bg-slate-100 text-slate-700 font-mono text-xs px-1.5 py-0.5 rounded border border-slate-200 cursor-pointer hover:bg-blue-50 hover:text-blue-600 hover:border-blue-200 transition-colors"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    if (onFilterMachine) onFilterMachine(String(part.capacity));
                                    const batches = groupedBatches.get(part.capacity) || [];
                                    setShowMachineDetails({ capacity: part.capacity, batches });
                                }}
                            >
                                {part.capacity} <span className="text-slate-400 text-[10px]">x{part.count}</span>
                            </span>
                        ))
                    ) : (
                        <div className="text-slate-700 font-mono text-xs">{assignedMachinesSummary}</div>
                    )}
                    
                    {/* Status Icon with Tooltip */}
                    {totalCapacity > 0 && (
                        <div className="relative group/total ml-1">
                            {(() => {
                                const diff = Math.abs(totalCapacity - row.requiredQty);
                                const percentage = row.requiredQty > 0 ? (diff / row.requiredQty) * 100 : 0;
                                const isProblem = percentage > 15;
                                return isProblem ? (
                                    <AlertCircle className="w-4 h-4 text-amber-500 cursor-help" />
                                ) : (
                                    <CheckCircle2 className="w-4 h-4 text-emerald-500 cursor-help" />
                                );
                            })()}
                            
                            <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover/total:block z-50 bg-slate-800 text-white text-xs rounded px-2 py-1 whitespace-nowrap shadow-lg pointer-events-none">
                                <div className="font-bold mb-0.5 border-b border-slate-600 pb-0.5">Total Capacity</div>
                                <div className="flex items-center gap-2 font-mono">
                                    <span className={totalCapacity < row.requiredQty ? "text-amber-300" : "text-emerald-300"}>{totalCapacity}</span>
                                    <span className="text-slate-400">/</span>
                                    <span>{row.requiredQty}</span>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
             </div>
             
             {/* Popover */}
             {showMachineDetails && (
                <div className="absolute top-full left-0 z-50 mt-1 w-72 bg-white border border-slate-200 shadow-xl rounded-lg p-3">
                    <div className="flex justify-between items-center mb-2 pb-2 border-b border-slate-100">
                        <h4 className="font-bold text-xs text-slate-800">
                            {showMachineDetails.capacity}kg Machines ({showMachineDetails.batches.length})
                        </h4>
                        <button onClick={(e) => { e.stopPropagation(); setShowMachineDetails(null); }} className="text-slate-400 hover:text-slate-600">
                            <X className="w-3 h-3" />
                        </button>
                    </div>
                    <div className="space-y-2 max-h-48 overflow-y-auto">
                        {showMachineDetails.batches.map((batch, idx) => (
                            <div key={idx} className="text-xs bg-slate-50 p-2 rounded border border-slate-100">
                                <div className="flex justify-between mb-1">
                                    <span className="font-medium text-slate-700">{row.material}</span>
                                    <span className="text-slate-500">{batch.color || '-'}</span>
                                </div>
                                <div className="flex justify-between text-[10px] text-slate-400">
                                    <span>{batch.machine || 'Unassigned'}</span>
                                    <span>{batch.dateSent || batch.formationDate || '-'}</span>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
             )}
          </td>
          {/* Total Sent */}
          <td className="p-0 border-r border-slate-200 text-right">
             <div className="px-3 py-2 font-mono text-blue-600 font-medium text-xs">
                {totalSent > 0 ? totalSent : '-'}
             </div>
          </td>
          {/* Total Received */}
          <td className="p-0 border-r border-slate-200 text-right">
             <div className="px-3 py-2 font-mono text-emerald-600 font-medium text-xs">
                {totalReceived > 0 ? totalReceived : '-'}
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
                  onChange={(val) => {
                      // Reset variant when fabric changes
                      handleUpdateOrder(row.id, { material: val, variantId: undefined });
                  }}
                  onCreateNew={handleCreateFabric}
                  placeholder="Select Fabric..."
                />
                
                {/* Variant Selector */}
                {fabricDetails && fabricDetails.variants && fabricDetails.variants.length > 1 && (
                    <div className="mt-1 px-1">
                        <select
                            value={row.variantId || ''}
                            onChange={(e) => handleUpdateOrder(row.id, { variantId: e.target.value })}
                            className={`w-full text-[10px] p-1 border rounded focus:outline-none cursor-pointer ${!row.variantId ? 'bg-amber-50 border-amber-300 text-amber-700 font-bold animate-pulse' : 'bg-slate-50 border-slate-200 text-slate-600'}`}
                            onClick={(e) => e.stopPropagation()}
                        >
                            <option value="">{row.variantId ? 'Change Variant...' : '⚠️ Select Variant (Required)'}</option>
                            {fabricDetails.variants.map((v, idx) => (
                                <option key={v.id} value={v.id}>
                                    {v.yarns.map(y => `${y.percentage}% ${y.name || 'Unknown'}`).join(', ')}
                                </option>
                            ))}
                        </select>
                    </div>
                )}

                {/* Total Yarn Display */}
                {hasComposition && row.requiredQty > 0 && (
                   <div className="mt-1 px-1 flex items-center gap-2">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onOpenFabricDetails(row.material, row.requiredQty, row.id);
                        }}
                        className="text-[10px] font-medium text-blue-600 bg-blue-50 px-2 py-0.5 rounded border border-blue-100 hover:bg-blue-100 transition-colors flex items-center gap-1"
                        title="View Yarn Details"
                      >
                        <Calculator size={10} />
                        Yarn Info
                      </button>
                      <span className="text-[10px] font-mono text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded border border-slate-200" title="Total Yarn Required including scrap">
                        Total: {totalYarnForOrder.toLocaleString(undefined, { maximumFractionDigits: 1 })} kg
                      </span>
                   </div>
                )}

                {hasComposition && (
                   <div className="px-2 pb-1 text-[10px] text-slate-500 font-mono flex items-center gap-1 opacity-0 group-hover/fabric:opacity-100 transition-opacity">
                     <CheckCircle2 className="w-3 h-3 text-emerald-500" />
                     <span>Verified</span>
                   </div>
                )}
              </div>
              {/* Removed absolute calculator button in favor of inline action */}
            </div>
          </td>

          {/* Req GSM */}
          <td className="p-0 border-r border-slate-200">
            <input 
              type="number"
              className="w-full h-full px-2 py-2 text-right bg-transparent outline-none focus:bg-blue-50 font-mono text-slate-600 text-xs"
              value={row.requiredGsm ?? ''}
              onChange={(e) => handleUpdateOrder(row.id, { requiredGsm: Number(e.target.value) })}
              placeholder="-"
            />
          </td>

          {/* Req Width */}
          <td className="p-0 border-r border-slate-200">
            <input 
              type="number"
              className="w-full h-full px-2 py-2 text-right bg-transparent outline-none focus:bg-blue-50 font-mono text-slate-600 text-xs"
              value={row.requiredWidth ?? ''}
              onChange={(e) => handleUpdateOrder(row.id, { requiredWidth: Number(e.target.value) })}
              placeholder="-"
            />
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
                {(() => {
                  // 1. Internal Active & Planned from statsMap
                  // Filter out "(Ext)" entries from active list as they are handled by externalMatches
                  const rawActive = statusInfo?.active || [];
                  const internalActive = rawActive.filter((m: string) => !m.endsWith('(Ext)'));
                  const internalPlanned = statusInfo?.planned || [];

                  // 2. External Matches
                  const externalMatches: { factoryName: string; status: string }[] = [];
                  const reference = `${selectedCustomerName}-${row.material}`;
                  
                  if (externalFactories && externalFactories.length > 0) {
                    for (const factory of externalFactories) {
                      if (factory.plans && Array.isArray(factory.plans)) {
                        for (const plan of factory.plans) {
                           const isClientMatch = plan.client && plan.client.trim().toLowerCase() === selectedCustomerName.toLowerCase();
                           const isFabricMatch = plan.fabric && row.material && plan.fabric.trim().toLowerCase() === row.material.toLowerCase();
                           
                           const constructedRef = `${plan.client}-${plan.fabric ? plan.fabric.split(/[\s-]+/).map((w: string) => w[0]).join('').toUpperCase() : ''}`;
                           const isRefMatch = (plan.orderReference && plan.orderReference.toLowerCase() === reference.toLowerCase()) ||
                                              (constructedRef.toLowerCase() === reference.toLowerCase());

                           if ((isClientMatch && isFabricMatch) || isRefMatch) {
                              externalMatches.push({
                                factoryName: factory.name,
                                status: plan.status === 'ACTIVE' ? 'Active' : 'Planned'
                              });
                           }
                        }
                      }
                    }
                  }

                  // 3. Direct Machine Assignment (Legacy/Fallback)
                  let directMachine = null;
                  if (internalActive.length === 0 && internalPlanned.length === 0 && row.machine) {
                     const m = machines.find(m => m.name === row.machine);
                     if (m) {
                        directMachine = m;
                     }
                  }

                  const hasAnyPlan = internalActive.length > 0 || internalPlanned.length > 0 || externalMatches.length > 0 || directMachine;

                  if (!hasAnyPlan) {
                     if ((displayRemaining || 0) <= 0) {
                        return (
                            <div className="group/finished relative">
                                <span className="text-[10px] text-slate-400 font-medium bg-slate-100 px-2 py-0.5 rounded-full whitespace-nowrap border border-slate-200 w-fit cursor-help">
                                  Finished
                                </span>
                                {finishedDetails && (
                                    <div className="hidden group-hover/finished:block absolute z-50 bg-white text-slate-700 text-[10px] p-2 rounded shadow-xl border border-slate-200 -mt-10 left-1/2 -translate-x-1/2 min-w-[200px]">
                                        <div className="font-bold border-b border-slate-100 mb-1 pb-1 text-slate-900">Finished Audit</div>
                                        <div className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-1">
                                            <span className="text-slate-500">Last Date:</span>
                                            <span className="font-mono">{finishedDetails.lastDate}</span>
                                            
                                            <span className="text-slate-500">Machines:</span>
                                            <div className="flex flex-wrap gap-1">
                                                {finishedDetails.uniqueMachines.map(m => (
                                                    <span key={m} className="bg-slate-100 px-1 rounded border border-slate-200">{m}</span>
                                                ))}
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </div>
                        );
                     }
                     return (
                        <button 
                          onClick={() => onOpenCreatePlan(row)}
                          className="text-[10px] text-amber-600 font-medium bg-amber-50 px-2 py-0.5 rounded-full whitespace-nowrap border border-amber-100 w-fit hover:bg-amber-100 hover:border-amber-300 transition-colors flex items-center gap-1"
                          title="Click to assign machine"
                        >
                          Not Planned
                          <Plus size={10} />
                        </button>
                     );
                  }

                  return (
                    <div className="flex flex-col gap-1.5 relative">
                        {/* Debug Info */}
                        {statusInfo?.debug && (
                            <div className="hidden group-hover:block absolute z-50 bg-black text-white text-[10px] p-2 rounded shadow-lg bottom-full left-1/2 -translate-x-1/2 mb-2 whitespace-nowrap pointer-events-none">
                                <div className="font-bold border-b border-gray-700 mb-1 pb-1">Debug Status Source</div>
                                <div>Active: {statusInfo.debug.activeReasons.length ? statusInfo.debug.activeReasons.join(', ') : 'None'}</div>
                                <div>Planned: {statusInfo.debug.plannedReasons.length ? statusInfo.debug.plannedReasons.join(', ') : 'None'}</div>
                                <div>Ext Matches: {externalMatches.length ? externalMatches.map(m => m.factoryName).join(', ') : 'None'}</div>
                                <div>Direct Machine: {directMachine ? `${directMachine.name} (Assigned to Order)` : 'None'}</div>
                            </div>
                        )}

                      {/* Internal Active */}
                      {internalActive.length > 0 && (
                        <div className="flex flex-wrap gap-1">
                          {internalActive.map((mName: string, i: number) => {
                            const machine = machines.find(m => m.name === mName);
                            const status = machine?.status || 'Active';
                            
                            let badgeClass = "bg-emerald-100 text-emerald-700 border-emerald-200";
                            if (status === 'Stopped') badgeClass = "bg-red-100 text-red-700 border-red-200";
                            if (status === 'Under Operation' || status === 'Maintenance' || status === 'Under Construction') badgeClass = "bg-amber-100 text-amber-700 border-amber-200";

                            return (
                              <span key={`a-${i}`} className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium whitespace-nowrap border ${badgeClass}`}>
                                {mName} - {status}
                              </span>
                            );
                          })}
                        </div>
                      )}

                      {/* Direct Machine Assignment (if not covered by Active) */}
                      {directMachine && (
                         <div className="flex flex-wrap gap-1">
                            {(() => {
                                const status = directMachine.status || 'Unknown';
                                const isWorking = status === 'Working';
                                const isStopped = status === 'Stopped';
                                const isMaintenance = status === 'Under Operation' || status === 'Maintenance';
                                
                                let badgeClass = "bg-slate-100 text-slate-600 border-slate-200";
                                if (isWorking) badgeClass = "bg-emerald-50 text-emerald-600 border-emerald-200";
                                if (isStopped) badgeClass = "bg-red-50 text-red-600 border-red-200";
                                if (isMaintenance) badgeClass = "bg-amber-50 text-amber-600 border-amber-200";

                                return (
                                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium whitespace-nowrap border w-fit flex items-center gap-1 group/direct ${badgeClass}`} title="Manually Assigned Machine (Direct)">
                                        {directMachine.name} - {status}
                                        <button
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                if (confirm(`Remove manual assignment of ${directMachine.name}?`)) {
                                                    handleUpdateOrder(row.id, { machine: '' });
                                                }
                                            }}
                                            className="hover:bg-red-100 hover:text-red-600 rounded-full p-0.5 opacity-0 group-hover/direct:opacity-100 transition-opacity"
                                            title="Remove Manual Assignment"
                                        >
                                            <X size={10} />
                                        </button>
                                    </span>
                                );
                            })()}
                         </div>
                      )}

                      {/* Internal Planned */}
                      {internalPlanned.length > 0 && (
                        <div className="flex flex-wrap gap-1">
                          {internalPlanned.map((m: string, i: number) => (
                            <span key={`p-${i}`} className="text-[10px] px-1.5 py-0.5 bg-blue-100 text-blue-700 rounded-full font-medium whitespace-nowrap border border-blue-200">
                              {m}
                            </span>
                          ))}
                        </div>
                      )}

                      {/* External Matches */}
                      {externalMatches.length > 0 && (
                        <div className="flex flex-wrap gap-1">
                          {externalMatches.map((match, i) => {
                             const isActive = match.status === 'Active';
                             // Active External: Cyan to differentiate from Internal Active (Emerald)
                             const badgeClass = isActive 
                                ? "bg-cyan-100 text-cyan-700 border-cyan-200" 
                                : "bg-purple-50 text-purple-700 border-purple-200";
                             
                             return (
                                <span key={`e-${i}`} className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium whitespace-nowrap border flex items-center gap-1 ${badgeClass}`}>
                                  <Factory size={10} />
                                  {match.factoryName}
                                </span>
                             );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })()}
              </div>
              
              <button
                onClick={() => handlePlanSearch(selectedCustomerName, row.material)}
                className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-md transition-all flex-shrink-0"
                title="Search Plan"
              >
                <Search className="w-4 h-4" />
              </button>
              
              <button
                onClick={() => {
                  // Extract active/planned machines for this row
                  const rawActive = statusInfo?.active || [];
                  const internalActive = rawActive.filter((m: string) => !m.endsWith('(Ext)'));
                  const internalPlanned = statusInfo?.planned || [];
                  onOpenProductionOrder(row, internalActive, internalPlanned);
                }}
                className={`p-1.5 rounded-md transition-all flex-shrink-0 flex items-center gap-1 ${
                  row.isPrinted 
                    ? "text-green-600 bg-green-50 hover:bg-green-100 pr-2" 
                    : "text-slate-400 hover:text-purple-600 hover:bg-purple-50"
                }`}
                title={row.isPrinted 
                  ? `Printed on ${row.printedAt ? new Date(row.printedAt).toLocaleDateString('en-GB') : 'Unknown Date'}` 
                  : "Print Production Order"}
              >
                <FileText className="w-4 h-4" />
                {row.isPrinted && row.printedAt && (
                  <span className="text-[10px] font-medium">
                    {new Date(row.printedAt).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit' })}
                  </span>
                )}
              </button>

              <button
                onClick={() => onOpenHistory(row)}
                className={`p-1.5 rounded-md transition-all flex-shrink-0 ${
                  hasHistory 
                    ? "text-orange-600 bg-orange-50 hover:bg-orange-100 ring-1 ring-orange-200 shadow-sm" 
                    : "text-slate-300 hover:text-slate-500 hover:bg-slate-50 opacity-60 hover:opacity-100"
                }`}
                title={hasHistory ? "View Production History" : "No Production History Found"}
              >
                <History className="w-4 h-4" />
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
          <td className="p-2 text-center border-r border-slate-200 text-xs text-slate-500 whitespace-nowrap">
            {formatDateShort(statusInfo?.startDate)}
          </td>

          {/* End Date (Auto) */}
          <td className="p-2 text-center border-r border-slate-200 text-xs text-slate-500 whitespace-nowrap">
            {formatDateShort(statusInfo?.endDate)}
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
        <td colSpan={10} className="p-4 border-b border-slate-200 shadow-inner">
            <div className="bg-white rounded border border-slate-200 overflow-hidden">
              <table className="w-full text-xs" dir="rtl">
                <thead className="bg-slate-50 text-slate-500 font-semibold border-b border-slate-200">
                  <tr>
                    <th className="px-3 py-2 text-right min-w-[120px]">اللون</th>
                    <th className="px-3 py-2 text-right w-24">رقم الازن</th>
                    <th className="px-3 py-2 text-right w-32">تاريخ التشكيل</th>
                    <th className="px-3 py-2 text-center w-16 text-[10px] text-slate-400">ايام</th>
                    <th className="px-3 py-2 text-right w-32">تاريخ الارسال</th>
                    <th className="px-3 py-2 text-center w-16 text-[10px] text-slate-400">ايام</th>
                    <th className="px-3 py-2 text-right w-32">المصبغة</th>
                    <th className="px-3 py-2 text-center w-20" title="Customer Demand">مطلوب</th>
                    <th className="px-3 py-2 text-center w-24" title="Vessel Capacity">ماكنة الصباغة</th>
                    <th className="px-3 py-2 text-center w-20" title="Actual Sent">مرسل</th>
                    <th className="px-3 py-2 text-center w-20">مستلم</th>
                    <th className="px-3 py-2 text-center w-20">الحالة</th>
                    <th className="px-3 py-2 text-right">ملاحظات</th>
                    <th className="px-3 py-2 w-10"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {(row.dyeingPlan || []).map((batch, idx) => (
                    <tr key={batch.id || idx} className="group/batch hover:bg-blue-50/30">
                      <td className="p-0">
                        <input
                          type="text"
                          className="w-full px-3 py-2 bg-transparent outline-none focus:bg-blue-50 text-right"
                          value={batch.color}
                          onChange={(e) => {
                            const newPlan = [...(row.dyeingPlan || [])];
                            newPlan[idx] = { ...batch, color: e.target.value };
                            handleUpdateOrder(row.id, { dyeingPlan: newPlan });
                          }}
                          placeholder="اللون..."
                        />
                      </td>
                      <td className="p-0">
                        <input
                          type="text"
                          className="w-full px-3 py-2 bg-transparent outline-none focus:bg-blue-50 text-right"
                          value={batch.dispatchNumber || ''}
                          onChange={(e) => {
                            const newPlan = [...(row.dyeingPlan || [])];
                            newPlan[idx] = { ...batch, dispatchNumber: e.target.value };
                            handleUpdateOrder(row.id, { dyeingPlan: newPlan });
                          }}
                          placeholder="رقم..."
                        />
                      </td>
                      <td className="p-0">
                        <input
                          type="date"
                          className="w-full px-3 py-2 bg-transparent outline-none focus:bg-blue-50 text-right"
                          value={batch.formationDate || ''}
                          onChange={(e) => {
                            const newPlan = [...(row.dyeingPlan || [])];
                            newPlan[idx] = { ...batch, formationDate: e.target.value };
                            handleUpdateOrder(row.id, { dyeingPlan: newPlan });
                          }}
                        />
                      </td>
                      <td className="p-0 text-center align-middle">
                        {batch.formationDate && (
                          <span className="text-[10px] text-slate-400 font-mono">
                            {Math.floor((new Date().getTime() - new Date(batch.formationDate).getTime()) / (1000 * 60 * 60 * 24))}
                          </span>
                        )}
                      </td>
                      <td className="p-0">
                        <input
                          type="date"
                          className="w-full px-3 py-2 bg-transparent outline-none focus:bg-blue-50 text-right"
                          value={batch.dateSent || ''}
                          onChange={(e) => {
                            const newPlan = [...(row.dyeingPlan || [])];
                            newPlan[idx] = { ...batch, dateSent: e.target.value };
                            handleUpdateOrder(row.id, { dyeingPlan: newPlan });
                          }}
                        />
                      </td>
                      <td className="p-0 text-center align-middle">
                        {batch.dateSent && (
                          <span className="text-[10px] text-slate-400 font-mono">
                            {Math.floor((new Date().getTime() - new Date(batch.dateSent).getTime()) / (1000 * 60 * 60 * 24))}
                          </span>
                        )}
                      </td>
                      <td className="p-0">
                        <SearchDropdown
                          id={`dyehouse-${row.id}-${idx}`}
                          options={dyehouses}
                          value={batch.dyehouse || ''}
                          onChange={(val) => {
                            const newPlan = [...(row.dyeingPlan || [])];
                            // Auto-calculate vessel size if dyehouse is selected
                            const recommended = recommendMachine(val, batch.quantity || 0);
                            newPlan[idx] = { 
                                ...batch, 
                                dyehouse: val,
                                plannedCapacity: recommended || batch.plannedCapacity 
                            };
                            handleUpdateOrder(row.id, { dyeingPlan: newPlan });
                          }}
                          placeholder="المصبغة..."
                          className="w-full h-full px-3 py-2 bg-transparent outline-none focus:bg-blue-50 text-right text-xs"
                        />
                      </td>
                      {/* Required (Customer Demand) */}
                      <td className="p-0">
                        <input
                          type="number"
                          className="w-full px-3 py-2 text-center bg-transparent outline-none focus:bg-blue-50 font-mono text-slate-600"
                          value={batch.quantity || ''}
                          onChange={(e) => {
                            const newPlan = [...(row.dyeingPlan || [])];
                            newPlan[idx] = { ...batch, quantity: Number(e.target.value) };
                            handleUpdateOrder(row.id, { dyeingPlan: newPlan });
                          }}
                          placeholder="0"
                          title="Customer Demand"
                        />
                      </td>
                      {/* Vessel (Planned Capacity) -> Machine Selection */}
                      <td className="p-0 relative">
                        {(() => {
                            const selectedDyehouse = dyehouses.find(d => d.name === batch.dyehouse);
                            const hasMachines = selectedDyehouse && selectedDyehouse.machines && selectedDyehouse.machines.length > 0;
                            
                            if (hasMachines) {
                                return (
                                    <div className="relative w-full h-full">
                                        <select
                                            className="w-full h-full px-1 py-2 text-center bg-transparent outline-none focus:bg-blue-50 font-mono font-bold text-slate-800 text-xs appearance-none cursor-pointer"
                                            value={batch.plannedCapacity || ''}
                                            onChange={(e) => {
                                                const newPlan = [...(row.dyeingPlan || [])];
                                                newPlan[idx] = { ...batch, plannedCapacity: Number(e.target.value) };
                                                handleUpdateOrder(row.id, { dyeingPlan: newPlan });
                                            }}
                                            title="Select Machine Capacity"
                                        >
                                            <option value="">-</option>
                                            {selectedDyehouse.machines.sort((a, b) => a.capacity - b.capacity).map((m, mIdx) => (
                                                <option key={mIdx} value={m.capacity}>
                                                    {m.capacity}kg
                                                </option>
                                            ))}
                                        </select>
                                        {/* Custom Arrow */}
                                        <div className="absolute right-1 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400">
                                            <ChevronDown size={10} />
                                        </div>
                                    </div>
                                );
                            }
                            
                            return (
                                <input
                                  type="number"
                                  className="w-full px-3 py-2 text-center bg-transparent outline-none focus:bg-blue-50 font-mono font-bold text-slate-800"
                                  value={batch.plannedCapacity || ''}
                                  onChange={(e) => {
                                    const newPlan = [...(row.dyeingPlan || [])];
                                    newPlan[idx] = { ...batch, plannedCapacity: Number(e.target.value) };
                                    handleUpdateOrder(row.id, { dyeingPlan: newPlan });
                                  }}
                                  placeholder="-"
                                  title="Machine Capacity"
                                />
                            );
                        })()}
                      </td>
                      {/* Actual Sent */}
                      <td className="p-0">
                        <input
                          type="number"
                          className="w-full px-3 py-2 text-center bg-transparent outline-none focus:bg-blue-50 font-mono font-medium text-blue-600"
                          value={batch.quantitySent || ''}
                          onChange={(e) => {
                            const newPlan = [...(row.dyeingPlan || [])];
                            newPlan[idx] = { ...batch, quantitySent: Number(e.target.value) };
                            handleUpdateOrder(row.id, { dyeingPlan: newPlan });
                          }}
                          placeholder="0"
                          title="Actual Sent"
                        />
                      </td>
                      {/* Received */}
                      <td className="p-0">
                        <input
                          type="number"
                          className="w-full px-3 py-2 text-center bg-transparent outline-none focus:bg-blue-50 font-mono font-medium text-emerald-600"
                          value={batch.receivedQuantity || ''}
                          onChange={(e) => {
                            const newPlan = [...(row.dyeingPlan || [])];
                            newPlan[idx] = { ...batch, receivedQuantity: Number(e.target.value) };
                            handleUpdateOrder(row.id, { dyeingPlan: newPlan });
                          }}
                          placeholder="0"
                        />
                      </td>
                      <td className="p-0 text-center align-middle">
                        {(() => {
                           if (batch.receivedQuantity && batch.receivedQuantity > 0) {
                             return <span className="inline-block text-[10px] px-1.5 py-0.5 bg-emerald-100 text-emerald-700 rounded border border-emerald-200 font-medium">تم الاستلام</span>;
                           }
                           if (batch.dispatchNumber) {
                             return <span className="inline-block text-[10px] px-1.5 py-0.5 bg-blue-100 text-blue-700 rounded border border-blue-200 font-medium">تم الارسال</span>;
                           }
                           return <span className="inline-block text-[10px] px-1.5 py-0.5 bg-slate-100 text-slate-500 rounded border border-slate-200 font-medium">مخطط</span>;
                        })()}
                      </td>
                      <td className="p-0">
                        <input
                          type="text"
                          className="w-full px-3 py-2 bg-transparent outline-none focus:bg-blue-50 text-right"
                          value={batch.notes}
                          onChange={(e) => {
                            const newPlan = [...(row.dyeingPlan || [])];
                            newPlan[idx] = { ...batch, notes: e.target.value };
                            handleUpdateOrder(row.id, { dyeingPlan: newPlan });
                          }}
                          placeholder="ملاحظات..."
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
                    <td colSpan={13} className="p-2">
                      <button
                        onClick={() => {
                          const newBatch = {
                            id: crypto.randomUUID(),
                            color: '',
                            quantity: 0,
                            dyehouse: '',
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
                        اضافة لون
                      </button>
                    </td>
                  </tr>
                </tbody>
              </table>
              
              {/* Smart Allocation Recommendation */}
              {row.dyeingPlan && row.dyeingPlan.length > 0 && (
                <SmartAllocationPanel 
                  plan={row.dyeingPlan} 
                  dyehouses={dyehouses} 
                  allOrders={allOrders}
                  context={{
                      customer: selectedCustomerName,
                      fabric: fabrics.find(f => f.name === row.material)?.shortName || row.material,
                      qty: row.requiredQty,
                      requiredColors: row.dyeingPlan.length
                  }}
                  onApply={(dyehouseName) => {
                     const selectedDyehouse = dyehouses.find(d => d.name === dyehouseName);
                     const newPlan = row.dyeingPlan?.map(batch => {
                         let capacity = batch.plannedCapacity;
                         // Auto-assign machine capacity if available in the selected dyehouse
                         if (selectedDyehouse && selectedDyehouse.machines && selectedDyehouse.machines.length > 0) {
                             const sorted = [...selectedDyehouse.machines].sort((a, b) => a.capacity - b.capacity);
                             // Find smallest machine that fits the quantity
                             const best = sorted.find(m => m.capacity >= (batch.quantity || 0));
                             // If none fits (too big), take the largest available
                             capacity = best ? best.capacity : sorted[sorted.length - 1].capacity;
                         }
                         return { ...batch, dyehouse: dyehouseName, plannedCapacity: capacity };
                     });
                     handleUpdateOrder(row.id, { dyeingPlan: newPlan });
                  }}
                />
              )}
        </div>
        </td>
      </tr>
    )}
    </>
  );
});

export const ClientOrdersPage: React.FC = () => {
  const [customers, setCustomers] = useState<CustomerSheet[]>([]);
  const [rawCustomers, setRawCustomers] = useState<CustomerSheet[]>([]);
  const [flatOrders, setFlatOrders] = useState<OrderRow[]>([]);
  
  // Initialize from localStorage if available
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(() => {
      return localStorage.getItem('selectedClientOrderId') || null;
  });

  // Persist selection changes
  useEffect(() => {
      if (selectedCustomerId) {
          localStorage.setItem('selectedClientOrderId', selectedCustomerId);
      } else {
          localStorage.removeItem('selectedClientOrderId');
      }
  }, [selectedCustomerId]);

  const [searchTerm, setSearchTerm] = useState('');
  const [newCustomerName, setNewCustomerName] = useState('');
  const [isAddingCustomer, setIsAddingCustomer] = useState(false);
  const [fabrics, setFabrics] = useState<FabricDefinition[]>([]);
  const [yarns, setYarns] = useState<Yarn[]>([]);
  const [inventory, setInventory] = useState<YarnInventoryItem[]>([]);
  const [machines, setMachines] = useState<MachineSS[]>([]);
  const [activeDay, setActiveDay] = useState<string>(new Date().toISOString().split('T')[0]);
  const [showYarnRequirements, setShowYarnRequirements] = useState(false);
  const [selectedYarnDetails, setSelectedYarnDetails] = useState<any>(null);
  const [showDyehouse, setShowDyehouse] = useState(false);
  const [dyehouses, setDyehouses] = useState<Dyehouse[]>([]);
  const [externalFactories, setExternalFactories] = useState<any[]>([]);
  
  // Seasons State
  const [seasons, setSeasons] = useState<Season[]>([]);
  // Initialize from localStorage if available
  const [selectedSeasonId, setSelectedSeasonId] = useState<string | null>(() => {
      return localStorage.getItem('selectedSeasonId') || null;
  });
  const [showAddSeason, setShowAddSeason] = useState(false);
  const [newSeasonName, setNewSeasonName] = useState('');

  // Machine Filter State
  const [machineFilter, setMachineFilter] = useState<string>('');

  // Persist Season Selection
  useEffect(() => {
      if (selectedSeasonId) {
          localStorage.setItem('selectedSeasonId', selectedSeasonId);
      }
  }, [selectedSeasonId]);

  // Fetch Seasons
  useEffect(() => {
    const unsubSeasons = onSnapshot(collection(db, 'Seasons'), async (snapshot) => {
      const loadedSeasons = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Season));
      
      if (loadedSeasons.length === 0) {
        // Create Default Season if none exist
        const defaultSeason: Season = {
          id: '2025-summer',
          name: '2025 Summer Season',
          startDate: '2025-01-01',
          endDate: '2025-06-30',
          isActive: true
        };
        await setDoc(doc(db, 'Seasons', defaultSeason.id), defaultSeason);
        setSeasons([defaultSeason]);
        setSelectedSeasonId(defaultSeason.id);
      } else {
        setSeasons(loadedSeasons);
        // Select active or first season if not selected AND not in localStorage
        // (The state initializer handles the localStorage part, but we need to validate it exists in the loaded list)
        if (!selectedSeasonId || !loadedSeasons.find(s => s.id === selectedSeasonId)) {
            const active = loadedSeasons.find(s => s.isActive);
            setSelectedSeasonId(active ? active.id : loadedSeasons[0].id);
        }
      }
    });
    return () => unsubSeasons();
  }, []);

  // Create Plan Modal State
  const [createPlanModal, setCreatePlanModal] = useState<{
    isOpen: boolean;
    order: OrderRow | null;
    customerName: string;
  }>({ isOpen: false, order: null, customerName: '' });

  // Fabric Details Modal State
  const [fabricDetailsModal, setFabricDetailsModal] = useState<{
    isOpen: boolean;
    fabric: FabricDefinition | null;
    orderQuantity: number;
    orderId?: string;
    customerId?: string;
    allocations?: Record<string, YarnAllocationItem[]>;
    variantId?: string;
  }>({ isOpen: false, fabric: null, orderQuantity: 0 });

  // Production Order Modal State
  const [productionOrderModal, setProductionOrderModal] = useState<{
    isOpen: boolean;
    order: OrderRow | null;
    activeMachines: string[];
    plannedMachines: string[];
  }>({ isOpen: false, order: null, activeMachines: [], plannedMachines: [] });

  // Production History Modal State
  const [selectedOrderForHistory, setSelectedOrderForHistory] = useState<OrderRow | null>(null);

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

  // Lot Details Modal State (New)
  const [lotDetailsModal, setLotDetailsModal] = useState<{
    isOpen: boolean;
    yarnName: string;
    lots: YarnInventoryItem[];
  }>({ isOpen: false, yarnName: '', lots: [] });

  // Fabric Dictionary Modal State
  const [fabricDictionaryModal, setFabricDictionaryModal] = useState(false);

  // Fabric Form Modal State
  const [fabricFormModal, setFabricFormModal] = useState<{
    isOpen: boolean;
    initialName?: string;
  }>({ isOpen: false });

  // Fetch Data
  useEffect(() => {
    // 1. Customers (Shells)
    const unsubCustomers = onSnapshot(collection(db, 'CustomerSheets'), (snapshot) => {
      const data = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as CustomerSheet));
      setRawCustomers(data);
    });

    // 2. All Orders (Sub-collections) - Optimized for Global View
    const unsubOrders = onSnapshot(query(collectionGroup(db, 'orders')), (snapshot) => {
      const orders = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as OrderRow));
      setFlatOrders(orders);
    });

    // Machines (for active status)
    const unsubMachines = onSnapshot(collection(db, 'MachineSS'), (snapshot) => {
      const data = snapshot.docs.map(d => d.data() as MachineSS);
      setMachines(data);
    });

    // External Plans
    const unsubExternal = onSnapshot(collection(db, 'ExternalPlans'), (snapshot) => {
      const data = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
      setExternalFactories(data);
    });

    // Fabrics
    DataService.getFabrics().then(setFabrics);

    // Yarns
    DataService.getYarns().then(setYarns);

    // Dyehouses
    DataService.getDyehouses().then(data => setDyehouses(data as unknown as Dyehouse[]));

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
      unsubOrders();
      unsubMachines();
      unsubInventory();
      unsubSettings();
    };
  }, []);

  // --- History Check Logic ---
  const [historySet, setHistorySet] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!selectedCustomerId || machines.length === 0) return;
    
    const client = customers.find(c => c.id === selectedCustomerId);
    if (!client) return;

    // Derive history from loaded machines data instead of collectionGroup query
    // because dailyLogs are stored as arrays in MachineSS documents, not subcollections.
    const fabrics = new Set<string>();
    const normalize = (s: string) => s ? s.trim().toLowerCase() : '';
    const targetClient = normalize(client.name);

    machines.forEach(machine => {
        if (machine.dailyLogs && Array.isArray(machine.dailyLogs)) {
            machine.dailyLogs.forEach(log => {
                if (normalize(log.client) === targetClient && log.fabric) {
                    fabrics.add(log.fabric);
                }
            });
        }
    });
    
    setHistorySet(fabrics);
  }, [selectedCustomerId, customers, machines]);

  // Merge Customers & Orders
  useEffect(() => {
    const merged = rawCustomers.map(c => {
        const subCollectionOrders = flatOrders.filter(o => {
            if (o.customerId !== c.id) return false;
            // Season Filter
            if (selectedSeasonId) {
                if (o.seasonId) return o.seasonId === selectedSeasonId;
                // Legacy orders (no seasonId) belong to '2025-summer'
                return selectedSeasonId === '2025-summer';
            }
            return true;
        });
        
        // Backward Compatibility & Fallback Filtering
        let finalOrders = subCollectionOrders;
        if (finalOrders.length === 0 && c.orders && c.orders.length > 0) {
             // Filter legacy array as well
             finalOrders = c.orders.filter(o => {
                if (selectedSeasonId) {
                    if (o.seasonId) return o.seasonId === selectedSeasonId;
                    return selectedSeasonId === '2025-summer';
                }
                return true;
             });
        }
        
        return { ...c, orders: finalOrders };
    }).filter(c => {
        // Filter: Show if has orders OR is currently selected
        if (c.orders.length > 0 || c.id === selectedCustomerId) return true;
        
        // Also show if client was created in this season (even if no orders yet)
        // Legacy clients (no createdSeasonId) default to '2025-summer'
        if (selectedSeasonId) {
            const clientSeason = c.createdSeasonId || '2025-summer';
            return clientSeason === selectedSeasonId;
        }
        
        return true;
    });

    merged.sort((a, b) => a.name.localeCompare(b.name));
    setCustomers(merged);
    
    if (!initialSelectionMade.current && merged.length > 0) {
      // Only auto-select if we don't already have a valid selection from localStorage
      const currentSelectionExists = selectedCustomerId && merged.some(c => c.id === selectedCustomerId);
      
      if (!currentSelectionExists) {
          setSelectedCustomerId(merged[0].id);
      }
      initialSelectionMade.current = true;
    }
  }, [rawCustomers, flatOrders, selectedSeasonId, selectedCustomerId]);

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
            if (activeLog) {
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

        // Check External Plans
        externalFactories.forEach(factory => {
            if (!factory.plans) return;
            factory.plans.forEach((plan: any) => {
                const normalize = (s: string) => s ? s.trim().toLowerCase() : '';
                const planClient = normalize(plan.client);
                const planFabric = normalize(plan.fabric);
                const normClient = normalize(clientName);
                const normFabric = normalize(fabric);

                if (planClient === normClient && planFabric === normFabric) {
                    // Only include if not completed
                    if (plan.status !== 'COMPLETED') {
                        remaining += (Number(plan.remaining) || 0);
                        // Add to active machines list to ensure the calculated remaining is used
                        activeMachines.push(`${factory.name} (Ext)`);
                    }
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
            others: Array.from(otherClients).join(', '),
            // Debug Info
            debug: {
                activeReasons: activeMachines.map(m => `Active: ${m}`),
                plannedReasons: plannedMachines.map(m => `Planned: ${m}`)
            }
        });
    });

    return map;
  }, [selectedCustomer, machines, customers, activeDay, externalFactories]);

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
        if (!fabric) return;

        // Determine active composition
        let composition: any[] = [];
        if (order.variantId) {
            if (fabric.variants) {
                const variant = fabric.variants.find(v => v.id === order.variantId);
                if (variant) composition = variant.yarns;
            }
        } else if (fabric.yarnComposition) {
            composition = fabric.yarnComposition;
        } else if (fabric.variants && fabric.variants.length === 1) {
            composition = fabric.variants[0].yarns;
        }

        if (composition.length > 0) {
            composition.forEach(comp => {
              // Use yarnId if available, otherwise fallback to name
              const key = comp.yarnId || comp.name;
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
        }
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

  const totalYarnRequirements = useMemo(() => {
    if (!selectedCustomer || !selectedCustomer.orders) return [];

    const requirements = new Map<string, { weight: number, fabrics: Map<string, number> }>();

    selectedCustomer.orders.forEach(order => {
        if (!order.material || !order.requiredQty) return;
        
        const fabric = fabrics.find(f => f.name === order.material);
        if (!fabric) return;

        // Determine active composition
        let composition: any[] = [];
        if (order.variantId) {
            if (fabric.variants) {
                const variant = fabric.variants.find(v => v.id === order.variantId);
                if (variant) composition = variant.yarns;
            }
        } else if (fabric.yarnComposition) {
            composition = fabric.yarnComposition;
        } else if (fabric.variants && fabric.variants.length === 1) {
            composition = fabric.variants[0].yarns;
        }

        if (composition.length > 0) {
            composition.forEach(comp => {
                const yarnName = comp.name;
                if (!yarnName) return;

                const baseQty = (order.requiredQty * (comp.percentage || 0)) / 100;
                const scrapMultiplier = 1 + ((comp.scrapPercentage || 0) / 100);
                const totalNeeded = baseQty * scrapMultiplier;

                const current = requirements.get(yarnName) || { weight: 0, fabrics: new Map<string, number>() };
                current.weight += totalNeeded;
                
                const currentFabricWeight = current.fabrics.get(order.material) || 0;
                current.fabrics.set(order.material, currentFabricWeight + totalNeeded);
                
                requirements.set(yarnName, current);
            });
        }
    });

    return Array.from(requirements.entries()).map(([name, data]) => ({
        name,
        weight: data.weight,
        fabrics: Array.from(data.fabrics.entries()).map(([fabricName, fabricWeight]) => ({
            name: fabricName,
            weight: fabricWeight
        })).sort((a, b) => b.weight - a.weight)
    })).sort((a, b) => b.weight - a.weight);
  }, [selectedCustomer, fabrics]);

  const handleAddCustomer = async () => {
    if (!newCustomerName.trim()) return;
    try {
      const docRef = await addDoc(collection(db, 'CustomerSheets'), {
        name: newCustomerName.trim(),
        orders: [],
        createdSeasonId: selectedSeasonId || '2025-summer' // Tag with current season
      });
      setNewCustomerName('');
      setIsAddingCustomer(false);
      setSelectedCustomerId(docRef.id); // Auto-select new customer
    } catch (error) {
      console.error("Error adding customer:", error);
    }
  };

  const handleDeleteCustomer = async (id: string) => {
    if (!window.confirm("Delete customer and all orders?")) return;
    try {
      // Delete sub-collection orders first to prevent orphans in collectionGroup queries
      const ordersSnapshot = await getDocs(collection(db, 'CustomerSheets', id, 'orders'));
      const batch = writeBatch(db);
      ordersSnapshot.docs.forEach(doc => {
          batch.delete(doc.ref);
      });
      await batch.commit();

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
      accessoryDeliveries: '',
      customerId: selectedCustomerId, // Link to parent
      seasonId: selectedSeasonId || '2025-summer' // Add Season ID
    };

    // Check if we should use sub-collection (if already migrated or empty)
    const hasSubCollectionData = flatOrders.some(o => o.customerId === selectedCustomerId);
    const hasLegacyData = selectedCustomer.orders && selectedCustomer.orders.length > 0 && !hasSubCollectionData;

    if (hasLegacyData) {
        // Legacy Mode: Append to array
        const updatedOrders = [...selectedCustomer.orders, newRow];
        await updateDoc(doc(db, 'CustomerSheets', selectedCustomerId), { orders: updatedOrders });
    } else {
        // Optimized Mode: Add to sub-collection
        await setDoc(doc(db, 'CustomerSheets', selectedCustomerId, 'orders', newRow.id), newRow);
    }
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

    // Sanitize updates to remove undefined values
    Object.keys(finalUpdates).forEach(key => {
        if (finalUpdates[key as keyof OrderRow] === undefined) {
            delete finalUpdates[key as keyof OrderRow];
        }
    });

    // Optimistic Update
    const updatedOrders = selectedCustomer.orders.map(order => {
      if (order.id === rowId) {
        return { ...order, ...finalUpdates };
      }
      return order;
    });

    // Update local state immediately (for responsiveness)
    setCustomers(prev => prev.map(c => {
      if (c.id === selectedCustomerId) {
        return { ...c, orders: updatedOrders };
      }
      return c;
    }));

    // Send to Firestore
    const hasSubCollectionData = flatOrders.some(o => o.customerId === selectedCustomerId);
    
    if (hasSubCollectionData) {
        // Optimized Mode
        await updateDoc(doc(db, 'CustomerSheets', selectedCustomerId, 'orders', rowId), finalUpdates);
    } else {
        // Legacy Mode
        await updateDoc(doc(db, 'CustomerSheets', selectedCustomerId), { orders: updatedOrders });
    }
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

    const hasSubCollectionData = flatOrders.some(o => o.customerId === selectedCustomerId);
    if (hasSubCollectionData) {
        const batch = writeBatch(db);
        selectedCustomer.orders.forEach(order => {
            if (selectedRows.has(order.id)) {
                const ref = doc(db, 'CustomerSheets', selectedCustomerId, 'orders', order.id);
                batch.update(ref, { orderReceiptDate: bulkDate });
            }
        });
        await batch.commit();
    } else {
        await updateDoc(doc(db, 'CustomerSheets', selectedCustomerId), { orders: updatedOrders });
    }

    setShowBulkDateInput(false);
    setBulkDate('');
    setSelectedRows(new Set());
  };

  // Removed getOrderStats in favor of statsMap

  const handleDeleteRow = async (rowId: string) => {
    if (!selectedCustomerId || !selectedCustomer) return;
    if (!window.confirm("Delete this order row?")) return;
    
    const hasSubCollectionData = flatOrders.some(o => o.customerId === selectedCustomerId);

    if (hasSubCollectionData) {
        // Optimized Mode
        await deleteDoc(doc(db, 'CustomerSheets', selectedCustomerId, 'orders', rowId));
    } else {
        // Legacy Mode
        const updatedOrders = selectedCustomer.orders.filter(o => o.id !== rowId);
        await updateDoc(doc(db, 'CustomerSheets', selectedCustomerId), { orders: updatedOrders });
    }
  };

  const handlePlanSearch = (clientName: string, fabricName: string) => {
    const reference = `${clientName}-${fabricName}`;
    const results: { machineName: string; type: 'ACTIVE' | 'PLANNED'; details: string; date?: string }[] = [];
  
    // 1. Internal Machines
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

    // 2. External Factories
    externalFactories.forEach(factory => {
      if (factory.plans && Array.isArray(factory.plans)) {
        factory.plans.forEach((plan: any) => {
           // Robust matching for external plans
           const isClientMatch = plan.client && plan.client.trim() === clientName;
           const isFabricMatch = plan.fabric && plan.fabric.trim() === fabricName;
           // Also check constructed reference if explicit one is missing
           const constructedRef = `${plan.client}-${plan.fabric ? plan.fabric.split(/[\s-]+/).map((w: string) => w[0]).join('').toUpperCase() : ''}`;
           const isRefMatch = (plan.orderReference && plan.orderReference.toLowerCase() === reference.toLowerCase()) ||
                              (constructedRef.toLowerCase() === reference.toLowerCase());

           if ((isClientMatch && isFabricMatch) || isRefMatch) {
              const isExternalActive = plan.status === 'ACTIVE';
              results.push({
                machineName: `${factory.name} (Ext)`,
                type: isExternalActive ? 'ACTIVE' : 'PLANNED',
                details: isExternalActive 
                  ? `Active External (Rem: ${plan.remaining})` 
                  : `Planned External (Qty: ${plan.quantity})`,
                date: plan.startDate || '-'
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
    setFabricFormModal({ isOpen: true, initialName: name });
  };

  const handleSaveNewFabric = async (fabricData: Partial<FabricDefinition>) => {
    try {
      await DataService.addFabric({
        ...fabricData,
        fabricId: crypto.randomUUID(),
        type: 'General'
      } as FabricDefinition);
      setFabrics(await DataService.getFabrics());
      setFabricFormModal({ isOpen: false });
    } catch (err) {
      console.error("Failed to create fabric", err);
    }
  };

  const handleCreateDyehouse = async (name: string) => {
    try {
      await DataService.addDyehouse(name);
      setDyehouses(await DataService.getDyehouses());
    } catch (err) {
      console.error("Failed to create dyehouse", err);
    }
  };

  const handleOpenFabricDetails = (fabricName: string, qty: number, orderId?: string) => {
    const fabric = fabrics.find(f => f.name === fabricName);
    let allocations: Record<string, YarnAllocationItem[]> | undefined;
    let variantId: string | undefined;

    if (orderId && selectedCustomer) {
        const order = selectedCustomer.orders.find(o => o.id === orderId);
        if (order) {
            allocations = order.yarnAllocations;
            variantId = order.variantId;
        }
    }

    if (fabric) {
      setFabricDetailsModal({
        isOpen: true,
        fabric,
        orderQuantity: qty,
        orderId,
        customerId: selectedCustomerId || undefined,
        allocations,
        variantId
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

    const hasSubCollectionData = flatOrders.some(o => o.customerId === selectedCustomerId);
    if (hasSubCollectionData) {
        await updateDoc(doc(db, 'CustomerSheets', selectedCustomerId, 'orders', orderId), { yarnAllocations: allocations });
    } else {
        await updateDoc(doc(db, 'CustomerSheets', selectedCustomerId), { orders: updatedOrders });
    }
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

  const handleMigrateData = async () => {
      if (!selectedCustomerId || !selectedCustomer) return;
      if (!window.confirm(`Migrate ${selectedCustomer.orders.length} orders to new structure? This is irreversible.`)) return;
      
      const batch = writeBatch(db);
      const customerRef = doc(db, 'CustomerSheets', selectedCustomerId);
      
      selectedCustomer.orders.forEach(order => {
          const newOrderRef = doc(collection(db, 'CustomerSheets', selectedCustomerId, 'orders'), order.id);
          batch.set(newOrderRef, { ...order, customerId: selectedCustomerId });
      });
      
      // Delete legacy array
      batch.update(customerRef, { orders: deleteField() });
      
      await batch.commit();
      alert("Migration Complete! Database is now optimized.");
  };

  const filteredCustomers = customers.filter(c => 
    c.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  // Filter Orders based on Machine Filter
  const filteredOrders = useMemo(() => {
      if (!selectedCustomer) return [];
      let orders = selectedCustomer.orders;
      
      if (machineFilter) {
          orders = orders.filter(row => {
              if (!row.dyeingPlan) return false;
              return row.dyeingPlan.some(b => 
                  String(b.quantity) === machineFilter || 
                  (b.machine && b.machine.toLowerCase().includes(machineFilter.toLowerCase()))
              );
          });
      }
      return orders;
  }, [selectedCustomer, machineFilter]);

  const usedFabricNames = useMemo(() => {
      if (!selectedCustomer || selectedCustomerId === ALL_CLIENTS_ID || selectedCustomerId === ALL_YARNS_ID) {
          return undefined;
      }
      return new Set(selectedCustomer.orders.map(o => o.material).filter(Boolean));
  }, [selectedCustomer, selectedCustomerId]);

  // DEBUG HELPER
  const getDebugInfo = () => {
    const logs: string[] = [];
    if (!selectedCustomer) return ["No customer selected"];
    
    logs.push(`Checking ${selectedCustomer.orders.length} orders...`);
    
    selectedCustomer.orders.forEach((order, i) => {
       logs.push(`Order #${i+1}: Material="${order.material}", Qty=${order.requiredQty}, VariantID="${order.variantId}"`);
       
       if (!order.material) {
           logs.push(`  -> SKIPPED: No material defined`);
           return;
       }
       
       const fabric = fabrics.find(f => f.name === order.material);
       if (!fabric) {
           logs.push(`  -> FAILED: Fabric "${order.material}" not found in database. Available: ${fabrics.slice(0,3).map(f=>f.name).join(', ')}...`);
           return;
       }
       
       logs.push(`  -> Found Fabric: ${fabric.name} (ID: ${fabric.id})`);
       
       let composition: any[] = [];
       if (order.variantId) {
           logs.push(`  -> Checking Variant ID: "${order.variantId}"`);
           if (fabric.variants) {
               const variant = fabric.variants.find(v => String(v.id) === String(order.variantId));
               if (variant) {
                   composition = variant.yarns;
                   logs.push(`  -> Found Variant: ${variant.name} with ${variant.yarns.length} yarns`);
               } else {
                   logs.push(`  -> WARNING: Variant ID "${order.variantId}" not found in fabric variants. Available IDs: ${fabric.variants.map(v => v.id).join(', ')}`);
               }
           } else {
               logs.push(`  -> WARNING: Order has Variant ID but fabric has no variants`);
           }
       } else if (fabric.yarnComposition && fabric.yarnComposition.length > 0) {
           composition = fabric.yarnComposition;
           logs.push(`  -> Using Standard Composition (${composition.length} yarns)`);
       } else if (fabric.variants && fabric.variants.length > 0) {
           composition = fabric.variants[0].yarns;
           logs.push(`  -> Fallback to First Variant (${composition.length} yarns)`);
       } else {
           logs.push(`  -> NO DEFINITION: Fabric has no composition and no variants`);
       }
       
       if (composition.length === 0) {
           logs.push(`  -> NO YARNS: Composition is empty`);
       } else {
           logs.push(`  -> Yarns found: ${composition.length}`);
       }
    });
    
    return logs;
  };

  const recommendMachine = (dyehouseName: string, quantitySent: number) => {
    const dh = dyehouses.find(d => d.name === dyehouseName);
    if (!dh || !dh.machines || dh.machines.length === 0) return null;
    
    const sorted = [...dh.machines].sort((a, b) => a.capacity - b.capacity);
    const best = sorted.find(m => m.capacity >= quantitySent);
    return best ? best.capacity : sorted[sorted.length - 1].capacity;
  };

  return (
    <div className="flex flex-col min-h-[calc(100vh-100px)] bg-slate-50 rounded-xl border border-slate-200 shadow-sm">
      <style>{globalStyles}</style>
      
      {/* Top Bar: Control Center */}
      <div className="bg-white border-b border-slate-200 shadow-sm z-20">
        
        {/* Row 1: Season Header & Context */}
        <div className="px-6 py-5 flex flex-col lg:flex-row items-start lg:items-center justify-between gap-6 border-b border-slate-100 bg-gradient-to-r from-slate-50 to-white">
            
            {/* Season Header (Prominent) */}
            <div className="flex flex-col gap-1">
                <div className="flex items-center gap-2 text-xs font-bold text-indigo-500 uppercase tracking-wider">
                    <Calendar className="w-3 h-3" />
                    Current Season
                </div>
                <div className="relative group flex items-center gap-2">
                    <select
                        value={selectedSeasonId || ''}
                        onChange={(e) => {
                            if (e.target.value === 'ADD_NEW') {
                                setShowAddSeason(true);
                            } else {
                                setSelectedSeasonId(e.target.value);
                            }
                        }}
                        className="appearance-none bg-transparent text-2xl font-black text-slate-800 cursor-pointer focus:outline-none hover:text-indigo-700 transition-colors pr-6"
                    >
                        {seasons.map(s => (
                            <option key={s.id} value={s.id}>{s.name}</option>
                        ))}
                        <option value="ADD_NEW" className="text-emerald-600 font-bold">+ Add New Season</option>
                    </select>
                    <ChevronDown className="absolute right-0 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400 pointer-events-none group-hover:text-indigo-500 transition-colors" />
                </div>
            </div>

            {/* Client Selector & Add */}
            <div className="flex items-center gap-3 w-full lg:w-auto flex-1 lg:flex-none lg:min-w-[400px]">
                <div className="relative flex-1">
                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                        <Users className="h-5 w-5 text-slate-400" />
                    </div>
                    <select 
                        value={selectedCustomerId || ''} 
                        onChange={(e) => setSelectedCustomerId(e.target.value)}
                        className="pl-10 pr-10 py-3 bg-white border border-slate-300 text-slate-700 text-base font-semibold rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 block w-full shadow-sm transition-all cursor-pointer appearance-none hover:border-indigo-300"
                    >
                        <option value={ALL_CLIENTS_ID} className="font-bold text-blue-600">All Clients Overview</option>
                        <option value={ALL_YARNS_ID} className="font-bold text-purple-600">All Yarn Requirements</option>
                        <option disabled value="">Select a client...</option>
                        {customers.map(c => (
                            <option key={c.id} value={c.id}>{c.name}</option>
                        ))}
                    </select>
                    <div className="absolute inset-y-0 right-0 flex items-center pr-3 pointer-events-none">
                        <ChevronDown className="h-5 w-5 text-slate-400" />
                    </div>
                </div>

                <button 
                    onClick={() => setIsAddingCustomer(true)} 
                    className="p-3 bg-indigo-50 text-indigo-600 rounded-xl hover:bg-indigo-100 transition-colors border border-indigo-100 shadow-sm group" 
                    title="Add New Client"
                >
                    <Plus className="w-5 h-5 group-hover:scale-110 transition-transform" />
                </button>
            </div>

            {/* Add Client Input (Inline) */}
            {isAddingCustomer && (
                <div className="flex items-center gap-2 animate-in fade-in slide-in-from-right-4 bg-white p-2 rounded-xl border border-indigo-200 shadow-xl absolute top-24 right-6 z-50">
                    <input
                        autoFocus
                        type="text"
                        placeholder="New Client Name..."
                        className="px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 w-56"
                        value={newCustomerName}
                        onChange={e => setNewCustomerName(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && handleAddCustomer()}
                    />
                    <button onClick={handleAddCustomer} className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm hover:bg-indigo-700 font-medium shadow-sm">
                        Save
                    </button>
                    <button onClick={() => setIsAddingCustomer(false)} className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg">
                        <X className="w-4 h-4" />
                    </button>
                </div>
            )}
        </div>

        {/* Row 2: Tools & Actions */}
        <div className="px-6 py-3 bg-slate-50/50 flex flex-col sm:flex-row items-center justify-between gap-4">
            
            {/* Left: View Toggles */}
            <div className="flex items-center gap-2 w-full sm:w-auto overflow-x-auto pb-2 sm:pb-0 no-scrollbar">
                <button 
                    onClick={() => setFabricDictionaryModal(true)}
                    className="flex items-center gap-2 px-3 py-1.5 bg-white border border-slate-200 text-slate-600 hover:text-indigo-600 hover:border-indigo-200 text-xs font-medium rounded-md shadow-sm transition-all whitespace-nowrap"
                >
                    <FileSpreadsheet className="w-3.5 h-3.5" />
                    Fabric Dictionary
                </button>

                <div className="h-4 w-px bg-slate-300 mx-1"></div>

                <button 
                    onClick={() => {
                        const newState = !showYarnRequirements;
                        setShowYarnRequirements(newState);
                        if (newState) setShowDyehouse(false);
                    }}
                    className={`flex items-center gap-2 px-3 py-1.5 border text-xs font-medium rounded-md shadow-sm transition-all whitespace-nowrap ${
                        showYarnRequirements 
                        ? 'bg-indigo-600 border-indigo-600 text-white shadow-indigo-100' 
                        : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                    }`}
                >
                    <Package className="w-3.5 h-3.5" />
                    Yarn Requirements
                </button>

                <button 
                    onClick={() => {
                        const newState = !showDyehouse;
                        setShowDyehouse(newState);
                        if (newState) setShowYarnRequirements(false);
                    }}
                    className={`flex items-center gap-2 px-3 py-1.5 border text-xs font-medium rounded-md shadow-sm transition-all whitespace-nowrap ${
                        showDyehouse 
                        ? 'bg-purple-600 border-purple-600 text-white shadow-purple-100' 
                        : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                    }`}
                >
                    <Droplets className="w-3.5 h-3.5" />
                    Dyehouse Info
                </button>

                {/* Machine Filter */}
                {showDyehouse && (
                    <>
                        <div className="h-4 w-px bg-slate-300 mx-1"></div>
                        <div className="relative flex items-center">
                            <Factory className="w-3.5 h-3.5 text-slate-400 absolute left-2" />
                            <select
                                value={machineFilter}
                                onChange={(e) => setMachineFilter(e.target.value)}
                                className={`pl-8 pr-8 py-1.5 border text-xs font-medium rounded-md shadow-sm transition-all appearance-none cursor-pointer outline-none ${
                                    machineFilter 
                                    ? 'bg-indigo-50 border-indigo-200 text-indigo-700' 
                                    : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                                }`}
                            >
                                <option value="">All Machines</option>
                                <option value="300">300kg</option>
                                <option value="600">600kg</option>
                                <option value="900">900kg</option>
                                <option value="1200">1200kg</option>
                            </select>
                            {machineFilter && (
                                <button 
                                    onClick={() => setMachineFilter('')}
                                    className="absolute right-2 text-indigo-400 hover:text-indigo-600"
                                >
                                    <X className="w-3 h-3" />
                                </button>
                            )}
                        </div>
                    </>
                )}
            </div>

            {/* Right: Client Actions */}
            {selectedCustomer && (
                <div className="flex items-center gap-3 w-full sm:w-auto justify-end">
                    {/* Migration Button */}
                    {(() => {
                        const hasSubCollectionData = flatOrders.some(o => o.customerId === selectedCustomerId);
                        const hasLegacyData = rawCustomers.find(c => c.id === selectedCustomerId)?.orders?.length;
                        
                        if (hasLegacyData && !hasSubCollectionData) {
                            return (
                                <button 
                                    onClick={handleMigrateData}
                                    className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-50 text-amber-700 hover:bg-amber-100 border border-amber-200 rounded-md transition-colors text-xs font-medium"
                                >
                                    <Layers className="w-3.5 h-3.5" />
                                    Migrate Data
                                </button>
                            );
                        }
                        return null;
                    })()}

                    <button 
                        onClick={() => handleDeleteCustomer(selectedCustomer.id)}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-slate-500 hover:text-red-600 hover:bg-red-50 border border-transparent hover:border-red-100 rounded-md transition-colors text-xs font-medium"
                    >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span className="hidden lg:inline">Delete Client</span>
                    </button>

                    <button 
                        onClick={handleAddRow}
                        className="flex items-center gap-2 px-4 py-1.5 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-all shadow-sm hover:shadow text-xs font-bold tracking-wide"
                    >
                        <Plus className="w-4 h-4" />
                        ADD ORDER
                    </button>
                </div>
            )}
        </div>
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
            {selectedRows.size > 0 && !showYarnRequirements && (
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

            <div className="flex-1 p-4 bg-slate-50">
              {!showYarnRequirements ? (
                <>
                  <div className="bg-white rounded-lg shadow border border-slate-200 overflow-x-auto mb-4">
                    <table className="w-full text-sm border-collapse whitespace-nowrap">
                      <thead className="bg-slate-100 text-slate-600 font-semibold shadow-sm text-xs uppercase tracking-wider">
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
                              <th className="p-3 text-right border-b border-r border-slate-200 min-w-[300px]">القماش</th>
                              <th className="p-3 text-right border-b border-r border-slate-200 min-w-[120px]">المصبغة</th>
                              <th className="p-3 text-right border-b border-r border-slate-200 min-w-[200px]">الماكينات</th>
                              <th className="p-3 text-right border-b border-r border-slate-200 w-24">اجمالي المرسل</th>
                              <th className="p-3 text-right border-b border-r border-slate-200 w-24">اجمالي المستلم</th>
                              <th className="p-3 text-center border-b border-r border-slate-200 w-10"></th>
                            </>
                          ) : (
                            <>
                              <th className="p-3 text-left border-b border-r border-slate-200 min-w-[350px]">Fabric</th>
                              <th className="p-3 text-right border-b border-r border-slate-200 w-20">Req GSM</th>
                              <th className="p-3 text-right border-b border-r border-slate-200 w-20">Req Width</th>
                              <th className="p-3 text-left border-b border-r border-slate-200 min-w-[140px]">Accessories</th>
                              <th className="p-3 text-right border-b border-r border-slate-200 w-20">Acc. Qty</th>
                            </>
                          )}
                          {!showDyehouse && (
                            <>
                              <th className="p-3 text-center border-b border-r border-slate-200 w-28">Status</th>
                              <th className="p-3 text-right border-b border-r border-slate-200 w-20">Ordered</th>
                              <th className="p-3 text-right border-b border-r border-slate-200 w-20 bg-slate-50">Remaining</th>
                              <th className="p-3 text-center border-b border-r border-slate-200 w-24">Receive Date</th>
                              <th className="p-3 text-center border-b border-r border-slate-200 w-24">Start Date</th>
                              <th className="p-3 text-center border-b border-r border-slate-200 w-24">End Date</th>
                              <th className="p-3 text-right border-b border-r border-slate-200 w-20">Scrap</th>
                              <th className="p-3 text-left border-b border-r border-slate-200 min-w-[100px]">Others</th>
                              <th className="p-3 text-left border-b border-r border-slate-200 w-32">Notes</th>
                              <th className="p-3 text-right border-b border-r border-slate-200 w-24 bg-orange-50">Fab. Deliv</th>
                              <th className="p-3 text-right border-b border-r border-slate-200 w-24 bg-purple-50">Acc. Deliv</th>
                            </>
                          )}
                          {showDyehouse && (
                             <th className="p-3 text-right border-b border-r border-slate-200 w-24">المطلوب</th>
                          )}
                          <th className="p-3 w-10 border-b border-slate-200"></th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {filteredOrders.map((row) => {
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
                              onOpenCreatePlan={(order) => setCreatePlanModal({ 
                                isOpen: true, 
                                order, 
                                customerName: selectedCustomer.name 
                              })}
                              dyehouses={dyehouses}
                              handleCreateDyehouse={handleCreateDyehouse}
                              machines={machines}
                              externalFactories={externalFactories}
                              allOrders={flatOrders}
                              onOpenProductionOrder={(order, active, planned) => {
                                setProductionOrderModal({
                                  isOpen: true,
                                  order,
                                  activeMachines: active,
                                  plannedMachines: planned
                                });
                              }}
                              onOpenHistory={(order) => setSelectedOrderForHistory(order)}
                              hasHistory={historySet.has(row.material || '')}
                              onFilterMachine={(cap) => setMachineFilter(cap)}
                            />
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  {/* Order Summary Cards */}
                  <div className="mt-4 space-y-4">
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
                  </div>
                </>
              ) : (
                /* Yarn Requirements View */
                <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden animate-in fade-in duration-300">
                    <div className="bg-slate-50 px-6 py-4 border-b border-slate-200 flex justify-between items-center">
                        <div>
                            <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                                <Package className="w-5 h-5 text-indigo-600" />
                                Yarn Requirements
                            </h3>
                            <p className="text-sm text-slate-500 mt-1">
                                Calculated based on current orders and fabric compositions
                            </p>
                        </div>
                        <div className="text-sm font-medium text-slate-600 bg-white px-3 py-1 rounded-full border border-slate-200 shadow-sm">
                            {totalYarnRequirements.length} Unique Yarns
                        </div>
                    </div>
                    
                    {totalYarnRequirements.length > 0 ? (
                      <div className="overflow-x-auto">
                          <table className="w-full text-sm text-left">
                              <thead className="bg-slate-50 text-slate-500 font-medium border-b border-slate-200">
                                <tr>
                                  <th className="px-6 py-3 w-1/3">Yarn Name</th>
                                  <th className="px-6 py-3 text-right">Total Requirement</th>
                                  <th className="px-6 py-3 text-right">Inventory (Total)</th>
                                  <th className="px-6 py-3 text-right">Net Available</th>
                                  <th className="px-6 py-3 text-center">Status</th>
                                  <th className="px-6 py-3 w-20 text-center">Action</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-slate-100 bg-white">
                                {totalYarnRequirements.map((yarn, idx) => {
                                  // Inventory Logic
                                  const inventoryItems = inventory.filter(item => 
                                      item.yarnName.toLowerCase().trim() === yarn.name.toLowerCase().trim()
                                  );
                                  
                                  const totalStock = inventoryItems.reduce((sum, item) => sum + (item.quantity || 0), 0);
                                  
                                  let totalAllocated = 0;
                                  let allocatedToThisCustomer = 0;
                                  
                                  inventoryItems.forEach(item => {
                                      if (item.allocations) {
                                          item.allocations.forEach(alloc => {
                                              totalAllocated += (alloc.quantity || 0);
                                              if (alloc.customerId === selectedCustomerId) {
                                                  allocatedToThisCustomer += (alloc.quantity || 0);
                                              }
                                          });
                                      }
                                  });
                                  
                                  const netAvailable = totalStock - totalAllocated;
                                  const availableForThisCustomer = netAvailable + allocatedToThisCustomer;
                                  const isEnough = availableForThisCustomer >= yarn.weight;
                                  const deficit = yarn.weight - availableForThisCustomer;

                                  return (
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
                                          {yarn.weight.toLocaleString(undefined, { maximumFractionDigits: 1 })} kg
                                      </td>
                                      <td className="px-4 py-3 text-right font-mono text-slate-600">
                                          {totalStock.toLocaleString(undefined, { maximumFractionDigits: 1 })} kg
                                      </td>
                                      <td 
                                          onClick={(e) => {
                                              e.stopPropagation(); // Prevent row click
                                              setLotDetailsModal({
                                                  isOpen: true,
                                                  yarnName: yarn.name,
                                                  lots: inventoryItems
                                              });
                                          }}
                                          className={`px-4 py-3 text-right font-mono font-bold cursor-pointer hover:underline ${availableForThisCustomer < yarn.weight ? 'text-red-600' : 'text-emerald-600'}`}
                                          title="Click to view available lots"
                                      >
                                          {availableForThisCustomer.toLocaleString(undefined, { maximumFractionDigits: 1 })} kg
                                      </td>
                                      <td className="px-4 py-3 text-center">
                                          {isEnough ? (
                                              <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-emerald-100 text-emerald-700 text-xs font-bold">
                                                  <CheckCircle2 size={12} />
                                                  Available
                                              </span>
                                          ) : (
                                              <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-red-100 text-red-700 text-xs font-bold" title={`Shortage: ${deficit.toFixed(1)} kg`}>
                                                  <AlertCircle size={12} />
                                                  Shortage
                                              </span>
                                          )}
                                      </td>
                                      <td className="px-4 py-3 text-center">
                                          <button className="p-1 rounded-full bg-slate-100 text-slate-500 group-hover:bg-blue-100 group-hover:text-blue-600 transition-colors">
                                          <Search className="w-4 h-4" />
                                          </button>
                                      </td>
                                      </tr>
                                  );
                                })}
                              </tbody>
                          </table>
                      </div>
                    ) : (
                      <div className="p-12 text-center text-slate-500">
                        <Package className="w-16 h-16 mx-auto mb-4 text-slate-300" />
                        <p className="text-lg font-medium">No yarn requirements found.</p>
                        <p className="text-sm text-slate-400 mt-2">Add orders with fabric compositions to see requirements here.</p>
                      </div>
                    )}
                </div>
              )}
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

        {/* Lot Details Modal */}
        {lotDetailsModal.isOpen && (
          <LotDetailsModal
            isOpen={lotDetailsModal.isOpen}
            onClose={() => setLotDetailsModal(prev => ({ ...prev, isOpen: false }))}
            yarnName={lotDetailsModal.yarnName}
            lots={lotDetailsModal.lots}
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
            variantId={fabricDetailsModal.variantId}
            onUpdateOrderVariant={async (variantId) => {
                if (fabricDetailsModal.orderId && selectedCustomer) {
                    await handleUpdateOrder(fabricDetailsModal.orderId, { variantId });
                }
            }}
          />
        )}

        {/* Create Plan Modal */}
        {createPlanModal.isOpen && createPlanModal.order && (
          <CreatePlanModal
            isOpen={createPlanModal.isOpen}
            onClose={() => setCreatePlanModal({ ...createPlanModal, isOpen: false })}
            order={createPlanModal.order}
            customerName={createPlanModal.customerName}
          />
        )}

        {/* Add Season Modal */}
        {showAddSeason && (
             <div className="fixed inset-0 bg-black/50 z-[100] flex items-center justify-center p-4">
                <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-md animate-in fade-in zoom-in-95">
                    <h3 className="text-lg font-bold text-slate-800 mb-4">Add New Season</h3>
                    <input
                        autoFocus
                        type="text"
                        placeholder="e.g., 2025 Winter Season"
                        value={newSeasonName}
                        onChange={(e) => setNewSeasonName(e.target.value)}
                        className="w-full px-4 py-2 border border-slate-300 rounded-lg mb-4 focus:ring-2 focus:ring-indigo-500 outline-none"
                    />
                    <div className="flex justify-end gap-2">
                        <button 
                            onClick={() => setShowAddSeason(false)}
                            className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg font-medium"
                        >
                            Cancel
                        </button>
                        <button 
                            onClick={async () => {
                                if (!newSeasonName.trim()) return;
                                const id = newSeasonName.toLowerCase().replace(/[^a-z0-9]+/g, '-');
                                const newSeason: Season = {
                                    id,
                                    name: newSeasonName,
                                    isActive: true,
                                    startDate: new Date().toISOString().split('T')[0]
                                };
                                await setDoc(doc(db, 'Seasons', id), newSeason);
                                setSelectedSeasonId(id);
                                setShowAddSeason(false);
                                setNewSeasonName('');
                            }}
                            className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 font-medium"
                        >
                            Create Season
                        </button>
                    </div>
                </div>
             </div>
        )}

        {/* Fabric Dictionary Modal */}
        <FabricDictionaryModal 
            isOpen={fabricDictionaryModal}
            onClose={() => setFabricDictionaryModal(false)}
            fabrics={fabrics}
            usedFabricNames={usedFabricNames}
        />

        {/* Fabric Form Modal */}
        <FabricFormModal
          isOpen={fabricFormModal.isOpen}
          onClose={() => setFabricFormModal({ isOpen: false })}
          onSave={handleSaveNewFabric}
          initialData={fabricFormModal.initialName ? { name: fabricFormModal.initialName } as any : null}
          machines={machines}
        />

        {/* Production Order Modal */}
        {productionOrderModal.isOpen && productionOrderModal.order && (
          <FabricProductionOrderModal
            isOpen={productionOrderModal.isOpen}
            onClose={() => setProductionOrderModal({ ...productionOrderModal, isOpen: false })}
            order={productionOrderModal.order}
            clientName={selectedCustomer?.name || ''}
            fabric={fabrics.find(f => f.name === productionOrderModal.order?.material)}
            activeMachines={productionOrderModal.activeMachines}
            plannedMachines={productionOrderModal.plannedMachines}
            allYarns={yarns}
            onMarkPrinted={() => {
              if (productionOrderModal.order) {
                const now = new Date().toISOString();
                handleUpdateOrder(productionOrderModal.order.id, { isPrinted: true, printedAt: now });
              }
            }}
          />
        )}

        {/* Production History Modal */}
        {selectedOrderForHistory && (
          <OrderProductionHistoryModal
            isOpen={!!selectedOrderForHistory}
            onClose={() => setSelectedOrderForHistory(null)}
            order={selectedOrderForHistory}
            clientName={selectedCustomer?.name || ''}
            machines={machines}
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

const LotDetailsModal: React.FC<{
  isOpen: boolean;
  onClose: () => void;
  yarnName: string;
  lots: YarnInventoryItem[];
}> = ({ isOpen, onClose, yarnName, lots }) => {
  if (!isOpen) return null;

  const totalQty = lots.reduce((sum, item) => sum + (item.quantity || 0), 0);

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[80vh]">
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
          <div>
            <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2">
              <Layers className="w-5 h-5 text-emerald-600" />
              Available Lots: {yarnName}
            </h2>
            <p className="text-sm text-slate-500">
              Total Stock: <span className="font-bold text-slate-700">{totalQty.toLocaleString(undefined, { maximumFractionDigits: 1 })} kg</span>
            </p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-full transition-colors">
            <X className="w-5 h-5 text-slate-400" />
          </button>
        </div>

        <div className="p-0 overflow-y-auto flex-1">
            {lots.length === 0 ? (
                <div className="p-8 text-center text-slate-400 italic">
                    No lots found in inventory for this yarn.
                </div>
            ) : (
                <table className="w-full text-sm text-left">
                <thead className="bg-slate-50 text-slate-500 font-medium border-b border-slate-200 sticky top-0">
                    <tr>
                    <th className="px-6 py-3">Lot Number</th>
                    <th className="px-6 py-3">Location</th>
                    <th className="px-6 py-3 text-right">Quantity (kg)</th>
                    <th className="px-6 py-3 text-right">Allocated</th>
                    <th className="px-6 py-3 text-right">Net Available</th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                    {lots.map((lot, idx) => {
                        const allocated = (lot.allocations || []).reduce((sum, a) => sum + (a.quantity || 0), 0);
                        const net = (lot.quantity || 0) - allocated;
                        
                        return (
                            <tr key={idx} className="hover:bg-slate-50 transition-colors">
                                <td className="px-6 py-3 font-medium text-slate-700 font-mono">{lot.lotNumber}</td>
                                <td className="px-6 py-3 text-slate-600 flex items-center gap-1">
                                    <MapPin size={14} className="text-slate-400" />
                                    {lot.location || 'Unknown'}
                                </td>
                                <td className="px-6 py-3 text-right font-mono text-slate-600">
                                    {(lot.quantity || 0).toLocaleString(undefined, { maximumFractionDigits: 1 })}
                                </td>
                                <td className="px-6 py-3 text-right font-mono text-amber-600">
                                    {allocated > 0 ? allocated.toLocaleString(undefined, { maximumFractionDigits: 1 }) : '-'}
                                </td>
                                <td className={`px-6 py-3 text-right font-mono font-bold ${net > 0 ? 'text-emerald-600' : 'text-slate-400'}`}>
                                    {net.toLocaleString(undefined, { maximumFractionDigits: 1 })}
                                </td>
                            </tr>
                        );
                    })}
                </tbody>
                </table>
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

const FabricDictionaryModal: React.FC<{
  isOpen: boolean;
  onClose: () => void;
  fabrics: FabricDefinition[];
  usedFabricNames?: Set<string>;
}> = ({ isOpen, onClose, fabrics, usedFabricNames }) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [showAll, setShowAll] = useState(false);

  if (!isOpen) return null;

  const displayedFabrics = fabrics.filter(f => {
      const matchesSearch = f.name.toLowerCase().includes(searchTerm.toLowerCase());
      const isUsed = usedFabricNames ? usedFabricNames.has(f.name) : true;
      // Default to showing only used fabrics if a filter is provided, unless showAll is true
      return matchesSearch && (showAll || !usedFabricNames || isUsed);
  });

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-5xl overflow-hidden flex flex-col max-h-[85vh] animate-in zoom-in-95 duration-200">
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
          <div>
            <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2">
              <FileSpreadsheet className="w-6 h-6 text-indigo-600" />
              Fabric Composition Dictionary
            </h2>
            <p className="text-sm text-slate-500">
              {usedFabricNames && !showAll ? 'Showing fabrics used in current order' : 'Showing all available fabrics'}
            </p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-full transition-colors">
            <X className="w-5 h-5 text-slate-400" />
          </button>
        </div>

        <div className="p-4 border-b border-slate-100 bg-white flex gap-4">
            <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input 
                    type="text" 
                    placeholder="Search fabrics..." 
                    className="w-full pl-10 pr-4 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                />
            </div>
            {usedFabricNames && (
                <button
                    onClick={() => setShowAll(!showAll)}
                    className={`px-4 py-2 rounded-lg text-sm font-medium border transition-colors ${showAll ? 'bg-slate-100 text-slate-600 border-slate-200' : 'bg-indigo-50 text-indigo-600 border-indigo-200'}`}
                >
                    {showAll ? 'Show Used Only' : 'Show All Fabrics'}
                </button>
            )}
        </div>

        <div className="p-0 overflow-y-auto flex-1 bg-slate-50/50">
            <table className="w-full text-sm text-left border-collapse">
                <thead className="bg-slate-100 text-slate-600 font-semibold border-b border-slate-200 sticky top-0 z-10 shadow-sm">
                    <tr>
                        <th className="px-6 py-3 w-1/4 border-r border-slate-200">Fabric Name</th>
                        <th className="px-6 py-3 w-1/6 border-r border-slate-200">Short Code</th>
                        <th className="px-6 py-3">Yarn Composition (Cell Format)</th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 bg-white">
                    {displayedFabrics.map(fabric => (
                        <tr key={fabric.id} className="hover:bg-slate-50 transition-colors">
                            <td className="px-6 py-4 font-medium text-slate-800 border-r border-slate-100 align-top">
                                {fabric.name}
                                {fabric.variants && fabric.variants.length > 0 && (
                                    <span className="block mt-1 text-xs text-slate-400 font-normal">
                                        {fabric.variants.length} Variants Available
                                    </span>
                                )}
                            </td>
                            <td className="px-6 py-4 text-slate-600 border-r border-slate-100 align-top font-mono text-xs">
                                {fabric.shortName || fabric.code || '-'}
                            </td>
                            <td className="px-6 py-4 align-top">
                                {fabric.variants && fabric.variants.length > 0 ? (
                                    <div className="space-y-4">
                                        {fabric.variants.map((variant, vIdx) => (
                                            <div key={vIdx} className="bg-slate-50 rounded border border-slate-200 p-2">
                                                <div className="text-xs font-bold text-indigo-600 mb-2 border-b border-slate-200 pb-1">
                                                    {variant.name}
                                                </div>
                                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                                    {variant.yarns.map((y, yIdx) => (
                                                        <div key={yIdx} className="flex items-center justify-between bg-white px-2 py-1 rounded border border-slate-100 text-xs">
                                                            <span className="font-medium text-slate-700">{y.name}</span>
                                                            <div className="flex items-center gap-2">
                                                                <span className="font-mono bg-blue-50 text-blue-700 px-1.5 rounded">{y.percentage}%</span>
                                                                {y.scrapPercentage && (
                                                                    <span className="font-mono bg-red-50 text-red-700 px-1.5 rounded" title="Scrap">+{y.scrapPercentage}%</span>
                                                                )}
                                                            </div>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                ) : fabric.yarnComposition && fabric.yarnComposition.length > 0 ? (
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                        {fabric.yarnComposition.map((y, yIdx) => (
                                            <div key={yIdx} className="flex items-center justify-between bg-slate-50 px-3 py-2 rounded border border-slate-100 text-xs">
                                                <span className="font-medium text-slate-700">{y.name || y.yarnName}</span>
                                                <div className="flex items-center gap-2">
                                                    <span className="font-mono bg-blue-50 text-blue-700 px-1.5 rounded">{y.percentage}%</span>
                                                    {y.scrapPercentage && (
                                                        <span className="font-mono bg-red-50 text-red-700 px-1.5 rounded" title="Scrap">+{y.scrapPercentage}%</span>
                                                    )}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                ) : (
                                    <span className="text-slate-400 italic text-xs">No composition defined</span>
                                )}
                            </td>
                        </tr>
                    ))}
                    {displayedFabrics.length === 0 && (
                        <tr>
                            <td colSpan={3} className="px-6 py-8 text-center text-slate-400 italic">
                                No fabrics found matching your criteria.
                            </td>
                        </tr>
                    )}
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

