import React, { useState, useEffect, useCallback, useRef } from 'react';
import { writeBatch, doc, getDoc } from 'firebase/firestore';
import { db } from '../services/firebase';
import { DataService } from '../services/dataService';
import { TelegramService } from '../services/telegramService';
import { PlanItem, MachineStatus, CustomerOrder, MachineRow } from '../types';
import { LinkOrderModal } from './LinkOrderModal';
import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';
import { CheckCircle, Send, Link } from 'lucide-react';

// Navigable fields across the whole row (including read-only) for smooth Excel-like movement
const NAVIGABLE_FIELDS: (keyof any)[] = [
  'machineBrand', 'machineType', 'machineName',
  'status', 'avgProduction', 'dayProduction', 'difference',
  'fabric', 'client', 'remainingMfg', 'scrap', 'reason',
  'endDate', 'plans'
];

// Helper function to calculate end date based on remaining quantity and daily production
const calculateEndDate = (logDate: string, remaining: number, dayProduction: number): string => {
  if (!dayProduction || dayProduction <= 0 || !remaining || remaining <= 0) return '-';
  const daysNeeded = Math.ceil(remaining / dayProduction);
  const startDate = new Date(logDate);
  startDate.setDate(startDate.getDate() + daysNeeded);
  return startDate.toLocaleDateString('ar-EG', { year: 'numeric', month: 'short', day: 'numeric' });
};

// Helper function to calculate plan end date based on start date and remaining/production
const calculatePlanEndDate = (startDate: string, remaining: number, productionPerDay: number): string => {
  if (!productionPerDay || productionPerDay <= 0 || !remaining || remaining <= 0 || !startDate) return '';
  const daysNeeded = Math.ceil(remaining / productionPerDay);
  const start = new Date(startDate);
  start.setDate(start.getDate() + daysNeeded);
  return start.toISOString().split('T')[0];
};

const STATUS_LABELS: Record<MachineStatus, string> = {
  [MachineStatus.WORKING]: 'تعمل',
  [MachineStatus.UNDER_OP]: 'تحت التشغيل',
  [MachineStatus.NO_ORDER]: 'متوقفة',
  [MachineStatus.OUT_OF_SERVICE]: 'خارج الخدمة',
  [MachineStatus.QALB]: 'قلب',
  [MachineStatus.OTHER]: 'Other'
};

const STATUS_COLOR_MAP: Record<MachineStatus, string> = {
  [MachineStatus.WORKING]: 'bg-emerald-50 text-emerald-900',
  [MachineStatus.UNDER_OP]: 'bg-amber-50 text-amber-900',
  [MachineStatus.NO_ORDER]: 'bg-slate-100 text-slate-500',
  [MachineStatus.OUT_OF_SERVICE]: 'bg-red-50 text-red-900',
  [MachineStatus.QALB]: 'bg-purple-100 text-purple-900',
  [MachineStatus.OTHER]: 'bg-pink-50 text-pink-900'
};

const ARABIC_STATUS_MAP: Record<string, MachineStatus> = {
  'تعمل': MachineStatus.WORKING,
  'تشغيل': MachineStatus.WORKING,
  'تحت التشغيل': MachineStatus.UNDER_OP,
  'متوقفة': MachineStatus.NO_ORDER,
  'خارج الخدمة': MachineStatus.OUT_OF_SERVICE,
  'صيانة': MachineStatus.OUT_OF_SERVICE,
  'قلب': MachineStatus.QALB,
  'other': MachineStatus.OTHER,
  'اخرى': MachineStatus.OTHER
};

const getStatusLabel = (status: MachineStatus) => STATUS_LABELS[status] || status;
const getStatusColor = (status: MachineStatus) => STATUS_COLOR_MAP[status] || 'bg-white';

const normalizeStatusValue = (value?: string): MachineStatus => {
  if (!value) return MachineStatus.NO_ORDER;
  const trimmed = value.trim();
  const direct = (Object.values(MachineStatus) as string[]).find(opt => opt.toLowerCase() === trimmed.toLowerCase());
  if (direct) {
    return direct as MachineStatus;
  }
  const arabicMatch = ARABIC_STATUS_MAP[trimmed];
  if (arabicMatch) {
    return arabicMatch;
  }
  return MachineStatus.OTHER;
};

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
        className="w-full px-1 py-0 text-xs outline-none bg-transparent"
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
                  className="px-2 py-1.5 hover:bg-blue-50 cursor-pointer text-xs border-b border-slate-100 last:border-b-0"
                >
                  {opt.name}
                </div>
              ))}
              {searchTerm && !options.some(o => o.name.toLowerCase() === searchTerm.toLowerCase()) && (
                <div
                  onClick={handleCreateNew}
                  className="px-2 py-1.5 hover:bg-emerald-50 cursor-pointer text-xs border-t border-slate-200 text-emerald-600 font-medium"
                >
                  + اضافة "{inputValue}"
                </div>
              )}
            </>
          ) : searchTerm ? (
            <div
              onClick={handleCreateNew}
              className="px-2 py-1.5 hover:bg-emerald-50 cursor-pointer text-xs text-emerald-600 font-medium"
            >
              + اضافة "{inputValue}"
            </div>
          ) : (
            <div className="px-2 py-1.5 text-xs text-slate-400">لا يوجد</div>
          )}
        </div>
      )}
    </div>
  );
};

interface FetchDataPageProps {
  selectedDate?: string;
  machines?: any[];
}

const FetchDataPage: React.FC<FetchDataPageProps> = ({ 
  selectedDate: propSelectedDate,
  machines = []
}) => {
  const [selectedDate, setSelectedDate] = useState<string>(propSelectedDate || new Date().toISOString().split('T')[0]);
  const [activeDay, setActiveDay] = useState<string>('');
  const [isDownloading, setIsDownloading] = useState(false);
  const [isSendingReport, setIsSendingReport] = useState(false);
  const [isReportSent, setIsReportSent] = useState(false);
  const printRef = useRef<HTMLDivElement>(null);

  const handleSendReport = async () => {
    if (isReportSent) return; // Prevent double send if already sent

    if (!activeDay) {
      alert("⚠️ Please mark an Active Day first before sending the report.");
      return;
    }

    if (selectedDate !== activeDay) {
      if (!window.confirm(`⚠️ You are viewing ${selectedDate}, but the Active Day is ${activeDay}.\n\nDo you want to send the report for ${selectedDate}?`)) {
        return;
      }
    }

    setIsSendingReport(true);
    try {
      const lowStockMachines = machines.filter(m => 
        m.status === 'Working' && 
        m.remainingMfg < 100 && 
        m.remainingMfg > 0
      );

      const finishedMachines = machines.filter(m => 
        (Number(m.remainingMfg) || 0) === 0 && 
        (Number(m.dayProduction) || 0) > 0
      );

      const date = new Date().toLocaleDateString('en-GB');
      let message = `📅 <b>تقرير الإنتاج اليومي: ${date}</b>\n\n`;

      // Section 1: Finished Machines
      if (finishedMachines.length > 0) {
        message += `🏁 <b>ماكينات انتهت اليوم:</b>\n`;
        finishedMachines.forEach((m, idx) => {
           // Use m.material (mapped from App.tsx) or fallback to m.fabric if available
           const fabricName = m.material || m.fabric || 'غير معروف';
           message += `${idx + 1}. <b>${m.machineName}</b> (${fabricName})\n`;
           
           const hasPlans = m.futurePlans && m.futurePlans.length > 0;
           if (hasPlans) {
             const nextPlan = m.futurePlans[0];
             message += `   ↳ 📅 التالي: ${nextPlan.fabric} (${nextPlan.client})\n`;
           } else {
             message += `   ↳ 🛑 لا توجد خطط مستقبلية.\n`;
           }
        });
        message += `\n`;
      }

      // Section 2: Low Stock
      if (lowStockMachines.length > 0) {
        message += `⚠️ <b>تنبيهات انخفاض المخزون (&lt;100kg):</b>\n`;
        
        lowStockMachines.forEach((m, idx) => {
          message += `${idx + 1}. <b>${m.machineName}</b> (متبقي: ${m.remainingMfg} كجم)\n`;
          
          const hasPlans = m.futurePlans && m.futurePlans.length > 0;
          if (hasPlans) {
            const nextPlan = m.futurePlans[0];
            message += `   ↳ 📅 التالي: ${nextPlan.fabric} (${nextPlan.client})\n`;
          } else {
            message += `   ↳ 🛑 لا توجد خطط مستقبلية.\n`;
          }
          message += `\n`;
        });
      }

      if (lowStockMachines.length === 0 && finishedMachines.length === 0) {
        message += `✅ <b>الوضع تمام!</b>\nلا توجد تنبيهات مخزون منخفض أو ماكينات انتهت.`;
      }

      await TelegramService.send(message);
      setIsReportSent(true);
      // alert("Report sent to Telegram successfully!"); // Removed alert to be less intrusive

    } catch (error) {
      console.error("Failed to send report:", error);
      alert("Failed to send report.");
    } finally {
      setIsSendingReport(false);
    }
  };
  
  // Filter State
  const [searchTerm, setSearchTerm] = useState('');
  const [filterClient, setFilterClient] = useState('');
  const [filterFabric, setFilterFabric] = useState('');
  const [filterType, setFilterType] = useState('ALL');

  const [allLogs, setAllLogs] = useState<any[]>([]);
  const [filteredLogs, setFilteredLogs] = useState<any[]>([]);

  const availableTypes = React.useMemo(() => {
    const types = new Set(allLogs.map(m => m.machineType));
    return ['ALL', ...Array.from(types).filter(Boolean).sort()];
  }, [allLogs]);
  const [fabrics, setFabrics] = useState<any[]>([]);
  const [clients, setClients] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [fetchTime, setFetchTime] = useState<number>(0);
  const [inlineCreateModal, setInlineCreateModal] = useState<{ type: 'fabric' | 'client' | null; isOpen: boolean; machineId: string; logId: string; newName?: string }>({ type: null, isOpen: false, machineId: '', logId: '' });
  const [inlineCreateForm, setInlineCreateForm] = useState({ name: '' });
  const [linkModalOpen, setLinkModalOpen] = useState<{ isOpen: boolean; machine: MachineRow | null }>({ isOpen: false, machine: null });
  const [plansModalOpen, setPlansModalOpen] = useState<{ isOpen: boolean; machineId: string; machineName: string; plans: PlanItem[] }>({ isOpen: false, machineId: '', machineName: '', plans: [] });
  const [addPlanModal, setAddPlanModal] = useState<{ isOpen: boolean; type: 'PRODUCTION' | 'SETTINGS' }>({ isOpen: false, type: 'PRODUCTION' });
  const [detailsModal, setDetailsModal] = useState<{ isOpen: boolean; log: any; index: number } | null>(null);
  const [newPlan, setNewPlan] = useState<Partial<PlanItem>>({
    type: 'PRODUCTION',
    fabric: '',
    productionPerDay: 0,
    quantity: 0,
    days: 0,
    startDate: new Date().toISOString().split('T')[0],
    endDate: new Date().toISOString().split('T')[0],
    remaining: 0,
    orderName: '',
    originalSampleMachine: '',
    notes: ''
  });
  const [inlineNewPlan, setInlineNewPlan] = useState<Partial<PlanItem>>({
    type: 'PRODUCTION',
    fabric: '',
    productionPerDay: 0,
    quantity: 0,
    days: 0,
    startDate: '',
    endDate: '',
    remaining: 0,
    orderName: '',
    originalSampleMachine: '',
    notes: ''
  });
  const [showInlineAddRow, setShowInlineAddRow] = useState(false);
  const [activeCell, setActiveCell] = useState<{ rowIndex: number; field: string } | null>(null);
  const [draggedRowIndex, setDraggedRowIndex] = useState<number | null>(null);
  const [externalProduction, setExternalProduction] = useState<number>(0);

  // Sync with propSelectedDate if it changes (e.g. from global app state)
  useEffect(() => {
    if (propSelectedDate && propSelectedDate !== selectedDate) {
      setSelectedDate(propSelectedDate);
    }
  }, [propSelectedDate]);

  // Fetch active day on mount
  useEffect(() => {
    const fetchActiveDay = async () => {
      try {
        const settingsDoc = await getDoc(doc(db, 'settings', 'global'));
        if (settingsDoc.exists()) {
          const data = settingsDoc.data();
          if (data.activeDay) {
            setActiveDay(data.activeDay);
            setSelectedDate(data.activeDay);
          }
        }
      } catch (error) {
        console.error("Error fetching active day:", error);
      }
    };
    fetchActiveDay();
  }, []);

  // Load machines, fabrics, and clients on mount
  useEffect(() => {
    loadFabricsAndClients();
    handleFetchLogs(selectedDate);
  }, [selectedDate]);

  // Filter logs when searchTerm or allLogs changes
  useEffect(() => {
    let filtered = [...allLogs];

    if (filterType !== 'ALL' && filterType.trim()) {
      const lowerType = filterType.toLowerCase();
      filtered = filtered.filter(log => log.machineType && log.machineType.toLowerCase().includes(lowerType));
    }

    if (filterClient.trim()) {
      const lowerClient = filterClient.toLowerCase();
      filtered = filtered.filter(log => log.client && log.client.toLowerCase().includes(lowerClient));
    }

    if (filterFabric.trim()) {
      const lowerFabric = filterFabric.toLowerCase();
      filtered = filtered.filter(log => log.fabric && log.fabric.toLowerCase().includes(lowerFabric));
    }

    if (searchTerm.trim()) {
      const lowerTerm = searchTerm.toLowerCase();
      filtered = filtered.filter(log => 
        (log.machineName && log.machineName.toLowerCase().includes(lowerTerm)) ||
        (log.machineBrand && log.machineBrand.toLowerCase().includes(lowerTerm)) ||
        (log.machineType && log.machineType.toLowerCase().includes(lowerTerm))
      );
    }
    setFilteredLogs(filtered);
  }, [searchTerm, filterClient, filterFabric, allLogs]);

  const handleMarkActiveDay = async () => {
    try {
      await DataService.updateGlobalSettings({ activeDay: selectedDate });
      setActiveDay(selectedDate);
      showMessage(`✅ Active Day set to ${selectedDate}`);
    } catch (error: any) {
      console.error("Error setting active day:", error);
      showMessage('❌ Failed to set active day', true);
    }
  };

  const handleFetchFromPreviousDay = async () => {
    const dateObj = new Date(selectedDate);
    dateObj.setDate(dateObj.getDate() - 1);
    const previousDate = dateObj.toISOString().split('T')[0];

    if (!window.confirm(`Fetch data from ${previousDate}? This will update the Remaining Quantity based on yesterday's production.`)) {
      return;
    }

    setLoading(true);
    try {
      const machines = await DataService.getMachinesFromMachineSS();
      const updatePromises: Promise<void>[] = [];
      let updatedCount = 0;

      for (const machine of machines) {
        const prevLog = (machine.dailyLogs || []).find((l: any) => l.date === previousDate);
        
        // Only update if we have previous data to carry over
        if (prevLog) {
           const currentLogs = machine.dailyLogs || [];
           const existingLogIndex = currentLogs.findIndex((l: any) => l.date === selectedDate);
           
           // Calculate new remaining: Yesterday's Remaining (Opening Balance for Today)
           const prevRemaining = Number(prevLog.remainingMfg) || 0;
           // We don't subtract prevProd here because prevRemaining is already the closing balance of yesterday (which is opening of today)
           // OR if prevRemaining was opening of yesterday, then we should subtract.
           // Based on user request "yesterdays remaining - daily production = todays remaining", 
           // it implies Yesterday's Remaining is the BASE.
           // Let's assume Fetch Yesterday just carries over the remaining quantity as the starting point.
           const newRemaining = prevRemaining; 

           const newLogEntry = {
             id: selectedDate,
             date: selectedDate,
             dayProduction: 0, // Reset
             scrap: 0, // Reset
             reason: '', // Reset
             status: prevLog.status, // Copy
             fabric: prevLog.fabric, // Copy
             client: prevLog.client, // Copy
             avgProduction: prevLog.avgProduction || machine.avgProduction || 0, // Copy
             remainingMfg: newRemaining, // Calculated
             customStatusNote: prevLog.customStatusNote || '', // Copy
             timestamp: new Date().toISOString()
           };

           const updatedLogs = [...currentLogs];
           if (existingLogIndex >= 0) {
             // Merge with existing, but overwrite the fetched fields
             updatedLogs[existingLogIndex] = { ...updatedLogs[existingLogIndex], ...newLogEntry };
           } else {
             updatedLogs.push(newLogEntry);
           }

           // Update the machine
           updatePromises.push(DataService.updateMachineInMachineSS(String(machine.id), {
             dailyLogs: updatedLogs,
             lastLogDate: selectedDate,
             avgProduction: newLogEntry.avgProduction,
             lastLogData: {
                date: selectedDate,
                dayProduction: newLogEntry.dayProduction,
                scrap: newLogEntry.scrap,
                status: newLogEntry.status,
                fabric: newLogEntry.fabric,
                client: newLogEntry.client,
                remainingMfg: newLogEntry.remainingMfg,
                reason: newLogEntry.reason,
                customStatusNote: newLogEntry.customStatusNote
             },
             lastUpdated: new Date().toISOString()
           }));
           updatedCount++;
        }
      }

      await Promise.all(updatePromises);
      await handleFetchLogs(selectedDate);
      showMessage(`✅ Fetched data for ${updatedCount} machines from ${previousDate}`);

    } catch (error: any) {
      console.error("Error fetching previous data:", error);
      showMessage('❌ Error fetching previous data', true);
    }
    setLoading(false);
  };

  const handleDragStart = (e: React.DragEvent, index: number) => {
    const target = e.target as HTMLElement;
    // Prevent drag if interacting with inputs
    if (['INPUT', 'SELECT', 'BUTTON', 'TEXTAREA'].includes(target.tagName)) {
      e.preventDefault();
      return;
    }
    setDraggedRowIndex(index);
    e.dataTransfer.effectAllowed = "move";
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  };

  const handleDrop = async (e: React.DragEvent, targetIndex: number) => {
    e.preventDefault();
    if (draggedRowIndex === null || draggedRowIndex === targetIndex) return;

    // Note: Drag and drop only works on the filtered view currently
    const newLogs = [...filteredLogs];
    const [draggedItem] = newLogs.splice(draggedRowIndex, 1);
    newLogs.splice(targetIndex, 0, draggedItem);

    setFilteredLogs(newLogs);
    // Also update main list order if possible, or just refresh
    // For simplicity in filtered view, we just update the order in DB
    setDraggedRowIndex(null);

    try {
      const batch = writeBatch(db);
      newLogs.forEach((log, index) => {
        const ref = doc(db, 'MachineSS', String(log.machineId));
        batch.update(ref, { orderIndex: index });
      });
      await batch.commit();
      showMessage('✅ Order updated');
    } catch (error: any) {
      console.error("Error updating order:", error);
      showMessage('❌ Error updating order', true);
    }
  };

  const [customerOrders, setCustomerOrders] = useState<any[]>([]);

  const loadFabricsAndClients = async () => {
    try {
      const [fabricsData, clientsData, ordersData] = await Promise.all([
        DataService.getFabrics(),
        DataService.getClients(),
        DataService.getCustomerOrders()
      ]);
      setFabrics(fabricsData);
      setClients(clientsData);
      setCustomerOrders(ordersData);
    } catch (error) {
      console.error('Error loading fabrics and clients:', error);
    }
  };

  // Smart Linker: Check if Client+Fabric matches an existing Order Reference
  const checkSmartLink = async (machineId: string, logId: string, client: string, fabric: string) => {
    if (!client || !fabric) return;

    // Find existing order
    const order = customerOrders.find(o => o.customerName === client);
    if (order) {
      const fabricEntry = order.fabrics.find((f: any) => f.fabricName === fabric);
      if (fabricEntry && fabricEntry.orderReference) {
        // Found a match! Auto-link it.
        // We don't need to ask the user if it's an exact match, just link it.
        // But if we want to be "Excel-like", we just do it silently or show a toast.
        console.log(`Auto-linking to ${fabricEntry.orderReference}`);
        // Update the log with this reference (if we had a field for it)
        // For now, we just ensure the order exists in OrderSS
      } else if (!fabricEntry) {
        // Client exists, Fabric doesn't. Auto-create?
        // User said: "be able to create it right there"
        try {
           await DataService.addFabricToOrder(client, fabric);
           showMessage(`✅ Linked new fabric to ${client}`);
           // Refresh orders
           const newOrders = await DataService.getCustomerOrders();
           setCustomerOrders(newOrders);
        } catch (e) {
           console.error("Auto-link failed", e);
        }
      }
    } else {
      // Client doesn't exist in OrderSS. Auto-create?
      try {
         await DataService.addFabricToOrder(client, fabric);
         showMessage(`✅ Created new order for ${client}`);
         const newOrders = await DataService.getCustomerOrders();
         setCustomerOrders(newOrders);
      } catch (e) {
         console.error("Auto-create failed", e);
      }
    }
  };

  const getCellId = (machineId: string, field: string) => `cell-${machineId}-${field}`;

  // Helper to focus any element (input/select or a static td) safely
  const focusElement = (el: HTMLElement | null) => {
    if (!el) return;
    if (!(el instanceof HTMLInputElement) && !(el instanceof HTMLSelectElement) && !(el instanceof HTMLTextAreaElement)) {
      el.tabIndex = 0;
    }
    el.focus({ preventScroll: true });
  };

  const handleCellFocus = useCallback((rowIndex: number, field: string) => {
    setActiveCell({ rowIndex, field });
  }, []);

  const handleGridBlur = useCallback((e: React.FocusEvent<HTMLDivElement>) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setActiveCell(null);
    }
  }, []);

  const moveFocus = useCallback((
    direction: 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight',
    rowIdx: number,
    field: string
  ) => {
    let targetRowIdx = rowIdx;
    let targetFieldIndex = NAVIGABLE_FIELDS.indexOf(field as any);
    if (targetFieldIndex === -1) return;

    if (direction === 'ArrowUp') {
      targetRowIdx = Math.max(0, rowIdx - 1);
    } else if (direction === 'ArrowDown') {
      targetRowIdx = Math.min(allLogs.length - 1, rowIdx + 1);
    } else if (direction === 'ArrowLeft') {
      targetFieldIndex = Math.max(0, targetFieldIndex - 1);
    } else if (direction === 'ArrowRight') {
      targetFieldIndex = Math.min(NAVIGABLE_FIELDS.length - 1, targetFieldIndex + 1);
    }

    const targetLog = filteredLogs[targetRowIdx];
    const targetField = NAVIGABLE_FIELDS[targetFieldIndex];
    if (targetLog && targetField) {
      setActiveCell({ rowIndex: targetRowIdx, field: targetField as string });
      const el = document.getElementById(getCellId(targetLog.machineId, targetField as string)) as HTMLElement | null;
      requestAnimationFrame(() => focusElement(el));
    }
  }, [filteredLogs]);

  useEffect(() => {
    const handleGlobalArrow = (e: KeyboardEvent) => {
      if (!activeCell) return;
      if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) return;

      const activeEl = document.activeElement as HTMLElement | null;
      if (!activeEl || !activeEl.id?.startsWith('cell-')) return;

      const forceNav = activeEl.dataset?.forceNav === 'true';

      if (!forceNav && activeEl instanceof HTMLTextAreaElement && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
        return;
      }

      if (!forceNav && activeEl instanceof HTMLInputElement && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
        const pos = activeEl.selectionStart ?? 0;
        const len = (activeEl.value ?? '').length;
        if ((e.key === 'ArrowLeft' && pos > 0) || (e.key === 'ArrowRight' && pos < len)) {
          return;
        }
      }

      e.preventDefault();
      e.stopPropagation();

      window.dispatchEvent(new Event('searchdropdown:forceclose'));
      moveFocus(e.key as 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight', activeCell.rowIndex, activeCell.field);
    };

    window.addEventListener('keydown', handleGlobalArrow, true);
    return () => window.removeEventListener('keydown', handleGlobalArrow, true);
  }, [activeCell, moveFocus]);

  const handleBlur = (
    e: React.FocusEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement> | React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>,
    machineId: string,
    logId: string,
    field: string
  ) => {
    const newVal = e.target.type === 'number' ? Number(e.target.value) : e.target.value;
    const log = filteredLogs.find(l => l.machineId === machineId && l.id === logId);
    
    if (log && log[field] !== newVal) {
      handleUpdateLog(machineId, logId, field, newVal);
    }
  };

  const handleFetchLogs = useCallback(async (date: string) => {
    setLoading(true);
    const startTime = performance.now();
    try {
      const allMachines = await DataService.getMachinesFromMachineSS();
      
      // Check if any machine is missing a log for this date and create it
      // Optimization: Don't write to Firestore immediately. Just create the log object in memory.
      // The log will be saved to Firestore when the user edits it.
      const updatedMachines = allMachines.map((machine) => {
        const logsForDate = (machine.dailyLogs || []).filter((log: any) => log.date === date);
        
        if (logsForDate.length === 0) {
          // Machine doesn't have a log for this date, create a virtual one
          const newLog = {
            id: date,
            date: date,
            dayProduction: 0,
            scrap: 0,
            status: machine.status || '',
            fabric: '',
            client: '',
            avgProduction: machine.avgProduction || 0,
            remainingMfg: 0,
            reason: '',
            timestamp: new Date().toISOString()
          };
          
          return { ...machine, dailyLogs: [...(machine.dailyLogs || []), newLog] };
        }
        return machine;
      });

      updatedMachines.sort((a: any, b: any) => {
         const orderA = a.orderIndex !== undefined ? a.orderIndex : 9999;
         const orderB = b.orderIndex !== undefined ? b.orderIndex : 9999;
         return orderA - orderB;
      });
      
      const flattenedLogs: any[] = [];
      updatedMachines.forEach(machine => {
        const logsForDate = (machine.dailyLogs || []).filter((log: any) => log.date === date);
        
        logsForDate.forEach((log: any) => {
          flattenedLogs.push({
            machineId: machine.id,
            machineName: machine.name,
            machineType: machine.type,
            machineBrand: machine.brand,
            ...log,
            id: log.date || log.id
          });
        });
      });

      // Fetch daily summary (external production)
      const dailySummary = await DataService.getDailySummary(date);
      setExternalProduction(dailySummary?.externalProduction || 0);
      
      setAllLogs(flattenedLogs);
      setFilteredLogs(flattenedLogs);
      
      const endTime = performance.now();
      const timeTaken = (endTime - startTime).toFixed(2);
      setFetchTime(parseFloat(timeTaken));
      
      showMessage(`✅ Fetched ${updatedMachines.length} machines in ${timeTaken}ms`);
    } catch (error) {
      console.error('Error fetching logs:', error);
      showMessage('❌ Error fetching logs', true);
    }
    setLoading(false);
  }, []);

  const showMessage = useCallback((msg: string, isError = false) => {
    setMessage(msg);
    setTimeout(() => setMessage(''), 3000);
  }, []);

  const handleLinkOrder = async (orderReference: string, orderId: string) => {
    if (!linkModalOpen.machine) return;
    
    const machineId = String(linkModalOpen.machine.id);
    const logId = selectedDate; // Logs are keyed by date
    
    // Update both reference and ID
    await handleUpdateLog(machineId, logId, 'orderReference', orderReference);
    // We might want to store orderId too if we added it to types
    await handleUpdateLog(machineId, logId, 'orderId', orderId);
    
    setLinkModalOpen({ isOpen: false, machine: null });
    showMessage(`✅ Linked to Order ${orderReference}`);
  };

  const handleUpdateLog = async (machineId: string, logId: string, field: string, newValue: any) => {
    // Optimistic Update
    let calculatedRemaining: number | undefined;
    let currentClient = '';
    let currentFabric = '';

    setAllLogs(prevLogs => prevLogs.map(log => {
      if (log.machineId === machineId && log.id === logId) {
        const updatedLog = { ...log, [field]: newValue };
        currentClient = updatedLog.client;
        currentFabric = updatedLog.fabric;
        
        if (field === 'dayProduction') {
           const oldRemaining = Number(log.remainingMfg) || 0;
           const oldProduction = Number(log.dayProduction) || 0;
           // Reconstruct the "start of day" remaining
           const baseRemaining = oldRemaining + oldProduction;
           
           const newProduction = Number(newValue) || 0;
           updatedLog.remainingMfg = Math.max(0, baseRemaining - newProduction);
           calculatedRemaining = updatedLog.remainingMfg;
        }
        return updatedLog;
      }
      return log;
    }));

    try {
      const machines = await DataService.getMachinesFromMachineSS();
      const machine = machines.find(m => m.id === machineId);
      if (!machine) return;

      const updatedLogs = [...(machine.dailyLogs || [])];
      
      // Check if log exists for the selected date
      let logIndex = updatedLogs.findIndex(log => log.date === selectedDate);
      
      if (logIndex < 0) {
        // Create new log for this date
        const newLog = {
          id: selectedDate, // Use date as ID
          date: selectedDate,
          dayProduction: 0,
          scrap: 0,
          status: machine.status || '',
          fabric: '',
          client: '',
          avgProduction: machine.avgProduction || 0,
          remainingMfg: 0,
          reason: '',
          timestamp: new Date().toISOString()
        };
        newLog[field] = newValue;
        
        if (field === 'dayProduction' && calculatedRemaining !== undefined) {
             newLog.remainingMfg = calculatedRemaining;
        }

        updatedLogs.push(newLog);
        logIndex = updatedLogs.length - 1;
      } else {
        // Update existing log
        updatedLogs[logIndex][field] = newValue;

        if (field === 'dayProduction' && calculatedRemaining !== undefined) {
             updatedLogs[logIndex].remainingMfg = calculatedRemaining;
        }
      }
      
      // Trigger Smart Link Check if Client or Fabric changed
      if (field === 'client' || field === 'fabric') {
         checkSmartLink(machineId, logId, currentClient, currentFabric);
      }

      const updatePayload: any = {
        dailyLogs: updatedLogs,
        lastLogDate: updatedLogs[logIndex].date,
        lastLogData: {
          date: updatedLogs[logIndex].date,
          dayProduction: updatedLogs[logIndex].dayProduction,
          scrap: updatedLogs[logIndex].scrap,
          status: updatedLogs[logIndex].status,
          fabric: updatedLogs[logIndex].fabric,
          client: updatedLogs[logIndex].client,
          remainingMfg: updatedLogs[logIndex].remainingMfg,
          reason: updatedLogs[logIndex].reason,
          customStatusNote: updatedLogs[logIndex].customStatusNote
        },
        lastUpdated: new Date().toISOString()
      };

      // Sync with Root Machine Fields if this is the Active Day
      if (updatedLogs[logIndex].date === activeDay) {
          updatePayload.status = updatedLogs[logIndex].status;
          updatePayload.client = updatedLogs[logIndex].client;
          updatePayload.material = updatedLogs[logIndex].fabric;
          updatePayload.remainingMfg = updatedLogs[logIndex].remainingMfg;
          updatePayload.dayProduction = updatedLogs[logIndex].dayProduction;
          updatePayload.reason = updatedLogs[logIndex].reason;
          updatePayload.customStatusNote = updatedLogs[logIndex].customStatusNote;
      }

      await DataService.updateMachineInMachineSS(machineId, updatePayload);

      // Optimistic update already handled the UI. No need to re-fetch immediately.
      showMessage('✅ Updated');
    } catch (error: any) {
      showMessage('❌ Error: ' + error.message, true);
      // Revert on error
      handleFetchLogs(selectedDate);
    }
  };

  const handleInlineCreateItem = async (machineId: string, logId: string, field: 'fabric' | 'client', newName: string) => {
    if (!newName.trim()) {
      showMessage('❌ Please enter a name', true);
      return;
    }

    setLoading(true);
    try {
      const machines = await DataService.getMachinesFromMachineSS();
      const machine = machines.find(m => m.id === machineId);
      if (!machine) return;

      const updatedLogs = [...(machine.dailyLogs || [])];
      
      // Check if log exists for the selected date
      let logIndex = updatedLogs.findIndex(log => log.date === selectedDate);
      
      if (logIndex < 0) {
        // Create new log for this date
        const newLog = {
          id: selectedDate, // Use date as ID
          date: selectedDate,
          dayProduction: 0,
          scrap: 0,
          status: machine.status || '',
          fabric: '',
          client: '',
          avgProduction: machine.avgProduction || 0,
          remainingMfg: 0,
          reason: '',
          timestamp: new Date().toISOString()
        };
        newLog[field] = newName;
        updatedLogs.push(newLog);
        logIndex = updatedLogs.length - 1;
      } else {
        // Update existing log
        updatedLogs[logIndex][field] = newName;
      }

      if (field === 'fabric') {
        await DataService.addFabric({ name: newName });
        const updatedFabrics = await DataService.getFabrics();
        setFabrics(updatedFabrics);
        
        // Trigger Smart Link Check
        const currentClient = updatedLogs[logIndex].client;
        if (currentClient) {
            checkSmartLink(machineId, logId, currentClient, newName);
        }

      } else if (field === 'client') {
        await DataService.addClient({ name: newName });
        const updatedClients = await DataService.getClients();
        setClients(updatedClients);

        // Trigger Smart Link Check
        const currentFabric = updatedLogs[logIndex].fabric;
        if (currentFabric) {
            checkSmartLink(machineId, logId, newName, currentFabric);
        }
      }

      const updatePayload: any = {
        dailyLogs: updatedLogs,
        lastUpdated: new Date().toISOString()
      };

      // Sync with Root Machine Fields if this is the Active Day
      if (selectedDate === activeDay) {
          const currentLog = updatedLogs[logIndex];
          updatePayload.status = currentLog.status;
          updatePayload.client = currentLog.client;
          updatePayload.material = currentLog.fabric;
          updatePayload.remainingMfg = currentLog.remainingMfg;
          updatePayload.dayProduction = currentLog.dayProduction;
          updatePayload.reason = currentLog.reason;
      }

      await DataService.updateMachineInMachineSS(machineId, updatePayload);

      setInlineCreateModal({ type: null, isOpen: false, machineId: '', logId: '' });
      setInlineCreateForm({ name: '' });
      await handleFetchLogs(selectedDate);
      showMessage(`✅ ${field === 'fabric' ? 'Fabric' : 'Client'} created and selected`);
    } catch (error: any) {
      showMessage('❌ Error: ' + error.message, true);
    }
    setLoading(false);
  };

  const openPlansModal = async (machineId: string, machineName: string) => {
    try {
      const machines = await DataService.getMachinesFromMachineSS();
      const machine = machines.find(m => m.id === machineId);
      
      if (machine) {
        // Calculate next start date from last plan's end date
        const plans = machine.futurePlans || [];
        let nextStartDate = new Date().toISOString().split('T')[0];
        
        if (plans.length > 0) {
          const lastPlan = plans[plans.length - 1];
          if (lastPlan.endDate) {
            const lastEndDate = new Date(lastPlan.endDate);
            lastEndDate.setDate(lastEndDate.getDate() + 1);
            nextStartDate = lastEndDate.toISOString().split('T')[0];
          }
        }
        
        setInlineNewPlan({
          type: 'PRODUCTION',
          fabric: '',
          productionPerDay: 0,
          quantity: 0,
          days: 0,
          startDate: nextStartDate,
          endDate: '',
          remaining: 0,
          orderName: '',
          originalSampleMachine: '',
          notes: ''
        });
        
        setPlansModalOpen({
          isOpen: true,
          machineId,
          machineName,
          plans
        });
      } else {
        showMessage('❌ Machine not found', true);
      }
    } catch (error) {
      console.error('Error fetching machine plans:', error);
      showMessage('❌ Error loading plans', true);
    }
  };

  const handleAddPlan = async () => {
    if (!plansModalOpen.machineId) return;
    
    setLoading(true);
    try {
      const machines = await DataService.getMachinesFromMachineSS();
      const machine = machines.find(m => m.id === plansModalOpen.machineId);
      if (!machine) {
        showMessage('❌ Machine not found', true);
        return;
      }

      const updatedPlans = [...(machine.futurePlans || []), newPlan as PlanItem];
      
      await DataService.updateMachineInMachineSS(plansModalOpen.machineId, {
        futurePlans: updatedPlans,
        lastUpdated: new Date().toISOString()
      });

      setPlansModalOpen({ ...plansModalOpen, plans: updatedPlans });
      setAddPlanModal({ isOpen: false, type: 'PRODUCTION' });
      setNewPlan({
        type: 'PRODUCTION',
        fabric: '',
        productionPerDay: 0,
        quantity: 0,
        days: 0,
        startDate: new Date().toISOString().split('T')[0],
        endDate: new Date().toISOString().split('T')[0],
        remaining: 0,
        orderName: '',
        originalSampleMachine: '',
        notes: ''
      });
      showMessage('✅ Plan added successfully');
    } catch (error: any) {
      showMessage('❌ Error: ' + error.message, true);
    }
    setLoading(false);
  };

  const handleDeletePlan = async (planIndex: number) => {
    if (!plansModalOpen.machineId) return;
    
    setLoading(true);
    try {
      const machines = await DataService.getMachinesFromMachineSS();
      const machine = machines.find(m => m.id === plansModalOpen.machineId);
      if (!machine) return;

      const updatedPlans = (machine.futurePlans || []).filter((_, idx) => idx !== planIndex);
      
      await DataService.updateMachineInMachineSS(plansModalOpen.machineId, {
        futurePlans: updatedPlans,
        lastUpdated: new Date().toISOString()
      });

      setPlansModalOpen({ ...plansModalOpen, plans: updatedPlans });
      showMessage('✅ Plan deleted');
    } catch (error: any) {
      showMessage('❌ Error: ' + error.message, true);
    }
    setLoading(false);
  };

  const handleMakeActive = async (planIndex: number) => {
    if (!plansModalOpen.machineId) return;

    if (!window.confirm('Are you sure you want to make this plan active? This will update the current machine status and remove the plan from the list.')) {
      return;
    }
    
    setLoading(true);
    try {
      const machines = await DataService.getMachinesFromMachineSS();
      const machine = machines.find(m => m.id === plansModalOpen.machineId);
      if (!machine) return;

      const planToActivate = (machine.futurePlans || [])[planIndex];
      if (!planToActivate) return;

      // 1. Update Current Status (Daily Log)
      const updatedLogs = [...(machine.dailyLogs || [])];
      let logIndex = updatedLogs.findIndex(log => log.date === selectedDate);
      
      const newLogData = {
        status: MachineStatus.WORKING,
        fabric: planToActivate.fabric || '',
        client: planToActivate.orderName || '', // Order turns to customer
        remainingMfg: planToActivate.remaining || 0, // Plan qt (remaining) goes to remaining qt
      };

      if (logIndex < 0) {
        // Create new log
        updatedLogs.push({
          id: selectedDate,
          date: selectedDate,
          dayProduction: 0,
          scrap: 0,
          avgProduction: machine.avgProduction || 0,
          reason: '',
          timestamp: new Date().toISOString(),
          ...newLogData
        });
        logIndex = updatedLogs.length - 1;
      } else {
        // Update existing
        updatedLogs[logIndex] = {
          ...updatedLogs[logIndex],
          ...newLogData
        };
      }

      // 2. Remove from Future Plans
      const updatedPlans = (machine.futurePlans || []).filter((_, idx) => idx !== planIndex);

      // 3. Save to Firestore
      await DataService.updateMachineInMachineSS(plansModalOpen.machineId, {
        dailyLogs: updatedLogs,
        futurePlans: updatedPlans,
        lastLogDate: updatedLogs[logIndex].date,
        lastLogData: {
          date: updatedLogs[logIndex].date,
          dayProduction: updatedLogs[logIndex].dayProduction,
          scrap: updatedLogs[logIndex].scrap,
          status: updatedLogs[logIndex].status,
          fabric: updatedLogs[logIndex].fabric,
          client: updatedLogs[logIndex].client,
          remainingMfg: updatedLogs[logIndex].remainingMfg
        },
        lastUpdated: new Date().toISOString()
      });

      // 4. Update Local State
      setPlansModalOpen({ ...plansModalOpen, plans: updatedPlans });
      await handleFetchLogs(selectedDate);
      showMessage('✅ Plan activated successfully');

    } catch (error: any) {
      showMessage('❌ Error: ' + error.message, true);
    }
    setLoading(false);
  };

  const handleUpdatePlan = async (planIndex: number, field: string, value: any) => {
    if (!plansModalOpen.machineId) return;
    
    try {
      const machines = await DataService.getMachinesFromMachineSS();
      const machine = machines.find(m => m.id === plansModalOpen.machineId);
      if (!machine) return;

      const updatedPlans = [...(machine.futurePlans || [])];
      updatedPlans[planIndex] = { ...updatedPlans[planIndex], [field]: value };
      
      await DataService.updateMachineInMachineSS(plansModalOpen.machineId, {
        futurePlans: updatedPlans,
        lastUpdated: new Date().toISOString()
      });

      setPlansModalOpen({ ...plansModalOpen, plans: updatedPlans });
      showMessage('✅ Plan updated');
    } catch (error: any) {
      showMessage('❌ Error: ' + error.message, true);
    }
  };

  const handleInlineAddPlan = async () => {
    if (!plansModalOpen.machineId) return;
    
    const isSettings = inlineNewPlan.type === 'SETTINGS';
    
    if (!inlineNewPlan.startDate) {
      showMessage('❌ Please fill Start Date', true);
      return;
    }
    
    if (isSettings) {
      if (!inlineNewPlan.days) {
        showMessage('❌ Please fill Days for settings', true);
        return;
      }
    } else {
      if (!inlineNewPlan.remaining || !inlineNewPlan.productionPerDay) {
        showMessage('❌ Please fill Remaining and Production/Day', true);
        return;
      }
    }
    
    setLoading(true);
    try {
      const machines = await DataService.getMachinesFromMachineSS();
      const machine = machines.find(m => m.id === plansModalOpen.machineId);
      if (!machine) {
        showMessage('❌ Machine not found', true);
        return;
      }

      let calculatedEndDate: string;
      let calculatedDays: number;

      if (isSettings) {
        // For settings, calculate end date from start date + days
        const startDateObj = new Date(inlineNewPlan.startDate || '');
        startDateObj.setDate(startDateObj.getDate() + (inlineNewPlan.days || 0));
        calculatedEndDate = startDateObj.toISOString().split('T')[0];
        calculatedDays = inlineNewPlan.days || 0;
      } else {
        // For production, calculate end date from remaining/production per day
        calculatedEndDate = calculatePlanEndDate(
          inlineNewPlan.startDate || '',
          inlineNewPlan.remaining || 0,
          inlineNewPlan.productionPerDay || 0
        );
        
        const startDateObj = new Date(inlineNewPlan.startDate || '');
        const endDateObj = new Date(calculatedEndDate);
        calculatedDays = Math.ceil((endDateObj.getTime() - startDateObj.getTime()) / (1000 * 60 * 60 * 24));
      }

      const completePlan: PlanItem = {
        type: inlineNewPlan.type || 'PRODUCTION',
        fabric: inlineNewPlan.fabric || '',
        productionPerDay: inlineNewPlan.productionPerDay || 0,
        quantity: inlineNewPlan.quantity || 0,
        days: calculatedDays,
        startDate: inlineNewPlan.startDate || '',
        endDate: calculatedEndDate,
        remaining: inlineNewPlan.remaining || 0,
        orderName: inlineNewPlan.orderName || '',
        originalSampleMachine: inlineNewPlan.originalSampleMachine || '',
        notes: inlineNewPlan.notes || ''
      };

      const updatedPlans = [...(machine.futurePlans || []), completePlan];
      
      await DataService.updateMachineInMachineSS(plansModalOpen.machineId, {
        futurePlans: updatedPlans,
        lastUpdated: new Date().toISOString()
      });

      setPlansModalOpen({ ...plansModalOpen, plans: updatedPlans });
      
      // Calculate next start date (end date + 1 day)
      const nextStartDate = new Date(calculatedEndDate);
      nextStartDate.setDate(nextStartDate.getDate() + 1);
      
      setInlineNewPlan({
        type: 'PRODUCTION',
        fabric: '',
        productionPerDay: 0,
        quantity: 0,
        days: 0,
        startDate: nextStartDate.toISOString().split('T')[0],
        endDate: '',
        remaining: 0,
        orderName: '',
        originalSampleMachine: '',
        notes: ''
      });
      setShowInlineAddRow(false);
      showMessage('✅ Plan added successfully');
    } catch (error: any) {
      showMessage('❌ Error: ' + error.message, true);
    }
    setLoading(false);
  };

  const handleKeyDown = (
    e: React.KeyboardEvent<HTMLElement>,
    logIdx: number,
    field: string
  ) => {
    if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) return;
    const targetEl = e.target as any;
    // Allow natural up/down inside textarea
    if (targetEl instanceof HTMLTextAreaElement && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) return;

    const forceNav = (targetEl as HTMLElement)?.dataset?.forceNav === 'true';

    // Allow horizontal cursor movement inside inputs before navigating away unless forced navigation
    if (!forceNav && targetEl instanceof HTMLInputElement && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
      const pos = targetEl.selectionStart ?? 0;
      const len = (targetEl.value ?? '').length;
      if ((e.key === 'ArrowLeft' && pos > 0) || (e.key === 'ArrowRight' && pos < len)) return;
    }

    e.preventDefault();

    // Force close all dropdowns immediately on navigation
    window.dispatchEvent(new Event('searchdropdown:forceclose'));
    moveFocus(e.key as 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight', logIdx, field);
  };

  const bousMachines = filteredLogs.filter(m => m.machineType === 'BOUS');
  const wideMachines = filteredLogs.filter(m => m.machineType !== 'BOUS');
  const bousProduction = bousMachines.reduce((sum, m) => sum + (Number(m.dayProduction) || 0), 0);
  const wideProduction = wideMachines.reduce((sum, m) => sum + (Number(m.dayProduction) || 0), 0);
  const totalProduction = wideProduction + bousProduction + Number(externalProduction);
  const totalScrap = filteredLogs.reduce((sum, m) => sum + (Number(m.scrap) || 0), 0);
  const scrapPercentage = totalProduction > 0 ? (totalScrap / totalProduction) * 100 : 0;
  
  const statusCounts = filteredLogs.reduce((acc, m) => {
    const status = normalizeStatusValue(m.status);
    acc[status] = (acc[status] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const handleExternalProductionBlur = async () => {
    try {
      await DataService.updateDailySummary(selectedDate, { externalProduction });
      showMessage('✅ External production saved');
    } catch (error) {
      console.error('Error saving external production:', error);
      showMessage('❌ Error saving external production', true);
    }
  };

  const handleDownloadPDF = async () => {
    if (!printRef.current) return;
    setIsDownloading(true);

    try {
      const element = printRef.current;

      // Force report header to be visible during capture
      const header = element.querySelector('.print-header') as HTMLElement;
      if (header) {
        header.classList.remove('hidden');
        header.style.display = 'block';
      }
      
      const canvas = await html2canvas(element, {
        scale: 2, 
        useCORS: true,
        backgroundColor: '#ffffff',
        windowWidth: element.scrollWidth + 100, // Ensure full width is captured
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
            (cell as HTMLElement).style.padding = '4px'; // Reduced from p-2 (8px)
            (cell as HTMLElement).style.fontSize = '10px'; // Smaller font
          });

          // Reduce footer padding and font sizes
          const footerDivs = clonedDoc.querySelectorAll('.p-4');
          footerDivs.forEach((div) => {
             // Check if it's part of the footer stats
             if (div.parentElement?.classList.contains('divide-slate-200')) {
                (div as HTMLElement).style.padding = '8px'; // Reduced from p-4 (16px)
             }
          });

          const largeTexts = clonedDoc.querySelectorAll('.text-2xl, .text-3xl');
          largeTexts.forEach((el) => {
             if (el.classList.contains('text-3xl')) {
                (el as HTMLElement).style.fontSize = '1.25rem'; // Reduced from 1.875rem
             } else {
                (el as HTMLElement).style.fontSize = '1rem'; // Reduced from 1.5rem
             }
          });
          
          // Status overview section
          const statusSection = clonedDoc.querySelector('.md\\:w-64');
          if (statusSection) {
             (statusSection as HTMLElement).style.padding = '8px';
          }
          // ----------------------------------

          // Replace inputs with text for clean PDF
          const inputs = clonedDoc.querySelectorAll('input, textarea');
          inputs.forEach((input: any) => {
            const span = clonedDoc.createElement('span');
            span.textContent = input.value;
            span.style.display = 'flex';
            span.style.alignItems = 'center';
            span.style.justifyContent = 'center';
            span.style.width = '100%';
            span.style.height = '100%';
            span.style.fontSize = 'inherit';
            span.style.fontWeight = getComputedStyle(input).fontWeight;
            
            // Ensure color is safe here too
            const rawColor = getComputedStyle(input).color;
            span.style.color = safeColor(rawColor);

            span.style.textAlign = 'center';
            span.style.whiteSpace = 'pre-wrap';
            if (input.tagName === 'TEXTAREA') {
               span.style.textAlign = 'center'; 
            }
            if (input.parentNode) {
              input.parentNode.replaceChild(span, input);
            }
          });

          // Handle selects
          const selects = clonedDoc.querySelectorAll('select');
          selects.forEach((select) => {
            const span = clonedDoc.createElement('span');
            const selectedOption = select.options[select.selectedIndex];
            span.textContent = selectedOption ? selectedOption.text : '';
            span.style.display = 'flex';
            span.style.alignItems = 'center';
            span.style.justifyContent = 'center';
            span.style.width = '100%';
            span.style.height = '100%';
            span.style.fontSize = 'inherit';
            span.style.fontWeight = 'bold';
            if (select.parentNode) {
              select.parentNode.replaceChild(span, select);
            }
          });

          const scrollables = clonedDoc.querySelectorAll('.overflow-x-auto');
          scrollables.forEach(el => {
             (el as HTMLElement).style.overflow = 'visible';
             (el as HTMLElement).style.display = 'block';
             // Force width to fit content to avoid clipping
             (el as HTMLElement).style.width = 'fit-content';
          });
          
          const handles = clonedDoc.querySelectorAll('.drag-handle');
          handles.forEach(el => (el as HTMLElement).style.display = 'none');
          
          const noPrints = clonedDoc.querySelectorAll('.no-print');
          noPrints.forEach(el => (el as HTMLElement).style.display = 'none');

          // Remove last column (Plans button)
          const rows = clonedDoc.querySelectorAll('tr');
          rows.forEach(row => {
            if (row.lastElementChild) {
              (row.lastElementChild as HTMLElement).style.display = 'none';
            }
          });
        }
      });

      // Hide header again after capture
      if (header) {
        header.classList.add('hidden');
        header.style.display = '';
      }

      const pdf = new jsPDF('l', 'mm', 'a4');
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const margin = 5; // Reduced margin
      const maxContentWidth = pageWidth - (margin * 2);
      const maxContentHeight = pageHeight - (margin * 2);

      // Calculate dimensions to fit width
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
      
      pdf.save(`Daily-Machine-Plan-${selectedDate}.pdf`);

    } catch (err) {
      console.error("PDF Generation failed", err);
      alert("Failed to generate PDF. Please try again.");
    } finally {
      setIsDownloading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 py-6 px-2 sm:px-6">
      {/* Inject global styles to hide number input spinners */}
      <style>{globalStyles}</style>

      <div className="max-w-[1400px] mx-auto flex flex-col gap-4">

        {/* Header with Date and Export */}
        <div className="flex flex-wrap items-center justify-between bg-white p-3 rounded-xl border border-slate-200 shadow-sm gap-3">
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-sm font-bold text-slate-500 uppercase tracking-wider">Report Date:</span>
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => {
                setSelectedDate(e.target.value);
                handleFetchLogs(e.target.value);
              }}
              className="bg-slate-50 border border-slate-300 text-slate-700 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block p-2 outline-none font-medium shadow-sm"
            />

            {/* Filters */}
            <div className="flex items-center gap-2 ml-2 sm:ml-4 sm:border-l sm:border-slate-200 sm:pl-4">
               <input 
                 type="text" 
                 placeholder="Search..." 
                 value={searchTerm}
                 onChange={(e) => setSearchTerm(e.target.value)}
                 className="w-28 sm:w-32 px-2 py-1.5 bg-slate-50 border border-slate-200 rounded text-sm focus:ring-1 focus:ring-blue-500 outline-none"
               />
               <select
                 value={filterType}
                 onChange={(e) => setFilterType(e.target.value)}
                 className="w-24 sm:w-28 px-2 py-1.5 bg-slate-50 border border-slate-200 rounded text-sm focus:ring-1 focus:ring-blue-500 outline-none appearance-none"
               >
                 {availableTypes.map(type => (
                   <option key={type} value={type}>{type}</option>
                 ))}
               </select>
               <input 
                 type="text" 
                 placeholder="Client..." 
                 value={filterClient}
                 onChange={(e) => setFilterClient(e.target.value)}
                 className="w-24 sm:w-28 px-2 py-1.5 bg-slate-50 border border-slate-200 rounded text-sm focus:ring-1 focus:ring-blue-500 outline-none"
               />
               <input 
                 type="text" 
                 placeholder="Fabric..." 
                 value={filterFabric}
                 onChange={(e) => setFilterFabric(e.target.value)}
                 className="w-24 sm:w-28 px-2 py-1.5 bg-slate-50 border border-slate-200 rounded text-sm focus:ring-1 focus:ring-blue-500 outline-none"
               />
            </div>

            {activeDay === selectedDate ? (
              <div className="bg-green-100 text-green-700 border border-green-200 px-3 py-1 rounded-md text-xs font-bold flex items-center gap-1 shadow-sm">
                ✅ Active Day
              </div>
            ) : (
              <button
                onClick={handleMarkActiveDay}
                className="bg-slate-800 hover:bg-slate-700 text-white px-3 py-1 rounded-md text-xs font-bold shadow-sm transition-colors"
                title="Set this date as the active working day for the schedule"
              >
                Mark as Active Day
              </button>
            )}
            <button
              onClick={handleFetchFromPreviousDay}
              className="bg-blue-600 hover:bg-blue-700 text-white px-3 py-1 rounded-md text-xs font-bold shadow-sm transition-colors flex items-center gap-1"
              title="Copy status and fabric from yesterday, and calculate new remaining quantity"
            >
              <span>↺</span> Fetch Yesterday
            </button>
          </div>
          <div className="flex gap-3">
            <button
              onClick={handleSendReport}
              disabled={isSendingReport || isReportSent}
              className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-bold transition-all shadow-sm border ${
                isReportSent
                  ? 'bg-emerald-100 text-emerald-700 border-emerald-300 cursor-default'
                  : isSendingReport 
                    ? 'bg-emerald-50 text-emerald-600 border-emerald-200' 
                    : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50 hover:text-slate-800'
              }`}
            >
              {isReportSent ? (
                <CheckCircle className="w-3 h-3" />
              ) : isSendingReport ? (
                <Send className="w-3 h-3 animate-pulse" />
              ) : (
                <Send className="w-3 h-3" />
              )}
              
              {isReportSent ? 'Sent' : isSendingReport ? 'Sending...' : 'Finished'}
            </button>
            <button
              onClick={handleDownloadPDF}
              disabled={isDownloading}
              className="flex items-center gap-2 bg-slate-800 hover:bg-slate-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors shadow-sm disabled:opacity-50"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              {isDownloading ? 'Processing...' : 'Export PDF'}
            </button>
          </div>
        </div>

        {/* Messages */}
        {message && (
          <div className={`px-3 py-2 rounded-lg text-sm font-medium shadow-sm ${message.startsWith('✅') ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
            {message}
          </div>
        )}
        
        {/* Excel-like Table */}
        <div ref={printRef} className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
            {/* Header for PDF only */}
            <div className="hidden print-header mb-4 text-center border-b border-slate-100 pb-4">
                <h1 className="text-xl font-bold text-slate-800 uppercase tracking-wide">Daily Machine Plan</h1>
                <p className="text-sm text-slate-500">Date: {new Date(selectedDate).toLocaleDateString('en-GB', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</p>
            </div>
          <div className="overflow-x-auto border border-slate-200 rounded-lg shadow-sm bg-white" onBlurCapture={handleGridBlur}>
            <table className="w-full text-xs text-center border-collapse">
              <thead className="bg-slate-50 text-slate-700 font-bold">
                <tr>
                  <th className="p-2 border border-slate-200 w-8 hidden md:table-cell">::</th>
                  <th className="p-2 border border-slate-200 w-10 hidden md:table-cell">ر</th>
                  <th className="p-2 border border-slate-200 w-20 hidden md:table-cell">الماركة</th>
                  <th className="p-2 border border-slate-200 w-20 hidden md:table-cell">النوع</th>
                  <th className="p-2 border border-slate-200 w-20">اسم الماكينة</th>
                  <th className="p-2 border border-slate-200 w-20">الحالة</th>
                  <th className="p-2 border border-slate-200 w-20 hidden md:table-cell">متوسط الانتاج</th>
                  <th className="p-2 border border-slate-200 w-20">انتاج اليوم</th>
                  <th className="p-2 border border-slate-200 w-16 text-red-600 hidden md:table-cell">الفرق</th>
                  <th className="p-2 border border-slate-200 min-w-[250px]">الخامة</th>
                  <th className="p-2 border border-slate-200 w-28">العميل</th>
                  <th className="p-2 border border-slate-200 w-20">المتبقي</th>
                  <th className="p-2 border border-slate-200 w-16 hidden md:table-cell">السقط</th>
                  <th className="p-2 border border-slate-200 min-w-[100px] hidden md:table-cell">السبب</th>
                  <th className="p-2 border border-slate-200 w-28 text-center hidden md:table-cell">تاريخ الانتهاء</th>
                  <th className="p-2 border border-slate-200 w-20 text-center">خطط / تفاصيل</th>
                </tr>
              </thead>
              <tbody>
                {filteredLogs.length === 0 ? (
                  <tr>
                    <td colSpan={16} className="p-6 text-center text-slate-500">
                      No logs found
                    </td>
                  </tr>
                ) : (
                  filteredLogs.map((log: any, idx: number) => {
                    const normalizedStatus = normalizeStatusValue(log.status);
                    const isOther = normalizedStatus === MachineStatus.OTHER;
                    const diff = ((Number(log.dayProduction) || 0) - (Number(log.avgProduction) || 0)).toFixed(1);
                    const fallbackCustom = !Object.values(MachineStatus).includes(log.status) ? (log.status || '') : '';
                    const customStatusNote = log.customStatusNote || fallbackCustom;

                    return (
                      <tr
                        key={`${log.machineId}-${log.id}-${idx}`}
                        draggable={true}
                        onDragStart={(e) => handleDragStart(e, idx)}
                        onDragOver={(e) => handleDragOver(e, idx)}
                        onDrop={(e) => handleDrop(e, idx)}
                        className={`hover:bg-blue-50/50 transition-colors align-middle ${idx % 2 === 0 ? 'bg-white' : 'bg-slate-50/70'}`}
                      >
                        {/* Drag Handle */}
                        <td className="border border-slate-200 p-0 text-slate-400 cursor-move text-lg select-none hidden md:table-cell">⋮⋮</td>

                        {/* Index */}
                        <td className="border border-slate-200 p-2 font-semibold text-slate-500 hidden md:table-cell">{idx + 1}</td>

                        {/* Brand */}
                        <td
                          id={getCellId(log.machineId, 'machineBrand')}
                          className="border border-slate-200 p-2 text-xs text-slate-600 cursor-pointer hover:bg-blue-50 focus:outline-2 focus:outline-blue-500 hidden md:table-cell"
                          tabIndex={0}
                          onFocus={() => handleCellFocus(idx, 'machineBrand')}
                          onKeyDown={(e) => handleKeyDown(e, idx, 'machineBrand')}
                        >
                          {log.machineBrand}
                        </td>

                        {/* Type */}
                        <td
                          id={getCellId(log.machineId, 'machineType')}
                          className="border border-slate-200 p-2 text-xs text-slate-600 cursor-pointer hover:bg-blue-50 focus:outline-2 focus:outline-blue-500 hidden md:table-cell"
                          tabIndex={0}
                          onFocus={() => handleCellFocus(idx, 'machineType')}
                          onKeyDown={(e) => handleKeyDown(e, idx, 'machineType')}
                        >
                          {log.machineType}
                        </td>

                        {/* Machine Name */}
                        <td
                          id={getCellId(log.machineId, 'machineName')}
                          className="border border-slate-200 p-2 text-xs font-semibold text-slate-700 cursor-pointer hover:bg-blue-50 focus:outline-2 focus:outline-blue-500"
                          tabIndex={0}
                          onFocus={() => handleCellFocus(idx, 'machineName')}
                          onKeyDown={(e) => handleKeyDown(e, idx, 'machineName')}
                        >
                          {log.machineName}
                        </td>

                        {/* Status */}
                        <td className={`border border-slate-200 p-0 align-middle ${getStatusColor(normalizedStatus)}`}>
                          <div className="flex flex-col h-full w-full">
                            <select
                              id={getCellId(log.machineId, 'status')}
                              defaultValue={normalizedStatus}
                              onFocus={() => {
                                handleCellFocus(idx, 'status');
                                window.dispatchEvent(new Event('searchdropdown:forceclose'));
                              }}
                              onChange={(e) => handleBlur(e, log.machineId, log.id, 'status')}
                              onKeyDown={(e) => handleKeyDown(e, idx, 'status')}
                              className="w-full h-full p-2 text-center bg-transparent focus:bg-blue-50 focus:outline-none appearance-none font-bold text-[10px]"
                            >
                              {(Object.values(MachineStatus) as MachineStatus[]).map((status) => (
                                <option key={status} value={status}>
                                  {getStatusLabel(status)}
                                </option>
                              ))}
                            </select>
                            {isOther && (
                              <input
                                id={`${getCellId(log.machineId, 'status')}-custom`}
                                defaultValue={customStatusNote}
                                placeholder="اكتب الحالة..."
                                onBlur={(e) => handleBlur({ target: { value: e.target.value, type: 'text' } } as any, log.machineId, log.id, 'customStatusNote')}
                                className="w-full border-t border-slate-200 bg-white/70 text-[10px] text-center p-1 outline-none"
                              />
                            )}
                          </div>
                        </td>

                        {/* Avg Production */}
                        <td className="border border-slate-200 p-0 hidden md:table-cell">
                          <input
                            id={getCellId(log.machineId, 'avgProduction')}
                            type="number"
                            defaultValue={log.avgProduction || 0}
                            data-force-nav="true"
                            onFocus={() => {
                              handleCellFocus(idx, 'avgProduction');
                              window.dispatchEvent(new Event('searchdropdown:forceclose'));
                            }}
                            onBlur={(e) => handleBlur(e, log.machineId, log.id, 'avgProduction')}
                            onKeyDown={(e) => handleKeyDown(e, idx, 'avgProduction')}
                            className="w-full h-full p-2 text-center bg-transparent focus:bg-blue-50 focus:outline-none"
                          />
                        </td>

                        {/* Day Production */}
                        <td className="border border-slate-200 p-0">
                          <input
                            id={getCellId(log.machineId, 'dayProduction')}
                            type="number"
                            defaultValue={log.dayProduction || 0}
                            data-force-nav="true"
                            onFocus={() => {
                              handleCellFocus(idx, 'dayProduction');
                              window.dispatchEvent(new Event('searchdropdown:forceclose'));
                            }}
                            onBlur={(e) => handleBlur(e, log.machineId, log.id, 'dayProduction')}
                            onKeyDown={(e) => handleKeyDown(e, idx, 'dayProduction')}
                            className="w-full h-full p-2 text-center bg-transparent focus:bg-blue-50 focus:outline-none font-semibold text-slate-800"
                          />
                        </td>

                        {/* Difference */}
                        <td
                          id={getCellId(log.machineId, 'difference')}
                          className={`border border-slate-200 p-2 font-bold cursor-pointer hover:bg-blue-50 focus:outline-2 focus:outline-blue-500 hidden md:table-cell ${parseFloat(diff) < 0 ? 'text-red-500' : 'text-emerald-600'}`}
                          tabIndex={0}
                          onFocus={() => handleCellFocus(idx, 'difference')}
                          onKeyDown={(e) => handleKeyDown(e, idx, 'difference')}
                        >
                          {diff}
                        </td>

                        {/* Fabric */}
                        <td className="border border-slate-200 p-0 relative">
                          <SearchDropdown
                            id={getCellId(log.machineId, 'fabric')}
                            options={fabrics}
                            value={log.fabric || ''}
                            onChange={(val) => handleBlur({ target: { value: val, type: 'text' } } as any, log.machineId, log.id, 'fabric')}
                            onCreateNew={() => {
                              const inputEl = document.getElementById(getCellId(log.machineId, 'fabric')) as HTMLInputElement;
                              const newName = inputEl?.value || '';
                              handleInlineCreateItem(log.machineId, log.id, 'fabric', newName);
                            }}
                            onFocus={() => handleCellFocus(idx, 'fabric')}
                            placeholder="---"
                          />
                        </td>

                        {/* Client */}
                        <td className="border border-slate-200 p-0 relative group">
                          <SearchDropdown
                            id={getCellId(log.machineId, 'client')}
                            options={clients}
                            value={log.client || ''}
                            onChange={(val) => handleBlur({ target: { value: val, type: 'text' } } as any, log.machineId, log.id, 'client')}
                            onCreateNew={() => {
                              const inputEl = document.getElementById(getCellId(log.machineId, 'client')) as HTMLInputElement;
                              const newName = inputEl?.value || '';
                              handleInlineCreateItem(log.machineId, log.id, 'client', newName);
                            }}
                            onFocus={() => handleCellFocus(idx, 'client')}
                            placeholder="---"
                          />
                          
                          {/* Reference Code Tooltip */}
                          {log.client && log.fabric && (
                            <div className="hidden group-hover:block absolute bottom-full left-1/2 -translate-x-1/2 mb-1 px-2 py-1 bg-slate-800 text-white text-xs rounded shadow-lg z-20 whitespace-nowrap pointer-events-none">
                              {log.client}-{log.fabric}
                              <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-slate-800"></div>
                            </div>
                          )}
                          
                          {/* Link Button / Indicator */}
                          <div className="absolute top-0 right-0 h-full flex items-center pr-1 pointer-events-auto z-10">
                            {log.orderReference ? (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setLinkModalOpen({ 
                                    isOpen: true, 
                                    machine: { ...log, id: log.machineId, material: log.fabric } as any 
                                  });
                                }}
                                className="flex items-center gap-1 text-[9px] bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded-full border border-blue-200 hover:bg-blue-100 transition-all font-medium shadow-sm"
                                title={`Linked to Order: ${log.orderReference}`}
                              >
                                <Link size={10} className="text-blue-500" />
                                {log.orderReference}
                              </button>
                            ) : (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setLinkModalOpen({ 
                                    isOpen: true, 
                                    machine: { ...log, id: log.machineId, material: log.fabric } as any 
                                  });
                                }}
                                className="opacity-0 group-hover:opacity-100 transition-all duration-200 text-slate-300 hover:text-blue-500 hover:bg-blue-50 p-1 rounded-full"
                                title="Link to Order"
                              >
                                <Link size={14} />
                              </button>
                            )}
                          </div>
                        </td>

                        {/* Remaining */}
                        <td className="border border-slate-200 p-0">
                          <input
                            key={`${log.machineId}-remaining-${log.remainingMfg}`}
                            id={getCellId(log.machineId, 'remainingMfg')}
                            type="text"
                            defaultValue={(() => {
                              const r = Number(log.remainingMfg) || 0;
                              const p = Number(log.dayProduction) || 0;
                              const isNotWorking = log.status !== 'Working';
                              
                              if (r === 0) {
                                if (p > 0) return "خلصت";
                                if (isNotWorking) return "-";
                                return "0";
                              }
                              return r;
                            })()}
                            data-force-nav="true"
                            onFocus={(e) => {
                              const val = e.target.value;
                              if (val === "خلصت" || val === "-") e.target.value = "0";
                              e.target.select();
                              handleCellFocus(idx, 'remainingMfg');
                              window.dispatchEvent(new Event('searchdropdown:forceclose'));
                            }}
                            onBlur={(e) => {
                                let val = e.target.value;
                                if (val === "خلصت" || val === "-") val = "0";
                                const numVal = Number(val);
                                const finalVal = isNaN(numVal) ? 0 : numVal;
                                if (log.remainingMfg !== finalVal) {
                                    handleUpdateLog(log.machineId, log.id, 'remainingMfg', finalVal);
                                }
                            }}
                            onKeyDown={(e) => handleKeyDown(e, idx, 'remainingMfg')}
                            className={`w-full h-full p-2 text-center bg-transparent focus:bg-blue-50 focus:outline-none ${
                              (Number(log.remainingMfg) || 0) === 0 && (Number(log.dayProduction) || 0) > 0 
                                ? 'text-green-600 font-bold' 
                                : (Number(log.remainingMfg) || 0) === 0 && log.status !== 'Working'
                                  ? 'text-slate-400'
                                  : ''
                            }`}
                          />
                        </td>

                        {/* Scrap */}
                        <td className="border border-slate-200 p-0 hidden md:table-cell">
                          <input
                            id={getCellId(log.machineId, 'scrap')}
                            type="number"
                            defaultValue={log.scrap || 0}
                            data-force-nav="true"
                            onFocus={() => {
                              handleCellFocus(idx, 'scrap');
                              window.dispatchEvent(new Event('searchdropdown:forceclose'));
                            }}
                            onBlur={(e) => handleBlur(e, log.machineId, log.id, 'scrap')}
                            onKeyDown={(e) => handleKeyDown(e, idx, 'scrap')}
                            className={`w-full h-full p-2 text-center bg-transparent focus:bg-blue-50 focus:outline-none font-bold ${log.scrap > 0 ? 'text-red-600' : ''}`}
                          />
                        </td>

                        {/* Reason */}
                        <td className="border border-slate-200 p-0 hidden md:table-cell">
                          <input
                            id={getCellId(log.machineId, 'reason')}
                            type="text"
                            defaultValue={log.reason || ''}
                            data-force-nav="true"
                            onFocus={() => {
                              handleCellFocus(idx, 'reason');
                              window.dispatchEvent(new Event('searchdropdown:forceclose'));
                            }}
                            onBlur={(e) => handleBlur(e, log.machineId, log.id, 'reason')}
                            onKeyDown={(e) => handleKeyDown(e, idx, 'reason')}
                            placeholder="السبب..."
                            className="w-full h-full p-2 text-center bg-transparent focus:bg-blue-50 focus:outline-none"
                          />
                        </td>

                        {/* End Date (Calculated) */}
                        <td
                          id={getCellId(log.machineId, 'endDate')}
                          className="border border-slate-200 p-2 text-center font-semibold text-blue-700 cursor-pointer hover:bg-blue-50 focus:outline-2 focus:outline-blue-500 hidden md:table-cell"
                          tabIndex={0}
                          onFocus={() => handleCellFocus(idx, 'endDate')}
                          onKeyDown={(e) => handleKeyDown(e, idx, 'endDate')}
                        >
                          {calculateEndDate(log.date || selectedDate, log.remainingMfg || 0, log.dayProduction || 0)}
                        </td>

                        {/* Plans Button */}
                        <td className="border border-slate-200 p-2">
                          <div className="flex items-center justify-center gap-1">
                            <button
                              id={getCellId(log.machineId, 'plans')}
                              onFocus={() => handleCellFocus(idx, 'plans')}
                              onClick={() => openPlansModal(log.machineId, log.machineName)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' || e.key === ' ') {
                                  e.preventDefault();
                                  openPlansModal(log.machineId, log.machineName);
                                } else {
                                  handleKeyDown(e, idx, 'plans');
                                }
                              }}
                              className="px-2 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded text-xs font-bold transition-colors focus:outline-2 focus:outline-blue-500"
                            >
                              خطط
                            </button>
                            <button
                              onClick={() => setDetailsModal({ isOpen: true, log, index: idx })}
                              className="md:hidden px-2 py-1 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded text-xs font-bold transition-colors"
                            >
                              تفاصيل
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* Footer */}
          <div className="border border-slate-200 rounded-lg bg-white shadow-sm overflow-hidden mt-4">
            <div className="flex flex-col-reverse md:flex-row">
              <div className="md:w-64 border-r border-slate-200 bg-slate-50 p-3 flex flex-col justify-center gap-2">
                 <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1 border-b border-slate-200 pb-1">Status Overview</h4>
                 {Object.values(MachineStatus).map(status => (
                   <div key={status} className="flex justify-between items-center text-xs">
                      <span className="text-slate-600">{getStatusLabel(status)}</span>
                      <span className={`font-bold px-2 rounded-full ${getStatusColor(status).replace('text-', 'text-opacity-100 text-').replace('bg-', 'bg-opacity-20 bg-')}`}>
                        {statusCounts[status] || 0}
                      </span>
                   </div>
                 ))}
              </div>

              <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-slate-200">
                 <div className="p-4 flex flex-col justify-center items-center bg-yellow-50/30">
                   <span className="text-xs text-amber-900/60 font-bold mb-1">انتاج البوص (Bous)</span>
                   <span className="text-2xl font-bold text-amber-700">{bousProduction.toLocaleString()}</span>
                 </div>
                 <div className="p-4 flex flex-col justify-center items-center">
                   <span className="text-xs text-slate-400 font-bold mb-1">مكن عريض (Wide)</span>
                   <span className="text-2xl font-bold text-slate-700">{wideProduction.toLocaleString()}</span>
                 </div>
                 <div className="p-4 flex flex-col justify-center items-center hover:bg-blue-50/50 transition-colors group cursor-pointer relative">
                   <span className="text-xs text-blue-900/60 font-bold mb-1 flex items-center gap-1">
                     خارجي (External)
                   </span>
                   <input 
                      type="number" 
                      value={externalProduction}
                      onChange={(e) => setExternalProduction(Number(e.target.value))}
                      onBlur={handleExternalProductionBlur}
                      className="w-full text-center bg-transparent font-bold text-2xl text-blue-700 outline-none border-b border-transparent group-hover:border-blue-300 focus:border-blue-500"
                   />
                 </div>
                 <div className="p-4 flex flex-col justify-center items-center bg-slate-900 text-white relative overflow-hidden">
                   <div className="absolute top-0 right-0 p-1">
                      <div className="flex items-center gap-1 bg-white/10 px-2 py-0.5 rounded text-[10px]">
                          <span className="text-red-300">Scrap:</span>
                          <span className="font-bold text-white">{totalScrap} ({scrapPercentage.toFixed(2)}%)</span>
                      </div>
                   </div>
                   <span className="text-xs text-slate-400 font-bold mb-1">الاجمالي (Total)</span>
                   <span className="text-3xl font-bold">{totalProduction.toLocaleString()}</span>
                 </div>
              </div>
            </div>
          </div>
        </div>

        {/* Inline Creation Modal */}
        {false && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded shadow-lg p-4 w-80">
              <h3 className="text-lg font-bold mb-3">
                {inlineCreateModal.type === 'fabric' ? 'اضافة خامة جديدة' : 'اضافة عميل جديد'}
              </h3>
              <input
                type="text"
                value={inlineCreateForm.name}
                onChange={(e) => setInlineCreateForm({ name: e.target.value })}
                placeholder={inlineCreateModal.type === 'fabric' ? 'اسم الخامة...' : 'اسم العميل...'}
                autoFocus
                className="w-full px-2 py-1 border border-slate-300 rounded mb-3 text-sm"
              />
              <div className="flex gap-2">
                <button
                  onClick={() => {
                    setInlineCreateModal({ type: null, isOpen: false, machineId: '', logId: '' });
                    setInlineCreateForm({ name: '' });
                  }}
                  className="flex-1 px-3 py-1 bg-slate-300 hover:bg-slate-400 rounded text-sm font-bold"
                >
                  الغاء
                </button>
                <button
                  onClick={() => handleInlineCreateItem(inlineCreateModal.machineId, inlineCreateModal.logId, inlineCreateModal.type!, inlineCreateForm.name)}
                  disabled={loading || !inlineCreateForm.name}
                  className="flex-1 px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded text-sm font-bold disabled:opacity-50"
                >
                  اضافة
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Plans Modal */}
        {plansModalOpen.isOpen && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-lg shadow-xl w-full max-w-6xl max-h-[90vh] flex flex-col">
              {/* Header */}
              <div className="bg-slate-700 text-white px-4 py-3 rounded-t-lg flex justify-between items-center">
                <div className="flex items-center gap-3">
                  <span className="bg-slate-600 px-3 py-1 rounded text-sm">ID: {plansModalOpen.machineId}</span>
                  <h3 className="text-lg font-bold">{plansModalOpen.machineName}</h3>
                </div>
                <div className="flex items-center gap-4 text-sm">
                  <span className="font-medium">MAYER</span>
                  <span>•</span>
                  <span className="font-medium">MELTON</span>
                  <button
                    onClick={() => setPlansModalOpen({ isOpen: false, machineId: '', machineName: '', plans: [] })}
                    className="ml-4 text-2xl hover:text-slate-300"
                  >
                    ✕
                  </button>
                </div>
              </div>

              {/* Table */}
              <div className="flex-1 overflow-auto p-0">
                <table className="w-full text-sm text-left">
                  <thead className="bg-slate-50 text-xs uppercase font-semibold text-slate-500 sticky top-0 z-10 shadow-sm">
                    <tr>
                      <th className="px-4 py-3 text-center w-10">#</th>
                      <th className="px-4 py-3">Start Date <span className="block text-[10px] font-normal text-slate-400">تاريخ البدء</span></th>
                      <th className="px-4 py-3">End Date <span className="block text-[10px] font-normal text-slate-400">تاريخ الانتهاء</span></th>
                      <th className="px-4 py-3">Orig. Machine <span className="block text-[10px] font-normal text-slate-400">الأصل</span></th>
                      <th className="px-4 py-3 text-center">Days <span className="block text-[10px] font-normal text-slate-400">المدة</span></th>
                      <th className="px-4 py-3">Order <span className="block text-[10px] font-normal text-slate-400">التشغيلة</span></th>
                      <th className="px-4 py-3 text-center">Remaining <span className="block text-[10px] font-normal text-slate-400">متبقي</span></th>
                      <th className="px-4 py-3 text-center">Qty <span className="block text-[10px] font-normal text-slate-400">الكمية</span></th>
                      <th className="px-4 py-3 text-center">Prod/Day <span className="block text-[10px] font-normal text-slate-400">انتاج/يوم</span></th>
                      <th className="px-4 py-3">Fabric / Notes <span className="block text-[10px] font-normal text-slate-400">الخامة / ملاحظات</span></th>
                      <th className="px-4 py-3 text-center">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {plansModalOpen.plans.length === 0 ? (
                      <tr>
                        <td colSpan={11} className="p-8 text-center text-slate-400">
                          No plans found
                        </td>
                      </tr>
                    ) : (
                      plansModalOpen.plans.map((plan: PlanItem, idx: number) => {
                        const isSettings = plan.type === 'SETTINGS';
                        const isActive = plan.startDate <= new Date().toISOString().split('T')[0] && plan.endDate >= new Date().toISOString().split('T')[0];
                        
                        // Calculate end date based on start date + remaining/production per day
                        const calculatedEndDate = calculatePlanEndDate(plan.startDate, plan.remaining || 0, plan.productionPerDay || 0);
                        const displayEndDate = calculatedEndDate || plan.endDate || '-';
                        
                        // Calculate days from start to end date
                        const calculatedDays = plan.startDate && calculatedEndDate 
                          ? Math.ceil((new Date(calculatedEndDate).getTime() - new Date(plan.startDate).getTime()) / (1000 * 60 * 60 * 24))
                          : plan.days || 0;
                        
                        return (
                          <tr key={idx} className={`${isActive ? 'bg-emerald-50/50' : isSettings ? 'bg-amber-50/50' : 'bg-white'} hover:bg-slate-50 transition-colors`}>
                            <td className="p-2 text-center text-slate-400 text-xs">{idx + 1}</td>
                            <td className="p-0">
                              <input
                                type="date"
                                value={plan.startDate || ''}
                                onChange={(e) => handleUpdatePlan(idx, 'startDate', e.target.value)}
                                className="w-full p-3 bg-transparent outline-none focus:bg-white focus:ring-2 focus:ring-inset focus:ring-blue-500 transition-all"
                              />
                            </td>
                            <td className="p-3 font-medium text-blue-700">
                              {displayEndDate}
                            </td>
                            <td className="p-0">
                              <input
                                type="text"
                                value={plan.originalSampleMachine || ''}
                                onChange={(e) => handleUpdatePlan(idx, 'originalSampleMachine', e.target.value)}
                                className="w-full p-3 bg-transparent outline-none focus:bg-white focus:ring-2 focus:ring-inset focus:ring-blue-500 transition-all"
                                placeholder="-"
                              />
                            </td>
                            <td className="p-3 text-center font-bold text-orange-600">
                              {calculatedDays}
                            </td>
                            <td className="p-0">
                              <input
                                type="text"
                                value={plan.orderName || ''}
                                onChange={(e) => handleUpdatePlan(idx, 'orderName', e.target.value)}
                                className="w-full p-3 bg-transparent outline-none focus:bg-white focus:ring-2 focus:ring-inset focus:ring-blue-500 transition-all text-blue-600 font-medium"
                                placeholder="-"
                              />
                            </td>
                            <td className="p-0">
                              <input
                                type="number"
                                value={plan.remaining || 0}
                                onChange={(e) => handleUpdatePlan(idx, 'remaining', Number(e.target.value))}
                                className="w-full p-3 text-center bg-transparent outline-none focus:bg-white focus:ring-2 focus:ring-inset focus:ring-blue-500 transition-all font-bold"
                              />
                            </td>
                            <td className="p-0">
                              <input
                                type="number"
                                value={isSettings ? 0 : plan.quantity}
                                onChange={(e) => handleUpdatePlan(idx, 'quantity', Number(e.target.value))}
                                disabled={isSettings}
                                className="w-full p-3 text-center bg-transparent outline-none focus:bg-white focus:ring-2 focus:ring-inset focus:ring-blue-500 transition-all disabled:opacity-50"
                              />
                            </td>
                            <td className="p-0">
                              <input
                                type="number"
                                value={plan.productionPerDay || 0}
                                onChange={(e) => handleUpdatePlan(idx, 'productionPerDay', Number(e.target.value))}
                                className="w-full p-3 text-center bg-transparent outline-none focus:bg-white focus:ring-2 focus:ring-inset focus:ring-blue-500 transition-all font-bold"
                              />
                            </td>
                            <td className="p-0">
                              {isSettings ? (
                                <input
                                  type="text"
                                  value={plan.notes || ''}
                                  onChange={(e) => handleUpdatePlan(idx, 'notes', e.target.value)}
                                  className="w-full p-3 bg-transparent outline-none focus:bg-white focus:ring-2 focus:ring-inset focus:ring-blue-500 transition-all text-slate-500 italic"
                                  placeholder="Notes..."
                                />
                              ) : (
                                <input
                                  type="text"
                                  value={plan.fabric || ''}
                                  onChange={(e) => handleUpdatePlan(idx, 'fabric', e.target.value)}
                                  className="w-full p-3 bg-transparent outline-none focus:bg-white focus:ring-2 focus:ring-inset focus:ring-blue-500 transition-all font-medium"
                                  placeholder="-"
                                />
                              )}
                            </td>
                            <td className="p-2 text-center flex gap-2 justify-center items-center">
                              <button
                                onClick={() => handleMakeActive(idx)}
                                className="p-1.5 bg-emerald-100 hover:bg-emerald-200 text-emerald-700 rounded-md transition-colors"
                                title="Make Active"
                              >
                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                </svg>
                              </button>
                              <button
                                onClick={() => handleDeletePlan(idx)}
                                className="p-1.5 bg-red-100 hover:bg-red-200 text-red-700 rounded-md transition-colors"
                                title="Delete"
                              >
                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                </svg>
                              </button>
                            </td>
                          </tr>
                        );
                      })
                    )}
                    
                    {/* Excel-like Add Row */}
                    {showInlineAddRow && (
                    <tr className={`border-t-2 ${inlineNewPlan.type === 'SETTINGS' ? 'bg-amber-50 border-amber-400' : 'bg-yellow-50 border-yellow-400'}`}>
                      <td className="p-2 text-center text-green-600 font-bold">+</td>
                      <td className="p-0">
                        <input
                          type="date"
                          value={inlineNewPlan.startDate || ''}
                          onChange={(e) => {
                            const prevPlan = plansModalOpen.plans[plansModalOpen.plans.length - 1];
                            const startDate = e.target.value || (prevPlan?.endDate ? new Date(new Date(prevPlan.endDate).getTime() + 86400000).toISOString().split('T')[0] : e.target.value);
                            setInlineNewPlan({ ...inlineNewPlan, startDate });
                          }}
                          placeholder="Start Date"
                          className="w-full p-3 bg-transparent outline-none font-medium placeholder-slate-400"
                        />
                      </td>
                      <td className="p-3 font-medium text-blue-700">
                        {inlineNewPlan.type === 'SETTINGS' 
                          ? (inlineNewPlan.startDate && inlineNewPlan.days 
                              ? (() => {
                                  const start = new Date(inlineNewPlan.startDate);
                                  start.setDate(start.getDate() + (inlineNewPlan.days || 0));
                                  return start.toISOString().split('T')[0];
                                })()
                              : '-')
                          : (inlineNewPlan.startDate && inlineNewPlan.remaining && inlineNewPlan.productionPerDay 
                              ? calculatePlanEndDate(inlineNewPlan.startDate, inlineNewPlan.remaining, inlineNewPlan.productionPerDay)
                              : '-')}
                      </td>
                      <td className="p-0">
                        <input
                          type="text"
                          value={inlineNewPlan.originalSampleMachine || ''}
                          onChange={(e) => setInlineNewPlan({ ...inlineNewPlan, originalSampleMachine: e.target.value })}
                          placeholder="Original"
                          className="w-full p-3 bg-transparent outline-none placeholder-slate-400"
                        />
                      </td>
                      <td className="p-0">
                        <input
                          type="number"
                          value={inlineNewPlan.days || ''}
                          onChange={(e) => setInlineNewPlan({ ...inlineNewPlan, days: Number(e.target.value) })}
                          placeholder="0"
                          className="w-full p-3 text-center bg-transparent outline-none font-bold text-orange-600 placeholder-slate-400"
                        />
                      </td>
                      <td className="p-0">
                        <input
                          type="text"
                          value={inlineNewPlan.orderName || ''}
                          onChange={(e) => setInlineNewPlan({ ...inlineNewPlan, orderName: e.target.value })}
                          placeholder="Order"
                          className="w-full p-3 bg-transparent outline-none text-blue-600 placeholder-slate-400"
                        />
                      </td>
                      <td className="p-0">
                        <input
                          type="number"
                          value={inlineNewPlan.remaining || ''}
                          onChange={(e) => setInlineNewPlan({ ...inlineNewPlan, remaining: Number(e.target.value) })}
                          placeholder="0"
                          disabled={inlineNewPlan.type === 'SETTINGS'}
                          className="w-full p-3 text-center bg-transparent outline-none font-bold disabled:opacity-50 placeholder-slate-400"
                        />
                      </td>
                      <td className="p-0">
                        <input
                          type="number"
                          value={inlineNewPlan.quantity || ''}
                          onChange={(e) => setInlineNewPlan({ ...inlineNewPlan, quantity: Number(e.target.value) })}
                          placeholder="0"
                          disabled={inlineNewPlan.type === 'SETTINGS'}
                          className="w-full p-3 text-center bg-transparent outline-none disabled:opacity-50 placeholder-slate-400"
                        />
                      </td>
                      <td className="p-0">
                        <input
                          type="number"
                          value={inlineNewPlan.productionPerDay || ''}
                          onChange={(e) => setInlineNewPlan({ ...inlineNewPlan, productionPerDay: Number(e.target.value) })}
                          placeholder="0"
                          disabled={inlineNewPlan.type === 'SETTINGS'}
                          className="w-full p-3 text-center bg-transparent outline-none font-bold disabled:opacity-50 placeholder-slate-400"
                        />
                      </td>
                      <td className="p-0">
                        {inlineNewPlan.type === 'SETTINGS' ? (
                          <input
                            type="text"
                            value={inlineNewPlan.notes || ''}
                            onChange={(e) => setInlineNewPlan({ ...inlineNewPlan, notes: e.target.value })}
                            placeholder="Notes..."
                            className="w-full p-3 bg-transparent outline-none text-slate-500 italic placeholder-slate-400"
                          />
                        ) : (
                          <input
                            type="text"
                            value={inlineNewPlan.fabric || ''}
                            onChange={(e) => setInlineNewPlan({ ...inlineNewPlan, fabric: e.target.value })}
                            placeholder="Fabric"
                            className="w-full p-3 bg-transparent outline-none placeholder-slate-400"
                          />
                        )}
                      </td>
                      <td className="p-2 text-center text-slate-400 text-xs">NEW</td>
                      <td className="p-2 text-center">
                        <button
                          onClick={handleInlineAddPlan}
                          disabled={loading || !inlineNewPlan.startDate || (inlineNewPlan.type === 'SETTINGS' ? !inlineNewPlan.days : (!inlineNewPlan.remaining || !inlineNewPlan.productionPerDay))}
                          className="px-2 py-1 bg-green-500 hover:bg-green-600 text-white rounded text-xs font-bold disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          ✓ Add
                        </button>
                      </td>
                    </tr>
                    )}
                  </tbody>
                </table>
              </div>

              {/* Footer */}
              <div className="border-t border-slate-200 p-4 flex justify-between items-center bg-slate-50 rounded-b-lg">
                <div className="flex gap-2">
                  <button 
                    onClick={() => {
                      const plans = plansModalOpen.plans;
                      let nextStartDate = new Date().toISOString().split('T')[0];
                      
                      if (plans.length > 0) {
                        const lastPlan = plans[plans.length - 1];
                        if (lastPlan.endDate) {
                          const lastEndDate = new Date(lastPlan.endDate);
                          lastEndDate.setDate(lastEndDate.getDate() + 1);
                          nextStartDate = lastEndDate.toISOString().split('T')[0];
                        }
                      }
                      
                      setInlineNewPlan({
                        type: 'PRODUCTION',
                        fabric: '',
                        productionPerDay: 0,
                        quantity: 0,
                        days: 0,
                        startDate: nextStartDate,
                        endDate: '',
                        remaining: 0,
                        orderName: '',
                        originalSampleMachine: '',
                        notes: ''
                      });
                      setShowInlineAddRow(true);
                    }}
                    className="px-4 py-2 border border-orange-400 text-orange-600 rounded hover:bg-orange-50 text-sm font-medium"
                  >
                    + Add Production Plan
                  </button>
                  <button 
                    onClick={() => {
                      const plans = plansModalOpen.plans;
                      let nextStartDate = new Date().toISOString().split('T')[0];
                      
                      if (plans.length > 0) {
                        const lastPlan = plans[plans.length - 1];
                        if (lastPlan.endDate) {
                          const lastEndDate = new Date(lastPlan.endDate);
                          lastEndDate.setDate(lastEndDate.getDate() + 1);
                          nextStartDate = lastEndDate.toISOString().split('T')[0];
                        }
                      }
                      
                      setInlineNewPlan({
                        type: 'SETTINGS',
                        fabric: '',
                        productionPerDay: 0,
                        quantity: 0,
                        days: 0,
                        startDate: nextStartDate,
                        endDate: '',
                        remaining: 0,
                        orderName: '',
                        originalSampleMachine: '',
                        notes: ''
                      });
                      setShowInlineAddRow(true);
                    }}
                    className="px-4 py-2 border border-orange-400 text-orange-600 rounded hover:bg-orange-50 text-sm font-medium"
                  >
                    + Add Settings
                  </button>
                </div>
                <button className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded text-sm font-medium">
                  Smart Add (AI)
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Add Plan Modal */}
        {addPlanModal.isOpen && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[60] p-4">
            <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl">
              <div className="bg-slate-700 text-white px-4 py-3 rounded-t-lg flex justify-between items-center">
                <h3 className="text-lg font-bold">
                  {addPlanModal.type === 'PRODUCTION' ? '➕ Add Production Plan' : '⚙️ Add Settings'}
                </h3>
                <button
                  onClick={() => setAddPlanModal({ isOpen: false, type: 'PRODUCTION' })}
                  className="text-2xl hover:text-slate-300"
                >
                  ✕
                </button>
              </div>

              <div className="p-6 space-y-4">
                {addPlanModal.type === 'PRODUCTION' ? (
                  <>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1">Fabric</label>
                        <input
                          type="text"
                          value={newPlan.fabric || ''}
                          onChange={(e) => setNewPlan({ ...newPlan, fabric: e.target.value })}
                          className="w-full px-3 py-2 border border-slate-300 rounded"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1">Order Name</label>
                        <input
                          type="text"
                          value={newPlan.orderName || ''}
                          onChange={(e) => setNewPlan({ ...newPlan, orderName: e.target.value })}
                          className="w-full px-3 py-2 border border-slate-300 rounded"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1">Quantity</label>
                        <input
                          type="number"
                          value={newPlan.quantity || 0}
                          onChange={(e) => setNewPlan({ ...newPlan, quantity: Number(e.target.value) })}
                          className="w-full px-3 py-2 border border-slate-300 rounded"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1">Production/Day</label>
                        <input
                          type="number"
                          value={newPlan.productionPerDay || 0}
                          onChange={(e) => setNewPlan({ ...newPlan, productionPerDay: Number(e.target.value) })}
                          className="w-full px-3 py-2 border border-slate-300 rounded"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1">Days</label>
                        <input
                          type="number"
                          value={newPlan.days || 0}
                          onChange={(e) => setNewPlan({ ...newPlan, days: Number(e.target.value) })}
                          className="w-full px-3 py-2 border border-slate-300 rounded"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1">Start Date</label>
                        <input
                          type="date"
                          value={newPlan.startDate || ''}
                          onChange={(e) => setNewPlan({ ...newPlan, startDate: e.target.value })}
                          className="w-full px-3 py-2 border border-slate-300 rounded"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1">End Date</label>
                        <input
                          type="date"
                          value={newPlan.endDate || ''}
                          onChange={(e) => setNewPlan({ ...newPlan, endDate: e.target.value })}
                          className="w-full px-3 py-2 border border-slate-300 rounded"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1">Remaining</label>
                        <input
                          type="number"
                          value={newPlan.remaining || 0}
                          onChange={(e) => setNewPlan({ ...newPlan, remaining: Number(e.target.value) })}
                          className="w-full px-3 py-2 border border-slate-300 rounded"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1">Original Machine</label>
                        <input
                          type="text"
                          value={newPlan.originalSampleMachine || ''}
                          onChange={(e) => setNewPlan({ ...newPlan, originalSampleMachine: e.target.value })}
                          className="w-full px-3 py-2 border border-slate-300 rounded"
                        />
                      </div>
                    </div>
                  </>
                ) : (
                  <>
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">Notes</label>
                      <textarea
                        value={newPlan.notes || ''}
                        onChange={(e) => setNewPlan({ ...newPlan, notes: e.target.value })}
                        className="w-full px-3 py-2 border border-slate-300 rounded"
                        rows={4}
                        placeholder="e.g., Change settings for new fabric type"
                      />
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1">Days</label>
                        <input
                          type="number"
                          value={newPlan.days || 0}
                          onChange={(e) => setNewPlan({ ...newPlan, days: Number(e.target.value) })}
                          className="w-full px-3 py-2 border border-slate-300 rounded"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1">Start Date</label>
                        <input
                          type="date"
                          value={newPlan.startDate || ''}
                          onChange={(e) => setNewPlan({ ...newPlan, startDate: e.target.value })}
                          className="w-full px-3 py-2 border border-slate-300 rounded"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1">End Date</label>
                        <input
                          type="date"
                          value={newPlan.endDate || ''}
                          onChange={(e) => setNewPlan({ ...newPlan, endDate: e.target.value })}
                          className="w-full px-3 py-2 border border-slate-300 rounded"
                        />
                      </div>
                    </div>
                  </>
                )}
              </div>

              <div className="border-t border-slate-200 p-4 flex justify-end gap-2">
                <button
                  onClick={() => setAddPlanModal({ isOpen: false, type: 'PRODUCTION' })}
                  className="px-4 py-2 border border-slate-300 text-slate-700 rounded hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  onClick={handleAddPlan}
                  disabled={loading}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded disabled:opacity-50"
                >
                  {loading ? 'Adding...' : 'Add Plan'}
                </button>
              </div>
            </div>
          </div>
        )}
        {/* Mobile Details Modal */}
        {detailsModal && detailsModal.isOpen && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-lg shadow-xl w-full max-w-sm overflow-hidden">
              <div className="bg-slate-50 px-4 py-3 border-b border-slate-200 flex justify-between items-center">
                <h3 className="font-bold text-slate-800">
                  {detailsModal.log.machineName} Details
                </h3>
                <button 
                  onClick={() => setDetailsModal(null)}
                  className="text-slate-400 hover:text-slate-600"
                >
                  ✕
                </button>
              </div>
              
              <div className="p-4 space-y-4">
                {/* Scrap */}
                <div>
                  <label className="block text-xs font-bold text-slate-500 mb-1">Scrap (السقط)</label>
                  <input
                    type="number"
                    defaultValue={detailsModal.log.scrap || 0}
                    onBlur={(e) => handleBlur(e, detailsModal.log.machineId, detailsModal.log.id, 'scrap')}
                    className="w-full p-2 border border-slate-300 rounded text-center font-bold"
                  />
                </div>

                {/* Reason */}
                <div>
                  <label className="block text-xs font-bold text-slate-500 mb-1">Reason (السبب)</label>
                  <input
                    type="text"
                    defaultValue={detailsModal.log.reason || ''}
                    onBlur={(e) => handleBlur(e, detailsModal.log.machineId, detailsModal.log.id, 'reason')}
                    placeholder="السبب..."
                    className="w-full p-2 border border-slate-300 rounded text-right"
                  />
                </div>

                {/* End Date */}
                <div>
                  <label className="block text-xs font-bold text-slate-500 mb-1">End Date (تاريخ الانتهاء)</label>
                  <div className="w-full p-2 bg-slate-50 border border-slate-200 rounded text-center font-semibold text-blue-700">
                    {calculateEndDate(detailsModal.log.date || selectedDate, detailsModal.log.remainingMfg || 0, detailsModal.log.dayProduction || 0)}
                  </div>
                </div>
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
        {/* Link Order Modal */}
        <LinkOrderModal
          isOpen={linkModalOpen.isOpen}
          onClose={() => setLinkModalOpen({ isOpen: false, machine: null })}
          machine={linkModalOpen.machine}
          orders={customerOrders}
          onLink={handleLinkOrder}
        />

      </div>
    </div>
  );
};

export default FetchDataPage;
