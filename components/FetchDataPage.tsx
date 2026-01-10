import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { writeBatch, doc, getDoc, onSnapshot, collection } from 'firebase/firestore';
import { db } from '../services/firebase';
import { DataService } from '../services/dataService';
import { parseFabricName } from '../services/data';
import { TelegramService } from '../services/telegramService';
import { PlanItem, MachineStatus, CustomerOrder, MachineRow } from '../types';
import { LinkOrderModal } from './LinkOrderModal';
import { toJpeg } from 'html-to-image';
import { jsPDF } from 'jspdf';
import * as XLSX from 'xlsx';
import { CheckCircle, Send, Link, Truck, Layout, Factory, FileSpreadsheet, Upload, X, Check, Sparkles, Edit, ArrowRight, History, CheckCircle2, XCircle, AlertTriangle, Download, Plus, Search, Calendar, FileText, Book } from 'lucide-react';
import { ExternalProductionSheet } from './ExternalProductionSheet'; // New Component - Force Refresh
import { FabricFormModal } from './FabricFormModal';
import { FabricDirectoryModal } from './FabricDirectoryModal';
import { MachineHistoryModal } from './MachineHistoryModal';

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
  onCreateNew?: () => void;
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  onFocus?: () => void;
  placeholder?: string;
  strict?: boolean;
}

interface StagedLog {
  id: string; // Unique ID for the staging row (machineId)
  machineId: string;
  machineName: string;
  
  // Context (Yesterday/Previous)
  previousDate: string;
  previousClient: string;
  previousFabric: string;
  previousRemaining: number;
  previousStatus: string;
  isStale: boolean; // If previous log is older than 1 day

  // Imported Data (The Change)
  hasImportData: boolean; // True if found in Excel
  importDate: string;
  importProduction: number;
  importScrap: number;
  importClient: string;
  importFabric: string;
  sourceWorkCenters: string[]; // List of Excel WorkCenters mapped to this machine
  
  // Split Run Handling
  isSplit: boolean; // If multiple rows for this machine in Excel
  splitDetails?: { client: string; fabric: string; production: number }[]; // Details of the split

  // Resulting State (Calculated/User Edited)
  newRemaining: number;
  newStatus: string;
  note: string;

  // Validation
  validationStatus: 'SAFE' | 'WARNING' | 'ERROR';
  validationMessage: string;
  
  // User Control
  selected: boolean; // If checked, will be imported
}

type FilterType = 'ALL' | 'WARNINGS' | 'ERRORS' | 'SAFE' | 'MISSING';

const SearchDropdown: React.FC<SearchDropdownProps> = ({
  id,
  options,
  value,
  onChange,
  onCreateNew,
  onKeyDown,
  onFocus,
  placeholder = '---',
  strict = false
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
}

const FetchDataPage: React.FC<FetchDataPageProps> = ({ 
  selectedDate: propSelectedDate,
  machines = [],
  onNavigateToPlanning
}) => {
  const [selectedDate, setSelectedDate] = useState<string>(propSelectedDate || new Date().toISOString().split('T')[0]);
  const [importDate, setImportDate] = useState<string>(new Date().toISOString().split('T')[0]);
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
  const [isFabricDirectoryOpen, setIsFabricDirectoryOpen] = useState(false);
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

  const handleExportBackup = () => {
    try {
      const backupData = {
        metadata: {
          date: selectedDate,
          timestamp: new Date().toISOString(),
          version: '1.0'
        },
        logs: filteredLogs.map(log => ({
          machineId: log.machineId,
          status: log.status,
          customStatusNote: log.customStatusNote || '',
          client: log.client,
          fabric: log.fabric,
          dayProduction: Number(log.dayProduction) || 0,
          avgProduction: Number(log.avgProduction) || 0,
          scrap: Number(log.scrap) || 0,
          reason: log.reason || '',
          remainingMfg: Number(log.remainingMfg) || 0, // CRITICAL: Save exact value
          orderReference: log.orderReference || '',
          orderId: log.orderId || ''
        }))
      };

      const blob = new Blob([JSON.stringify(backupData, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `DailyLog_${selectedDate}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      
      showMessage('✅ Backup exported successfully');
    } catch (error) {
      console.error('Export failed:', error);
      showMessage('❌ Export failed', true);
    }
  };

  const handleImportBackup = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Reset input so same file can be selected again
    e.target.value = '';

    const reader = new FileReader();
    reader.onload = async (evt) => {
      try {
        const content = evt.target?.result as string;
        const backup = JSON.parse(content);
        
        // Validation
        if (!backup.metadata || !backup.logs || !Array.isArray(backup.logs)) {
          throw new Error('Invalid backup file format');
        }

        if (backup.metadata.date !== selectedDate) {
          if (!window.confirm(`⚠️ Date Mismatch!\n\nFile Date: ${backup.metadata.date}\nCurrent View: ${selectedDate}\n\nDo you want to proceed and OVERWRITE data for ${selectedDate}?`)) {
            return;
          }
        } else {
           if (!window.confirm(`⚠️ This will OVERWRITE all data for ${selectedDate} with the backup file.\n\nAre you sure?`)) {
             return;
           }
        }

        setLoading(true);
        
        // Process Import
        const machines = await DataService.getMachinesFromMachineSS();
        const updatePromises: Promise<void>[] = [];
        let updatedCount = 0;

        for (const log of backup.logs) {
           const machineId = String(log.machineId);
           const machine = machines.find(m => String(m.id) === machineId);
           
           if (machine) {
              // Construct Log Entry
              const newLogEntry = {
                id: selectedDate,
                date: selectedDate,
                dayProduction: log.dayProduction,
                scrap: log.scrap,
                reason: log.reason,
                status: log.status,
                fabric: log.fabric,
                client: log.client,
                avgProduction: log.avgProduction,
                remainingMfg: log.remainingMfg, // CRITICAL: Force value from file
                customStatusNote: log.customStatusNote,
                orderReference: log.orderReference,
                orderId: log.orderId,
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

              // 1. Update Array (Legacy)
              const updatePromise = DataService.updateMachineInMachineSS(machineId, {
                dailyLogs: updatedLogs,
                lastLogDate: selectedDate,
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

              // 2. Update Sub-collection
              const subCollectionPromise = DataService.updateDailyLog(machineId, selectedDate, newLogEntry);

              updatePromises.push(Promise.all([updatePromise, subCollectionPromise]).then(() => {}));
              updatedCount++;
           }
        }

        await Promise.all(updatePromises);
        await handleFetchLogs(selectedDate);
        showMessage(`✅ Successfully restored ${updatedCount} logs from backup`);

      } catch (error: any) {
        console.error('Import failed:', error);
        showMessage('❌ Import failed: ' + error.message, true);
      } finally {
        setLoading(false);
      }
    };
    reader.readAsText(file);
  };

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
      let message = `📅 <b>Daily Report: ${date}</b>\n\n`;

      // Section 1: Finished Machines
      if (finishedMachines.length > 0) {
        message += `🏁 <b>FINISHED PRODUCTION</b>\n`;
        finishedMachines.forEach((m) => {
           const fabricName = m.material || m.fabric || 'Unknown';
           const { shortName } = parseFabricName(fabricName);
           
           message += `\n🔹 <b>${m.machineName}</b> (${m.brand || ''})\n`;
           message += `📦 <b>Done:</b> ${shortName} (${m.client || '-'})\n`;
           
           const hasPlans = m.futurePlans && m.futurePlans.length > 0;
           if (hasPlans) {
             const nextPlan = m.futurePlans[0];
             const { shortName: nextFabric } = parseFabricName(nextPlan.fabric);
             message += `📅 <b>Next:</b> ${nextFabric} (${nextPlan.client})\n`;
           } else {
             message += `🛑 <b>Next:</b> No Plan!\n`;
           }
        });
        message += `\n`;
      }

      // Section 2: Low Stock
      if (lowStockMachines.length > 0) {
        message += `⚠️ <b>LOW STOCK ALERTS</b>\n`;
        
        lowStockMachines.forEach((m) => {
          message += `\n🔸 <b>${m.machineName}</b> (${m.brand || ''})\n`;
          message += `📉 <b>Rem:</b> ${m.remainingMfg}kg\n`;
          
          const hasPlans = m.futurePlans && m.futurePlans.length > 0;
          if (hasPlans) {
            const nextPlan = m.futurePlans[0];
            const { shortName: nextFabric } = parseFabricName(nextPlan.fabric);
            message += `📅 <b>Next:</b> ${nextFabric} (${nextPlan.client})\n`;
          } else {
            message += `🛑 <b>Next:</b> No Plan!\n`;
          }
        });
        message += `\n`;
      }

      if (lowStockMachines.length === 0 && finishedMachines.length === 0) {
        message += `✅ <b>All Good!</b>\nNo low stock alerts or finished machines.`;
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
  const [hallScrap, setHallScrap] = useState<number>(0);
  const [labScrap, setLabScrap] = useState<number>(0);
  const [showExternalSheet, setShowExternalSheet] = useState(false); // Toggle for External Sheet
  
  const handleSaveFabric = async (formData: any) => {
    if (!formData.name) return;
    setLoading(true);
    try {
      await DataService.addFabric(formData);
      const updatedFabrics = await DataService.getFabrics();
      setFabrics(updatedFabrics);
      setIsFabricModalOpen(false);
      showMessage('✅ Fabric added successfully');
    } catch (error: any) {
      showMessage('❌ Error adding fabric: ' + error.message, true);
    } finally {
      setLoading(false);
    }
  };

  // Import ODOO State
  const [showImportModal, setShowImportModal] = useState(false);
  const [importPreview, setImportPreview] = useState<StagedLog[]>([]);
  const [filter, setFilter] = useState<FilterType>('ALL');
  
  // Mapping State
  const [showMappingModal, setShowMappingModal] = useState(false);
  const [unknownWorkCenters, setUnknownWorkCenters] = useState<{ name: string; fabrics: string[] }[]>([]);
  const [workCenterMappings, setWorkCenterMappings] = useState<Record<string, string>>({});
  const [pendingImportRows, setPendingImportRows] = useState<any[]>([]);
  const [mappingMachines, setMappingMachines] = useState<any[]>([]); // Machines list for mapping modal

  // Fabric Import State
  const [showFabricImportModal, setShowFabricImportModal] = useState(false);
  const [unknownFabrics, setUnknownFabrics] = useState<string[]>([]);
  const [fabricsToCreate, setFabricsToCreate] = useState<Record<string, boolean>>({});

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

  // ODOO Import Logic
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (evt) => {
      const bstr = evt.target?.result;
      const wb = XLSX.read(bstr, { type: 'binary' });
      const wsname = wb.SheetNames[0];
      const ws = wb.Sheets[wsname];
      const data = XLSX.utils.sheet_to_json(ws, { header: 1 });
      
      // Skip header (row 0), start from row 2 (index 1)
      const rows = data.slice(1);
      setPendingImportRows(rows);
      
      // Fetch current machines and saved mappings
      const [currentMachines, savedMappings] = await Promise.all([
        DataService.getMachinesFromMachineSS(),
        DataService.getWorkCenterMappings()
      ]);
      
      setMappingMachines(currentMachines);
      
      // First Pass: Identify ALL WorkCenters
      const allWorkCenters = new Set<string>();
      rows.forEach((row: any) => {
        const workCenter = row[4]; // Column E (Index 4) is Work Center
        if (workCenter) {
          allWorkCenters.add(String(workCenter).trim());
        }
      });

      // Prepare Mapping List for Review
      const mappingList: { name: string; fabrics: string[]; currentMachineId?: string }[] = [];
      const autoMappings: Record<string, string> = { ...savedMappings };
      
      allWorkCenters.forEach(wcStr => {
         // Find fabrics for context
         const wcFabrics = new Set<string>();
         rows.forEach((r: any) => {
            if (String(r[4]).trim() === wcStr && r[0]) wcFabrics.add(r[0]);
         });

         let machineId = savedMappings[wcStr];
         
         if (!machineId) {
            // Try Direct Match
            const machine = currentMachines.find((m: any) => 
              (m.name && m.name.toLowerCase() === wcStr.toLowerCase()) || 
              (m.machineid && m.machineid.toString() === wcStr) ||
              (m.id && m.id.toString() === wcStr)
            );
            if (machine) machineId = String(machine.id);
         }

         if (!machineId) {
            // Try Auto-Map via Fabric
            // (Simplified: just check if any fabric is unique to a machine)
            // ... logic omitted for brevity, can be added if needed
         }

         if (machineId) {
            autoMappings[wcStr] = machineId;
         }

         mappingList.push({
            name: wcStr,
            fabrics: Array.from(wcFabrics),
            currentMachineId: machineId
         });
      });

      // ALWAYS Show Mapping Modal to let user review/fix "wrong" mappings
      setUnknownWorkCenters(mappingList);
      setWorkCenterMappings(autoMappings);
      setShowMappingModal(true);
    };
    reader.readAsBinaryString(file);
  };

  const checkFabricsAndProceed = async (rows: any[], machines: any[], mappings: Record<string, string>) => {
    // Ensure mappings state is synced for any future steps (like Fabric Modal)
    setWorkCenterMappings(mappings);
    
    const unknownFabricsSet = new Set<string>();
    
    // Refresh fabrics list to be sure
    const currentFabrics = await DataService.getFabrics();
    setFabrics(currentFabrics);

    rows.forEach((row: any) => {
      const fabricName = row[0];
      if (fabricName && !currentFabrics.find(f => f.name === fabricName)) {
        unknownFabricsSet.add(fabricName);
      }
    });

    if (unknownFabricsSet.size > 0) {
      const unknowns = Array.from(unknownFabricsSet);
      setUnknownFabrics(unknowns);
      // Default all to true
      const initialCreateState: Record<string, boolean> = {};
      unknowns.forEach(f => initialCreateState[f] = true);
      setFabricsToCreate(initialCreateState);
      
      // We need to persist machines/mappings for the next step
      // Since we can't easily pass them through the modal state without prop drilling or complex state,
      // we'll just rely on refetching machines or using the 'machines' prop if needed, 
      // but 'mappings' is already in state 'workCenterMappings'.
      // 'pendingImportRows' is already set.
      
      setShowFabricImportModal(true);
    } else {
      processImportRows(rows, machines, mappings);
    }
  };

  const handleRemap = (wcName: string, currentMachineId: string) => {
      // Find fabrics for this WC from pending rows to show context
      const fabrics = new Set<string>();
      pendingImportRows.forEach((row: any) => {
          if (String(row[3]).trim() === wcName) {
              fabrics.add(row[0]);
          }
      });
      
      setUnknownWorkCenters([{ name: wcName, fabrics: Array.from(fabrics) }]);
      setWorkCenterMappings(prev => ({ ...prev, [wcName]: currentMachineId }));
      setShowMappingModal(true);
  };

  const processImportRows = async (rows: any[], machines: any[], mappings: Record<string, string>) => {
      const previewData: StagedLog[] = [];
      const targetDate = importDate; // Use the selected import date
      const yesterdayDate = new Date(targetDate);
      yesterdayDate.setDate(yesterdayDate.getDate() - 1);
      const yesterdayStr = yesterdayDate.toISOString().split('T')[0];

      // Refresh fabrics to get latest shortNames (especially if we just added some)
      const currentFabrics = await DataService.getFabrics();

      // 1. Group Excel rows by Machine ID (using mappings)
      const excelMap = new Map<string, any[]>();

      rows.forEach((row: any) => {
        const workCenter = row[4]; // Column E (Index 4) is Work Center
        if (!workCenter) return;
        const wcStr = String(workCenter).trim();

        let machineId = '';
        
        // Check mappings
        if (mappings[wcStr]) {
           machineId = mappings[wcStr];
        } else {
           // Direct Match
           const machine = machines.find((m: any) => 
             (m.name && m.name.toLowerCase() === wcStr.toLowerCase()) || 
             (m.machineid && m.machineid.toString() === wcStr) ||
             (m.id && m.id.toString() === wcStr)
           );
           if (machine) {
             machineId = String(machine.id);
           } else {
             // Fallback to name if not found (should be handled by mapping modal though)
             machineId = wcStr;
           }
        }

        if (!excelMap.has(machineId)) {
          excelMap.set(machineId, []);
        }
        excelMap.get(machineId)?.push(row);
      });

      // 2. Iterate through ALL Machines (Machine-First Approach)
      machines.forEach((machine: any) => {
        const machineId = String(machine.id);
        const groupRows = excelMap.get(machineId);
        const hasImportData = !!groupRows && groupRows.length > 0;

        // --- Context (Yesterday) ---
        const sortedLogs = [...(machine.dailyLogs || [])].sort((a: any, b: any) => new Date(b.date).getTime() - new Date(a.date).getTime());
        const previousLog = sortedLogs.find((l: any) => l.date < targetDate);
        
        const previousRemaining = previousLog?.remaining || previousLog?.remainingMfg || 0;
        const previousStatus = previousLog?.status || 'Stopped';
        const previousDate = previousLog?.date || 'No Data';
        const previousClient = previousLog?.client || '';
        const previousFabric = previousLog?.fabric || '';
        const isStale = previousDate !== yesterdayStr && previousDate !== 'No Data';

        // --- Import Data (Today) ---
        let totalProduction = 0;
        let totalScrap = 0;
        let primaryClient = '';
        let primaryFabric = '';
        let note = '';
        let isSplit = false;
        let splitDetails: { client: string; fabric: string; production: number }[] = [];
        let sourceWorkCenters: string[] = [];

        if (hasImportData && groupRows) {
          isSplit = groupRows.length > 1;
          sourceWorkCenters = Array.from(new Set(groupRows.map(r => String(r[4]).trim()))); // Column E (Index 4)

          if (isSplit) {
             // CONFLICT: Do not merge. Take the first one but flag as error.
             // Or should we take the first one?
             // User said "delete the idea of split merging".
             // So we treat this as a conflict.
             // We will just take the first row for display purposes, but validation will fail.
             const row = groupRows[0];
             totalProduction = parseFloat(row[1]) || 0;
             totalScrap = parseFloat(row[3]) || 0; // Column D (Index 3) is Scrap
             
             const rawCustomer = String(row[2] || '');
             primaryClient = rawCustomer.split(/[\s-]/)[0].trim();
             
             const rawFabricName = row[0];
             const fabricDef = currentFabrics.find(f => f.name === rawFabricName);
             primaryFabric = fabricDef ? (fabricDef.shortName || fabricDef.name) : rawFabricName;
             
             // Populate details for the tooltip anyway
             groupRows.forEach((r: any) => {
                const p = parseFloat(r[1]) || 0;
                const c = String(r[2] || '').split(/[\s-]/)[0].trim();
                const f = r[0];
                splitDetails.push({ client: c, fabric: f, production: p });
             });

          } else {
             // Single Row - Normal Case
             const row = groupRows[0];
             totalProduction = parseFloat(row[1]) || 0;
             totalScrap = parseFloat(row[3]) || 0; // Column D (Index 3) is Scrap
             
             const rawCustomer = String(row[2] || '');
             primaryClient = rawCustomer.split(/[\s-]/)[0].trim();
             
             const rawFabricName = row[0];
             const fabricDef = currentFabrics.find(f => f.name === rawFabricName);
             primaryFabric = fabricDef ? (fabricDef.shortName || fabricDef.name) : rawFabricName;
          }
        }

        // --- Result (Forecast) ---
        const netProduction = Math.max(0, totalProduction - totalScrap);
        let newRemaining = Math.max(0, previousRemaining - netProduction);
        
        let newStatus = previousStatus;
        if (hasImportData) {
          if (totalProduction > 0) {
            newStatus = 'Working'; 
          } else if (totalProduction === 0 && previousStatus === 'Working') {
            newStatus = 'Stopped'; 
          }
        }

        // --- Validation Logic ---
        let validationStatus: 'SAFE' | 'WARNING' | 'ERROR' = 'SAFE';
        let validationMessage = '';

        if (!hasImportData) {
          if (previousStatus === 'Working') {
            validationStatus = 'WARNING';
            validationMessage = 'Missing in Excel (Was Working).';
          }
        } else {
          // Rule 0: Split Run / Conflict
          if (isSplit) {
             validationStatus = 'ERROR';
             validationMessage = `Conflict: ${groupRows?.length} rows map to this machine. Check mappings.`;
          }

          // Rule 1: Unexpected Changeover
          if (previousRemaining > 0 && previousClient && primaryClient && previousClient !== primaryClient) {
            validationStatus = 'WARNING';
            validationMessage = `Client changed (${previousClient} -> ${primaryClient}) but ${previousRemaining}kg remained.`;
          }

          // Rule 2: Stale History
          if (isStale) {
             if (validationStatus === 'SAFE') validationStatus = 'WARNING';
             validationMessage += ` Previous data is from ${previousDate}.`;
          }

          // Rule 3: Overwrite Check
          const exists = (machine.dailyLogs || []).some((l: any) => l.date === targetDate);
          if (exists) {
             validationStatus = 'WARNING';
             validationMessage += ` Data already exists for ${targetDate}.`;
          }

          // Rule 4: Negative Remaining
          if (netProduction > previousRemaining + 50 && previousRemaining > 0) { 
             validationStatus = 'WARNING';
             validationMessage += ` Production (${netProduction}) > Remaining (${previousRemaining}).`;
          }
          
          // Rule 5: Split Run
          if (isSplit) {
             validationStatus = 'WARNING';
             validationMessage += ` Split Run detected (${groupRows?.length} entries).`;
          }
        }

        previewData.push({
          id: machine.id,
          machineId: String(machine.id),
          machineName: machine.name,
          previousDate,
          previousClient,
          previousFabric,
          previousRemaining,
          previousStatus,
          isStale,
          hasImportData,
          importDate: targetDate,
          importProduction: totalProduction,
          importScrap: totalScrap,
          importClient: primaryClient,
          importFabric: primaryFabric,
          sourceWorkCenters,
          isSplit,
          splitDetails,
          newRemaining,
          newStatus,
          note,
          validationStatus,
          validationMessage,
          selected: hasImportData // Only select if data exists by default
        });
      });

      // Sort: Issues first, then by Name
      previewData.sort((a, b) => {
        if (a.validationStatus !== 'SAFE' && b.validationStatus === 'SAFE') return -1;
        if (a.validationStatus === 'SAFE' && b.validationStatus !== 'SAFE') return 1;
        return a.machineName.localeCompare(b.machineName);
      });

      setImportPreview(previewData);
      setShowImportModal(true);
  };

  const applyImport = async () => {
    const selectedItems = importPreview.filter(item => item.selected);
    if (selectedItems.length === 0) {
      showMessage('⚠️ No items selected for import.', true);
      return;
    }
    
    setLoading(true);
    try {
      const batch = writeBatch(db);
      const machines = await DataService.getMachinesFromMachineSS();
      
      for (const item of selectedItems) {
        const machine = machines.find((m: any) => String(m.id) === String(item.machineId));
        if (!machine) continue;

        const newLog = {
          date: item.importDate,
          dayProduction: item.importProduction,
          scrap: item.importScrap || 0,
          fabric: item.importFabric || '',
          client: item.importClient || '',
          status: item.newStatus,
          remaining: item.newRemaining, // For legacy structure
          remainingMfg: item.newRemaining, // For new structure
          note: item.note || ''
        };

        // Update dailyLogs array (Legacy)
        const existingLogIndex = (machine.dailyLogs || []).findIndex((l: any) => l.date === item.importDate);
        let updatedLogs = [...(machine.dailyLogs || [])];

        if (existingLogIndex >= 0) {
          updatedLogs[existingLogIndex] = { ...updatedLogs[existingLogIndex], ...newLog };
        } else {
          updatedLogs.push(newLog);
        }

        const docRef = doc(db, 'MachineSS', String(machine.id));
        
        // Update parent doc
        batch.update(docRef, { 
          dailyLogs: updatedLogs,
          // Also update top-level fields if this is the latest log
          ...(item.importDate >= (machine.lastLogDate || '') ? {
            status: item.newStatus,
            lastLogDate: item.importDate,
            lastLogData: newLog
          } : {})
        });

        // Update sub-collection
        const subLogRef = doc(db, 'MachineSS', String(machine.id), 'dailyLogs', item.importDate);
        batch.set(subLogRef, {
          ...newLog,
          machineId: machine.id,
          timestamp: new Date().toISOString()
        }, { merge: true });
      }

      await batch.commit();
      setImportPreview([]);
      setShowImportModal(false);
      showMessage(`✅ Successfully imported ${selectedItems.length} records!`);
      handleFetchLogs(selectedDate); // Refresh
    } catch (error) {
      console.error('Error applying import:', error);
      showMessage('❌ Error applying import', true);
    } finally {
      setLoading(false);
    }
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
          ...log,
          id: log.date || log.id
        });
      });
    });

    // Fetch daily summary (external production)
    // Note: This is still async/fetch based. Ideally should be subscribed too.
    try {
      const dailySummary = await DataService.getDailySummary(date);
      setExternalProduction(dailySummary?.externalProduction || 0);
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
  const totalScrap = filteredLogs.reduce((sum, m) => sum + (Number(m.scrap) || 0), 0) + Number(hallScrap) + Number(labScrap);
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
                <div className="relative">
                  <input 
                    type="date" 
                    value={fetchSourceDate}
                    onChange={(e) => setFetchSourceDate(e.target.value)}
                    className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-300 rounded-lg text-slate-700 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all"
                  />
                  <div className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none">
                    <History size={18} />
                  </div>
                </div>
                <p className="text-xs text-slate-500">
                  This will copy machine status, fabric, and client from the selected date and calculate the new remaining quantity.
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
               <div className="flex items-center gap-2 bg-slate-50 px-3 py-1.5 rounded-lg border border-slate-200">
                  <span className="text-xs font-bold text-slate-500 uppercase tracking-wider hidden xs:inline">Date:</span>
                  <input
                    type="date"
                    value={selectedDate}
                    onChange={(e) => {
                      isUserDateSelection.current = true; // Mark as user interaction
                      setSelectedDate(e.target.value);
                      handleFetchLogs(e.target.value);
                    }}
                    className="bg-transparent text-slate-700 text-sm font-medium outline-none cursor-pointer"
                  />
               </div>

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
                    onClick={() => setShowImportModal(true)}
                    className="p-2 rounded-lg text-slate-600 hover:text-purple-600 hover:bg-purple-50 border border-transparent hover:border-purple-100 transition-all"
                  >
                    <FileSpreadsheet size={18} />
                  </button>

                  <button
                    onClick={handleExportBackup}
                    className="p-2 rounded-lg text-slate-600 hover:text-blue-600 hover:bg-blue-50 border border-transparent hover:border-blue-100 transition-all"
                  >
                    <Download size={18} />
                  </button>

                  <label className="p-2 rounded-lg text-slate-600 hover:text-blue-600 hover:bg-blue-50 border border-transparent hover:border-blue-100 transition-all cursor-pointer" title="Import JSON">
                    <Upload size={18} />
                    <input
                      type="file"
                      accept=".json"
                      onChange={handleImportBackup}
                      className="hidden"
                    />
                  </label>

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
                onClick={handleSendReport}
                disabled={isSendingReport || isReportSent}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold transition-all shadow-sm border ${
                  isReportSent
                    ? 'bg-emerald-100 text-emerald-700 border-emerald-300 cursor-default'
                    : isSendingReport 
                      ? 'bg-emerald-50 text-emerald-600 border-emerald-200' 
                      : 'bg-slate-800 text-white border-slate-800 hover:bg-slate-700 hover:border-slate-700'
                }`}
              >
                {isReportSent ? (
                  <CheckCircle className="w-4 h-4" />
                ) : isSendingReport ? (
                  <Send className="w-4 h-4 animate-pulse" />
                ) : (
                  <Send className="w-4 h-4" />
                )}
                <span className="hidden sm:inline">{isReportSent ? 'Finished' : isSendingReport ? 'Sending...' : 'Finish'}</span>
                <span className="sm:hidden">{isReportSent ? 'Done' : 'Finish'}</span>
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
                    <div className="bg-slate-50 px-2 py-2 border-t border-slate-100 flex justify-between items-center gap-1">
                      <button
                        onClick={() => setDetailsModal({ isOpen: true, log, index: idx })}
                        className="text-[10px] font-medium text-slate-500 hover:text-slate-700 flex-1 text-center"
                      >
                        Details
                      </button>
                      <button
                        onClick={() => openPlansModal(log.machineId, log.machineName)}
                        className="px-2 py-1 bg-blue-600 text-white text-[10px] font-bold rounded shadow-sm hover:bg-blue-700 transition-colors flex-1 text-center truncate"
                      >
                        Plans
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
                            value={log.avgProduction ?? ''}
                            data-force-nav="true"
                            onFocus={() => {
                              handleCellFocus(idx, 'avgProduction');
                              window.dispatchEvent(new Event('searchdropdown:forceclose'));
                            }}
                            onChange={(e) => handleUpdateLog(log.machineId, log.id, 'avgProduction', e.target.value, true)}
                            onBlur={(e) => handleUpdateLog(log.machineId, log.id, 'avgProduction', Number(e.target.value), false)}
                            onKeyDown={(e) => handleKeyDown(e, idx, 'avgProduction')}
                            className="w-full h-full p-2 text-center bg-transparent focus:bg-blue-50 focus:outline-none"
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

              {/* Scrap Inputs Column */}
              <div className="md:w-32 border-r border-slate-200 bg-red-50/30 p-2 flex flex-col justify-center gap-2">
                 <div className="flex flex-col items-center">
                    <span className="text-[10px] text-red-900/60 font-bold mb-0.5">سقط الصالة</span>
                    <input 
                       type="number" 
                       value={hallScrap}
                       onChange={(e) => setHallScrap(Number(e.target.value))}
                       onBlur={handleHallScrapBlur}
                       className="w-full text-center bg-white/50 rounded border border-red-100 font-bold text-sm text-red-700 outline-none focus:border-red-300 py-1"
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
                       className="w-full text-center bg-white/50 rounded border border-red-100 font-bold text-sm text-red-700 outline-none focus:border-red-300 py-1"
                    />
                 </div>
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
                  <thead className="bg-slate-100 text-slate-600 font-semibold text-xs uppercase tracking-wider sticky top-0 z-10 shadow-sm">
                    <tr>
                      <th className="p-2 border-b border-r border-slate-200 w-28 text-center">Start</th>
                      <th className="p-2 border-b border-r border-slate-200 w-28 text-center">End</th>
                      <th className="p-2 border-b border-r border-slate-200 w-24 text-left">Machine</th>
                      <th className="p-2 border-b border-r border-slate-200 w-16 text-center">Days</th>
                      <th className="p-2 border-b border-r border-slate-200 min-w-[120px] text-left">Client / Ref</th>
                      <th className="p-2 border-b border-r border-slate-200 w-20 text-right">Rem.</th>
                      <th className="p-2 border-b border-r border-slate-200 w-20 text-right">Qty</th>
                      <th className="p-2 border-b border-r border-slate-200 w-20 text-right">Prod/Day</th>
                      <th className="p-2 border-b border-r border-slate-200 min-w-[120px] text-left">Fabric / Notes</th>
                      <th className="p-2 border-b border-slate-200 w-20 text-center">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {plansModalOpen.plans.length === 0 ? (
                      <tr>
                        <td colSpan={10} className="p-8 text-center text-slate-400">
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
                            {/* Machine */}
                            <td className="p-0 border-r border-slate-100">
                              <input
                                type="text"
                                value={plan.originalSampleMachine || ''}
                                onChange={(e) => handleUpdatePlan(idx, 'originalSampleMachine', e.target.value)}
                                className="w-full p-2 bg-transparent outline-none focus:bg-blue-50 text-xs"
                                placeholder="-"
                              />
                            </td>
                            {/* Days */}
                            <td className="p-2 border-r border-slate-100 text-center text-xs font-bold text-orange-600">
                              {calculatedDays}
                            </td>
                            {/* Client / Ref */}
                            <td className="p-0 border-r border-slate-100">
                              <input
                                type="text"
                                value={plan.orderName || ''}
                                onChange={(e) => handleUpdatePlan(idx, 'orderName', e.target.value)}
                                className="w-full p-2 bg-transparent outline-none focus:bg-blue-50 text-xs text-blue-600 font-medium"
                                placeholder="-"
                              />
                            </td>
                            {/* Remaining */}
                            <td className="p-0 border-r border-slate-100">
                              <input
                                type="number"
                                value={plan.remaining || 0}
                                onChange={(e) => handleUpdatePlan(idx, 'remaining', Number(e.target.value))}
                                className="w-full p-2 text-right bg-transparent outline-none focus:bg-blue-50 text-xs font-bold"
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
                            <td className="p-0 border-r border-slate-100">
                              {isSettings ? (
                                <input
                                  type="text"
                                  value={plan.notes || ''}
                                  onChange={(e) => handleUpdatePlan(idx, 'notes', e.target.value)}
                                  className="w-full p-2 bg-transparent outline-none focus:bg-blue-50 text-xs text-slate-500 italic"
                                  placeholder="Notes..."
                                />
                              ) : (
                                <input
                                  type="text"
                                  value={plan.fabric || ''}
                                  onChange={(e) => handleUpdatePlan(idx, 'fabric', e.target.value)}
                                  className="w-full p-2 bg-transparent outline-none focus:bg-blue-50 text-xs font-medium"
                                  placeholder="-"
                                />
                              )}
                            </td>
                            {/* Actions */}
                            <td className="p-1 text-center flex gap-1 justify-center items-center">
                              <button
                                onClick={() => handleMakeActive(idx)}
                                className="p-1 bg-emerald-100 hover:bg-emerald-200 text-emerald-700 rounded transition-colors"
                                title="Make Active"
                              >
                                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                </svg>
                              </button>
                              <button
                                onClick={() => handleDeletePlan(idx)}
                                className="p-1 bg-red-100 hover:bg-red-200 text-red-700 rounded transition-colors"
                                title="Delete"
                              >
                                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
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
                      {/* Machine */}
                      <td className="p-0 border-r border-slate-200">
                        <input
                          type="text"
                          value={inlineNewPlan.originalSampleMachine || ''}
                          onChange={(e) => setInlineNewPlan({ ...inlineNewPlan, originalSampleMachine: e.target.value })}
                          placeholder="Original"
                          className="w-full p-2 bg-transparent outline-none placeholder-slate-400 text-xs"
                        />
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
                      {/* Remaining */}
                      <td className="p-0 border-r border-slate-200">
                        <input
                          type="number"
                          value={inlineNewPlan.remaining || ''}
                          onChange={(e) => setInlineNewPlan({ ...inlineNewPlan, remaining: Number(e.target.value) })}
                          placeholder="0"
                          disabled={inlineNewPlan.type === 'SETTINGS'}
                          className="w-full p-2 text-right bg-transparent outline-none font-bold disabled:opacity-50 placeholder-slate-400 text-xs"
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
                      <td className="p-0 border-r border-slate-200">
                        {inlineNewPlan.type === 'SETTINGS' ? (
                          <input
                            type="text"
                            value={inlineNewPlan.notes || ''}
                            onChange={(e) => setInlineNewPlan({ ...inlineNewPlan, notes: e.target.value })}
                            placeholder="Notes..."
                            className="w-full p-2 bg-transparent outline-none text-slate-500 italic placeholder-slate-400 text-xs"
                          />
                        ) : (
                          <input
                            type="text"
                            value={inlineNewPlan.fabric || ''}
                            onChange={(e) => setInlineNewPlan({ ...inlineNewPlan, fabric: e.target.value })}
                            placeholder="Fabric"
                            className="w-full p-2 bg-transparent outline-none placeholder-slate-400 text-xs"
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

      </>
      ) : (
        <ExternalProductionSheet 
          date={selectedDate} 
          onClose={() => setShowExternalSheet(false)}
          onUpdateTotal={(total) => {
             setExternalProduction(total);
             // Also update the daily summary immediately so the main view reflects it
             DataService.updateDailySummary(selectedDate, { externalProduction: total });
          }}
          isEmbedded={true}
          onNavigateToPlanning={onNavigateToPlanning}
        />
      )}

      {/* Mapping Modal */}
      {showMappingModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[80] p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-3xl max-h-[90vh] overflow-hidden flex flex-col">
            <div className="p-6 border-b border-slate-200 flex justify-between items-center bg-purple-50">
              <div>
                <h2 className="text-xl font-bold text-purple-800 flex items-center gap-2">
                  <Link className="text-purple-600" />
                  Review Work Center Mappings
                </h2>
                <p className="text-sm text-purple-700 mt-1">
                  Verify how Excel Work Centers map to your Machines before importing.
                </p>
              </div>
              <button 
                onClick={() => setShowMappingModal(false)}
                className="text-slate-400 hover:text-slate-600 transition-colors"
              >
                <X size={24} />
              </button>
            </div>
            
            <div className="p-6 overflow-y-auto flex-1">
              <div className="space-y-4">
                {unknownWorkCenters.map((wc, idx) => {
                  const isMapped = !!workCenterMappings[wc.name];
                  return (
                  <div key={idx} className={`p-4 border rounded-lg ${isMapped ? 'bg-white border-slate-200' : 'bg-red-50 border-red-200'}`}>
                    <div className="flex justify-between items-start mb-3">
                      <div>
                        <div className="flex items-center gap-2">
                           <h3 className="font-bold text-slate-800 text-lg">{wc.name}</h3>
                           {!isMapped && <span className="text-[10px] bg-red-100 text-red-600 px-2 py-0.5 rounded-full font-bold">Unmapped</span>}
                        </div>
                        <div className="text-xs text-slate-500 mt-1">
                          Fabrics in Excel: {wc.fabrics.join(', ') || 'None'}
                        </div>
                      </div>
                    </div>
                    
                    <div className="flex items-center gap-3">
                      <span className="text-sm font-medium text-slate-700">Maps to:</span>
                      <div className="flex-1">
                        <SearchDropdown
                          id={`mapping-${idx}`}
                          options={mappingMachines.map((m: any) => ({ 
                            id: m.id, 
                            name: `${m.machineName || m.name} (${m.machineType || '?'})` 
                          }))}
                          value={(() => {
                            const mappedId = workCenterMappings[wc.name];
                            if (!mappedId) return '';
                            const m = mappingMachines.find((m: any) => String(m.id) === String(mappedId));
                            return m ? `${m.machineName || m.name} (${m.machineType || '?'})` : '';
                          })()}
                          onChange={(val) => {
                            // Reverse lookup name to ID
                            const selected = mappingMachines.find((m: any) => `${m.machineName || m.name} (${m.machineType || '?'})` === val);
                            if (selected) {
                              setWorkCenterMappings(prev => ({
                                ...prev,
                                [wc.name]: String(selected.id)
                              }));
                            } else if (val === '') {
                               // Allow clearing
                               setWorkCenterMappings(prev => {
                                   const next = { ...prev };
                                   delete next[wc.name];
                                   return next;
                               });
                            }
                          }}
                          placeholder="Select a machine..."
                        />
                      </div>
                    </div>
                  </div>
                )})}
              </div>
            </div>

            <div className="p-4 border-t border-slate-200 bg-slate-50 flex justify-end gap-3">
               <button
                  onClick={() => setShowMappingModal(false)}
                  className="px-4 py-2 text-slate-600 hover:text-slate-800 font-medium transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    // Save mappings to DB
                    DataService.saveWorkCenterMappings(workCenterMappings);
                    setShowMappingModal(false);
                    checkFabricsAndProceed(pendingImportRows, mappingMachines, workCenterMappings);
                  }}
                  className="px-6 py-2 bg-purple-600 hover:bg-purple-700 text-white font-bold rounded-lg shadow-sm transition-colors flex items-center gap-2"
                >
                  <Check size={18} />
                  Confirm Mappings & Continue
                </button>
            </div>
          </div>
        </div>
      )}

      {/* Fabric Import Modal */}
      {showFabricImportModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[80] p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
            <div className="p-6 border-b border-slate-200 flex justify-between items-center bg-purple-50">
              <div>
                <h2 className="text-xl font-bold text-purple-800 flex items-center gap-2">
                  <Sparkles className="text-purple-600" />
                  New Fabrics Found
                </h2>
                <p className="text-sm text-purple-700 mt-1">
                  The following fabrics are not in the database. Select which ones to add.
                </p>
              </div>
              <button 
                onClick={() => setShowFabricImportModal(false)}
                className="text-slate-400 hover:text-slate-600 transition-colors"
              >
                <X size={24} />
              </button>
            </div>
            
            <div className="p-6 overflow-y-auto flex-1">
              <div className="space-y-2">
                {unknownFabrics.map((fabricName, idx) => {
                  const { shortName } = parseFabricName(fabricName);
                  const isSelected = fabricsToCreate[fabricName];
                  
                  return (
                    <div key={idx} className={`p-3 border rounded-lg flex items-center gap-3 transition-colors ${isSelected ? 'bg-purple-50 border-purple-200' : 'bg-slate-50 border-slate-200'}`}>
                      <input 
                        type="checkbox"
                        checked={isSelected}
                        onChange={(e) => {
                          setFabricsToCreate(prev => ({
                            ...prev,
                            [fabricName]: e.target.checked
                          }));
                        }}
                        className="w-5 h-5 text-purple-600 rounded focus:ring-purple-500"
                      />
                      <div className="flex-1">
                        <div className="text-sm font-bold text-slate-800">{fabricName}</div>
                        {isSelected && (
                          <div className="text-xs text-purple-600 mt-1 flex items-center gap-1">
                            <span className="font-medium">Will be added as:</span> {shortName}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="p-6 border-t border-slate-200 bg-slate-50 flex justify-end gap-3">
              <button
                onClick={() => setShowFabricImportModal(false)}
                className="px-4 py-2 text-slate-600 hover:bg-slate-200 rounded-lg font-medium transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  setShowFabricImportModal(false);
                  
                  // Create selected fabrics
                  const createPromises = unknownFabrics
                    .filter(f => fabricsToCreate[f])
                    .map(async (name) => {
                       const { code, shortName } = parseFabricName(name);
                       // Generate ID
                       const docId = name.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
                       await DataService.addFabric({ 
                         name, 
                         code, 
                         shortName,
                         workCenters: [], 
                         variants: []
                       });
                    });
                  
                  if (createPromises.length > 0) {
                    await Promise.all(createPromises);
                    showMessage(`✅ Added ${createPromises.length} new fabrics`);
                  }

                  // Refetch machines to be safe
                  const freshMachines = await DataService.getMachinesFromMachineSS();
                  
                  // Proceed
                  processImportRows(pendingImportRows, freshMachines, workCenterMappings);
                }}
                className="px-6 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg font-bold shadow-lg shadow-purple-200 transition-colors flex items-center gap-2"
              >
                <Check size={18} />
                Continue Import
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Import Modal */}
      {showImportModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[70] p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-[95vw] h-[90vh] flex flex-col">
            {/* Header */}
            <div className="p-4 border-b border-slate-200 flex justify-between items-center bg-purple-50">
              <div>
                <h2 className="text-xl font-bold text-purple-800 flex items-center gap-2">
                  <FileSpreadsheet className="text-purple-600" />
                  Import & Validate ODOO Data
                </h2>
                <p className="text-sm text-purple-700 mt-1">
                  Review incoming production data against yesterday's machine state.
                </p>
              </div>
              <div className="flex items-center gap-4">
                 <div className="flex items-center gap-2 bg-white px-3 py-1.5 rounded border border-slate-300">
                    <span className="text-sm font-bold text-slate-600">Import Date:</span>
                    <input 
                      type="date" 
                      value={importDate}
                      onChange={(e) => setImportDate(e.target.value)}
                      className="text-sm border-none focus:ring-0 text-slate-800 font-medium"
                    />
                 </div>
                 <button 
                  onClick={() => {
                    setShowImportModal(false);
                    setImportPreview([]);
                  }}
                  className="text-slate-400 hover:text-slate-600 transition-colors"
                >
                  <X size={24} />
                </button>
              </div>
            </div>
            
            {/* Content */}
            <div className="flex-1 overflow-hidden flex flex-col">
              {importPreview.length === 0 ? (
                <div className="flex-1 flex flex-col items-center justify-center p-12 bg-slate-50">
                  <div className="w-full max-w-xl border-2 border-dashed border-slate-300 rounded-xl bg-white p-12 flex flex-col items-center text-center hover:border-blue-400 transition-colors relative">
                    <input 
                      type="file" 
                      accept=".xlsx, .xls" 
                      onChange={handleFileUpload}
                      className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                    />
                    <div className="w-20 h-20 bg-blue-50 rounded-full flex items-center justify-center mb-6">
                      <Upload size={40} className="text-blue-600" />
                    </div>
                    <h3 className="text-xl font-bold text-slate-800 mb-2">Upload Production Sheet</h3>
                    <p className="text-slate-500 mb-8">Drag and drop your Excel file here, or click to browse.</p>
                    
                    <div className="text-left text-sm text-slate-500 bg-slate-50 p-4 rounded border border-slate-200 w-full">
                      <p className="font-bold mb-2 text-slate-700">Required Columns:</p>
                      <div className="grid grid-cols-2 gap-2">
                        <div className="flex items-center gap-2"><div className="w-6 h-6 rounded bg-slate-200 flex items-center justify-center text-xs font-bold">A</div> Fabric Name</div>
                        <div className="flex items-center gap-2"><div className="w-6 h-6 rounded bg-slate-200 flex items-center justify-center text-xs font-bold">B</div> Production (Kg)</div>
                        <div className="flex items-center gap-2"><div className="w-6 h-6 rounded bg-slate-200 flex items-center justify-center text-xs font-bold">C</div> Customer</div>
                        <div className="flex items-center gap-2"><div className="w-6 h-6 rounded bg-slate-200 flex items-center justify-center text-xs font-bold">D</div> Scrap (Kg)</div>
                        <div className="flex items-center gap-2"><div className="w-6 h-6 rounded bg-slate-200 flex items-center justify-center text-xs font-bold">E</div> Machine Name</div>
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="flex-1 overflow-auto bg-slate-100 p-4">
                  <div className="bg-white rounded-lg shadow border border-slate-200 overflow-hidden">
                    <table className="w-full text-sm text-left border-collapse">
                      <thead className="bg-slate-50 text-slate-700 font-bold sticky top-0 z-10 shadow-sm">
                        <tr>
                          <th className="p-3 border-b w-10 text-center">
                            <input 
                              type="checkbox" 
                              checked={importPreview.every(i => i.selected)}
                              onChange={(e) => {
                                const allSelected = e.target.checked;
                                setImportPreview(prev => prev.map(p => ({ ...p, selected: allSelected })));
                              }}
                            />
                          </th>
                          <th className="p-3 border-b w-48">Machine</th>
                          
                          {/* Context Group */}
                          <th className="p-3 border-b border-l border-slate-200 bg-slate-50/50 w-64">
                            <div className="flex items-center gap-1 text-slate-500 mb-1 text-xs uppercase tracking-wider">
                              <History size={12} /> Yesterday (Context)
                            </div>
                          </th>

                          {/* Import Group */}
                          <th className="p-3 border-b border-l border-slate-200 bg-indigo-50/30 w-64">
                            <div className="flex items-center gap-1 text-indigo-600 mb-1 text-xs uppercase tracking-wider">
                              <FileSpreadsheet size={12} /> Import (Today)
                            </div>
                          </th>

                          {/* Result Group */}
                          <th className="p-3 border-b border-l border-slate-200 bg-purple-100">
                            <div className="flex items-center gap-1 text-purple-700 mb-1 text-xs uppercase tracking-wider">
                              <ArrowRight size={12} /> Forecast
                            </div>
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200">
                        {importPreview.map((item, idx) => {
                           const isWarning = item.validationStatus === 'WARNING';
                           const isError = item.validationStatus === 'ERROR';
                           const rowClass = isError ? 'bg-red-50' : isWarning ? 'bg-amber-50' : 'hover:bg-slate-50';

                           return (
                            <tr key={idx} className={`${rowClass} transition-colors`}>
                              <td className="p-3 text-center border-r border-slate-100">
                                <input 
                                  type="checkbox" 
                                  checked={item.selected}
                                  onChange={() => {
                                    setImportPreview(prev => {
                                      const next = [...prev];
                                      next[idx].selected = !next[idx].selected;
                                      return next;
                                    });
                                  }}
                                />
                              </td>
                              <td className="p-3 border-r border-slate-100">
                                <div className="font-bold text-slate-800">{item.machineName}</div>
                                <div className="text-xs text-slate-500 flex items-center gap-1 mt-1">
                                  {item.hasImportData ? (
                                    <span className="text-green-600 flex items-center gap-0.5">
                                      <CheckCircle2 size={10} /> Found in Excel
                                    </span>
                                  ) : (
                                    <span className="text-slate-400 flex items-center gap-0.5">
                                      <XCircle size={10} /> Not in Excel
                                    </span>
                                  )}
                                </div>
                                {item.validationMessage && (
                                  <div className={`text-[10px] mt-2 p-1 rounded border ${
                                    isError ? 'bg-red-100 text-red-700 border-red-200' : 'bg-amber-100 text-amber-700 border-amber-200'
                                  }`}>
                                    {item.validationMessage}
                                  </div>
                                )}
                              </td>

                              {/* Context (Yesterday) */}
                              <td className="p-3 border-r border-slate-100 text-slate-600">
                                <div className="flex justify-between items-center mb-1">
                                  <span className="text-xs font-medium">Status:</span>
                                  <span className={`text-xs px-1.5 py-0.5 rounded ${
                                    item.previousStatus === 'Working' ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-600'
                                  }`}>{item.previousStatus}</span>
                                </div>
                                <div className="flex justify-between items-center mb-1">
                                  <span className="text-xs font-medium">Rem:</span>
                                  <span className="font-mono font-bold">{item.previousRemaining} kg</span>
                                </div>
                                {item.previousClient && (
                                  <div className="text-xs text-slate-500 truncate max-w-[180px]" title={`${item.previousClient} / ${item.previousFabric}`}>
                                    {item.previousClient} • {item.previousFabric}
                                  </div>
                                )}
                                {item.isStale && (
                                  <div className="text-[10px] text-red-500 mt-1 flex items-center gap-1">
                                    <AlertTriangle size={10} /> Data from {item.previousDate}
                                  </div>
                                )}
                              </td>

                              {/* Import (Today) */}
                              <td className="p-3 border-r border-slate-100 bg-indigo-50/10">
                                {item.hasImportData ? (
                                  <>
                                    {/* Source WorkCenters (Mapping) */}
                                    <div className="mb-2 flex flex-wrap gap-1">
                                      {item.sourceWorkCenters?.map((wc, i) => (
                                        <div key={i} className="flex items-center gap-1 bg-white border border-slate-200 rounded px-1.5 py-0.5 text-[10px] text-slate-500 shadow-sm">
                                          <span className="truncate max-w-[80px]" title={wc}>{wc}</span>
                                          <button 
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              handleRemap(wc, item.machineId);
                                            }}
                                            className="text-indigo-500 hover:text-indigo-700 p-0.5 rounded hover:bg-indigo-50"
                                            title="Edit Mapping"
                                          >
                                            <Edit size={10} />
                                          </button>
                                        </div>
                                      ))}
                                    </div>

                                    <div className="flex justify-between items-center mb-1">
                                      <span className="text-xs font-medium text-indigo-700">Prod:</span>
                                      <span className="font-mono font-bold text-indigo-700">{item.importProduction} kg</span>
                                    </div>
                                    {item.importScrap > 0 && (
                                      <div className="flex justify-between items-center mb-1 text-red-600">
                                        <span className="text-xs">Scrap:</span>
                                        <span className="font-mono text-xs">-{item.importScrap} kg</span>
                                      </div>
                                    )}
                                    <div className="text-xs text-slate-700 font-medium truncate max-w-[180px]">
                                      {item.importClient}
                                    </div>
                                    <div className="text-xs text-slate-500 truncate max-w-[180px]">
                                      {item.importFabric}
                                    </div>
                                    {item.isSplit && (
                                      <div className="mt-1">
                                        <span className="text-[10px] bg-red-100 text-red-700 px-1.5 py-0.5 rounded border border-red-200 font-bold flex items-center gap-1">
                                          <AlertTriangle size={10} /> CONFLICT
                                        </span>
                                        <div className="text-[10px] text-slate-500 mt-0.5">
                                          Multiple rows map to this machine.
                                        </div>
                                      </div>
                                    )}
                                  </>
                                ) : (
                                  <div className="text-center text-slate-400 text-xs italic py-2">
                                    No data in Excel
                                  </div>
                                )}
                              </td>

                              {/* Forecast */}
                              <td className="p-3 bg-purple-50/20">
                                <div className="flex justify-between items-center mb-1">
                                  <span className="text-xs font-medium">New Rem:</span>
                                  <div className="flex items-center gap-1">
                                    <span className={`font-mono font-bold ${item.newRemaining < 0 ? 'text-red-600' : 'text-slate-800'}`}>
                                      {item.newRemaining} kg
                                    </span>
                                    {item.hasImportData && (
                                      <span className="text-[10px] text-slate-400">
                                        ({item.newRemaining - item.previousRemaining})
                                      </span>
                                    )}
                                  </div>
                                </div>
                                <div className="flex justify-between items-center">
                                  <span className="text-xs font-medium">New Status:</span>
                                  <span className={`text-xs px-1.5 py-0.5 rounded font-bold ${
                                    item.newStatus === 'Working' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                                  }`}>
                                    {item.newStatus}
                                  </span>
                                </div>
                              </td>
                            </tr>
                           );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
            
            {/* Footer */}
            <div className="p-4 border-t border-slate-200 bg-slate-50 flex justify-between items-center">
              <div className="text-sm text-slate-500">
                {importPreview.filter(i => i.selected).length} machines selected for update
              </div>
              <div className="flex gap-3">
                <button
                  onClick={() => {
                    setShowImportModal(false);
                    setImportPreview([]);
                  }}
                  className="px-4 py-2 text-slate-600 hover:text-slate-800 font-medium transition-colors"
                >
                  Cancel
                </button>
                {importPreview.length > 0 && (
                  <button
                    onClick={applyImport}
                    className="px-6 py-2 bg-purple-600 hover:bg-purple-700 text-white font-bold rounded-lg shadow-sm transition-colors flex items-center gap-2"
                  >
                    <Check size={18} />
                    Confirm & Apply
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
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
      {/* Add/Edit Modal */}
      <FabricFormModal
        isOpen={isFabricModalOpen}
        onClose={() => setIsFabricModalOpen(false)}
        onSave={handleSaveFabric}
        machines={rawMachines}
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
        onClose={() => setHistoryModalOpen({ ...historyModalOpen, isOpen: false })}
        machineId={historyModalOpen.machineId}
        machineName={historyModalOpen.machineName}
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
