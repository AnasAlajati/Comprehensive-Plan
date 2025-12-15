import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { MachineRow, PlanItem, MachineStatus, CustomerOrder } from '../types';
import { SmartPlanModal } from './SmartPlanModal';
import { recalculateSchedule, addDays } from '../services/data';
import { DataService } from '../services/dataService';
import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';
import { doc, onSnapshot, setDoc, updateDoc } from 'firebase/firestore';
import { db } from '../services/firebase';
import { Search, Play, GripVertical } from 'lucide-react';

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
  onCreateNew: (newValue: string) => void;
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  onFocus?: () => void;
  placeholder?: string;
  className?: string;
  extraInfo?: (option: any) => React.ReactNode;
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
  className,
  extraInfo
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

  const handleCreateNew = () => {
    if (inputValue.trim()) {
      onCreateNew(inputValue);
      // Don't clear inputValue here, let the parent update the value prop
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
    <div ref={containerRef} className="relative w-full">
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
        className={className || "w-full text-center py-1.5 px-2 rounded hover:bg-white focus:bg-white focus:ring-1 focus:ring-blue-400 outline-none bg-transparent text-slate-600 text-xs"}
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
                  onClick={() => handleSelect(opt.name)}
                  className="px-2 py-1.5 hover:bg-blue-50 cursor-pointer text-xs border-b border-slate-100 last:border-b-0 text-left flex justify-between items-center"
                >
                  <span>{opt.name}</span>
                  {extraInfo && extraInfo(opt)}
                </div>
              ))}
              {searchTerm && !options.some(o => o.name.toLowerCase() === searchTerm.toLowerCase()) && (
                <div
                  onClick={handleCreateNew}
                  className="px-2 py-1.5 hover:bg-emerald-50 cursor-pointer text-xs border-t border-slate-200 text-emerald-600 font-medium text-left"
                >
                  + Add "{inputValue}"
                </div>
              )}
            </>
          ) : searchTerm ? (
            <div
              onClick={handleCreateNew}
              className="px-2 py-1.5 hover:bg-emerald-50 cursor-pointer text-xs text-emerald-600 font-medium text-left"
            >
              + Add "{inputValue}"
            </div>
          ) : (
            <div className="px-2 py-1.5 text-xs text-slate-400 text-left">No options</div>
          )}
        </div>
      )}
    </div>
  );
};

interface PlanningScheduleProps {
  machines?: MachineRow[];
  onUpdate?: (machine: MachineRow) => Promise<void>;
}
type PlanningMachine = MachineRow & { machineSSId: string; scheduleIndex?: number };

export const PlanningSchedule: React.FC<PlanningScheduleProps> = ({ onUpdate }) => {
  const [smartAddMachineId, setSmartAddMachineId] = useState<number | null>(null);
  const [detailsModal, setDetailsModal] = useState<{ isOpen: boolean; machine: any; plan?: any; isCurrent?: boolean; } | null>(null);
  const [draggedPlan, setDraggedPlan] = useState<{machineId: number, index: number} | null>(null);
  const [draggedMachineId, setDraggedMachineId] = useState<number | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);
  const [machines, setMachines] = useState<PlanningMachine[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>('');
  const [activeDay, setActiveDay] = useState<string>(new Date().toISOString().split('T')[0]);
  
  // Filter State
  const [searchTerm, setSearchTerm] = useState('');
  const [filterType, setFilterType] = useState('ALL');
  const [filterClient, setFilterClient] = useState('');
  const [filterFabric, setFilterFabric] = useState('');

  // Data for Dropdowns
  const [fabrics, setFabrics] = useState<any[]>([]);
  const [clients, setClients] = useState<any[]>([]);
  const [customerOrders, setCustomerOrders] = useState<CustomerOrder[]>([]);

  const scheduleRef = useRef<HTMLDivElement>(null);

  // Listen for Active Day changes
  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'settings', 'global'), (doc) => {
      if (doc.exists() && doc.data().activeDay) {
        setActiveDay(doc.data().activeDay);
      }
    });
    return () => unsub();
  }, []);

  // Load Fabrics and Clients
  useEffect(() => {
    const loadData = async () => {
      try {
        const [f, c, o] = await Promise.all([
          DataService.getFabrics(),
          DataService.getClients(),
          DataService.getCustomerOrders()
        ]);
        setFabrics(f);
        setClients(c);
        setCustomerOrders(o);
      } catch (err) {
        console.error("Failed to load fabrics/clients", err);
      }
    };
    loadData();
  }, []);

  const handleDateChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setActiveDay(val);
    try {
      await setDoc(doc(db, 'settings', 'global'), { activeDay: val }, { merge: true });
    } catch (err) {
      console.error("Failed to update active day", err);
    }
  };

  const handleCreateItem = async (type: 'fabric' | 'client', name: string) => {
    try {
      if (type === 'fabric') {
        await DataService.addFabric({ name });
        setFabrics(await DataService.getFabrics());
      } else {
        await DataService.addClient({ name });
        setClients(await DataService.getClients());
      }
    } catch (err) {
      console.error(`Failed to create ${type}`, err);
    }
  };

  const toNumber = (value: any, fallback = 0) => {
    const num = Number(value);
    return Number.isFinite(num) ? num : fallback;
  };

  const normalizeStatus = (value: any): MachineStatus => {
    const statuses = Object.values(MachineStatus);
    return statuses.includes(value) ? (value as MachineStatus) : MachineStatus.NO_ORDER;
  };

  const mapMachineSSDocToMachineRow = useCallback((machine: any, index: number, currentActiveDay: string): PlanningMachine => {
    const logs = Array.isArray(machine.dailyLogs) ? machine.dailyLogs : [];
    
    // Filter logs to find the state as of activeDay
    const relevantLogs = logs.filter((l: any) => l.date <= currentActiveDay);
    
    const latestLog = relevantLogs.reduce((latest: any, current: any) => {
      if (!current?.date) return latest;
      if (!latest?.date) return current;
      return new Date(current.date).getTime() >= new Date(latest.date).getTime() ? current : latest;
    }, null);

    const effectiveLog = latestLog || (machine.lastLogDate <= currentActiveDay ? machine.lastLogData : {});

    const hydratePlan = (plan: any): PlanItem => ({
      type: plan?.type || 'PRODUCTION',
      fabric: plan?.fabric || '',
      productionPerDay: toNumber(plan?.productionPerDay),
      quantity: toNumber(plan?.quantity),
      days: toNumber(plan?.days),
      startDate: plan?.startDate || '',
      endDate: plan?.endDate || '',
      remaining: toNumber(plan?.remaining),
      client: plan?.client || '',
      orderName: plan?.orderName || '',
      originalSampleMachine: plan?.originalSampleMachine || '',
      notes: plan?.notes || '',
      orderId: plan?.orderId,
      fabricId: plan?.fabricId
    });

    const machineNumericId = typeof machine.machineid === 'number'
      ? machine.machineid
      : typeof machine.machineId === 'number'
        ? machine.machineId
        : typeof machine.id === 'number'
          ? machine.id
          : index + 1;

    const futurePlans: PlanItem[] = Array.isArray(machine.futurePlans)
      ? machine.futurePlans.map(hydratePlan)
      : [];

    const resolvedStatus = normalizeStatus(effectiveLog?.status || machine.status);

    // machineSSId MUST be the Firestore doc ID (string), not the numeric ID!
    const machineSSId = machine.id || machine.firestoreId || String(machineNumericId);

    return {
      id: machineNumericId,
      machineSSId,
      scheduleIndex: machine.scheduleIndex !== undefined ? machine.scheduleIndex : 9999,
      brand: machine.brand || '—',
      type: machine.type || '—',
      machineName: machine.name || machine.machineName || `Machine ${machineNumericId}`,
      status: resolvedStatus,
      customStatusNote: machine.customStatusNote || '',
      avgProduction: toNumber(effectiveLog?.avgProduction, toNumber(machine.avgProduction)),
      dayProduction: toNumber(effectiveLog?.dayProduction, toNumber(machine.dayProduction)),
      remainingMfg: toNumber(effectiveLog?.remainingMfg, toNumber(machine.remainingMfg)),
      scrap: toNumber(effectiveLog?.scrap, toNumber(machine.scrap)),
      reason: effectiveLog?.reason || machine.reason || '',
      material: effectiveLog?.fabric || machine.material || '',
      client: effectiveLog?.client || machine.client || '',
      futurePlans,
      dailyLogs: logs.map((log: any) => log.id).filter(Boolean),
      lastLogDate: effectiveLog?.date || machine.lastLogDate,
      lastLogData: effectiveLog?.date ? {
        date: effectiveLog.date,
        dayProduction: toNumber(effectiveLog.dayProduction),
        scrap: toNumber(effectiveLog.scrap),
        status: normalizeStatus(effectiveLog.status),
        fabric: effectiveLog.fabric || '',
        client: effectiveLog.client || ''
      } : undefined
    };
  }, []);

  const sanitizePlans = useCallback((plans: PlanItem[]): PlanItem[] => (
    plans.map(plan => {
      const clean: Record<string, any> = {};
      Object.entries(plan).forEach(([key, value]) => {
        if (value !== undefined) {
          clean[key] = value;
        }
      });
      return clean as PlanItem;
    })
  ), []);

  const persistFuturePlans = useCallback(async (machine: PlanningMachine, plans: PlanItem[]) => {
    try {
      const cleanedPlans = sanitizePlans(plans);
      console.log('Saving plans for MachineSS:', machine.machineSSId, cleanedPlans);
      
      await DataService.updateMachineInMachineSS(machine.machineSSId, {
        futurePlans: cleanedPlans,
        lastUpdated: new Date().toISOString()
      });
      setError('');
    } catch (err) {
      console.error('Failed to update MachineSS plan', err);
      setError('تعذر حفظ التعديلات، يرجى المحاولة مرة أخرى.');
    }
  }, [onUpdate, sanitizePlans]);

  const updateMachinePlans = useCallback((machine: PlanningMachine, transform: (plans: PlanItem[]) => PlanItem[]) => {
    const currentPlans = [...(machine.futurePlans || [])];
    const transformed = transform(currentPlans);
    const recalculated = recalculateSchedule(transformed, machine);
    setMachines(prev => prev.map(m => m.id === machine.id ? { ...m, futurePlans: recalculated } : m));
    persistFuturePlans(machine, recalculated);
  }, [persistFuturePlans]);

  useEffect(() => {
    let isMounted = true;
    const fetchMachines = async () => {
      setLoading(true);
      try {
        const machineDocs = await DataService.getMachinesFromMachineSS();
        if (!isMounted) return;
        const mapped = machineDocs.map((machine: any, idx: number) => mapMachineSSDocToMachineRow(machine, idx, activeDay));
        setMachines(mapped);
        setError('');
      } catch (err) {
        console.error('Failed to load MachineSS data', err);
        if (isMounted) {
          setError('تعذر تحميل بيانات التخطيط.');
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    };

    fetchMachines();
    return () => {
      isMounted = false;
    };
  }, [mapMachineSSDocToMachineRow, activeDay]);

  const handleActivatePlan = async (e: React.MouseEvent, machine: PlanningMachine, plan: PlanItem, index: number) => {
    e.preventDefault();
    e.stopPropagation();
    
    if (!confirm(`Are you sure you want to start production for ${plan.fabric} (${plan.client}) on ${machine.machineName}? This will update the machine's current status.`)) {
      return;
    }

    try {
      const updates = {
        status: 'Working',
        client: plan.client,
        material: plan.fabric,
        fabric: plan.fabric,
        currentOrder: plan.orderName,
        orderReference: plan.orderReference || (plan.client && plan.fabric ? `${plan.client}-${plan.fabric.split(/[\s-]+/).map((w: string) => w[0]).join('')}` : ''), // NEW: Persist reference (auto-gen if missing)
        remainingMfg: plan.remaining,
        dayProduction: 0,
        lastUpdated: new Date().toISOString(),
        futurePlans: machine.futurePlans?.filter((_, i) => i !== index)
      };

      await DataService.updateMachineInMachineSS(machine.machineSSId, updates);
      
      setMachines(prev => prev.map(m => {
        if (m.id === machine.id) {
          return {
            ...m,
            status: MachineStatus.WORKING,
            client: plan.client || '',
            material: plan.fabric,
            orderReference: updates.orderReference, // NEW: Update local state
            remainingMfg: plan.remaining,
            dayProduction: 0,
            futurePlans: m.futurePlans?.filter((_, i) => i !== index) || []
          };
        }
        return m;
      }));

    } catch (err) {
      console.error("Failed to activate plan", err);
      alert("Failed to activate plan");
    }
  };

  const handlePlanChange = async (
    machine: PlanningMachine, 
    planIndex: number, 
    field: keyof PlanItem, 
    value: any
  ) => {
    updateMachinePlans(machine, (plans) => {
      const updated = [...plans];
      const plan = { ...updated[planIndex], [field]: value };
      
      // Auto-update remaining if quantity changes
      if (field === 'quantity') {
        plan.remaining = value;
      }

      // Auto-generate Order Reference
      if (field === 'client' || field === 'fabric') {
        const c = field === 'client' ? value : plan.client;
        const f = field === 'fabric' ? value : plan.fabric;
        if (c && f) {
            // Logic: Client - Fabric Initials (e.g. OR - Single Jersey -> OR-SJ)
            const fabricInitials = f.split(/[\s-]+/).map((w: string) => w[0]).join('');
            plan.orderReference = `${c}-${fabricInitials}`;
        }
      }
      
      updated[planIndex] = plan;
      return updated;
    });

    // Smart Connection: Auto-add fabric to Customer Order if not exists
    if (field === 'fabric' || field === 'client') {
       const currentPlan = machine.futurePlans?.[planIndex];
       const clientName = field === 'client' ? value : currentPlan?.client;
       const fabricName = field === 'fabric' ? value : currentPlan?.fabric;
       
       if (clientName && fabricName) {
          // Check if order exists
          const order = customerOrders.find(o => o.customerName === clientName);
          const fabricExists = order?.fabrics.some(f => f.fabricName === fabricName);
          
          if (!fabricExists) {
             try {
                await DataService.addFabricToOrder(clientName, fabricName);
                // Update local state optimistically
                setCustomerOrders(prev => {
                   const newOrders = [...prev];
                   const existingOrderIndex = newOrders.findIndex(o => o.customerName === clientName);
                   if (existingOrderIndex >= 0) {
                      // Avoid duplicates in local state if multiple rapid updates
                      if (!newOrders[existingOrderIndex].fabrics.some(f => f.fabricName === fabricName)) {
                        newOrders[existingOrderIndex].fabrics.push({
                            fabricName,
                            totalQuantity: 0,
                            remainingQuantity: 0,
                            assignedMachines: []
                        });
                      }
                   } else {
                      newOrders.push({
                         customerName: clientName,
                         fabrics: [{
                            fabricName,
                            totalQuantity: 0,
                            remainingQuantity: 0,
                            assignedMachines: []
                         }]
                      });
                   }
                   return newOrders;
                });
             } catch (e) {
                console.error("Failed to auto-add fabric to order", e);
             }
          }
       }
    }
  };

  const addPlan = (machine: PlanningMachine, type: 'PRODUCTION' | 'SETTINGS' = 'PRODUCTION') => {
    const newPlan: PlanItem = {
      type: type,
      fabric: '',
      productionPerDay: machine.avgProduction || 150,
      quantity: 0,
      days: type === 'SETTINGS' ? 1 : 0,
      startDate: '',
      endDate: '',
      remaining: 0,
      client: '',
      orderName: '',
      originalSampleMachine: '',
      notes: ''
    };
    updateMachinePlans(machine, (plans) => [...plans, newPlan]);
  };

  const deletePlan = async (e: React.MouseEvent, machine: PlanningMachine, planIndex: number) => {
    e.preventDefault();
    e.stopPropagation(); // Stop drag interference
    if (!machine.futurePlans) return;
    updateMachinePlans(machine, (plans) => plans.filter((_, i) => i !== planIndex));
  };

  const handleDragStart = (e: React.DragEvent, machineId: number, index: number) => {
    const target = e.target as HTMLElement;
    if (['INPUT', 'SELECT', 'BUTTON', 'TEXTAREA'].includes(target.tagName) && !target.classList.contains('drag-handle')) {
      e.preventDefault();
      return;
    }
    setDraggedPlan({ machineId, index });
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDrop = (e: React.DragEvent, targetMachineId: number, targetIndex: number) => {
    e.preventDefault();
    if (!draggedPlan || draggedPlan.machineId !== targetMachineId || draggedPlan.index === targetIndex) return;

    const machine = machines.find(m => m.id === targetMachineId);
    if (!machine) return;

    updateMachinePlans(machine, (plans) => {
      const reordered = [...plans];
      const [removed] = reordered.splice(draggedPlan.index, 1);
      reordered.splice(targetIndex, 0, removed);
      return reordered;
    });
    setDraggedPlan(null);
  };

  const handleSmartPlanSave = (plan: PlanItem) => {
    if (smartAddMachineId === null) return;
    const machine = machines.find(m => m.id === smartAddMachineId);
    if (machine) {
      plan.type = 'PRODUCTION';
      updateMachinePlans(machine, (plans) => [...plans, plan]);
    }
    setSmartAddMachineId(null);
  };

  const uniqueClients = useMemo(() => {
    const clients = new Set<string>();
    machines.forEach(m => {
      if (m.client) clients.add(m.client);
    });
    return Array.from(clients).sort();
  }, [machines]);

  const uniqueFabrics = useMemo(() => {
    const fabrics = new Set<string>();
    machines.forEach(m => {
      if (m.material) fabrics.add(m.material);
    });
    return Array.from(fabrics).sort();
  }, [machines]);

  const availableTypes = useMemo(() => {
    const types = new Set(machines.map(m => m.type));
    return ['ALL', 'All (Excl. BOUS)', ...Array.from(types).sort()];
  }, [machines]);

  const filteredMachines = useMemo(() => {
    let result = [...machines];

    if (filterType !== 'ALL' && filterType.trim()) {
      const lowerType = filterType.toLowerCase();
      result = result.filter(m => m.type && m.type.toLowerCase().includes(lowerType));
    }

    if (filterClient.trim()) {
      const lowerClient = filterClient.toLowerCase();
      result = result.filter(m => m.client && m.client.toLowerCase().includes(lowerClient));
    }

    if (filterFabric.trim()) {
      const lowerFabric = filterFabric.toLowerCase();
      result = result.filter(m => m.material && m.material.toLowerCase().includes(lowerFabric));
    }

    if (searchTerm.trim()) {
      const lowerTerm = searchTerm.toLowerCase();
      result = result.filter(m => 
        m.machineName.toLowerCase().includes(lowerTerm) ||
        m.brand.toLowerCase().includes(lowerTerm)
      );
    }
    
    result.sort((a, b) => {
      // Priority 1: Custom Schedule Order
      const indexA = a.scheduleIndex !== undefined ? a.scheduleIndex : 9999;
      const indexB = b.scheduleIndex !== undefined ? b.scheduleIndex : 9999;
      
      if (indexA !== indexB) {
          return indexA - indexB;
      }

      // Sort by Client (A-Z)
      const clientA = (a.client || '').toLowerCase();
      const clientB = (b.client || '').toLowerCase();
      if (clientA < clientB) return -1;
      if (clientA > clientB) return 1;

      // Then by Fabric (A-Z)
      const fabricA = (a.material || '').toLowerCase();
      const fabricB = (b.material || '').toLowerCase();
      if (fabricA < fabricB) return -1;
      if (fabricA > fabricB) return 1;

      // Finally by ID
      return (a.id || 0) - (b.id || 0);
    });

    return result;
  }, [machines, filterType, filterClient, filterFabric, searchTerm]);

  const handleMachineDragStart = (e: React.DragEvent, machineId: number) => {
    setDraggedMachineId(machineId);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleMachineDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const handleMachineDrop = async (e: React.DragEvent, targetMachineId: number) => {
    e.preventDefault();
    if (draggedMachineId === null || draggedMachineId === targetMachineId) return;

    const currentIndex = filteredMachines.findIndex(m => m.id === draggedMachineId);
    const targetIndex = filteredMachines.findIndex(m => m.id === targetMachineId);

    if (currentIndex === -1 || targetIndex === -1) return;

    const newMachines = [...filteredMachines];
    const [movedMachine] = newMachines.splice(currentIndex, 1);
    newMachines.splice(targetIndex, 0, movedMachine);

    // Update scheduleIndex for all machines to persist the order
    const updates = newMachines.map((machine, index) => ({
        id: machine.machineSSId,
        scheduleIndex: (index + 1) * 1000
    }));

    try {
        // Optimistically update local state
        setMachines(prev => {
            const updateMap = new Map(updates.map(u => [u.id, u.scheduleIndex]));
            return prev.map(m => {
                if (updateMap.has(m.machineSSId)) {
                    return { ...m, scheduleIndex: updateMap.get(m.machineSSId) };
                }
                return m;
            });
        });

        // Persist to Firestore
        await Promise.all(updates.map(u => 
            DataService.updateMachineInMachineSS(u.id, { scheduleIndex: u.scheduleIndex })
        ));
    } catch (err) {
        console.error("Failed to reorder machines", err);
        setError("Failed to save new order");
    }
    
    setDraggedMachineId(null);
  };

  const handleDownloadPDF = async () => {
    setIsDownloading(true);

    try {
      // 1. Setup PDF (A4 Landscape)
      const pdf = new jsPDF('l', 'mm', 'a4');
      const pageWidth = 297;
      const pageHeight = 210;
      const margin = 10; // mm
      const contentWidth = pageWidth - (margin * 2);
      const contentHeight = pageHeight - (margin * 2);
      
      // Pixel conversion (approx 3.78 px/mm at 96 DPI, but we scale up for quality)
      const pxPerMm = 3.78; 
      const containerWidth = Math.floor(contentWidth * pxPerMm);
      const containerHeight = Math.floor(contentHeight * pxPerMm);

      // 2. Create Hidden Container
      const container = document.createElement('div');
      container.style.position = 'absolute';
      container.style.top = '-9999px';
      container.style.left = '0';
      container.style.width = `${containerWidth}px`;
      container.style.backgroundColor = '#ffffff';
      document.body.appendChild(container);

      // --- COLOR SANITIZATION HELPER (Same as FetchDataPage) ---
      const ctx = document.createElement('canvas').getContext('2d');
      const safeColor = (c: string) => {
          if (!c || typeof c !== 'string') return c;
          if (!c.includes('ok') && !c.includes('lab') && !c.includes('lch')) return c;

          if (c.includes('oklch') || c.includes('oklab') || c.includes('lab(') || c.includes('lch(')) {
              if (!ctx) return '#000000';
              try {
                  ctx.clearRect(0, 0, 1, 1);
                  ctx.fillStyle = c;
                  ctx.fillRect(0, 0, 1, 1);
                  const data = ctx.getImageData(0, 0, 1, 1).data;
                  return `rgba(${data[0]}, ${data[1]}, ${data[2]}, ${data[3] / 255})`;
              } catch (e) {
                  console.warn('Color conversion failed', e);
                  return '#000000'; 
              }
          }
          return c;
      };

      // 3. Group Machines
      const groups: Record<string, PlanningMachine[]> = {};
      const typeOrder = ['SINGLE', 'DOUBLE', 'MELTON', 'INTERLOCK', 'RIB', 'JACQUARD'];
      
      const normalizeType = (t: string) => {
        const upper = (t || '').toUpperCase();
        if (upper.includes('SINGLE')) return 'SINGLE';
        if (upper.includes('DOUBLE')) return 'DOUBLE';
        return upper || 'OTHER';
      };

      filteredMachines.forEach(m => {
        const type = normalizeType(m.type);
        if (!groups[type]) groups[type] = [];
        groups[type].push(m);
      });

      const sortedTypes = Object.keys(groups).sort((a, b) => {
         const idxA = typeOrder.indexOf(a);
         const idxB = typeOrder.indexOf(b);
         if (idxA === -1 && idxB === -1) return a.localeCompare(b);
         if (idxA === -1) return 1;
         if (idxB === -1) return -1;
         return idxA - idxB;
      });

      // 4. Render Logic
      const pages: HTMLElement[] = [];
      let currentPage: HTMLElement | null = null;
      let currentY = 0;

      const createNewPage = () => {
        const page = document.createElement('div');
        page.style.width = `${containerWidth}px`;
        page.style.height = `${containerHeight}px`; // Fixed height per page
        page.style.padding = '20px';
        page.style.backgroundColor = 'white';
        page.style.boxSizing = 'border-box';
        page.style.position = 'relative';
        page.style.overflow = 'hidden';
        
        // Add Title/Date Header
        const headerDiv = document.createElement('div');
        headerDiv.innerHTML = `
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; border-bottom: 2px solid #1e293b; padding-bottom: 5px;">
            <h1 style="font-size: 18px; font-weight: bold; color: #1e293b; margin: 0;">Production Schedule</h1>
            <span style="font-size: 12px; color: #64748b;">Generated: ${new Date().toLocaleDateString()}</span>
          </div>
        `;
        page.appendChild(headerDiv);
        
        container.appendChild(page);
        pages.push(page);
        currentPage = page;
        currentY = 60; // Initial offset after header
        
        return page;
      };

      // Initialize first page
      createNewPage();

      // Helper for Row Background (Subtle tint based on status to match UI vibe)
      const getRowBg = (s: MachineStatus) => {
          switch(s) {
            case MachineStatus.WORKING: return '#ecfdf5'; // emerald-50
            case MachineStatus.UNDER_OP: return '#fffbeb'; // amber-50
            case MachineStatus.NO_ORDER: return '#f8fafc'; // slate-50
            case MachineStatus.OUT_OF_SERVICE: return '#fef2f2'; // red-50
            case MachineStatus.QALB: return '#faf5ff'; // purple-50
            default: return '#ffffff';
          }
      };

      // Helper to calculate end date
      const calcEndDate = (start: string, rem: number, prod: number) => {
         if (!start || !rem || !prod) return '-';
         const days = Math.ceil(rem / prod);
         const d = new Date(start);
         d.setDate(d.getDate() + days);
         return d.toISOString().split('T')[0];
      };

      let currentTbody: HTMLTableSectionElement | null = null;

      const startNewTable = (page: HTMLElement) => {
          const table = document.createElement('table');
          table.style.width = '100%';
          table.style.borderCollapse = 'collapse';
          table.style.fontSize = '10px';
          table.style.tableLayout = 'fixed';
          table.style.marginBottom = '10px';

          table.innerHTML = `
             <thead>
               <tr style="background-color: #f8fafc; color: #64748b; border-bottom: 2px solid #e2e8f0;">
                 <th style="padding: 6px; text-align: center; width: 10%;">Start</th>
                 <th style="padding: 6px; text-align: center; width: 10%;">End</th>
                 <th style="padding: 6px; text-align: center; width: 8%;">Orig.</th>
                 <th style="padding: 6px; text-align: center; width: 6%;">Days</th>
                 <th style="padding: 6px; text-align: left; width: 12%;">Client</th>
                 <th style="padding: 6px; text-align: left; width: 8%;">Ref</th>
                 <th style="padding: 6px; text-align: right; width: 10%;">Rem.</th>
                 <th style="padding: 6px; text-align: right; width: 10%;">Qty</th>
                 <th style="padding: 6px; text-align: right; width: 8%;">Prod</th>
                 <th style="padding: 6px; text-align: left; width: 18%;">Fabric/Notes</th>
               </tr>
             </thead>
             <tbody></tbody>
          `;
          page.appendChild(table);
          return table.querySelector('tbody')!;
      };

      for (const type of sortedTypes) {
        const machines = groups[type];
        if (machines.length === 0) continue;

        // Type Header
        const typeHeaderHeight = 30;
        if (currentY + typeHeaderHeight > containerHeight - 20) {
           createNewPage();
           currentTbody = null;
        }

        if (currentPage) {
            currentTbody = null; // Start fresh table for new type section
            const typeDiv = document.createElement('div');
            typeDiv.innerHTML = `
              <div style="padding: 8px; background-color: #e2e8f0; font-weight: bold; color: #1e293b; border-bottom: 1px solid #cbd5e1; font-size: 12px; margin-bottom: 10px;">
                ${type} MACHINES (${machines.length})
              </div>
            `;
            currentPage.appendChild(typeDiv);
            currentY += typeHeaderHeight + 10;
        }

        for (const machine of machines) {
           const planRows = machine.futurePlans && machine.futurePlans.length > 0 ? machine.futurePlans : [];
           const totalRows = 1 + planRows.length; // 1 for current status + plans
           
           // Calculate height needed for this machine block
           const machineHeaderHeight = 25;
           const dataRowsHeight = totalRows * 25;
           const totalBlockHeight = machineHeaderHeight + dataRowsHeight;

           // Check if machine fits on current page
           if (currentY + totalBlockHeight > containerHeight - 20) {
              createNewPage();
              currentTbody = null;
              
              // Re-add type header for context on new page
              const typeDiv = document.createElement('div');
              typeDiv.innerHTML = `
                <div style="padding: 8px; background-color: #e2e8f0; font-weight: bold; color: #1e293b; border-bottom: 1px solid #cbd5e1; font-size: 12px; margin-bottom: 10px;">
                  ${type} MACHINES (Cont.)
                </div>
              `;
              currentPage!.appendChild(typeDiv);
              currentY += 40;
           }

           if (!currentPage) continue;

           if (!currentTbody) {
               currentTbody = startNewTable(currentPage);
               currentY += 30; // Table header height
           }

           // --- Machine Header Row (Spans all columns) ---
           const machineHeaderRow = document.createElement('tr');
           machineHeaderRow.style.backgroundColor = '#1e293b';
           machineHeaderRow.style.color = 'white';
           
           machineHeaderRow.innerHTML = `
             <td colspan="10" style="padding: 6px 10px; border-bottom: 1px solid #334155;">
               <div style="display: flex; justify-content: space-between; align-items: center;">
                 <div style="display: flex; align-items: center; gap: 10px;">
                   <span style="font-weight: bold; font-size: 11px;">${machine.machineName}</span>
                   <span style="font-size: 9px; opacity: 0.8; text-transform: uppercase; background-color: rgba(255,255,255,0.1); padding: 1px 4px; border-radius: 2px;">${machine.brand || ''}</span>
                 </div>
                 <div style="font-size: 9px; font-weight: 500; opacity: 0.9;">${machine.status}</div>
               </div>
             </td>
           `;
           currentTbody.appendChild(machineHeaderRow);

           // --- Row 1: Current Status ---
           const endDate = calcEndDate(activeDay, machine.remainingMfg, machine.dayProduction);
           const statusRow = document.createElement('tr');
           statusRow.style.backgroundColor = getRowBg(machine.status);
           statusRow.style.borderBottom = '1px solid #e2e8f0';
           
           statusRow.innerHTML = `
             <td style="padding: 6px; text-align: center;">${activeDay}</td>
             <td style="padding: 6px; text-align: center;">${endDate}</td>
             <td style="padding: 6px; text-align: center;">-</td>
             <td style="padding: 6px; text-align: center;">-</td>
             <td style="padding: 6px;">${machine.client || '-'}</td>
             <td style="padding: 6px;">${machine.orderReference || '-'}</td>
             <td style="padding: 6px; text-align: right;">${machine.remainingMfg?.toLocaleString() || '-'}</td>
             <td style="padding: 6px; text-align: right;">-</td>
             <td style="padding: 6px; text-align: right;">${machine.avgProduction?.toLocaleString() || '-'}</td>
             <td style="padding: 6px;">${machine.material || '-'}</td>
           `;
           currentTbody.appendChild(statusRow);

           // --- Future Plans ---
           planRows.forEach(plan => {
              const planRow = document.createElement('tr');
              planRow.style.borderBottom = '1px solid #f1f5f9';
              planRow.style.backgroundColor = '#ffffff';
              
              planRow.innerHTML = `
                <td style="padding: 6px; text-align: center;">${plan.startDate || '-'}</td>
                <td style="padding: 6px; text-align: center;">${plan.endDate || '-'}</td>
                <td style="padding: 6px; text-align: center;">${plan.originalSampleMachine || '-'}</td>
                <td style="padding: 6px; text-align: center;">${plan.days || '-'}</td>
                <td style="padding: 6px;">${plan.client || '-'}</td>
                <td style="padding: 6px;">${plan.orderName || '-'}</td>
                <td style="padding: 6px; text-align: right;">${plan.remaining?.toLocaleString() || '-'}</td>
                <td style="padding: 6px; text-align: right;">${plan.quantity?.toLocaleString() || '-'}</td>
                <td style="padding: 6px; text-align: right;">${plan.productionPerDay?.toLocaleString() || '-'}</td>
                <td style="padding: 6px;">${plan.fabric || plan.notes || '-'}</td>
              `;
              currentTbody.appendChild(planRow);
           });

           currentY += totalBlockHeight;
        }
      }

      // 5. Generate PDF
      for (let i = 0; i < pages.length; i++) {
        // --- PRE-SANITIZE DOM ELEMENTS ---
        // This prevents html2canvas from crashing during initial parse if it encounters oklch
        const domElements = pages[i].querySelectorAll('*');
        domElements.forEach((el: any) => {
            const style = el.style;
            const computed = getComputedStyle(el);
            // We only need to overwrite if it's an unsafe color
            if (computed.backgroundColor && (computed.backgroundColor.includes('ok') || computed.backgroundColor.includes('lab'))) {
                style.backgroundColor = safeColor(computed.backgroundColor);
            }
            if (computed.color && (computed.color.includes('ok') || computed.color.includes('lab'))) {
                style.color = safeColor(computed.color);
            }
            if (computed.borderColor && (computed.borderColor.includes('ok') || computed.borderColor.includes('lab'))) {
                style.borderColor = safeColor(computed.borderColor);
            }
        });
        // ---------------------------------

        if (i > 0) pdf.addPage();
        const canvas = await html2canvas(pages[i], {
          scale: 2,
          useCORS: true,
          backgroundColor: '#ffffff',
          onclone: (clonedDoc) => {
             // Apply color sanitization if any dynamic styles slipped through
             const allElements = clonedDoc.querySelectorAll('*');
             allElements.forEach((el: any) => {
                const style = el.style;
                const computed = getComputedStyle(el);

                if (computed.backgroundColor) style.backgroundColor = safeColor(computed.backgroundColor);
                if (computed.color) style.color = safeColor(computed.color);
                if (computed.borderColor) style.borderColor = safeColor(computed.borderColor);
                if (computed.outlineColor) style.outlineColor = safeColor(computed.outlineColor);

                // Handle shadows that might contain oklch
                if (computed.boxShadow && (computed.boxShadow.includes('ok') || computed.boxShadow.includes('lab') || computed.boxShadow.includes('lch'))) {
                   style.boxShadow = 'none'; 
                }
             });
          }
        });
        const imgData = canvas.toDataURL('image/jpeg', 0.95);
        pdf.addImage(imgData, 'JPEG', 0, 0, pageWidth, pageHeight);
      }

      pdf.save(`Production_Schedule_${new Date().toISOString().split('T')[0]}.pdf`);
      document.body.removeChild(container);

    } catch (error) {
      console.error("PDF Generation Error:", error);
      alert("Failed to generate PDF");
    } finally {
      setIsDownloading(false);
    }
  };

  if (loading) {
    return (
      <div className="text-center py-12 text-slate-400">
        <p>Loading planning schedule...</p>
      </div>
    );
  }

  if (error && machines.length === 0) {
    return (
      <div className="text-center py-12 text-red-500">
        <p>{error}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-10">
      {/* Filter Bar */}
      <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-200">
          <div className="flex flex-col lg:flex-row gap-4 justify-between items-start lg:items-center">
            <div className="flex flex-1 flex-col sm:flex-row gap-3 w-full">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-5 h-5" />
                <input
                  type="text"
                  placeholder="Search machines..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full pl-10 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all"
                />
              </div>
              
              <div className="flex gap-2 overflow-x-auto pb-2 sm:pb-0">
                <select
                  value={filterType}
                  onChange={(e) => setFilterType(e.target.value)}
                  className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm font-medium text-slate-600 focus:ring-2 focus:ring-blue-500 outline-none w-32 appearance-none"
                >
                  {availableTypes.map(type => (
                    <option key={type} value={type}>{type}</option>
                  ))}
                </select>

                <input 
                  type="text"
                  placeholder="Filter Client..."
                  value={filterClient}
                  onChange={(e) => setFilterClient(e.target.value)}
                  className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm font-medium text-slate-600 focus:ring-2 focus:ring-blue-500 outline-none w-32"
                />

                <input 
                  type="text"
                  placeholder="Filter Fabric..."
                  value={filterFabric}
                  onChange={(e) => setFilterFabric(e.target.value)}
                  className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm font-medium text-slate-600 focus:ring-2 focus:ring-blue-500 outline-none w-32"
                />
              </div>
            </div>
            
            <button 
              onClick={handleDownloadPDF}
              disabled={isDownloading}
              className="flex items-center gap-2 bg-slate-800 hover:bg-slate-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50 whitespace-nowrap"
            >
              {isDownloading ? 'Generating PDF...' : 'Download PDF'}
            </button>
          </div>
      </div>

      {filteredMachines.length === 0 ? (
        <div className="text-center py-12 text-slate-400">
          <p>No machines found matching your filter.</p>
        </div>
      ) : (
      <div ref={scheduleRef} className="space-y-8">
      {filteredMachines.map((machine) => {
        try {
          const isWorking = machine.status === MachineStatus.WORKING;
          const dailyRate = machine.dayProduction > 0 ? machine.dayProduction : (machine.avgProduction || 1);
          const currentRemainingDays = isWorking && machine.remainingMfg > 0 ? Math.ceil(machine.remainingMfg / dailyRate) : 0;
          const currentEndDate = isWorking ? addDays(activeDay, currentRemainingDays) : '-';
          const isOther = machine.status === MachineStatus.OTHER;

          return (
            <div 
              key={machine.id} 
              id={`machine-schedule-card-${machine.id}`}
              data-machine-type={machine.type}
              className={`bg-white rounded-lg shadow-sm border border-slate-200 overflow-hidden ring-1 ring-black/5 transition-opacity ${draggedMachineId === machine.id ? 'opacity-50' : ''}`}
              draggable
              onDragStart={(e) => handleMachineDragStart(e, machine.id)}
              onDragOver={handleMachineDragOver}
              onDrop={(e) => handleMachineDrop(e, machine.id)}
            >
            <div className="bg-slate-800 px-4 sm:px-6 py-3 flex flex-col sm:flex-row justify-between sm:items-center text-white gap-2 sm:gap-0">
              <div className="flex items-center gap-3">
                  <span className="bg-slate-700/50 px-2 py-1 rounded text-xs font-mono text-slate-300 border border-slate-600">ID: {machine.id}</span>
                  <h3 className="font-bold text-lg tracking-wide">{machine.machineName}</h3>
              </div>
              <div className="flex items-center gap-4 text-sm font-medium text-slate-300">
                  <span className="uppercase tracking-wider text-xs">{machine.brand}</span>
                  <span className="w-1 h-1 bg-slate-500 rounded-full"></span>
                  <span className="uppercase tracking-wider text-xs">{machine.type}</span>
                  <div className="cursor-move p-1 hover:bg-slate-700 rounded" title="Drag to reorder">
                    <GripVertical size={20} className="text-slate-400" />
                  </div>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-center border-collapse text-sm">
                <thead className="bg-slate-50 text-slate-600 font-semibold border-b border-slate-200">
                  <tr>
                    <th className="py-3 px-2 border-r border-slate-100 w-10 text-slate-400 hidden md:table-cell">::</th>
                    <th className="py-3 px-2 border-r border-slate-100 w-28 hidden md:table-cell"><div className="flex flex-col"><span className="text-xs text-slate-500 uppercase tracking-wider">Start Date</span><span className="text-[10px] text-slate-400">تاريخ البدء</span></div></th>
                    <th className="py-3 px-2 border-r border-slate-100 w-28 hidden md:table-cell"><div className="flex flex-col"><span className="text-xs text-slate-500 uppercase tracking-wider">End Date</span><span className="text-[10px] text-slate-400">تاريخ الانتهاء</span></div></th>
                    <th className="py-3 px-2 border-r border-slate-100 w-24 hidden md:table-cell"><div className="flex flex-col"><span className="text-xs text-slate-500 uppercase tracking-wider">Orig. Machine</span><span className="text-[10px] text-slate-400">الاصل</span></div></th>
                    <th className="py-3 px-2 border-r border-slate-100 w-20 hidden md:table-cell"><div className="flex flex-col"><span className="text-xs text-slate-500 uppercase tracking-wider">Days</span><span className="text-[10px] text-slate-400">المدة</span></div></th>
                    <th className="py-3 px-2 border-r border-slate-100 w-24"><div className="flex flex-col"><span className="text-xs text-slate-500 uppercase tracking-wider">Client</span><span className="text-[10px] text-slate-400">العميل</span></div></th>
                    <th className="py-3 px-2 border-r border-slate-100 w-20 hidden md:table-cell"><div className="flex flex-col"><span className="text-xs text-slate-500 uppercase tracking-wider">Ref</span><span className="text-[10px] text-slate-400">المرجع</span></div></th>
                    <th className="py-3 px-2 border-r border-slate-100 w-20 hidden md:table-cell"><div className="flex flex-col"><span className="text-xs text-slate-500 uppercase tracking-wider">Remaining</span><span className="text-[10px] text-slate-400">متبقي</span></div></th>
                    <th className="py-3 px-2 border-r border-slate-100 w-20"><div className="flex flex-col"><span className="text-xs text-slate-500 uppercase tracking-wider">Qty</span><span className="text-[10px] text-slate-400">الكمية</span></div></th>
                    <th className="py-3 px-2 border-r border-slate-100 w-20 hidden md:table-cell"><div className="flex flex-col"><span className="text-xs text-slate-500 uppercase tracking-wider">Prod/Day</span><span className="text-[10px] text-slate-400">انتاج/يوم</span></div></th>
                    <th className="py-3 px-2 border-r border-slate-100"><div className="flex flex-col"><span className="text-xs text-slate-500 uppercase tracking-wider">Fabric / Notes</span><span className="text-[10px] text-slate-400">الخامة / ملاحظات</span></div></th>
                    <th className="py-3 px-2 w-10 text-slate-400 hidden md:table-cell">#</th>
                    <th className="py-3 px-2 w-20 text-slate-400">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {/* Current Machine Status Row */}
                  {isWorking ? (
                    <tr className="bg-emerald-50 border-b-2 border-emerald-100 relative group">
                      <td className="p-2 text-center align-middle hidden md:table-cell"><span className="flex items-center justify-center w-6 h-6 rounded-full bg-emerald-200 text-emerald-700 text-[10px] font-bold">Now</span></td>
                      <td className="p-2 text-xs font-bold text-emerald-800 align-middle hidden md:table-cell">{activeDay}</td>
                      <td className="p-2 text-xs font-bold text-emerald-800 align-middle hidden md:table-cell">{currentEndDate}</td>
                      <td className="p-2 text-center text-xs text-slate-400 align-middle hidden md:table-cell">-</td>
                      <td className="p-2 text-center align-middle hidden md:table-cell"><div className="text-emerald-700 text-xs font-bold bg-white/50 py-1 rounded border border-emerald-200 mx-auto w-12">{currentRemainingDays}</div></td>
                      <td className="p-2 text-center text-xs font-bold text-blue-600 align-middle">{machine.client}</td>
                      <td className="p-2 text-center text-xs font-mono text-slate-500 align-middle hidden md:table-cell">{machine.orderReference || '-'}</td>
                      <td className="p-2 text-center text-xs font-bold text-emerald-700 align-middle hidden md:table-cell">{machine.remainingMfg}</td>
                      <td className="p-2 text-center text-xs text-slate-500 align-middle">-</td>
                      <td className="p-2 text-center text-xs text-slate-600 align-middle hidden md:table-cell">{machine.dayProduction}</td>
                      <td className="p-2 text-right text-xs font-medium text-slate-800 align-middle dir-rtl"><div className="flex items-center justify-end gap-2"><span>{machine.material}</span><span className="px-2 py-0.5 bg-emerald-200 text-emerald-800 text-[9px] rounded-full uppercase font-bold tracking-wider">Active</span></div></td>
                      <td className="p-2 text-center text-[10px] text-slate-400 align-middle hidden md:table-cell">0</td>
                      <td className="p-2 text-center text-[10px] text-slate-400 italic align-middle">
                        <span className="hidden md:inline">Live</span>
                        <button 
                          onClick={() => setDetailsModal({ isOpen: true, machine, isCurrent: true })}
                          className="md:hidden px-2 py-1 bg-emerald-100 text-emerald-700 rounded text-[10px] font-bold"
                        >
                          More
                        </button>
                      </td>
                    </tr>
                  ) : (
                    <tr className={`${isOther ? 'bg-purple-50/50 border-purple-100' : 'bg-amber-50/50 border-amber-100'} border-b`}>
                      <td className="p-2 text-center align-middle hidden md:table-cell"><span className={`w-2 h-2 rounded-full inline-block ${isOther ? 'bg-purple-400' : 'bg-amber-400'}`}></span></td>
                      <td colSpan={12} className={`p-3 text-center text-sm font-medium ${isOther ? 'text-purple-700' : 'text-amber-700'}`}>
                         Machine Status: <span className="font-bold">{machine.status}</span> 
                         {isOther && machine.customStatusNote && <span className="block text-xs font-normal mt-1 italic">"{machine.customStatusNote}"</span>}
                         {!isOther && " — No Active Production"}
                      </td>
                    </tr>
                  )}

                  {machine.futurePlans && machine.futurePlans.map((plan, index) => {
                    const isSettings = plan.type === 'SETTINGS';
                    
                    // Look ahead logic for Settings rows
                    let nextContext = null;
                    if (isSettings && machine.futurePlans && index < machine.futurePlans.length - 1) {
                        nextContext = machine.futurePlans[index + 1];
                    }

                    return (
                      <tr 
                        key={index} 
                        className={`group transition-colors align-top ${isSettings ? 'bg-amber-50 hover:bg-amber-100' : 'hover:bg-blue-50/50'} ${draggedPlan?.index === index && draggedPlan.machineId === machine.id ? 'opacity-50' : ''}`}
                        draggable
                        onDragStart={(e) => handleDragStart(e, machine.id, index)}
                        onDragOver={handleDragOver}
                        onDrop={(e) => handleDrop(e, machine.id, index)}
                      >
                        <td className="p-2 text-slate-300 cursor-move hover:text-slate-500 drag-handle align-middle hidden md:table-cell">⠿</td>
                        <td className="p-2 text-xs font-medium text-slate-500 bg-slate-50/50 align-middle hidden md:table-cell">{plan.startDate || '-'}</td>
                        <td className="p-2 text-xs font-medium text-slate-500 bg-slate-50/50 align-middle hidden md:table-cell">{plan.endDate || '-'}</td>
                        <td className="p-1 align-middle hidden md:table-cell">
                          {!isSettings && (
                            <input 
                              type="text"
                              className="w-full text-center py-1.5 px-2 rounded hover:bg-white focus:bg-white focus:ring-1 focus:ring-blue-400 outline-none bg-transparent text-slate-600 text-xs"
                              value={plan.originalSampleMachine || ''}
                              onChange={(e) => handlePlanChange(machine, index, 'originalSampleMachine', e.target.value)}
                              placeholder="-"
                            />
                          )}
                        </td>
                        <td className="p-1 align-middle hidden md:table-cell">
                          {isSettings ? (
                             <input type="number" min="1" max="30" className="w-full text-center py-1.5 px-2 rounded bg-white border border-amber-200 focus:ring-1 focus:ring-amber-500 outline-none font-bold text-amber-700" value={plan.days} onChange={(e) => handlePlanChange(machine, index, 'days', Number(e.target.value))} />
                          ) : (
                             <div className="text-slate-400 text-xs bg-slate-50 py-1 rounded border border-slate-100 mx-auto w-12">{plan.days}</div>
                          )}
                        </td>
                        <td className="p-1 align-middle relative group">
                          {!isSettings && <SearchDropdown
                            id={`client-${machine.id}-${index}`}
                            options={clients}
                            value={plan.client || ''}
                            onChange={(val) => handlePlanChange(machine, index, 'client', val)}
                            onCreateNew={async (val) => {
                                await handleCreateItem('client', val);
                                handlePlanChange(machine, index, 'client', val);
                            }}
                            placeholder="-"
                            className="w-full text-center py-1.5 px-2 rounded hover:bg-white focus:bg-white focus:ring-1 focus:ring-blue-400 outline-none bg-transparent font-bold text-slate-700"
                          />}
                          
                          {/* Reference Code Tooltip */}
                          {!isSettings && plan.client && plan.fabric && (
                            <div className="hidden group-hover:block absolute bottom-full left-1/2 -translate-x-1/2 mb-1 px-2 py-1 bg-slate-800 text-white text-xs rounded shadow-lg z-20 whitespace-nowrap pointer-events-none">
                              {plan.client}-{plan.fabric}
                              <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-slate-800"></div>
                            </div>
                          )}
                        </td>
                        <td className="p-1 align-middle hidden md:table-cell">
                          {!isSettings && (
                            <input 
                              type="text"
                              className="w-full text-center py-1.5 px-2 rounded hover:bg-white focus:bg-white focus:ring-1 focus:ring-blue-400 outline-none bg-transparent text-slate-500 text-xs font-mono"
                              value={plan.orderReference || ''}
                              onChange={(e) => handlePlanChange(machine, index, 'orderReference', e.target.value)}
                              placeholder="-"
                              title="Order Reference (Auto-generated)"
                            />
                          )}
                        </td>
                        <td className="p-1 align-middle hidden md:table-cell">
                          {!isSettings && <input type="number" className="w-full text-center py-1.5 px-2 rounded hover:bg-white focus:bg-white focus:ring-1 focus:ring-blue-400 outline-none bg-transparent text-slate-600" value={plan.remaining} onChange={(e) => handlePlanChange(machine, index, 'remaining', Number(e.target.value))} />}
                        </td>
                        <td className="p-1 align-middle">
                          {!isSettings && <input type="number" className="w-full text-center py-1.5 px-2 rounded hover:bg-white focus:bg-white focus:ring-1 focus:ring-blue-400 outline-none bg-transparent text-slate-600 font-medium" value={plan.quantity} onChange={(e) => handlePlanChange(machine, index, 'quantity', Number(e.target.value))} />}
                        </td>
                        <td className="p-1 align-middle hidden md:table-cell">
                           {!isSettings && <input type="number" className="w-full text-center py-1.5 px-2 rounded hover:bg-white focus:bg-white focus:ring-1 focus:ring-blue-400 outline-none bg-transparent text-slate-600" value={plan.productionPerDay} onChange={(e) => handlePlanChange(machine, index, 'productionPerDay', Number(e.target.value))} />}
                        </td>
                        <td className="p-1 align-middle relative">
                          {isSettings ? (
                             <>
                                <textarea className="w-full text-left py-1.5 px-2 rounded bg-white border border-amber-200 focus:ring-1 focus:ring-amber-500 outline-none text-sm text-amber-800 resize-none overflow-hidden" rows={1} value={plan.notes || ''} onChange={(e) => handlePlanChange(machine, index, 'notes', e.target.value)} placeholder="Type settings note..." />
                                {nextContext && (
                                    <div className="text-[10px] text-amber-600/70 mt-1 flex items-center gap-1">
                                        <span>⮑ Next:</span>
                                        <span className="font-bold truncate max-w-[120px]">{nextContext.fabric || 'Unknown'}</span>
                                        {nextContext.orderName && <span className="opacity-75">({nextContext.orderName})</span>}
                                    </div>
                                )}
                             </>
                          ) : (
                             <SearchDropdown
                                id={`fabric-${machine.id}-${index}`}
                                options={fabrics}
                                value={plan.fabric || ''}
                                onChange={(val) => handlePlanChange(machine, index, 'fabric', val)}
                                onCreateNew={async (val) => {
                                    await handleCreateItem('fabric', val);
                                    handlePlanChange(machine, index, 'fabric', val);
                                }}
                                placeholder="-"
                                className="w-full text-right py-1.5 px-2 rounded hover:bg-white focus:bg-white focus:ring-1 focus:ring-blue-400 outline-none bg-transparent text-sm text-slate-700 leading-tight"
                                extraInfo={(opt) => {
                                   const clientName = plan.client;
                                   if (!clientName) return null;
                                   const order = customerOrders.find(o => o.customerName === clientName);
                                   const fabricInOrder = order?.fabrics.find(f => f.fabricName === opt.name);
                                   
                                   if (fabricInOrder) {
                                     return <span className="text-[10px] text-slate-400 ml-2">Rem: {fabricInOrder.remainingQuantity}kg</span>;
                                   }
                                   return null;
                                }}
                             />
                          )}
                        </td>
                        <td className="p-2 text-xs text-slate-300 font-mono align-middle hidden md:table-cell">{index + 1}</td>
                        <td className="p-1 align-middle">
                           <div className="flex items-center justify-center gap-1">
                              <button 
                                type="button"
                                onMouseDown={(e) => e.stopPropagation()} 
                                onClick={(e) => handleActivatePlan(e, machine, plan, index)}
                                className="p-1 text-slate-300 hover:text-emerald-500 hover:bg-emerald-50 rounded transition-colors"
                                title="Start Production"
                              >
                                <Play className="w-4 h-4" />
                              </button>
                              <button 
                              type="button"
                              onMouseDown={(e) => e.stopPropagation()} 
                              onClick={(e) => deletePlan(e, machine, index)}
                              className="p-1 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded transition-colors"
                              title="Delete Plan"
                              >
                              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                              </button>
                              <button 
                                onClick={() => setDetailsModal({ isOpen: true, machine, plan, isCurrent: false })}
                                className="md:hidden p-1 text-blue-500 hover:text-blue-700 transition-colors"
                              >
                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                </svg>
                              </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  
                  <tr>
                    <td colSpan={12} className="p-2 bg-slate-50 border-t border-slate-100">
                      <div className="flex flex-col sm:flex-row gap-2">
                        <button onClick={() => addPlan(machine, 'PRODUCTION')} className="flex-1 flex items-center justify-center gap-2 py-2 border border-dashed border-slate-300 rounded-lg text-slate-500 hover:text-blue-600 hover:border-blue-300 hover:bg-blue-50/50 transition-all text-xs font-medium">
                          + Add Production Plan
                        </button>
                        <button onClick={() => addPlan(machine, 'SETTINGS')} className="px-4 py-2 border border-dashed border-amber-300 rounded-lg text-amber-600 hover:text-amber-700 hover:bg-amber-50 hover:border-amber-400 transition-all text-xs font-medium">
                          + Add Settings
                        </button>
                        <button onClick={() => setSmartAddMachineId(machine.id)} className="flex items-center justify-center gap-2 px-4 py-2 border border-dashed border-indigo-200 rounded-lg text-indigo-500 hover:text-indigo-700 hover:bg-indigo-50 hover:border-indigo-300 transition-all text-xs font-medium bg-indigo-50/30">
                          Smart Add (AI)
                        </button>
                      </div>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        );
        } catch (err) {
          console.error('PlanningSchedule machine render error for machine', machine?.id ?? 'unknown', err);
          return (
            <div key={`error-${machine?.id ?? 'unknown'}`} className="p-4 text-red-600 bg-red-50 rounded">Error rendering machine {machine?.id ?? 'unknown'} — check console</div>
          );
        }
      })}
      </div>
      )}

      {detailsModal && detailsModal.isOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-sm overflow-hidden">
            <div className="bg-slate-50 px-4 py-3 border-b border-slate-200 flex justify-between items-center">
              <h3 className="font-bold text-slate-800">
                {detailsModal.machine.machineName} Details
              </h3>
              <button 
                onClick={() => setDetailsModal(null)}
                className="text-slate-400 hover:text-slate-600"
              >
                ✕
              </button>
            </div>
            
            <div className="p-4 space-y-4 max-h-[70vh] overflow-y-auto">
              {detailsModal.isCurrent ? (
                <>
                  <div>
                    <label className="block text-xs font-bold text-slate-500 mb-1">Start Date</label>
                    <div className="p-2 bg-slate-50 border border-slate-200 rounded text-sm">{activeDay}</div>
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-500 mb-1">End Date</label>
                    <div className="p-2 bg-slate-50 border border-slate-200 rounded text-sm">{detailsModal.machine.lastLogData?.endDate || '-'}</div>
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-500 mb-1">Remaining</label>
                    <div className="p-2 bg-slate-50 border border-slate-200 rounded text-sm">{detailsModal.machine.remainingMfg}</div>
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-500 mb-1">Ref</label>
                    <div className="p-2 bg-slate-50 border border-slate-200 rounded text-sm">{detailsModal.machine.orderReference || '-'}</div>
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-500 mb-1">Prod/Day</label>
                    <div className="p-2 bg-slate-50 border border-slate-200 rounded text-sm">{detailsModal.machine.dayProduction}</div>
                  </div>
                </>
              ) : (
                <>
                  <div>
                    <label className="block text-xs font-bold text-slate-500 mb-1">Start Date</label>
                    <div className="p-2 bg-slate-50 border border-slate-200 rounded text-sm">{detailsModal.plan.startDate || '-'}</div>
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-500 mb-1">End Date</label>
                    <div className="p-2 bg-slate-50 border border-slate-200 rounded text-sm">{detailsModal.plan.endDate || '-'}</div>
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-500 mb-1">Original Machine</label>
                    <div className="p-2 bg-slate-50 border border-slate-200 rounded text-sm">{detailsModal.plan.originalSampleMachine || '-'}</div>
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-500 mb-1">Days</label>
                    <div className="p-2 bg-slate-50 border border-slate-200 rounded text-sm">{detailsModal.plan.days}</div>
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-500 mb-1">Ref</label>
                    <div className="p-2 bg-slate-50 border border-slate-200 rounded text-sm">{detailsModal.plan.orderReference || '-'}</div>
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-500 mb-1">Remaining</label>
                    <div className="p-2 bg-slate-50 border border-slate-200 rounded text-sm">{detailsModal.plan.remaining}</div>
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-500 mb-1">Prod/Day</label>
                    <div className="p-2 bg-slate-50 border border-slate-200 rounded text-sm">{detailsModal.plan.productionPerDay}</div>
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-500 mb-1">Index</label>
                    <div className="p-2 bg-slate-50 border border-slate-200 rounded text-sm">{(detailsModal.machine.futurePlans?.indexOf(detailsModal.plan) || 0) + 1}</div>
                  </div>
                </>
              )}
            </div>

            <div className="bg-slate-50 px-4 py-3 border-t border-slate-200 flex justify-end">
              <button
                onClick={() => setDetailsModal(null)}
                className="px-4 py-2 bg-blue-600 text-white rounded font-medium text-sm"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {smartAddMachineId !== null && (
        <SmartPlanModal 
          onClose={() => setSmartAddMachineId(null)} 
          onSave={handleSmartPlanSave}
        />
      )}
    </div>
  );
};
