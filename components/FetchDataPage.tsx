import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { writeBatch, doc, getDoc, onSnapshot, collection, setDoc } from 'firebase/firestore';
import { db } from '../services/firebase';
import { DataService } from '../services/dataService';
import { parseFabricName } from '../services/data';
import { PlanItem, MachineStatus, CustomerOrder, MachineRow, FabricDefinition } from '../types';
import { LinkOrderModal } from './LinkOrderModal';
import { toJpeg } from 'html-to-image';
import { jsPDF } from 'jspdf';
import { CheckCircle, Send, Link, Truck, Layout, Factory, X, Check, Sparkles, Edit, ArrowRight, History, Plus, Search, Calendar, FileText, Book, Trash2 } from 'lucide-react';
import { ProfessionalDatePicker } from './ProfessionalDatePicker';
import { ExternalProductionSheet } from './ExternalProductionSheet'; // New Component - Force Refresh
import { StandaloneFabricEditor } from './FabricEditor';
import { FabricDirectoryModal } from './FabricDirectoryModal';
import { MachineHistoryModal } from './MachineHistoryModal';
import { DailySummaryModal } from './DailySummaryModal';

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
  // Format: "13-Jan"
  const dateStr = startDate.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  return dateStr.replace(' ', '-');
};

// Helper function to calculate plan end date based on start date and remaining/production
const calculatePlanEndDate = (startDate: string, remaining: number, productionPerDay: number): string => {
  if (!productionPerDay || productionPerDay <= 0 || !remaining || remaining <= 0 || !startDate) return '';
  const daysNeeded = Math.ceil(remaining / productionPerDay);
  const start = new Date(startDate);
  start.setDate(start.getDate() + daysNeeded);
  return start.toISOString().split('T')[0];
};

const formatDateShort = (dateStr: string) => {
  if (!dateStr || dateStr === '-') return '-';
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return dateStr;
  const str = date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  return str.replace(' ', '-');
};

const STATUS_LABELS: Record<MachineStatus, string> = {
  [MachineStatus.WORKING]: 'تعمل',
  [MachineStatus.UNDER_OP]: 'تحت التشغيل',
  [MachineStatus.NO_ORDER]: 'متوقفة',
  [MachineStatus.OUT_OF_SERVICE]: 'خارج الخدمة',
  [MachineStatus.QALB]: 'قلب',
  [MachineStatus.SAMPLES]: 'عينات',
  [MachineStatus.OTHER]: 'Other'
};

const STATUS_COLOR_MAP: Record<MachineStatus, string> = {
  [MachineStatus.WORKING]: 'bg-emerald-50 text-emerald-900',
  [MachineStatus.UNDER_OP]: 'bg-amber-50 text-amber-900',
  [MachineStatus.NO_ORDER]: 'bg-slate-100 text-slate-500',
  [MachineStatus.OUT_OF_SERVICE]: 'bg-red-50 text-red-900',
  [MachineStatus.QALB]: 'bg-purple-100 text-purple-900',
  [MachineStatus.SAMPLES]: 'bg-cyan-100 text-cyan-900',
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
  'عينات': MachineStatus.SAMPLES,
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
  onCreateNew?: () => void;
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  onFocus?: () => void;
  placeholder?: string;
  strict?: boolean;
  disabled?: boolean;
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
  strict = false,
  disabled = false
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
    onChange(option.name);
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
    // Strict Mode: Clear if not in options
    if (strict && inputValue.trim()) {
      const match = options.find(opt => 
        getLabel(opt).toLowerCase() === inputValue.toLowerCase() || 
        opt.name.toLowerCase() === inputValue.toLowerCase()
      );
      
      if (!match) {
        setInputValue('');
        onChange('');
      } else {
        // Normalize to the correct name if it was a case-insensitive match
        if (match.name !== value) {
            onChange(match.name);
        }
      }
    }

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
          if (disabled) return;
          window.dispatchEvent(new CustomEvent('searchdropdown:open', { detail: { id } }));
          setIsOpen(true);
          onFocus?.();
        }}
        onBlur={handleInputBlur}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        disabled={disabled}
        className={`w-full px-1 py-0 text-xs outline-none bg-transparent ${disabled ? 'cursor-not-allowed opacity-60' : ''}`}
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
                  className="px-2 py-1.5 hover:bg-blue-50 cursor-pointer text-xs border-b border-slate-100 last:border-b-0"
                >
                  {getLabel(opt)}
                </div>
              ))}
              {searchTerm && onCreateNew && !options.some(o => o.name.toLowerCase() === searchTerm.toLowerCase()) && (
                <div
                  onClick={handleCreateNew}
                  className="px-2 py-1.5 hover:bg-emerald-50 cursor-pointer text-xs border-t border-slate-200 text-emerald-600 font-medium"
                >
                  + اضافة "{inputValue}"
                </div>
              )}
            </>
          ) : searchTerm && onCreateNew ? (
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
  onNavigateToPlanning?: (mode: 'INTERNAL' | 'EXTERNAL') => void;
  onNavigateToOrder?: (client: string, fabric?: string) => void;
  userRole?: 'admin' | 'editor' | 'viewer' | 'dyehouse_manager' | 'dyehouse_colors_manager' | 'factory_manager' | null;
}

const FetchDataPage: React.FC<FetchDataPageProps> = ({ 
  selectedDate: propSelectedDate,
  machines = [],
  onNavigateToPlanning,
  onNavigateToOrder,
  userRole
}) => {
  // Viewer role is read-only
  const isReadOnly = userRole === 'viewer';
  
  const [selectedDate, setSelectedDate] = useState<string>(propSelectedDate || new Date().toISOString().split('T')[0]);
  const [reportDates, setReportDates] = useState<string[]>([]);
  const [activeDay, setActiveDay] = useState<string>('');
  const [isDownloading, setIsDownloading] = useState(false);
  const [isSendingReport, setIsSendingReport] = useState(false);
  const [isReportSent, setIsReportSent] = useState(false);
  const [isNewDay, setIsNewDay] = useState(false);
  const [reportStarted, setReportStarted] = useState(false);
  const [sourceDate, setSourceDate] = useState<string>('');
  const [fetchModalOpen, setFetchModalOpen] = useState(false);
  const [fetchSourceDate, setFetchSourceDate] = useState<string>('');
  const [lastValidDate, setLastValidDate] = useState<string>('');
  const [isFabricModalOpen, setIsFabricModalOpen] = useState(false);
  const [editingFabric, setEditingFabric] = useState<FabricDefinition | null>(null);
  const [isFabricDirectoryOpen, setIsFabricDirectoryOpen] = useState(false);
  const [isSummaryModalOpen, setIsSummaryModalOpen] = useState(false);
  const [historyModalOpen, setHistoryModalOpen] = useState<{
    isOpen: boolean;
    machineId: string;
    machineName: string;
  }>({
    isOpen: false,
    machineId: '',
    machineName: ''
  });
  
  // Ref to track if the user has manually changed the date (to avoid auto-triggering "New Day" modal on load)
  const isUserDateSelection = useRef(false);

  const [confirmModal, setConfirmModal] = useState<{
    isOpen: boolean;
    type: 'fabric' | 'client';
    name: string;
    machineId: string;
    logId: string;
  }>({
    isOpen: false,
    type: 'fabric',
    name: '',
    machineId: '',
    logId: ''
  });
  const printRef = useRef<HTMLDivElement>(null);

  // Filter State
  const [searchTerm, setSearchTerm] = useState('');
  const [filterClient, setFilterClient] = useState('');
  const [filterFabric, setFilterFabric] = useState('');
  const [filterType, setFilterType] = useState('ALL');

  const [rawMachines, setRawMachines] = useState<any[]>([]);
  const [allLogs, setAllLogs] = useState<any[]>([]);
  // filteredLogs is derived via useMemo below


  const availableTypes = React.useMemo(() => {
    const types = new Set(allLogs.map(m => m.machineType));
    return ['ALL', ...Array.from(types).filter(Boolean).sort()];
  }, [allLogs]);
  const [fabrics, setFabrics] = useState<any[]>([]);
  const [clients, setClients] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [fetchTime, setFetchTime] = useState<number>(0);
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
  const [externalScrap, setExternalScrap] = useState<number>(0);
  const [hallScrap, setHallScrap] = useState<number>(0);
  const [labScrap, setLabScrap] = useState<number>(0);
  const [showExternalSheet, setShowExternalSheet] = useState(false); // Toggle for External Sheet
  
  // Centralized fabric save handler using DataService.upsertFabric
  const handleFabricSaved = async (savedFabric: FabricDefinition) => {
    const updatedFabrics = await DataService.getFabrics();
    setFabrics(updatedFabrics);
    setIsFabricModalOpen(false);
    setEditingFabric(null);
    showMessage(editingFabric ? '✅ Fabric updated successfully' : '✅ Fabric added successfully');
  };

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

  // Fetch all days that have reports for the calendar highlighting
  useEffect(() => {
    const fetchReportDates = async () => {
      try {
        const machines = await DataService.getMachinesFromMachineSS();
        const dates = new Set<string>();
        machines.forEach(m => {
          if (m.dailyLogs) {
            m.dailyLogs.forEach((log: any) => {
              if (log.date) dates.add(log.date);
            });
          }
        });
        setReportDates(Array.from(dates));
      } catch (error) {
        console.error("Error fetching report dates:", error);
      }
    };
    fetchReportDates();
  }, []);

  // Load machines, fabrics, and clients on mount
  useEffect(() => {
    loadFabricsAndClients();
    handleFetchLogs(selectedDate);
  }, [selectedDate]);

  // Filter logs when searchTerm or allLogs changes
  const filteredLogs = useMemo(() => {
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
    return filtered;
  }, [searchTerm, filterClient, filterFabric, allLogs, filterType]);

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

  const handleFetchFromPreviousDay = async (customSourceDate?: string) => {
    // Use custom source date if provided, otherwise calculate yesterday
    let previousDate = '';
    if (customSourceDate) {
        previousDate = customSourceDate;
    } else {
        const dateObj = new Date(selectedDate);
        dateObj.setDate(dateObj.getDate() - 1);
        previousDate = dateObj.toISOString().split('T')[0];
    }

    if (!customSourceDate && !window.confirm(`Fetch data from ${previousDate}? This will update the Remaining Quantity based on yesterday's production.`)) {
      return;
    }

    setLoading(true);
    try {
      // Use local state instead of fetching to ensure we have the latest offline edits
      const machines = rawMachines.length > 0 ? rawMachines : await DataService.getMachinesFromMachineSS();
      const updatePromises: Promise<void>[] = [];
      let updatedCount = 0;

      for (const machine of machines) {
        const prevLog = (machine.dailyLogs || []).find((l: any) => l.date === previousDate);
        
        if (prevLog) {
           const prevRemaining = Number(prevLog.remainingMfg) || Number(prevLog.remaining) || 0;
           const newRemaining = prevRemaining; 

           const newLogEntry = {
             id: selectedDate,
             date: selectedDate,
             dayProduction: 0,
             scrap: 0,
             reason: '',
             status: prevLog.status,
             fabric: prevLog.fabric,
             client: prevLog.client,
             avgProduction: prevLog.avgProduction || machine.avgProduction || 0,
             remainingMfg: newRemaining,
             customStatusNote: prevLog.customStatusNote || '',
             timestamp: new Date().toISOString()
           };

           const currentLogs = machine.dailyLogs || [];
           const existingLogIndex = currentLogs.findIndex((l: any) => l.date === selectedDate);
           
           let updatedLogs = [...currentLogs];
           if (existingLogIndex >= 0) {
             updatedLogs[existingLogIndex] = { ...updatedLogs[existingLogIndex], ...newLogEntry };
           } else {
             updatedLogs.push(newLogEntry);
           }

           // 1. Update Array (Legacy Support)
           const updatePromise = DataService.updateMachineInMachineSS(String(machine.id), {
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
           });

           // 2. Update Sub-collection (New Architecture)
           // This ensures App.tsx sees the data even if it prioritizes sub-collections
           const subCollectionPromise = DataService.updateDailyLog(String(machine.id), selectedDate, newLogEntry);

           updatePromises.push(Promise.all([updatePromise, subCollectionPromise]).then(() => {}));
           updatedCount++;
        }
      }

      await Promise.all(updatePromises);
      // Subscription handles update
      showMessage(`✅ Fetched data for ${updatedCount} machines from ${previousDate}`);
      
      // If we were in "New Day" mode, this will trigger a re-render with data, so we exit that mode
      setReportStarted(true);

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

    // If no filter is active, we can swap in allLogs.
    if (!searchTerm && filterType === 'ALL' && !filterClient && !filterFabric) {
        setAllLogs(newLogs); 
    } else {
        alert("Drag and drop is only available when no filters are active.");
        return;
    }

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
    // 1. Load from Local Storage (Cache) first for offline support
    const cachedFabrics = localStorage.getItem('cached_fabrics');
    const cachedClients = localStorage.getItem('cached_clients');
    
    if (cachedFabrics) {
      try {
        setFabrics(JSON.parse(cachedFabrics));
      } catch (e) { console.error("Error parsing cached fabrics", e); }
    }
    
    if (cachedClients) {
      try {
        setClients(JSON.parse(cachedClients));
      } catch (e) { console.error("Error parsing cached clients", e); }
    }

    try {
      const [fabricsData, clientsData, ordersData] = await Promise.all([
        DataService.getFabrics(),
        DataService.getClients(),
        DataService.getCustomerOrders()
      ]);
      
      // 2. Update State & Cache
      setFabrics(fabricsData);
      setClients(clientsData);
      setCustomerOrders(ordersData);
      
      localStorage.setItem('cached_fabrics', JSON.stringify(fabricsData));
      localStorage.setItem('cached_clients', JSON.stringify(clientsData));
      
    } catch (error) {
      console.error('Error loading fabrics and clients (Offline mode active):', error);
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

  // Real-time Subscription
  // REPLACED: We now rely on the 'machines' prop passed from App.tsx which handles the complex merging of Sub-collections + Arrays.
  // This fixes the "Disappearing Data" issue where local state was out of sync with the parent's view.
  useEffect(() => {
    if (machines && machines.length > 0) {
      setRawMachines(machines);
    }
  }, [machines]);

  /* REMOVED: Internal Listener (Legacy)
  useEffect(() => {
    setLoading(true);
    const unsubscribe = onSnapshot(collection(db, 'MachineSS'), (snapshot) => {
      const machines = snapshot.docs.map(doc => ({
        ...doc.data(),
        id: doc.id,
        firestoreId: doc.id
      }));
      setRawMachines(machines);
      setLoading(false);
    }, (error) => {
      console.error("Error fetching machines:", error);
      showMessage('❌ Error connecting to database', true);
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);
  */

  // Process logs whenever machines or date changes
  useEffect(() => {
    // Reset report started state when date changes
    setReportStarted(false);
  }, [selectedDate]);

  useEffect(() => {
    if (rawMachines.length === 0) return;
    processLogs(rawMachines, selectedDate);
  }, [rawMachines, selectedDate, reportStarted]);

  const processLogs = useCallback(async (machines: any[], date: string) => {
    const startTime = performance.now();
    
    // Check if we have ANY real logs for this date
    const hasRealLogs = machines.some(m => (m.dailyLogs || []).some((l: any) => l.date === date));
    
    // Auto-start report (skip modal)
    // setIsNewDay(false);
    if (!hasRealLogs) {
      if (isUserDateSelection.current) {
         setIsNewDay(true);
      }
    } else {
      setIsNewDay(false);
    }
    setLastValidDate(date);

    // Check if any machine is missing a log for this date and create it
    const updatedMachines = machines.map((machine) => {
      const logsForDate = (machine.dailyLogs || []).filter((log: any) => log.date === date);
      
      if (logsForDate.length === 0) {
        // Machine doesn't have a log for this date, create a virtual one
        const sortedLogs = (machine.dailyLogs || []).sort((a: any, b: any) => b.date.localeCompare(a.date));
        const lastLog = sortedLogs.find((l: any) => l.date < date);
        
        const defaultClient = lastLog ? lastLog.client : (machine.client || '');
        const defaultFabric = lastLog ? lastLog.fabric : (machine.material || machine.fabric || '');
        const defaultStatus = lastLog ? lastLog.status : (machine.status || '');

        const newLog = {
          id: date,
          date: date,
          dayProduction: 0,
          scrap: 0,
          status: defaultStatus,
          fabric: defaultFabric,
          client: defaultClient,
          avgProduction: machine.avgProduction || 0,
          remainingMfg: lastLog ? (Number(lastLog.remainingMfg) || 0) : 0,
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
          futurePlans: machine.futurePlans, // Include future plans to show "Next Up" in summary
          ...log,
          // Use machineId as the unique ID for the row as there is only one log per machine per day
          id: machine.id
        });
      });
    });

    // Fetch daily summary (external production)
    // Note: This is still async/fetch based. Ideally should be subscribed too.
    try {
      const dailySummary = await DataService.getDailySummary(date);
      setExternalProduction(dailySummary?.externalProduction || 0);
      setExternalScrap(dailySummary?.externalScrap || 0);
      setHallScrap(dailySummary?.hallScrap || 0);
      setLabScrap(dailySummary?.labScrap || 0);
    } catch (e) {
      console.warn("Failed to fetch daily summary", e);
    }
    
    setAllLogs(flattenedLogs);
    // setFilteredLogs(flattenedLogs); // Derived
    
    const endTime = performance.now();
    const timeTaken = (endTime - startTime).toFixed(2);
    setFetchTime(parseFloat(timeTaken));
  }, [reportStarted]);

  const handleFetchLogs = useCallback(async (date: string) => {
    // Legacy function kept for compatibility, but now just triggers processLogs if we have data
    if (rawMachines.length > 0) {
      processLogs(rawMachines, date);
    }
  }, [rawMachines, processLogs]);

  /* 
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
          // Try to find the most recent log to carry over client/fabric
          const sortedLogs = (machine.dailyLogs || []).sort((a: any, b: any) => b.date.localeCompare(a.date));
          const lastLog = sortedLogs.find((l: any) => l.date < date);
          
          const defaultClient = lastLog ? lastLog.client : (machine.client || '');
          const defaultFabric = lastLog ? lastLog.fabric : (machine.material || machine.fabric || '');
          const defaultStatus = lastLog ? lastLog.status : (machine.status || '');

          const newLog = {
            id: date,
            date: date,
            dayProduction: 0,
            scrap: 0,
            status: defaultStatus,
            fabric: defaultFabric,
            client: defaultClient,
            avgProduction: machine.avgProduction || 0,
            remainingMfg: lastLog ? (Number(lastLog.remainingMfg) || 0) : 0,
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
      setHallScrap(dailySummary?.hallScrap || 0);
      setLabScrap(dailySummary?.labScrap || 0);
      
      setAllLogs(flattenedLogs);
      // setFilteredLogs(flattenedLogs); // Derived
      
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
  */

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

  const handleUpdateLog = async (machineId: string, logId: string, field: string, newValue: any, onlyLocal = false) => {
    // Get current values from local state to ensure we don't overwrite recent changes
    // that might not be in Firestore yet (Race Condition Fix)
    const currentLog = allLogs.find(l => l.machineId === machineId && l.id === logId);
    const effectiveClient = field === 'client' ? newValue : (currentLog?.client || '');
    const effectiveFabric = field === 'fabric' ? newValue : (currentLog?.fabric || '');
    const effectiveStatus = field === 'status' ? newValue : (currentLog?.status || '');

    // Optimistic Update
    let calculatedRemaining: number | undefined;
    let currentClient = effectiveClient;
    let currentFabric = effectiveFabric;

    setAllLogs(prevLogs => prevLogs.map(log => {
      if (log.machineId === machineId && log.id === logId) {
        const updatedLog = { ...log, [field]: newValue };
        
        // When user manually edits remaining, mark it as overridden
        // This prevents dayProduction changes from auto-calculating remaining
        if (field === 'remainingMfg') {
           updatedLog.remainingOverride = true;
        }
        
        // Only auto-calculate remaining if it wasn't manually overridden
        if (field === 'dayProduction' && !log.remainingOverride) {
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

    if (onlyLocal) return;

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
          status: effectiveStatus || machine.status || '',
          fabric: effectiveFabric,
          client: effectiveClient,
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

      // Sanitize Numeric Fields for Firestore (keep UI state flexible for typing)
      const sanitizedLog = { ...updatedLogs[logIndex] };
      if (['remainingMfg', 'dayProduction', 'avgProduction', 'scrap'].includes(field)) {
          sanitizedLog[field] = Number(newValue) || 0;
          // Apply to the log in array
          updatedLogs[logIndex][field] = Number(newValue) || 0;
      }
      
      // Persist the remainingOverride flag to Firestore when remaining is manually edited
      if (field === 'remainingMfg') {
          updatedLogs[logIndex].remainingOverride = true;
      }
      // Also ensure remainingMfg is number if it was recalculated
      if (calculatedRemaining !== undefined) {
          updatedLogs[logIndex].remainingMfg = Number(calculatedRemaining);
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
      
      // Also update the subcollection log to ensure History Modal works correctly
      if (updatedLogs[logIndex]) {
          await DataService.updateDailyLog(machineId, updatedLogs[logIndex].date, updatedLogs[logIndex]);
      }

      // Optimistic update already handled the UI. No need to re-fetch immediately.
      showMessage('✅ Updated');
    } catch (error: any) {
      showMessage('❌ Error: ' + error.message, true);
      // Revert on error
      handleFetchLogs(selectedDate);
    }
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
        client: inlineNewPlan.orderName || '', // Map orderName to client for display
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
  // Calculate Samples Production separately
  const samplesProduction = filteredLogs.reduce((sum, m) => {
    if (normalizeStatusValue(m.status) === MachineStatus.SAMPLES) {
      return sum + (Number(m.dayProduction) || 0);
    }
    return sum;
  }, 0);

  const bousProduction = bousMachines.reduce((sum, m) => {
    if (normalizeStatusValue(m.status) === MachineStatus.SAMPLES) return sum;
    return sum + (Number(m.dayProduction) || 0);
  }, 0);
  
  const wideProduction = wideMachines.reduce((sum, m) => {
    if (normalizeStatusValue(m.status) === MachineStatus.SAMPLES) return sum;
    return sum + (Number(m.dayProduction) || 0);
  }, 0);

  const totalProduction = wideProduction + bousProduction + Number(externalProduction);
  const totalScrap = filteredLogs.reduce((sum, m) => sum + (Number(m.scrap) || 0), 0) + Number(hallScrap) + Number(labScrap) + Number(externalScrap) + samplesProduction;
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

  const handleHallScrapBlur = async () => {
    try {
      await DataService.updateDailySummary(selectedDate, { hallScrap });
      showMessage('✅ Hall scrap saved');
    } catch (error) {
      console.error('Error saving hall scrap:', error);
      showMessage('❌ Error saving hall scrap', true);
    }
  };

  const handleLabScrapBlur = async () => {
    try {
      await DataService.updateDailySummary(selectedDate, { labScrap });
      showMessage('✅ Lab scrap saved');
    } catch (error) {
      console.error('Error saving lab scrap:', error);
      showMessage('❌ Error saving lab scrap', true);
    }
  };

  const handleDownloadPDF = async () => {
    if (!printRef.current) return;
    setIsDownloading(true);

    try {
      const originalElement = printRef.current;
      
      // 1. Clone the node manually to avoid modifying the live DOM
      const clone = originalElement.cloneNode(true) as HTMLElement;
      
      // 2. Setup clone for capture (off-screen but visible)
      clone.style.position = 'absolute';
      clone.style.top = '0';
      clone.style.left = '0';
      clone.style.zIndex = '-9999'; // Place behind everything instead of far off-screen
      // Use fit-content to ensure we only capture the actual content size after compaction
      clone.style.width = 'fit-content';
      clone.style.height = 'fit-content';
      clone.style.backgroundColor = '#ffffff';
      document.body.appendChild(clone);

      // 3. Apply transformations to the clone
      
      // Show header
      const header = clone.querySelector('.print-header') as HTMLElement;
      if (header) {
        header.classList.remove('hidden');
        header.style.display = 'block';
      }

      // Compact Layout Adjustments
      const cells = clone.querySelectorAll('th, td');
      cells.forEach((cell) => {
        (cell as HTMLElement).style.padding = '4px';
        (cell as HTMLElement).style.fontSize = '10px';
      });

      const footerDivs = clone.querySelectorAll('.p-4');
      footerDivs.forEach((div) => {
          if (div.parentElement?.classList.contains('divide-slate-200')) {
            (div as HTMLElement).style.padding = '8px';
          }
      });

      const largeTexts = clone.querySelectorAll('.text-2xl, .text-3xl');
      largeTexts.forEach((el) => {
          if (el.classList.contains('text-3xl')) {
            (el as HTMLElement).style.fontSize = '1.25rem';
          } else {
            (el as HTMLElement).style.fontSize = '1rem';
          }
      });
      
      const statusSection = clone.querySelector('.md\\:w-64');
      if (statusSection) {
          (statusSection as HTMLElement).style.padding = '8px';
      }

      // Replace inputs/textareas/selects with text spans
      // We must read values from the ORIGINAL elements because cloneNode doesn't copy current values
      const originalInputs = originalElement.querySelectorAll('input, textarea, select');
      const cloneInputs = clone.querySelectorAll('input, textarea, select');
      
      cloneInputs.forEach((cloneInput, index) => {
          const originalInput = originalInputs[index] as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
          
          const span = document.createElement('span');
          span.style.display = 'flex';
          span.style.alignItems = 'center';
          span.style.justifyContent = 'center';
          span.style.width = '100%';
          span.style.height = '100%';
          span.style.fontSize = 'inherit';
          span.style.fontWeight = window.getComputedStyle(originalInput).fontWeight;
          span.style.color = window.getComputedStyle(originalInput).color;
          span.style.fontFamily = window.getComputedStyle(originalInput).fontFamily;
          span.style.textAlign = 'center';
          span.style.whiteSpace = 'pre-wrap';

          if (cloneInput.tagName === 'SELECT') {
             const select = originalInput as HTMLSelectElement;
             const selectedOption = select.options[select.selectedIndex];
             span.textContent = selectedOption ? selectedOption.text : '';
          } else {
             span.textContent = originalInput.value;
          }

          // Fix Arabic Text Direction
          if (/[\u0600-\u06FF]/.test(span.textContent || '')) {
             span.style.direction = 'rtl';
             span.style.unicodeBidi = 'isolate';
          }

          if (cloneInput.parentNode) {
            cloneInput.parentNode.replaceChild(span, cloneInput);
          }
      });

      // Scrollables
      const scrollables = clone.querySelectorAll('.overflow-x-auto');
      scrollables.forEach(el => {
          (el as HTMLElement).style.overflow = 'visible';
          (el as HTMLElement).style.display = 'block';
          (el as HTMLElement).style.width = 'fit-content';
      });
      
      // Hide elements
      const handles = clone.querySelectorAll('.drag-handle');
      handles.forEach(el => (el as HTMLElement).style.display = 'none');
      
      const noPrints = clone.querySelectorAll('.no-print');
      noPrints.forEach(el => (el as HTMLElement).style.display = 'none');

      const rows = clone.querySelectorAll('tr');
      rows.forEach(row => {
        if (row.lastElementChild) {
          (row.lastElementChild as HTMLElement).style.display = 'none';
        }
      });

      // Wait for layout to settle (fixes white screen issue)
      await new Promise(resolve => setTimeout(resolve, 100));

      // 4. Generate Image using html-to-image
      const dataUrl = await toJpeg(clone, {
        quality: 0.8,
        cacheBust: true,
        backgroundColor: '#ffffff',
        pixelRatio: 1.5,
      });

      // 5. Generate PDF
      const pdf = new jsPDF({
        orientation: 'l',
        unit: 'mm',
        format: 'a4',
        compress: true // Enable PDF compression
      });
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const margin = 5;
      const maxContentWidth = pageWidth - (margin * 2);
      const maxContentHeight = pageHeight - (margin * 2);

      const imgProps = pdf.getImageProperties(dataUrl);
      const imgWidth = imgProps.width;
      const imgHeight = imgProps.height;
      
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

      // Center horizontally if scaled down by height
      const xOffset = margin + (maxContentWidth - pdfContentWidth) / 2;
      
      pdf.addImage(dataUrl, 'JPEG', xOffset, margin, pdfContentWidth, pdfContentHeight);
      pdf.save(`Daily_Machine_Plan_${new Date(selectedDate).toISOString().split('T')[0]}.pdf`);

      // 6. Cleanup
      document.body.removeChild(clone);

    } catch (error) {
      console.error('Error generating PDF:', error);
      alert('Failed to generate PDF. Please try again.');
    } finally {
      setIsDownloading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 py-6 px-2 sm:px-6">
      {/* Inject global styles to hide number input spinners */}
      <style>{globalStyles}</style>

      {/* Fetch Data Modal */}
      {fetchModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full overflow-hidden border border-slate-200">
            <div className="bg-blue-600 px-6 py-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="bg-white/20 p-2 rounded-lg">
                  <History className="text-white" size={24} />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-white">Fetch Previous Data</h3>
                  <p className="text-blue-100 text-xs">Select source date to copy from</p>
                </div>
              </div>
              <button 
                onClick={() => setFetchModalOpen(false)}
                className="text-white/70 hover:text-white hover:bg-white/10 p-1 rounded-full transition-colors"
                title="Close"
              >
                <X size={20} />
              </button>
            </div>
            
            <div className="p-6 space-y-6">
              <div className="space-y-2">
                <label className="block text-sm font-medium text-slate-700">
                  Source Date:
                </label>
                <div className="flex justify-center">
                  <ProfessionalDatePicker 
                    selectedDate={fetchSourceDate}
                    onChange={(date) => setFetchSourceDate(date)}
                    highlightedDates={reportDates}
                    activeDay={activeDay}
                  />
                </div>
                <p className="text-xs text-slate-500 text-center">
                  Dates marked with a <span className="text-emerald-500 font-bold">green dot</span> have existing report data.
                </p>
              </div>

              <div className="flex flex-col gap-3">
                <button
                  onClick={() => {
                    handleFetchFromPreviousDay(fetchSourceDate);
                    setFetchModalOpen(false);
                  }}
                  disabled={!fetchSourceDate}
                  className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white font-bold py-3 rounded-xl shadow-lg shadow-blue-200 transition-all flex items-center justify-center gap-2 active:scale-[0.98]"
                >
                  <span>Fetch Data</span>
                  <ArrowRight size={18} />
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="max-w-[1400px] mx-auto flex flex-col gap-4">

        {/* Header with Date and Export */}
        <div className="bg-white p-2 md:p-4 rounded-xl border border-slate-200 shadow-sm flex flex-col gap-2 md:gap-4">
          
          {/* Top Row: Date & Global Controls */}
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 border-b border-slate-100 pb-3 md:pb-4">
            
            <div className="flex items-center justify-between w-full md:w-auto">
               {/* Date Selection */}
               <ProfessionalDatePicker 
                 selectedDate={selectedDate}
                 onChange={(date) => {
                  isUserDateSelection.current = true;
                  setSelectedDate(date);
                  handleFetchLogs(date);
                 }}
                 highlightedDates={reportDates}
                 activeDay={activeDay}
               />

               {/* Mobile Active Day Indicator/Toggle */}
               <div className="md:hidden">
                  {activeDay === selectedDate ? (
                    <div className="p-2 rounded-lg text-emerald-600 bg-emerald-50 border border-emerald-200 shadow-sm">
                      <CheckCircle size={18} />
                    </div>
                  ) : (
                    <button
                      onClick={handleMarkActiveDay}
                      className="p-2 rounded-lg text-slate-500 bg-slate-50 border border-slate-200 hover:bg-slate-100 transition-all shadow-sm"
                      title="Set as Active Day"
                    >
                      <Calendar size={18} />
                    </button>
                  )}
               </div>
            </div>

            {/* Filters Group - Scrollable on Mobile */}
            <div className="flex items-center gap-2 overflow-x-auto pb-1 md:pb-0 no-scrollbar -mx-2 px-2 md:mx-0 md:px-0">
               <div className="relative shrink-0">
                 <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 w-3.5 h-3.5" />
                 <input 
                   type="text" 
                   placeholder="Search..." 
                   value={searchTerm}
                   onChange={(e) => setSearchTerm(e.target.value)}
                   className="pl-8 pr-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none w-28 md:w-32 transition-all"
                 />
               </div>
               
               <select
                 value={filterType}
                 onChange={(e) => setFilterType(e.target.value)}
                 className="shrink-0 px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none cursor-pointer"
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
                 className="shrink-0 px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none w-24 md:w-28 transition-all"
               />
               
               <input 
                 type="text" 
                 placeholder="Fabric..." 
                 value={filterFabric}
                 onChange={(e) => setFilterFabric(e.target.value)}
                 className="shrink-0 px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none w-24 md:w-28 transition-all"
               />
            </div>
            
             {/* Desktop Sync Status */}
             <div className="hidden md:flex items-center gap-2 px-3 py-1.5 rounded-full bg-slate-50 border border-slate-200 text-xs font-medium text-slate-500 shrink-0">
                {navigator.onLine ? (
                  <>
                    <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></div>
                    <span>Synced</span>
                  </>
                ) : (
                  <>
                    <div className="w-2 h-2 rounded-full bg-amber-500"></div>
                    <span>Local Mode</span>
                  </>
                )}
              </div>
          </div>

          {/* Bottom Row: Actions */}
          <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
            
            {/* Primary Actions Scrollable */}
            <div className="flex items-center gap-2 overflow-x-auto pb-1 md:pb-0 no-scrollbar -mx-2 px-2 md:mx-0 md:px-0">
              <button
                onClick={() => setIsFabricModalOpen(true)}
                className="shrink-0 px-4 py-2 rounded-lg text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 active:bg-blue-800 transition-colors flex items-center gap-2 shadow-sm"
              >
                <Plus size={16} />
                <span className="hidden xs:inline">Add Fabric</span>
                <span className="xs:hidden">Fabric</span>
              </button>

              <button
                onClick={() => setIsFabricDirectoryOpen(true)}
                className="shrink-0 px-3 py-2 rounded-lg text-sm font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 hover:border-slate-300 transition-all flex items-center gap-2 shadow-sm"
              >
                <Book size={16} />
                <span className="hidden xs:inline">Directory</span>
              </button>

              <button
                onClick={() => {
                  const dateObj = new Date(selectedDate);
                  dateObj.setDate(dateObj.getDate() - 1);
                  setFetchSourceDate(dateObj.toISOString().split('T')[0]);
                  setFetchModalOpen(true);
                }}
                className="shrink-0 px-3 py-2 rounded-lg text-sm font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 hover:border-slate-300 transition-all flex items-center gap-2 shadow-sm"
              >
                <span>↺</span> 
                <span className="hidden xs:inline">Fetch Data</span>
                <span className="xs:hidden">Fetch</span>
              </button>

              {/* Desktop Active Day Button */}
              <div className="hidden md:block">
                  {activeDay === selectedDate ? (
                    <div className="px-3 py-2 rounded-lg text-sm font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 flex items-center gap-2 shadow-sm cursor-default">
                      <CheckCircle size={16} />
                      Active Day
                    </div>
                  ) : (
                    <button
                      onClick={handleMarkActiveDay}
                      className="px-3 py-2 rounded-lg text-sm font-medium text-slate-600 bg-slate-100 border border-slate-200 hover:bg-slate-200 transition-all flex items-center gap-2 shadow-sm"
                    >
                      <Calendar size={16} />
                      Mark Active
                    </button>
                  )}
              </div>
            </div>

            {/* Secondary Actions / Tools */}
            <div className="flex items-center justify-between md:justify-end gap-2 pt-2 md:pt-0 border-t md:border-t-0 border-slate-100">
              
              <div className="flex items-center gap-2">
                  <button
                    onClick={handleDownloadPDF}
                    disabled={isDownloading}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-bold text-red-600 bg-red-50 border border-red-200 hover:bg-red-100 transition-all disabled:opacity-50 shadow-sm"
                  >
                    <FileText size={16} />
                    <span className="hidden sm:inline">PDF</span>
                  </button>
              </div>

              <div className="h-8 w-px bg-slate-200 mx-1 hidden sm:block"></div>

              <button
                onClick={() => setIsSummaryModalOpen(true)}
                className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold transition-all shadow-sm border bg-slate-800 text-white border-slate-800 hover:bg-slate-700 hover:border-slate-700"
              >
                <Book className="w-4 h-4" />
                <span className="hidden sm:inline">Daily Summary</span>
                <span className="sm:hidden">Summary</span>
              </button>
            </div>
          </div>
        </div>

        {/* View Toggle - Centered Below Header */}
        <div className="flex justify-center mb-6">
          <div className="bg-slate-100 p-1 rounded-lg flex items-center border border-slate-200 shadow-sm">
            <button
              onClick={() => setShowExternalSheet(false)}
              className={`flex items-center gap-2 px-6 py-2 rounded-md text-sm font-bold transition-all ${
                !showExternalSheet
                  ? 'bg-white text-blue-600 shadow-sm ring-1 ring-black/5'
                  : 'text-slate-500 hover:text-slate-700 hover:bg-slate-200/50'
              }`}
            >
              <Layout size={18} />
              Internal Schedule
            </button>
            <button
              onClick={() => setShowExternalSheet(true)}
              className={`flex items-center gap-2 px-6 py-2 rounded-md text-sm font-bold transition-all ${
                showExternalSheet
                  ? 'bg-white text-indigo-600 shadow-sm ring-1 ring-black/5'
                  : 'text-slate-500 hover:text-slate-700 hover:bg-slate-200/50'
              }`}
            >
              <Factory size={18} />
              External Schedule
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
        {!showExternalSheet ? (
          <>
          <div ref={printRef} className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
            {/* Header for PDF only */}
            <div className="hidden print-header mb-4 text-center border-b border-slate-100 pb-4">
                <h1 className="text-xl font-bold text-slate-800 uppercase tracking-wide">Daily Machine Plan</h1>
                <p className="text-sm text-slate-500">Date: {new Date(selectedDate).toLocaleDateString('en-GB', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</p>
            </div>

          {/* Mobile Card View */}
          <div className="md:hidden grid grid-cols-2 gap-2">
            {filteredLogs.length === 0 ? (
              <div className="col-span-2 p-6 text-center text-slate-500 bg-slate-50 rounded-lg border border-slate-200">
                No logs found
              </div>
            ) : (
              filteredLogs.map((log: any, idx: number) => {
                const normalizedStatus = normalizeStatusValue(log.status);
                const isWorking = normalizedStatus === MachineStatus.WORKING;
                const endDate = calculateEndDate(log.date || selectedDate, log.remainingMfg || 0, log.dayProduction || 0);
                const diff = ((Number(log.dayProduction) || 0) - (Number(log.avgProduction) || 0)).toFixed(1);
                const { shortName } = parseFabricName(log.fabric || '');
                
                return (
                  <div key={`${log.machineId}-${idx}`} className="bg-white rounded-lg border border-slate-200 shadow-sm overflow-hidden flex flex-col">
                    {/* Card Header */}
                    <div className="bg-slate-50 px-2 py-2 border-b border-slate-100 flex justify-between items-center">
                      <div className="flex items-center gap-1 overflow-hidden">
                        <span className="font-bold text-slate-800 text-xs truncate">{log.machineName}</span>
                        <span className="text-[10px] text-slate-400 font-mono shrink-0">#{idx + 1}</span>
                      </div>
                      <div className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider shrink-0 ${getStatusColor(normalizedStatus)}`}>
                        {getStatusLabel(normalizedStatus)}
                      </div>
                    </div>

                    {/* Card Body */}
                    <div className="p-2 grid grid-cols-1 gap-2 text-xs flex-1">
                      <div>
                        <span className="text-[10px] text-slate-400 block mb-0.5">Fabric</span>
                        <div className="font-medium text-slate-700 whitespace-normal leading-tight text-[11px]" title={log.fabric}>{shortName || '-'}</div>
                      </div>
                      
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                            <span className="text-[10px] text-slate-400 block mb-0.5">Client</span>
                            <div className="font-medium text-slate-700 truncate" title={log.client}>{log.client || '-'}</div>
                        </div>
                        <div>
                            <span className="text-[10px] text-slate-400 block mb-0.5">End</span>
                            <div className="font-medium text-blue-600">{endDate}</div>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-2">
                          <div>
                            <span className="text-[10px] text-slate-400 block mb-0.5">Rem</span>
                            <div className={`font-bold ${Number(log.remainingMfg) === 0 ? 'text-green-600' : 'text-slate-700'}`}>
                              {log.remainingMfg || 0}
                            </div>
                          </div>

                          <div>
                            <span className="text-[10px] text-slate-400 block mb-0.5">Prod</span>
                            <div className="font-medium text-slate-700">{log.dayProduction || 0}</div>
                          </div>
                      </div>

                      {(log.scrap > 0 || log.reason) && (
                        <div className="bg-red-50 p-1.5 rounded border border-red-100 mt-1">
                           {log.scrap > 0 && (
                             <div className="flex justify-between mb-0.5">
                               <span className="text-[10px] text-red-500">Scrap:</span>
                               <span className="text-[10px] font-bold text-red-700">{log.scrap}</span>
                             </div>
                           )}
                           {log.reason && (
                             <div className="flex justify-between">
                               <span className="text-[10px] text-red-500">Rsn:</span>
                               <span className="text-[10px] font-bold text-red-700 truncate max-w-[60px]" title={log.reason}>{log.reason}</span>
                             </div>
                           )}
                        </div>
                      )}
                    </div>

                    {/* Card Footer */}
                    <div className="bg-slate-50 px-2 py-2 border-t border-slate-100 flex justify-between items-center gap-2">
                      <button
                        onClick={() => setHistoryModalOpen({ isOpen: true, machineId: log.machineId, machineName: log.machineName })}
                        className="flex-1 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-md text-[10px] font-bold transition-colors flex items-center justify-center gap-1.5 border border-slate-200"
                      >
                        <History size={14} />
                        History
                      </button>
                      <button
                        onClick={() => openPlansModal(log.machineId, log.machineName)}
                        className={`
                            flex-1 py-1.5 rounded-md text-[10px] font-bold transition-all flex items-center justify-center gap-1.5 border
                            ${log.futurePlans && log.futurePlans.filter((p: any) => p.type !== 'SETTINGS').length > 0
                                ? 'bg-emerald-500 hover:bg-emerald-600 text-white border-emerald-600 shadow-sm'
                                : 'bg-white hover:bg-blue-50 text-blue-600 border-blue-200'}
                        `}
                      >
                         {log.futurePlans && log.futurePlans.filter((p: any) => p.type !== 'SETTINGS').length > 0 ? (
                            <>
                                <Calendar size={14} />
                                {log.futurePlans.filter((p: any) => p.type !== 'SETTINGS').length} Plans
                            </>
                         ) : (
                            <>
                                <Plus size={14} />
                                Add Plan
                            </>
                         )}
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          <div className="hidden md:block overflow-x-auto border border-slate-200 rounded-lg shadow-sm bg-white" onBlurCapture={handleGridBlur}>
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
                              disabled={isReadOnly}
                              className={`w-full h-full p-2 text-center bg-transparent focus:bg-blue-50 focus:outline-none appearance-none font-bold text-[10px] ${isReadOnly ? 'cursor-not-allowed opacity-60' : ''}`}
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
                                disabled={isReadOnly}
                                className={`w-full border-t border-slate-200 bg-white/70 text-[10px] text-center p-1 outline-none ${isReadOnly ? 'cursor-not-allowed opacity-60' : ''}`}
                              />
                            )}
                          </div>
                        </td>

                        {/* Avg Production */}
                        <td className="border border-slate-200 p-0 hidden md:table-cell">
                          <input
                            id={getCellId(log.machineId, 'avgProduction')}
                            type="number"
                            value={log.avgProduction ?? ''}
                            data-force-nav="true"
                            onFocus={() => {
                              handleCellFocus(idx, 'avgProduction');
                              window.dispatchEvent(new Event('searchdropdown:forceclose'));
                            }}
                            onChange={(e) => handleUpdateLog(log.machineId, log.id, 'avgProduction', e.target.value, true)}
                            onBlur={(e) => handleUpdateLog(log.machineId, log.id, 'avgProduction', Number(e.target.value), false)}
                            onKeyDown={(e) => handleKeyDown(e, idx, 'avgProduction')}
                            disabled={isReadOnly}
                            className={`w-full h-full p-2 text-center bg-transparent focus:bg-blue-50 focus:outline-none ${isReadOnly ? 'cursor-not-allowed opacity-60' : ''}`}
                          />
                        </td>

                        {/* Day Production */}
                        <td className="border border-slate-200 p-0">
                          <input
                            id={getCellId(log.machineId, 'dayProduction')}
                            type="number"
                            value={log.dayProduction ?? ''}
                            data-force-nav="true"
                            onFocus={() => {
                              handleCellFocus(idx, 'dayProduction');
                              window.dispatchEvent(new Event('searchdropdown:forceclose'));
                            }}
                            onChange={(e) => handleUpdateLog(log.machineId, log.id, 'dayProduction', e.target.value, true)}
                            onBlur={(e) => handleUpdateLog(log.machineId, log.id, 'dayProduction', Number(e.target.value), false)}
                            onKeyDown={(e) => handleKeyDown(e, idx, 'dayProduction')}
                            disabled={isReadOnly}
                            className={`w-full h-full p-2 text-center bg-transparent focus:bg-blue-50 focus:outline-none font-semibold text-slate-800 ${isReadOnly ? 'cursor-not-allowed opacity-60' : ''}`}
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
                            onFocus={() => handleCellFocus(idx, 'fabric')}
                            placeholder="---"
                            strict={true}
                          />
                        </td>

                        {/* Client */}
                        <td className="border border-slate-200 p-0 relative group">
                          <SearchDropdown
                            id={getCellId(log.machineId, 'client')}
                            options={clients}
                            value={log.client || ''}
                            onChange={(val) => handleBlur({ target: { value: val, type: 'text' } } as any, log.machineId, log.id, 'client')}
                            onFocus={() => handleCellFocus(idx, 'client')}
                            placeholder="---"
                            strict={true}
                          />
                          
                          {/* Reference Code Tooltip */}
                          {log.client && log.fabric && (
                            <div className="hidden group-hover:block absolute bottom-full left-1/2 -translate-x-1/2 mb-1 px-2 py-1 bg-slate-800 text-white text-xs rounded shadow-lg z-20 whitespace-nowrap pointer-events-none">
                              {log.client}-{log.fabric}
                              <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-slate-800"></div>
                            </div>
                          )}
                          
                        {/* Link Indicator (Read-only) */}
                        <div className="absolute top-0 right-0 h-full flex items-center pr-1 pointer-events-auto z-10">
                          {log.orderReference && (
                            <div
                              className="flex items-center gap-1 text-[9px] bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded-full border border-blue-200 transition-all font-medium shadow-sm cursor-default"
                              title={`Linked to Order: ${log.orderReference}`}
                            >
                              <Link size={10} className="text-blue-500" />
                              {log.orderReference}
                            </div>
                          )}
                        </div>
                        </td>

                        {/* Remaining */}
                        <td className="border border-slate-200 p-0">
                          <input
                            id={getCellId(log.machineId, 'remainingMfg')}
                            type="text"
                            value={log.remainingMfg ?? ''}
                            onChange={(e) => handleUpdateLog(log.machineId, log.id, 'remainingMfg', e.target.value, true)}
                            data-force-nav="true"
                            onFocus={(e) => {
                              e.target.select();
                              handleCellFocus(idx, 'remainingMfg');
                              window.dispatchEvent(new Event('searchdropdown:forceclose'));
                            }}
                            onBlur={(e) => {
                                const val = e.target.value;
                                const numVal = Number(val);
                                const finalVal = isNaN(numVal) ? 0 : numVal;
                                handleUpdateLog(log.machineId, log.id, 'remainingMfg', finalVal, false);
                            }}
                            onKeyDown={(e) => handleKeyDown(e, idx, 'remainingMfg')}
                            disabled={isReadOnly}
                            className={`w-full h-full p-2 text-center bg-transparent focus:bg-blue-50 focus:outline-none ${isReadOnly ? 'cursor-not-allowed opacity-60' : ''} ${
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
                              onClick={() => setHistoryModalOpen({ isOpen: true, machineId: log.machineId, machineName: log.machineName })}
                              className="p-1.5 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded transition-colors"
                              title="View History"
                            >
                              <History size={14} />
                            </button>
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
                              className={`
                                transition-all duration-200 flex items-center justify-center gap-1
                                ${log.futurePlans && log.futurePlans.filter((p: any) => p.type !== 'SETTINGS').length > 0 
                                  ? 'px-3 py-1 bg-emerald-500 hover:bg-emerald-600 text-white rounded-full text-[10px] font-bold shadow-md shadow-emerald-100 ring-1 ring-emerald-500 ring-offset-1' 
                                  : 'p-1.5 text-slate-300 hover:text-blue-600 hover:bg-blue-50 rounded-full'}
                                focus:outline-none focus:ring-2 focus:ring-blue-500
                              `}
                            >
                              {log.futurePlans && log.futurePlans.filter((p: any) => p.type !== 'SETTINGS').length > 0 ? (
                                <>
                                  <Calendar size={12} />
                                  <span>{log.futurePlans.filter((p: any) => p.type !== 'SETTINGS').length}</span>
                                </>
                              ) : (
                                <Plus size={16} />
                              )}
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

              {/* Scrap Inputs Column */}
              <div className="md:w-32 border-r border-slate-200 bg-red-50/30 p-2 flex flex-col justify-center gap-1">
                 <div className="flex flex-col items-center">
                    <span className="text-[10px] text-red-900/60 font-bold mb-0.5">سقط الصالة</span>
                    <input 
                       type="number" 
                       value={hallScrap}
                       onChange={(e) => setHallScrap(Number(e.target.value))}
                       onBlur={handleHallScrapBlur}
                       className="w-full text-center bg-white/50 rounded border border-red-100 font-bold text-sm text-red-700 outline-none focus:border-red-300 py-0.5"
                    />
                 </div>
                 <div className="w-full h-px bg-red-100"></div>
                 <div className="flex flex-col items-center">
                    <span className="text-[10px] text-red-900/60 font-bold mb-0.5">سقط المعمل</span>
                    <input 
                       type="number" 
                       value={labScrap}
                       onChange={(e) => setLabScrap(Number(e.target.value))}
                       onBlur={handleLabScrapBlur}
                       className="w-full text-center bg-white/50 rounded border border-red-100 font-bold text-sm text-red-700 outline-none focus:border-red-300 py-0.5"
                    />
                 </div>
                 <div className="w-full h-px bg-red-100"></div>
                 <div className="flex flex-col items-center">
                    <span className="text-[10px] text-red-900/60 font-bold mb-0.5">سقط الخارجي</span>
                    <input 
                       type="number" 
                       value={externalScrap}
                       disabled // Calculated field
                       className="w-full text-center bg-red-100/50 rounded border border-red-200 font-bold text-sm text-red-700 outline-none py-0.5 cursor-not-allowed"
                       title="Calculated from External Production Sheet"
                    />
                 </div>
              </div>

              <div className={`flex-1 grid grid-cols-1 sm:grid-cols-2 ${samplesProduction > 0 ? 'lg:grid-cols-5' : 'lg:grid-cols-4'} divide-y sm:divide-y-0 sm:divide-x divide-slate-200`}>
                 <div className="p-4 flex flex-col justify-center items-center bg-yellow-50/30">
                   <span className="text-xs text-amber-900/60 font-bold mb-1">انتاج البوص (Bous)</span>
                   <span className="text-2xl font-bold text-amber-700">{bousProduction.toLocaleString()}</span>
                 </div>
                 <div className="p-4 flex flex-col justify-center items-center">
                   <span className="text-xs text-slate-400 font-bold mb-1">مكن عريض (Wide)</span>
                   <span className="text-2xl font-bold text-slate-700">{wideProduction.toLocaleString()}</span>
                 </div>
                 {samplesProduction > 0 && (
                   <div className="p-4 flex flex-col justify-center items-center bg-cyan-50/30">
                     <span className="text-xs text-cyan-900/60 font-bold mb-1">عينات (Samples)</span>
                     <span className="text-2xl font-bold text-cyan-700">{samplesProduction.toLocaleString()}</span>
                   </div>
                 )}
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

              {/* Table / Mobile Cards */}
              <div className="flex-1 overflow-auto bg-slate-100 md:bg-white md:p-0">
                {/* Mobile View */}
                <div className="md:hidden flex flex-col gap-3 p-3">
                  {plansModalOpen.plans.length === 0 && !showInlineAddRow ? (
                    <div className="p-8 text-center text-slate-400 bg-white rounded-lg shadow-sm border border-slate-200">
                      No plans found
                    </div>
                  ) : (
                    plansModalOpen.plans.map((plan: PlanItem, idx: number) => {
                       const isSettings = plan.type === 'SETTINGS';
                       const isActive = plan.startDate <= new Date().toISOString().split('T')[0] && plan.endDate >= new Date().toISOString().split('T')[0];
                       
                       // Calculate end date based on start date + remaining/production per day
                       const calculatedEndDate = calculatePlanEndDate(plan.startDate, plan.remaining || 0, plan.productionPerDay || 0);
                       const displayEndDate = calculatedEndDate || plan.endDate || '-';
                       const formattedEndDate = formatDateShort(displayEndDate);
                       
                       // Calculate days from start to end date
                       const calculatedDays = plan.startDate && calculatedEndDate 
                         ? Math.ceil((new Date(calculatedEndDate).getTime() - new Date(plan.startDate).getTime()) / (1000 * 60 * 60 * 24))
                         : plan.days || 0;

                       const { shortName: fabricShortName } = parseFabricName(plan.fabric || '');
                       
                       return (
                         <div key={idx} className={`relative p-3 rounded-xl shadow-sm border ${isActive ? 'bg-emerald-50 border-emerald-200 ring-1 ring-emerald-500/20' : isSettings ? 'bg-amber-50 border-amber-200' : 'bg-white border-slate-200'}`}>
                           {/* Row 1: Dates & Delete */}
                           <div className="flex justify-between items-start mb-2">
                              <div className="flex items-center gap-1.5 flex-1">
                                <div className="bg-slate-100 px-2 py-1 rounded text-[10px] font-bold text-slate-500 border border-slate-200 flex items-center gap-1 group focus-within:ring-2 focus-within:ring-blue-500/20 focus-within:border-blue-400">
                                   <Calendar size={10} className="text-slate-400"/>
                                   <input
                                      type="date"
                                      value={plan.startDate || ''}
                                      onChange={(e) => handleUpdatePlan(idx, 'startDate', e.target.value)}
                                      className="bg-transparent outline-none w-[75px] group-hover:text-slate-700 transition-colors"
                                   />
                                </div>
                                <span className="text-slate-300 text-xs font-bold">→</span>
                                <div className="bg-slate-100 px-2 py-1 rounded text-[10px] font-bold text-slate-600 border border-slate-200 min-w-[50px] text-center">
                                   {formattedEndDate}
                                </div>
                              </div>
                              <button
                                onClick={() => handleDeletePlan(idx)}
                                className="p-1.5 bg-red-50 text-red-400 hover:text-red-500 rounded-md border border-red-100 hover:border-red-200 ml-2"
                              >
                                <Trash2 size={14} />
                              </button>
                           </div>

                           {/* Row 2: Fabric & Client */}
                           <div className="mb-3 space-y-2">
                              {isSettings ? (
                                <textarea
                                  value={plan.notes || ''}
                                  onChange={(e) => handleUpdatePlan(idx, 'notes', e.target.value)}
                                  className="w-full bg-slate-50/50 p-2 rounded text-xs text-slate-600 italic border border-slate-200 outline-none focus:border-blue-400 focus:bg-white transition-all resize-none font-medium"
                                  placeholder="Notes..."
                                  rows={2}
                                />
                              ) : (
                                <textarea
                                  value={fabricShortName || plan.fabric || ''}
                                  onChange={(e) => handleUpdatePlan(idx, 'fabric', e.target.value)}
                                  className="w-full bg-transparent p-0 text-sm font-bold text-slate-800 outline-none focus:bg-blue-50/30 rounded px-1 -mx-1 transition-all resize-none leading-snug"
                                  placeholder="Fabric Name"
                                  rows={2}
                                />
                              )}
                              
                              <div className="relative">
                                 <div className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400">
                                    <Sparkles size={10} />
                                 </div>
                                 <input
                                   type="text"
                                   value={plan.client || plan.orderName || ''}
                                   onChange={(e) => handleUpdatePlan(idx, 'orderName', e.target.value)}
                                   className="w-full bg-slate-50 border border-slate-100 rounded px-2 py-1.5 pl-6 text-xs text-blue-600 font-medium outline-none focus:border-blue-400 focus:bg-white transition-all placeholder:text-slate-400"
                                   placeholder="Client / Reference"
                                 />
                              </div>
                           </div>

                           {/* Row 3: Stats Grid */}
                           <div className="grid grid-cols-3 gap-2 border-t border-slate-100/50 pt-2">
                              {/* Quantity */}
                              <div className="bg-slate-50 rounded p-1.5 border border-slate-100">
                                 <span className="block text-[9px] uppercase font-bold text-slate-400 mb-0.5">Quantity</span>
                                 <input
                                    type="number"
                                    value={isSettings ? 0 : plan.quantity}
                                    onChange={(e) => handleUpdatePlan(idx, 'quantity', Number(e.target.value))}
                                    disabled={isSettings}
                                    className="w-full bg-transparent font-bold text-xs text-slate-700 outline-none p-0 disabled:opacity-50 text-center"
                                 />
                              </div>
                              {/* Prod/Day */}
                              <div className="bg-slate-50 rounded p-1.5 border border-slate-100">
                                 <span className="block text-[9px] uppercase font-bold text-slate-400 mb-0.5">Prod/Day</span>
                                 <input
                                    type="number"
                                    value={plan.productionPerDay || 0}
                                    onChange={(e) => handleUpdatePlan(idx, 'productionPerDay', Number(e.target.value))}
                                    className="w-full bg-transparent font-bold text-xs text-slate-700 outline-none p-0 text-center"
                                 />
                              </div>
                              {/* Days */}
                              <div className="bg-orange-50 rounded p-1.5 border border-orange-100 flex flex-col items-center justify-center">
                                 <span className="block text-[9px] uppercase font-bold text-orange-400 mb-0.5">Days</span>
                                 <span className="font-bold text-xs text-orange-600 leading-none">{calculatedDays}</span>
                              </div>
                           </div>
                         </div>
                       );
                    })
                  )}

                  {/* Mobile Inline Add Form */}
                  {showInlineAddRow && (() => {
                    const isSettings = inlineNewPlan.type === 'SETTINGS';
                    return (
                    <div className={`p-4 rounded-xl border-2 shadow-lg animate-in fade-in slide-in-from-bottom-4 ${isSettings ? 'bg-amber-50 border-amber-400' : 'bg-yellow-50 border-yellow-400'}`}>
                       <h4 className="text-xs font-bold uppercase tracking-wider mb-3 flex items-center gap-2">
                          <Plus size={14} className={isSettings ? 'text-amber-600' : 'text-yellow-600'} />
                          {isSettings ? 'New Maintenance/Settings' : 'New Production Plan'}
                       </h4>
                       
                       {/* Date Range */}
                       <div className="flex gap-2 mb-3">
                          <input
                            type="date"
                            value={inlineNewPlan.startDate || ''}
                            onChange={(e) => {
                              const prevPlan = plansModalOpen.plans[plansModalOpen.plans.length - 1];
                              const startDate = e.target.value || (prevPlan?.endDate ? new Date(new Date(prevPlan.endDate).getTime() + 86400000).toISOString().split('T')[0] : e.target.value);
                              setInlineNewPlan({ ...inlineNewPlan, startDate });
                            }}
                            className="bg-white/50 border border-black/5 rounded p-2 text-xs font-bold w-full outline-none focus:bg-white"
                          />
                          <div className="w-16 bg-white/50 border border-black/5 rounded p-2 flex items-center justify-center">
                             <input
                                type="number"
                                value={inlineNewPlan.days || ''}
                                onChange={(e) => setInlineNewPlan({ ...inlineNewPlan, days: Number(e.target.value) })}
                                placeholder="Days"
                                className="w-full bg-transparent font-bold text-xs text-center outline-none p-0 placeholder:text-black/20"
                             />
                          </div>
                       </div>

                       {/* Content */}
                       <div className="space-y-2 mb-3">
                          {inlineNewPlan.type === 'SETTINGS' ? (
                             <input
                               type="text"
                               value={inlineNewPlan.notes || ''}
                               onChange={(e) => setInlineNewPlan({ ...inlineNewPlan, notes: e.target.value })}
                               placeholder="Maintenance notes..."
                               className="w-full bg-white/50 border border-black/5 rounded p-2 text-sm italic outline-none focus:bg-white focus:ring-2 ring-amber-400/20"
                             />
                          ) : (
                             <input
                               type="text"
                               value={inlineNewPlan.fabric || ''}
                               onChange={(e) => setInlineNewPlan({ ...inlineNewPlan, fabric: e.target.value })}
                               placeholder="Fabric Name"
                               className="w-full bg-white/50 border border-black/5 rounded p-2 text-sm font-bold outline-none focus:bg-white focus:ring-2 ring-yellow-400/20"
                             />
                          )}
                          
                          <input
                            type="text"
                            value={inlineNewPlan.orderName || ''}
                            onChange={(e) => setInlineNewPlan({ ...inlineNewPlan, orderName: e.target.value })}
                            placeholder="Client / Reference"
                            className="w-full bg-white/50 border border-black/5 rounded p-2 text-xs font-medium text-blue-700 outline-none focus:bg-white"
                          />
                       </div>

                       {/* Stats */}
                       <div className="grid grid-cols-2 gap-2 mb-3">
                          {!isSettings && (
                             <>
                              <input
                                 type="number"
                                 value={inlineNewPlan.quantity || ''}
                                 onChange={(e) => setInlineNewPlan({ ...inlineNewPlan, quantity: Number(e.target.value) })}
                                 placeholder="Quantity"
                                 className="bg-white/50 border border-black/5 rounded p-2 text-sm text-center outline-none focus:bg-white"
                              />
                              <input
                                 type="number"
                                 value={inlineNewPlan.productionPerDay || ''}
                                 onChange={(e) => setInlineNewPlan({ ...inlineNewPlan, productionPerDay: Number(e.target.value) })}
                                 placeholder="Prod/Day"
                                 className="bg-white/50 border border-black/5 rounded p-2 text-sm text-center font-bold outline-none focus:bg-white"
                              />
                             </>
                          )}
                       </div>

                       <div className="flex gap-2">
                          <button
                             onClick={() => setShowInlineAddRow(false)}
                             className="flex-1 py-2 bg-white/50 hover:bg-white text-slate-500 rounded-lg text-xs font-bold border border-black/5 transition-colors"
                          >
                             Cancel
                          </button>
                          <button
                             onClick={handleInlineAddPlan}
                             disabled={loading || !inlineNewPlan.startDate || (inlineNewPlan.type === 'SETTINGS' ? !inlineNewPlan.days : (!inlineNewPlan.remaining || !inlineNewPlan.productionPerDay))}
                             className="flex-[2] py-2 bg-black text-white rounded-lg text-xs font-bold shadow-md hover:bg-slate-800 disabled:opacity-50 transition-colors"
                          >
                             Add Plan
                          </button>
                       </div>
                    </div>
                    );
                  })()}
                </div>

                {/* Desktop Table */}
                <table className="hidden md:table w-full text-sm text-left">
                  <thead className="bg-slate-50 text-slate-500 font-bold uppercase tracking-wider text-[10px] sticky top-0 z-10">
                    <tr>
                      <th className="p-3 border-b border-slate-100 w-32 text-center">Start</th>
                      <th className="p-3 border-b border-slate-100 w-32 text-center">End</th>
                      <th className="p-3 border-b border-slate-100 w-16 text-center">Days</th>
                      <th className="p-3 border-b border-slate-100 min-w-[100px]">Client / Ref</th>
                      <th className="p-3 border-b border-slate-100 w-20 text-center">Qty</th>
                      <th className="p-3 border-b border-slate-100 w-20 text-center">Prod/Day</th>
                      <th className="p-3 border-b border-slate-100 min-w-[200px]">Fabric / Notes</th>
                      <th className="p-3 border-b border-slate-100 w-16 text-center"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {plansModalOpen.plans.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="p-8 text-center text-slate-400">
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
                        const formattedEndDate = formatDateShort(displayEndDate);
                        
                        // Calculate days from start to end date
                        const calculatedDays = plan.startDate && calculatedEndDate 
                          ? Math.ceil((new Date(calculatedEndDate).getTime() - new Date(plan.startDate).getTime()) / (1000 * 60 * 60 * 24))
                          : plan.days || 0;

                        const { shortName: fabricShortName } = parseFabricName(plan.fabric || '');
                        
                        return (
                          <tr key={idx} className={`${isActive ? 'bg-emerald-50/50' : isSettings ? 'bg-amber-50/50' : 'bg-white'} hover:bg-slate-50 transition-colors border-b border-slate-100`}>
                            {/* Start Date */}
                            <td className="p-0 border-r border-slate-100">
                              <input
                                type="date"
                                value={plan.startDate || ''}
                                onChange={(e) => handleUpdatePlan(idx, 'startDate', e.target.value)}
                                className="w-full p-2 bg-transparent outline-none focus:bg-blue-50 text-center text-xs font-medium"
                              />
                            </td>
                            {/* End Date */}
                            <td className="p-2 border-r border-slate-100 text-center text-xs font-medium text-slate-600 bg-slate-50/30">
                              {formattedEndDate}
                            </td>
                            {/* Days */}
                            <td className="p-2 border-r border-slate-100 text-center text-xs font-bold text-orange-600">
                              {calculatedDays}
                            </td>
                            {/* Client / Ref */}
                            <td className="p-0 border-r border-slate-100">
                              <input
                                type="text"
                                value={plan.client || plan.orderName || ''}
                                onChange={(e) => handleUpdatePlan(idx, 'orderName', e.target.value)}
                                className="w-full p-2 bg-transparent outline-none focus:bg-blue-50 text-xs text-blue-600 font-medium"
                                placeholder="-"
                              />
                            </td>
                            {/* Quantity */}
                            <td className="p-0 border-r border-slate-100">
                              <input
                                type="number"
                                value={isSettings ? 0 : plan.quantity}
                                onChange={(e) => handleUpdatePlan(idx, 'quantity', Number(e.target.value))}
                                disabled={isSettings}
                                className="w-full p-2 text-right bg-transparent outline-none focus:bg-blue-50 text-xs disabled:opacity-50"
                              />
                            </td>
                            {/* Prod/Day */}
                            <td className="p-0 border-r border-slate-100">
                              <input
                                type="number"
                                value={plan.productionPerDay || 0}
                                onChange={(e) => handleUpdatePlan(idx, 'productionPerDay', Number(e.target.value))}
                                className="w-full p-2 text-right bg-transparent outline-none focus:bg-blue-50 text-xs font-bold"
                              />
                            </td>
                            {/* Fabric / Notes */}
                            <td className="p-0 border-r border-slate-100 align-top">
                              {isSettings ? (
                                <textarea
                                  value={plan.notes || ''}
                                  onChange={(e) => handleUpdatePlan(idx, 'notes', e.target.value)}
                                  className="w-full h-full p-2 bg-transparent outline-none focus:bg-blue-50 text-xs text-slate-500 italic resize-none"
                                  placeholder="Notes..."
                                  rows={2}
                                />
                              ) : (
                                <textarea
                                  value={fabricShortName || plan.fabric || ''}
                                  onChange={(e) => handleUpdatePlan(idx, 'fabric', e.target.value)}
                                  className="w-full h-full p-2 bg-transparent outline-none focus:bg-blue-50 text-xs font-medium resize-none"
                                  placeholder="-"
                                  rows={2}
                                />
                              )}
                            </td>
                            {/* Actions */}
                            <td className="p-1 text-center flex gap-1 justify-center items-center">
                              <button
                                onClick={() => handleDeletePlan(idx)}
                                className="p-1.5 hover:bg-red-50 text-slate-400 hover:text-red-500 rounded-full transition-colors"
                                title="Delete"
                              >
                                <Trash2 size={14} />
                              </button>
                            </td>
                          </tr>
                        );
                      })
                    )}
                    
                    {/* Excel-like Add Row - Desktop Only */}
                    {showInlineAddRow && (
                    <tr className={`border-t-2 ${inlineNewPlan.type === 'SETTINGS' ? 'bg-amber-50 border-amber-400' : 'bg-yellow-50 border-yellow-400'}`}>
                      {/* Start Date */}
                      <td className="p-0 border-r border-slate-200">
                        <input
                          type="date"
                          value={inlineNewPlan.startDate || ''}
                          onChange={(e) => {
                            const prevPlan = plansModalOpen.plans[plansModalOpen.plans.length - 1];
                            const startDate = e.target.value || (prevPlan?.endDate ? new Date(new Date(prevPlan.endDate).getTime() + 86400000).toISOString().split('T')[0] : e.target.value);
                            setInlineNewPlan({ ...inlineNewPlan, startDate });
                          }}
                          placeholder="Start Date"
                          className="w-full p-2 bg-transparent outline-none font-medium placeholder-slate-400 text-center text-xs"
                        />
                      </td>
                      {/* End Date */}
                      <td className="p-2 border-r border-slate-200 font-medium text-blue-700 text-center text-xs">
                        {inlineNewPlan.type === 'SETTINGS' 
                          ? (inlineNewPlan.startDate && inlineNewPlan.days 
                              ? (() => {
                                  const start = new Date(inlineNewPlan.startDate);
                                  start.setDate(start.getDate() + (inlineNewPlan.days || 0));
                                  return formatDateShort(start.toISOString().split('T')[0]);
                                })()
                              : '-')
                          : (inlineNewPlan.startDate && inlineNewPlan.remaining && inlineNewPlan.productionPerDay 
                              ? formatDateShort(calculatePlanEndDate(inlineNewPlan.startDate, inlineNewPlan.remaining, inlineNewPlan.productionPerDay))
                              : '-')}
                      </td>
                      {/* Days */}
                      <td className="p-0 border-r border-slate-200">
                        <input
                          type="number"
                          value={inlineNewPlan.days || ''}
                          onChange={(e) => setInlineNewPlan({ ...inlineNewPlan, days: Number(e.target.value) })}
                          placeholder="0"
                          className="w-full p-2 text-center bg-transparent outline-none font-bold text-orange-600 placeholder-slate-400 text-xs"
                        />
                      </td>
                      {/* Client */}
                      <td className="p-0 border-r border-slate-200">
                        <input
                          type="text"
                          value={inlineNewPlan.orderName || ''}
                          onChange={(e) => setInlineNewPlan({ ...inlineNewPlan, orderName: e.target.value })}
                          placeholder="Order"
                          className="w-full p-2 bg-transparent outline-none text-blue-600 placeholder-slate-400 text-xs"
                        />
                      </td>
                      {/* Quantity */}
                      <td className="p-0 border-r border-slate-200">
                        <input
                          type="number"
                          value={inlineNewPlan.quantity || ''}
                          onChange={(e) => setInlineNewPlan({ ...inlineNewPlan, quantity: Number(e.target.value) })}
                          placeholder="0"
                          disabled={inlineNewPlan.type === 'SETTINGS'}
                          className="w-full p-2 text-right bg-transparent outline-none disabled:opacity-50 placeholder-slate-400 text-xs"
                        />
                      </td>
                      {/* Prod/Day */}
                      <td className="p-0 border-r border-slate-200">
                        <input
                          type="number"
                          value={inlineNewPlan.productionPerDay || ''}
                          onChange={(e) => setInlineNewPlan({ ...inlineNewPlan, productionPerDay: Number(e.target.value) })}
                          placeholder="0"
                          disabled={inlineNewPlan.type === 'SETTINGS'}
                          className="w-full p-2 text-right bg-transparent outline-none font-bold disabled:opacity-50 placeholder-slate-400 text-xs"
                        />
                      </td>
                      {/* Fabric/Notes */}
                      <td className="p-0 border-r border-slate-200 align-top">
                        {inlineNewPlan.type === 'SETTINGS' ? (
                          <textarea
                            value={inlineNewPlan.notes || ''}
                            onChange={(e) => setInlineNewPlan({ ...inlineNewPlan, notes: e.target.value })}
                            placeholder="Notes..."
                            className="w-full h-full p-2 bg-transparent outline-none text-slate-500 italic placeholder-slate-400 text-xs resize-none"
                            rows={2}
                          />
                        ) : (
                          <textarea
                            value={inlineNewPlan.fabric || ''}
                            onChange={(e) => setInlineNewPlan({ ...inlineNewPlan, fabric: e.target.value })}
                            placeholder="Fabric"
                            className="w-full h-full p-2 bg-transparent outline-none placeholder-slate-400 text-xs resize-none"
                            rows={2}
                          />
                        )}
                      </td>
                      {/* Actions */}
                      <td className="p-2 text-center">
                        <button
                          onClick={handleInlineAddPlan}
                          disabled={loading || !inlineNewPlan.startDate || (inlineNewPlan.type === 'SETTINGS' ? !inlineNewPlan.days : (!inlineNewPlan.remaining || !inlineNewPlan.productionPerDay))}
                          className="px-2 py-1 bg-green-500 hover:bg-green-600 text-white rounded text-xs font-bold disabled:opacity-50 disabled:cursor-not-allowed w-full"
                        >
                          Add
                        </button>
                      </td>
                    </tr>
                    )}
                  </tbody>
                </table>
              </div>

              {/* Footer */}
              <div className="border-t border-slate-200 p-4 flex justify-between items-center bg-slate-50 rounded-b-lg">
                <div className="flex gap-2 w-full">
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
                    className="flex-1 px-4 py-2 border border-blue-500 text-blue-600 rounded bg-white hover:bg-blue-50 text-sm font-medium transition-colors"
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
                    className="flex-1 px-4 py-2 border border-slate-300 text-slate-600 rounded bg-white hover:bg-slate-50 text-sm font-medium transition-colors"
                  >
                    + Add Settings
                  </button>
                </div>
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

      </>
      ) : (
        <ExternalProductionSheet 
          date={selectedDate} 
          onClose={() => setShowExternalSheet(false)}
          onUpdateTotal={(total, scrap) => {
             setExternalProduction(total);
             const s = scrap || 0;
             setExternalScrap(s);
             // Also update the daily summary immediately so the main view reflects it
             DataService.updateDailySummary(selectedDate, { externalProduction: total, externalScrap: s });
          }}
          isEmbedded={true}
          onNavigateToPlanning={onNavigateToPlanning}
        />
      )}

      {/* New Day Modal */}
      {isNewDay && (
        <div className="fixed inset-0 z-[60] bg-slate-900/50 flex items-center justify-center p-4 backdrop-blur-sm">
          <div className="bg-white rounded-xl shadow-2xl max-w-md w-full overflow-hidden animate-in fade-in zoom-in duration-200 border border-slate-200 relative">
            <button
                onClick={() => {
                    setIsNewDay(false);
                    if (activeDay) {
                        setSelectedDate(activeDay);
                    } else {
                        // Fallback if no active day is set
                        setSelectedDate(new Date().toISOString().split('T')[0]);
                    }
                }}
                className="absolute top-3 right-3 p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-full transition-colors"
            >
                <X size={20} />
            </button>
            <div className="p-6 text-center">
              <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-4 text-blue-600 shadow-sm border border-blue-200">
                <Calendar size={32} />
              </div>
              <h2 className="text-xl font-bold text-slate-800 mb-2">Daily Machine Plan</h2>
              <p className="text-slate-500 mb-6 text-sm">
                No production data found for <span className="font-semibold text-slate-700">{new Date(selectedDate).toLocaleDateString('en-GB')}</span>.<br/>
                How would you like to start?
              </p>
              
              <div className="flex flex-col gap-3">
                <div className="bg-slate-50 p-3 rounded-lg border border-slate-200 mb-2">
                   <label className="block text-xs font-bold text-slate-500 mb-1 text-left uppercase tracking-wider">Source Date</label>
                   <input
                     type="date"
                     className="w-full text-sm border-slate-300 rounded-md shadow-sm focus:border-blue-500 focus:ring-blue-500"
                     defaultValue={(() => {
                        const d = new Date(selectedDate);
                        d.setDate(d.getDate() - 1);
                        return d.toISOString().split('T')[0];
                     })()}
                     id="sourceDateInput"
                   />
                </div>

                <button
                  onClick={() => {
                    const input = document.getElementById('sourceDateInput') as HTMLInputElement;
                    const sourceDate = input?.value;
                    if (sourceDate) {
                        handleFetchFromPreviousDay(sourceDate);
                    }
                    setIsNewDay(false);
                  }}
                  className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-lg shadow-sm transition-colors flex items-center justify-center gap-2"
                >
                  <History size={18} />
                  Fetch Data
                </button>
                
                <button
                  onClick={() => {
                     // Clear the auto-cloned data to start fresh
                     const blankLogs = allLogs.map(log => ({
                        ...log,
                        fabric: '',
                        client: '',
                        status: 'Planned',
                        remainingMfg: 0,
                        targetProduction: 0, 
                        dayProduction: 0,
                        scrap: 0
                     }));
                     setAllLogs(blankLogs);
                     // setFilteredLogs(blankLogs); // Derived
                     setIsNewDay(false);
                  }}
                  className="w-full py-2 bg-white border border-slate-200 text-slate-600 hover:bg-slate-50 font-bold rounded-lg transition-colors"
                >
                  Start Fresh (Empty)
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      {/* Add/Edit Modal - Using Centralized Editor */}
      <StandaloneFabricEditor
        isOpen={isFabricModalOpen}
        onClose={() => setIsFabricModalOpen(false)}
        onSaved={handleFabricSaved}
        machines={rawMachines}
        initialData={editingFabric}
      />

      {/* Fabric Directory Modal */}
      <FabricDirectoryModal
        isOpen={isFabricDirectoryOpen}
        onClose={() => setIsFabricDirectoryOpen(false)}
        machines={rawMachines}
      />

      {/* Machine History Modal */}
      <MachineHistoryModal
        isOpen={historyModalOpen.isOpen}
        onClose={() => setHistoryModalOpen(prev => ({ ...prev, isOpen: false }))}
        machineId={historyModalOpen.machineId}
        machineName={historyModalOpen.machineName}
        userRole={userRole}
      />

      <DailySummaryModal 
        isOpen={isSummaryModalOpen}
        onClose={() => setIsSummaryModalOpen(false)}
        machines={allLogs}
        selectedDate={selectedDate}
        onDateChange={setSelectedDate}
        onNavigateToOrder={onNavigateToOrder}
      />

      {/* PDF Generation Overlay */}
      {isDownloading && (
        <div className="fixed inset-0 z-[100] bg-slate-900/80 backdrop-blur-sm flex flex-col items-center justify-center text-white">
          <div className="animate-spin rounded-full h-16 w-16 border-4 border-white/20 border-t-white mb-4"></div>
          <h3 className="text-xl font-bold">Generating PDF...</h3>
          <p className="text-slate-300 mt-2">Please wait while we prepare your document.</p>
        </div>
      )}
    </div>
    </div>
  );
};

export default FetchDataPage;
