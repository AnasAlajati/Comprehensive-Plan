import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { MachineRow, PlanItem, MachineStatus } from '../types';
import { SmartPlanModal } from './SmartPlanModal';
import { recalculateSchedule, addDays } from '../services/data';
import { DataService } from '../services/dataService';
import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../services/firebase';
import { Search } from 'lucide-react';

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
  onCreateNew: () => void;
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
                  className="px-2 py-1.5 hover:bg-blue-50 cursor-pointer text-xs border-b border-slate-100 last:border-b-0 text-left"
                >
                  {opt.name}
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
type PlanningMachine = MachineRow & { machineSSId: string };

export const PlanningSchedule: React.FC<PlanningScheduleProps> = ({ onUpdate }) => {
  const [smartAddMachineId, setSmartAddMachineId] = useState<number | null>(null);
  const [draggedPlan, setDraggedPlan] = useState<{machineId: number, index: number} | null>(null);
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
        const [f, c] = await Promise.all([
          DataService.getFabrics(),
          DataService.getClients()
        ]);
        setFabrics(f);
        setClients(c);
      } catch (err) {
        console.error("Failed to load fabrics/clients", err);
      }
    };
    loadData();
  }, []);

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

  const handlePlanChange = (
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
      
      updated[planIndex] = plan;
      return updated;
    });
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

    if (filterType !== 'ALL') {
      if (filterType === 'All (Excl. BOUS)') {
        result = result.filter(m => m.type !== 'BOUS');
      } else {
        result = result.filter(m => m.type === filterType);
      }
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
    
    result.sort((a, b) => (a.id || 0) - (b.id || 0));

    return result;
  }, [machines, filterType, filterClient, filterFabric, searchTerm]);

  const handleDownloadPDF = async () => {
    if (!scheduleRef.current) return;
    setIsDownloading(true);

    try {
      const element = scheduleRef.current;
      
      const canvas = await html2canvas(element, {
        scale: 2,
        useCORS: true,
        backgroundColor: '#ffffff',
        windowWidth: element.scrollWidth + 100,
        onclone: (clonedDoc) => {
          // --- FIX: Sanitize OKLCH colors for html2canvas ---
          const ctx = document.createElement('canvas').getContext('2d');
          
          const safeColor = (c: string) => {
             if (!c || typeof c !== 'string') return c;
             if (!ctx) return c; 
             
             if (c.includes('oklch') || c.includes('lab(') || c.includes('lch(')) {
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

          try {
            if (ctx) {
              ctx.canvas.width = 1;
              ctx.canvas.height = 1;
              
              const allElements = clonedDoc.querySelectorAll('*');
              allElements.forEach((el) => {
                const style = (el as HTMLElement).style;
                const computed = getComputedStyle(el);
                
                if (computed.backgroundColor) style.backgroundColor = safeColor(computed.backgroundColor);
                if (computed.color) style.color = safeColor(computed.color);
                if (computed.borderColor) style.borderColor = safeColor(computed.borderColor);
                if (computed.outlineColor) style.outlineColor = safeColor(computed.outlineColor);
                
                if (computed.boxShadow && computed.boxShadow.includes('oklch')) {
                   style.boxShadow = 'none'; 
                }
              });
            }
          } catch (e) {
            console.error('Error in PDF color sanitization:', e);
          }
          // --------------------------------------------------

          // --- COMPACT LAYOUT ADJUSTMENTS ---
          // Reduce padding in table cells
          const cells = clonedDoc.querySelectorAll('th, td');
          cells.forEach((cell) => {
            (cell as HTMLElement).style.padding = '4px'; // Reduced padding
            (cell as HTMLElement).style.fontSize = '10px'; // Smaller font
          });
          // ----------------------------------

          // Remove Actions column (last th/td in each row)
          const rows = clonedDoc.querySelectorAll('tr');
          rows.forEach(row => {
            if (row.lastElementChild) {
              (row.lastElementChild as HTMLElement).style.display = 'none';
            }
          });

          // Hide buttons and drag handles
          const toHide = clonedDoc.querySelectorAll('button, .drag-handle, .no-print');
          toHide.forEach(el => (el as HTMLElement).style.display = 'none');

          // Replace inputs with text
          const inputs = clonedDoc.querySelectorAll('input, textarea, select');
          inputs.forEach((input: any) => {
            const span = clonedDoc.createElement('span');
            span.textContent = input.value;
            span.className = input.className;
            span.style.border = 'none';
            span.style.background = 'transparent';
            span.style.textAlign = 'center';
            span.style.padding = '0';
            span.style.margin = '0';
            span.style.display = 'inline-block';
            
            // Preserve font styles
            const computed = getComputedStyle(input);
            span.style.fontSize = 'inherit'; // Inherit from parent (which we set to 10px)
            span.style.fontWeight = computed.fontWeight;
            span.style.color = safeColor(computed.color);

            if (input.tagName === 'TEXTAREA') {
                span.style.whiteSpace = 'pre-wrap';
            }
            if(input.parentNode) input.parentNode.replaceChild(span, input);
          });
          
          // Ensure full width
          const scrollables = clonedDoc.querySelectorAll('.overflow-x-auto');
          scrollables.forEach(el => {
             (el as HTMLElement).style.overflow = 'visible';
             (el as HTMLElement).style.display = 'block';
             (el as HTMLElement).style.width = 'fit-content';
          });
        }
      });

      const pdf = new jsPDF('l', 'mm', 'a4');
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const margin = 5; // Reduced margin
      const maxContentWidth = pageWidth - (margin * 2);
      const maxContentHeight = pageHeight - (margin * 2);

      const imgWidth = canvas.width;
      const imgHeight = canvas.height;
      
      // Calculate scale to fit width
      let pdfContentWidth = maxContentWidth;
      let pdfContentHeight = (imgHeight * maxContentWidth) / imgWidth;

      // Enforce 1 page constraint
      // If height exceeds page height, scale down to fit height
      if (pdfContentHeight > maxContentHeight) {
        const scaleFactor = maxContentHeight / pdfContentHeight;
        pdfContentWidth = pdfContentWidth * scaleFactor;
        pdfContentHeight = maxContentHeight;
      }

      // Center horizontally and vertically
      const x = margin + (maxContentWidth - pdfContentWidth) / 2;
      const y = margin + (maxContentHeight - pdfContentHeight) / 2;
      
      pdf.addImage(canvas.toDataURL('image/png'), 'PNG', x, y, pdfContentWidth, pdfContentHeight);
      
      pdf.save('production-schedule.pdf');
    } catch (err) {
      console.error("PDF Error:", err);
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
                  className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm font-medium text-slate-600 focus:ring-2 focus:ring-blue-500 outline-none"
                >
                  {availableTypes.map(type => (
                    <option key={type} value={type}>{type === 'ALL' ? 'Type: All' : type}</option>
                  ))}
                </select>

                <select 
                  value={filterClient}
                  onChange={(e) => setFilterClient(e.target.value)}
                  className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm font-medium text-slate-600 focus:ring-2 focus:ring-blue-500 outline-none"
                >
                  <option value="">All Clients</option>
                  {uniqueClients.map(c => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>

                <select 
                  value={filterFabric}
                  onChange={(e) => setFilterFabric(e.target.value)}
                  className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm font-medium text-slate-600 focus:ring-2 focus:ring-blue-500 outline-none"
                >
                  <option value="">All Fabrics</option>
                  {uniqueFabrics.map(f => (
                    <option key={f} value={f}>{f}</option>
                  ))}
                </select>
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
              className="bg-white rounded-lg shadow-sm border border-slate-200 overflow-hidden ring-1 ring-black/5"
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
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-center border-collapse text-sm min-w-[800px]">
                <thead className="bg-slate-50 text-slate-600 font-semibold border-b border-slate-200">
                  <tr>
                    <th className="py-3 px-2 border-r border-slate-100 w-10 text-slate-400">::</th>
                    <th className="py-3 px-2 border-r border-slate-100 w-28"><div className="flex flex-col"><span className="text-xs text-slate-500 uppercase tracking-wider">Start Date</span><span className="text-[10px] text-slate-400">تاريخ البدء</span></div></th>
                    <th className="py-3 px-2 border-r border-slate-100 w-24"><div className="flex flex-col"><span className="text-xs text-slate-500 uppercase tracking-wider">Orig. Machine</span><span className="text-[10px] text-slate-400">الاصل</span></div></th>
                    <th className="py-3 px-2 border-r border-slate-100 w-20"><div className="flex flex-col"><span className="text-xs text-slate-500 uppercase tracking-wider">Days</span><span className="text-[10px] text-slate-400">المدة</span></div></th>
                    <th className="py-3 px-2 border-r border-slate-100 w-24"><div className="flex flex-col"><span className="text-xs text-slate-500 uppercase tracking-wider">Client</span><span className="text-[10px] text-slate-400">العميل</span></div></th>
                    <th className="py-3 px-2 border-r border-slate-100 w-24"><div className="flex flex-col"><span className="text-xs text-slate-500 uppercase tracking-wider">Order</span><span className="text-[10px] text-slate-400">الطلبية</span></div></th>
                    <th className="py-3 px-2 border-r border-slate-100 w-20"><div className="flex flex-col"><span className="text-xs text-slate-500 uppercase tracking-wider">Remaining</span><span className="text-[10px] text-slate-400">متبقي</span></div></th>
                    <th className="py-3 px-2 border-r border-slate-100 w-20"><div className="flex flex-col"><span className="text-xs text-slate-500 uppercase tracking-wider">Remaining</span><span className="text-[10px] text-slate-400">متبقي</span></div></th>
                    <th className="py-3 px-2 border-r border-slate-100 w-20"><div className="flex flex-col"><span className="text-xs text-slate-500 uppercase tracking-wider">Qty</span><span className="text-[10px] text-slate-400">الكمية</span></div></th>
                    <th className="py-3 px-2 border-r border-slate-100 w-20"><div className="flex flex-col"><span className="text-xs text-slate-500 uppercase tracking-wider">Prod/Day</span><span className="text-[10px] text-slate-400">انتاج/يوم</span></div></th>
                    <th className="py-3 px-2 border-r border-slate-100"><div className="flex flex-col"><span className="text-xs text-slate-500 uppercase tracking-wider">Fabric / Notes</span><span className="text-[10px] text-slate-400">الخامة / ملاحظات</span></div></th>
                    <th className="py-3 px-2 w-10 text-slate-400">#</th>
                    <th className="py-3 px-2 w-20 text-slate-400">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {/* Current Machine Status Row */}
                  {isWorking ? (
                    <tr className="bg-emerald-50 border-b-2 border-emerald-100 relative group">
                      <td className="p-2 text-center align-middle"><span className="flex items-center justify-center w-6 h-6 rounded-full bg-emerald-200 text-emerald-700 text-[10px] font-bold">Now</span></td>
                      <td className="p-2 text-xs font-bold text-emerald-800 align-middle">{activeDay}</td>
                      <td className="p-2 text-xs font-bold text-emerald-800 align-middle">{currentEndDate}</td>
                      <td className="p-2 text-center text-xs text-slate-400 align-middle">-</td>
                      <td className="p-2 text-center align-middle"><div className="text-emerald-700 text-xs font-bold bg-white/50 py-1 rounded border border-emerald-200 mx-auto w-12">{currentRemainingDays}</div></td>
                      <td className="p-2 text-center text-xs font-bold text-blue-600 align-middle">{machine.client}</td>
                      <td className="p-2 text-center text-xs font-bold text-emerald-700 align-middle">{machine.remainingMfg}</td>
                      <td className="p-2 text-center text-xs text-slate-500 align-middle">-</td>
                      <td className="p-2 text-center text-xs text-slate-600 align-middle">{machine.dayProduction}</td>
                      <td className="p-2 text-right text-xs font-medium text-slate-800 align-middle dir-rtl"><div className="flex items-center justify-end gap-2"><span>{machine.material}</span><span className="px-2 py-0.5 bg-emerald-200 text-emerald-800 text-[9px] rounded-full uppercase font-bold tracking-wider">Active</span></div></td>
                      <td className="p-2 text-center text-[10px] text-slate-400 align-middle">0</td>
                      <td className="p-2 text-center text-[10px] text-slate-400 italic align-middle">Live</td>
                    </tr>
                  ) : (
                    <tr className={`${isOther ? 'bg-purple-50/50 border-purple-100' : 'bg-amber-50/50 border-amber-100'} border-b`}>
                      <td className="p-2 text-center align-middle"><span className={`w-2 h-2 rounded-full inline-block ${isOther ? 'bg-purple-400' : 'bg-amber-400'}`}></span></td>
                      <td colSpan={11} className={`p-3 text-center text-sm font-medium ${isOther ? 'text-purple-700' : 'text-amber-700'}`}>
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
                        <td className="p-2 text-slate-300 cursor-move hover:text-slate-500 drag-handle align-middle">⠿</td>
                        <td className="p-2 text-xs font-medium text-slate-500 bg-slate-50/50 align-middle">{plan.startDate || '-'}</td>
                        <td className="p-2 text-xs font-medium text-slate-500 bg-slate-50/50 align-middle">{plan.endDate || '-'}</td>
                        <td className="p-1 align-middle">
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
                        <td className="p-1 align-middle">
                          {isSettings ? (
                             <input type="number" min="1" max="30" className="w-full text-center py-1.5 px-2 rounded bg-white border border-amber-200 focus:ring-1 focus:ring-amber-500 outline-none font-bold text-amber-700" value={plan.days} onChange={(e) => handlePlanChange(machine, index, 'days', Number(e.target.value))} />
                          ) : (
                             <div className="text-slate-400 text-xs bg-slate-50 py-1 rounded border border-slate-100 mx-auto w-12">{plan.days}</div>
                          )}
                        </td>
                        <td className="p-1 align-middle">
                          {!isSettings && <SearchDropdown
                            id={`client-${machine.id}-${index}`}
                            options={clients}
                            value={plan.client || ''}
                            onChange={(val) => handlePlanChange(machine, index, 'client', val)}
                            onCreateNew={() => handleCreateItem('client', plan.client || '')}
                            placeholder="-"
                            className="w-full text-center py-1.5 px-2 rounded hover:bg-white focus:bg-white focus:ring-1 focus:ring-blue-400 outline-none bg-transparent font-bold text-slate-700"
                          />}
                        </td>
                        <td className="p-1 align-middle">
                          {!isSettings && <input type="text" className="w-full text-center py-1.5 px-2 rounded hover:bg-white focus:bg-white focus:ring-1 focus:ring-blue-400 outline-none bg-transparent font-bold text-blue-600" value={plan.orderName || ''} onChange={(e) => handlePlanChange(machine, index, 'orderName', e.target.value)} placeholder="-" />}
                        </td>
                        <td className="p-1 align-middle">
                          {!isSettings && <input type="number" className="w-full text-center py-1.5 px-2 rounded hover:bg-white focus:bg-white focus:ring-1 focus:ring-blue-400 outline-none bg-transparent text-slate-600" value={plan.remaining} onChange={(e) => handlePlanChange(machine, index, 'remaining', Number(e.target.value))} />}
                        </td>
                        <td className="p-1 align-middle">
                          {!isSettings && <input type="number" className="w-full text-center py-1.5 px-2 rounded hover:bg-white focus:bg-white focus:ring-1 focus:ring-blue-400 outline-none bg-transparent text-slate-600 font-medium" value={plan.quantity} onChange={(e) => handlePlanChange(machine, index, 'quantity', Number(e.target.value))} />}
                        </td>
                        <td className="p-1 align-middle">
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
                                onCreateNew={() => handleCreateItem('fabric', plan.fabric || '')}
                                placeholder="-"
                                className="w-full text-right py-1.5 px-2 rounded hover:bg-white focus:bg-white focus:ring-1 focus:ring-blue-400 outline-none bg-transparent text-sm text-slate-700 leading-tight"
                             />
                          )}
                        </td>
                        <td className="p-2 text-xs text-slate-300 font-mono align-middle">{index + 1}</td>
                        <td className="p-1 align-middle">
                           <div className="flex items-center justify-center gap-1">
                              <button 
                              type="button"
                              onMouseDown={(e) => e.stopPropagation()} 
                              onClick={(e) => deletePlan(e, machine, index)}
                              className="p-1 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded transition-colors"
                              title="Delete Plan"
                              >
                              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
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

      {smartAddMachineId !== null && (
        <SmartPlanModal 
          onClose={() => setSmartAddMachineId(null)} 
          onSave={handleSmartPlanSave}
        />
      )}
    </div>
  );
};
