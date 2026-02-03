import React, { useState, useEffect, useMemo, useRef } from 'react';
import { 
  collection, 
  onSnapshot, 
  addDoc, 
  updateDoc, 
  deleteDoc, 
  doc, 
  serverTimestamp,
  query,
  orderBy,
  getDocs,
  where
} from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';
import { db, auth, storage } from '../services/firebase';
import { 
  Plus, 
  Search, 
  Filter, 
  Calendar, 
  Clock, 
  CheckCircle, 
  Circle, 
  Settings, 
  Award,
  Trash2,
  Edit3,
  X,
  Save,
  ChevronDown,
  ChevronUp,
  Beaker,
  Play,
  Target,
  RefreshCw,
  Zap,
  History,
  ChevronLeft,
  ChevronRight,
  Repeat,
  AlertTriangle,
  ArrowUp,
  ArrowDown,
  Loader,
  Info,
  ListOrdered,
  Activity,
  Camera,
  Image as ImageIcon
} from 'lucide-react';
import { MachineSS, FuturePlanEntry } from '../types';

// Sample Status Types
type SampleStatus = 'PLANNED' | 'MACHINE_SETUP' | 'QUALITY_CHECK' | 'DONE';

interface Sample {
  id: string;
  name: string;
  notes: string;
  expectedDate: string;
  machineId: string;
  machineName: string;
  status: SampleStatus;
  // NEW: Priority & Scheduling
  priority: number; // Lower number = higher priority (1 is highest)
  estimatedDays: number; // Estimated days to complete
  calculatedStartDate?: string; // Auto-calculated based on machine queue
  calculatedEndDate?: string; // Auto-calculated based on machine queue + estimatedDays
  statusHistory: {
    status: SampleStatus;
    date: string;
    enteredAt: string;
    updatedBy?: string;
  }[];
  imageUrl?: string; // Sample image URL
  imagePath?: string; // Storage path for deletion
  // Sample Data (measurements)
  rawWeight?: number; // وزن خام
  zeroWeight?: number; // وزن زيرو
  rawWidth?: number; // عرض خام
  zeroWidth?: number; // عرض زيرو
  // Finishing Plan (خطة الجهيز)
  requiredFinishedWeight?: number; // وزن مطلوب مجهز
  requiredFinishedWidth?: number; // عرض مطلوب مجهز
  finishingNazeem?: boolean; // نزيم
  finishingTathbeet?: boolean; // تثبيت
  finishingKasra?: boolean; // كسترة
  finishingCarbon?: boolean; // كربون
  finishingRam?: boolean; // رام
  finishingCompacter?: boolean; // كومباكتر
  createdAt: any;
  createdBy: string;
  updatedAt?: any;
  updatedBy?: string;
}

interface Machine {
  id: string;
  name: string;
  type?: string;
  futurePlans?: FuturePlanEntry[];
  dailyLogs?: any[];
}

// Machine Schedule Info (calculated from MachineSS)
interface MachineScheduleInfo {
  isCurrentlyWorking: boolean;
  currentWork?: {
    fabric: string;
    client: string;
    remaining?: number;
  };
  futurePlans: FuturePlanEntry[];
  nextAvailableDate: string;
  totalQueuedDays: number;
}

// Daily Work Entry
interface DailyWorkEntry {
  id: string;
  date: string; // YYYY-MM-DD
  sampleId: string;
  sampleName: string;
  machineId: string;
  machineName: string;
  notes: string;
  workType: 'SAMPLE' | 'ORDER_WORK';
  technicianId: string; // Legacy single - kept for backwards compatibility
  technicianName: string; // Legacy single
  technicians?: { id: string; name: string }[]; // New: array of technicians
  color?: string; // Work color tag
  line?: string; // Line/section identifier
  imageUrl?: string; // Image URL from Firebase Storage
  imagePath?: string; // Storage path for deletion
  fabricName?: string; // For ORDER_WORK
  customerName?: string; // For ORDER_WORK
  createdAt: any;
  createdBy: string;
}

// Technician (stored in Firestore)
interface Technician {
  id: string;
  name: string;
  createdAt?: any;
}

const STATUS_CONFIG: Record<SampleStatus, { label: string; labelAr: string; icon: any; color: string; bg: string; border: string }> = {
  'PLANNED': { 
    label: 'Planned', 
    labelAr: 'مخطط', 
    icon: Target, 
    color: 'text-slate-600', 
    bg: 'bg-slate-100', 
    border: 'border-slate-300' 
  },
  'MACHINE_SETUP': { 
    label: 'Machine Setup', 
    labelAr: 'تجهيز الماكينة', 
    icon: Settings, 
    color: 'text-amber-600', 
    bg: 'bg-amber-100', 
    border: 'border-amber-300' 
  },
  'QUALITY_CHECK': { 
    label: 'Quality Check', 
    labelAr: 'فحص الجودة', 
    icon: Award, 
    color: 'text-blue-600', 
    bg: 'bg-blue-100', 
    border: 'border-blue-300' 
  },
  'DONE': { 
    label: 'Done', 
    labelAr: 'مكتمل', 
    icon: CheckCircle, 
    color: 'text-emerald-600', 
    bg: 'bg-emerald-100', 
    border: 'border-emerald-300' 
  }
};

const STATUS_ORDER: SampleStatus[] = ['PLANNED', 'MACHINE_SETUP', 'QUALITY_CHECK', 'DONE'];

const WORK_TYPE_CONFIG: Record<string, { label: string; labelAr: string; color: string; bg: string }> = {
  'SAMPLE': { label: 'Sample', labelAr: 'عينة', color: 'text-slate-700', bg: 'bg-slate-200' },
  'ORDER_WORK': { label: 'Order Work', labelAr: 'شغل اوردرات', color: 'text-white', bg: 'bg-slate-700' }
};

export const SampleTrackingPage: React.FC = () => {
  const [samples, setSamples] = useState<Sample[]>([]);
  const [machines, setMachines] = useState<Machine[]>([]);
  const [machineSchedules, setMachineSchedules] = useState<Record<string, MachineScheduleInfo>>({});
  const [dailyWork, setDailyWork] = useState<DailyWorkEntry[]>([]);
  const [technicians, setTechnicians] = useState<Technician[]>([]);
  const [showAddTechnicianModal, setShowAddTechnicianModal] = useState(false);
  const [newTechnicianName, setNewTechnicianName] = useState('');
  const [assigningTechnicianTo, setAssigningTechnicianTo] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterStatus, setFilterStatus] = useState<SampleStatus | 'ALL'>('ALL');
  const [filterMachine, setFilterMachine] = useState<string>('ALL');
  
  // Daily Work States
  const [selectedDate, setSelectedDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [showDailyWorkModal, setShowDailyWorkModal] = useState(false);
  const [showMachineScheduleModal, setShowMachineScheduleModal] = useState<string | null>(null);
  const [dailyWorkForm, setDailyWorkForm] = useState({
    sampleId: '',
    sampleName: '',
    machineId: '',
    machineName: '',
    notes: '',
    workType: 'SAMPLE' as 'SAMPLE' | 'ORDER_WORK',
    technicianId: '',
    technicianName: '',
    color: '#6366f1', // Default indigo
    line: '',
    fabricName: '', // For ORDER_WORK
    customerName: '' // For ORDER_WORK
  });

  // Predefined colors for work entries
  const WORK_COLORS = [
    { value: '#6366f1', name: 'بنفسجي' }, // Indigo
    { value: '#8b5cf6', name: 'أرجواني' }, // Violet
    { value: '#ec4899', name: 'وردي' }, // Pink
    { value: '#ef4444', name: 'أحمر' }, // Red
    { value: '#f97316', name: 'برتقالي' }, // Orange
    { value: '#eab308', name: 'أصفر' }, // Yellow
    { value: '#22c55e', name: 'أخضر' }, // Green
    { value: '#14b8a6', name: 'فيروزي' }, // Teal
    { value: '#0ea5e9', name: 'أزرق' }, // Sky
    { value: '#64748b', name: 'رمادي' }, // Slate
  ];
  
  // Modal States
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingSample, setEditingSample] = useState<Sample | null>(null);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [loadingSchedule, setLoadingSchedule] = useState<string | null>(null);
  const [editingLineWorkId, setEditingLineWorkId] = useState<string | null>(null);
  const [editingLineValue, setEditingLineValue] = useState('');
  
  // Image States
  const [uploadingImageFor, setUploadingImageFor] = useState<string | null>(null);
  const [viewingImage, setViewingImage] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  // Sample Data Modal State
  const [showSampleDataModal, setShowSampleDataModal] = useState<Sample | null>(null);
  const [sampleDataForm, setSampleDataForm] = useState({
    rawWeight: '',
    zeroWeight: '',
    rawWidth: '',
    zeroWidth: '',
    // Finishing Plan
    requiredFinishedWeight: '',
    requiredFinishedWidth: '',
    finishingNazeem: false,
    finishingTathbeet: false,
    finishingKasra: false,
    finishingCarbon: false,
    finishingRam: false,
    finishingCompacter: false
  });
  
  // Form State
  const [formData, setFormData] = useState({
    name: '',
    notes: '',
    expectedDate: new Date().toISOString().split('T')[0],
    machineId: '',
    machineName: '',
    priority: 1,
    estimatedDays: 1
  });

  // Fetch Machines with Schedule Info
  useEffect(() => {
    const unsubscribe = onSnapshot(collection(db, 'MachineSS'), (snapshot) => {
      const machineList: Machine[] = [];
      const schedules: Record<string, MachineScheduleInfo> = {};
      
      snapshot.docs.forEach(docSnap => {
        const data = docSnap.data() as MachineSS;
        const machineId = docSnap.id;
        
        machineList.push({
          id: machineId,
          name: data.name || machineId,
          futurePlans: data.futurePlans || [],
          dailyLogs: data.dailyLogs || []
        });
        
        // Calculate schedule info
        const today = new Date().toISOString().split('T')[0];
        const futurePlans = (data.futurePlans || []).filter(p => p.endDate >= today);
        const todayLog = (data.dailyLogs || []).find(log => log.date === today);
        
        // Calculate total queued days from future plans
        let totalQueuedDays = 0;
        let latestEndDate = today;
        
        futurePlans.forEach(plan => {
          totalQueuedDays += plan.days || 0;
          if (plan.endDate > latestEndDate) {
            latestEndDate = plan.endDate;
          }
        });
        
        // Next available date is either tomorrow or the day after last plan ends
        const nextAvailableDate = futurePlans.length > 0 
          ? addDays(latestEndDate, 1) 
          : today;
        
        schedules[machineId] = {
          isCurrentlyWorking: !!(todayLog && todayLog.fabric),
          currentWork: todayLog ? {
            fabric: todayLog.fabric,
            client: todayLog.client,
            remaining: todayLog.remainingMfg
          } : undefined,
          futurePlans: futurePlans.sort((a, b) => a.startDate.localeCompare(b.startDate)),
          nextAvailableDate,
          totalQueuedDays
        };
      });
      
      setMachines(machineList.sort((a, b) => a.name.localeCompare(b.name)));
      setMachineSchedules(schedules);
    }, (error) => {
      console.error('Error fetching machines:', error);
    });
    
    return () => unsubscribe();
  }, []);

  // Helper: Add days to a date string
  const addDays = (dateStr: string, days: number): string => {
    const date = new Date(dateStr);
    date.setDate(date.getDate() + days);
    return date.toISOString().split('T')[0];
  };

  // Calculate expected date based on machine queue and priority
  const calculateExpectedDate = (machineId: string, estimatedDays: number, priority: number): { startDate: string; endDate: string } => {
    const schedule = machineSchedules[machineId];
    const today = new Date().toISOString().split('T')[0];
    
    if (!schedule) {
      const startDate = today;
      const endDate = addDays(startDate, estimatedDays);
      return { startDate, endDate };
    }
    
    // Get all samples on this machine that are not done, sorted by priority
    const machineQueuedSamples = samples
      .filter(s => s.machineId === machineId && s.status !== 'DONE')
      .sort((a, b) => (a.priority || 999) - (b.priority || 999));
    
    // Calculate days needed for higher priority samples
    let daysBeforeThis = 0;
    for (const s of machineQueuedSamples) {
      if ((s.priority || 999) < priority) {
        daysBeforeThis += s.estimatedDays || 1;
      }
    }
    
    // Start after machine's current queue + higher priority samples
    const baseStartDate = schedule.nextAvailableDate > today ? schedule.nextAvailableDate : today;
    const startDate = addDays(baseStartDate, daysBeforeThis);
    const endDate = addDays(startDate, estimatedDays);
    
    return { startDate, endDate };
  };

  // Auto-update expected date when machine or priority changes
  useEffect(() => {
    if (formData.machineId && formData.estimatedDays > 0) {
      const { startDate, endDate } = calculateExpectedDate(
        formData.machineId, 
        formData.estimatedDays,
        formData.priority
      );
      setFormData(prev => ({
        ...prev,
        expectedDate: endDate
      }));
    }
  }, [formData.machineId, formData.estimatedDays, formData.priority, machineSchedules]);

  // Fetch Samples (Real-time)
  useEffect(() => {
    const q = query(collection(db, 'samples'), orderBy('createdAt', 'desc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const sampleList = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as Sample[];
      setSamples(sampleList);
      setLoading(false);
    }, (error) => {
      console.error('Error fetching samples:', error);
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  // Fetch Daily Work (Real-time)
  useEffect(() => {
    // Using single orderBy to avoid composite index requirement
    const q = query(collection(db, 'sampleDailyWork'), orderBy('createdAt', 'desc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const workList = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as DailyWorkEntry[];
      // Sort by date then createdAt in memory
      workList.sort((a, b) => {
        if (b.date !== a.date) return b.date.localeCompare(a.date);
        return 0; // Already sorted by createdAt from Firestore
      });
      setDailyWork(workList);
    }, (error) => {
      console.error('Error fetching daily work:', error);
    });

    return () => unsubscribe();
  }, []);

  // Fetch Technicians from Firestore
  useEffect(() => {
    const q = query(collection(db, 'technicians'), orderBy('createdAt', 'asc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const techList = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as Technician[];
      setTechnicians(techList);
    }, (error) => {
      console.error('Error fetching technicians:', error);
    });

    return () => unsubscribe();
  }, []);

  // Add Technician
  const handleAddTechnician = async () => {
    if (!newTechnicianName.trim()) return;
    
    try {
      await addDoc(collection(db, 'technicians'), {
        name: newTechnicianName.trim(),
        createdAt: serverTimestamp()
      });
      setNewTechnicianName('');
      setShowAddTechnicianModal(false);
    } catch (error) {
      console.error('Error adding technician:', error);
    }
  };

  // Delete Technician
  const handleDeleteTechnician = async (techId: string) => {
    if (!window.confirm('هل أنت متأكد من حذف هذا الفني؟')) return;
    
    try {
      await deleteDoc(doc(db, 'technicians', techId));
    } catch (error) {
      console.error('Error deleting technician:', error);
    }
  };

  // Assign/Toggle Technician to Work Entry (supports multiple)
  const handleAssignTechnician = async (workId: string, techId: string, techName: string) => {
    try {
      const work = dailyWork.find(w => w.id === workId);
      if (!work) return;
      
      // Get current technicians array (or convert from legacy single)
      let currentTechs = work.technicians || [];
      if (currentTechs.length === 0 && work.technicianId) {
        currentTechs = [{ id: work.technicianId, name: work.technicianName }];
      }
      
      // Toggle: if already assigned, remove; otherwise add
      const isAlreadyAssigned = currentTechs.some(t => t.id === techId);
      let newTechs: { id: string; name: string }[];
      
      if (isAlreadyAssigned) {
        newTechs = currentTechs.filter(t => t.id !== techId);
      } else {
        newTechs = [...currentTechs, { id: techId, name: techName }];
      }
      
      // Update with array and also legacy fields for compatibility
      await updateDoc(doc(db, 'sampleDailyWork', workId), {
        technicians: newTechs,
        technicianId: newTechs[0]?.id || '',
        technicianName: newTechs.map(t => t.name).join(', ') || ''
      });
      // Don't close modal to allow selecting more
    } catch (error) {
      console.error('Error assigning technician:', error);
    }
  };

  // Today's date
  const today = new Date().toISOString().split('T')[0];
  
  // Is selected date today?
  const isToday = selectedDate === today;
  
  // Work entries for selected date
  const selectedDateWork = useMemo(() => {
    return dailyWork.filter(w => w.date === selectedDate);
  }, [dailyWork, selectedDate]);

  // Quick Add Sample to Today's Work
  const handleQuickAddToTodayWork = async (sample: Sample) => {
    setUpdatingId(sample.id);
    try {
      await addDoc(collection(db, 'sampleDailyWork'), {
        date: selectedDate,
        sampleId: sample.id,
        sampleName: sample.name,
        machineId: sample.machineId || '',
        machineName: sample.machineName || '',
        notes: '',
        workType: 'SAMPLE',
        color: '#6366f1',
        line: '',
        fabricName: '',
        customerName: '',
        technicianId: '',
        technicianName: '',
        createdAt: serverTimestamp(),
        createdBy: auth.currentUser?.email || 'unknown'
      });
    } catch (error) {
      console.error('Error adding to today work:', error);
    } finally {
      setUpdatingId(null);
    }
  };

  // Add Daily Work Entry
  const handleAddDailyWork = async () => {
    if (!dailyWorkForm.machineId) return;
    // For ORDER_WORK, require fabric name
    if (dailyWorkForm.workType === 'ORDER_WORK' && !dailyWorkForm.fabricName) return;
    // For SAMPLE, require sample selection
    if (dailyWorkForm.workType === 'SAMPLE' && !dailyWorkForm.sampleId) return;
    
    setUpdatingId('adding-work');
    try {
      const sample = samples.find(s => s.id === dailyWorkForm.sampleId);
      const machine = machines.find(m => m.id === dailyWorkForm.machineId);
      
      // Build sample name based on work type
      let sampleName = '';
      if (dailyWorkForm.workType === 'SAMPLE') {
        sampleName = sample?.name || dailyWorkForm.sampleName;
      } else {
        // For ORDER_WORK: Fabric Name - Customer
        sampleName = dailyWorkForm.customerName 
          ? `${dailyWorkForm.fabricName} - ${dailyWorkForm.customerName}`
          : dailyWorkForm.fabricName;
      }
      
      await addDoc(collection(db, 'sampleDailyWork'), {
        date: selectedDate,
        sampleId: dailyWorkForm.workType === 'SAMPLE' ? dailyWorkForm.sampleId : '',
        sampleName: sampleName,
        machineId: dailyWorkForm.machineId,
        machineName: machine?.name || dailyWorkForm.machineName,
        notes: dailyWorkForm.notes,
        workType: dailyWorkForm.workType,
        color: dailyWorkForm.workType === 'SAMPLE' ? dailyWorkForm.color : '',
        line: dailyWorkForm.workType === 'SAMPLE' ? dailyWorkForm.line : '',
        fabricName: dailyWorkForm.workType === 'ORDER_WORK' ? dailyWorkForm.fabricName : '',
        customerName: dailyWorkForm.workType === 'ORDER_WORK' ? dailyWorkForm.customerName : '',
        technicianId: '',
        technicianName: '',
        createdAt: serverTimestamp(),
        createdBy: auth.currentUser?.email || 'unknown'
      });
      
      setDailyWorkForm({
        sampleId: '',
        sampleName: '',
        machineId: '',
        machineName: '',
        notes: '',
        workType: 'SAMPLE',
        technicianId: '',
        technicianName: '',
        color: '#6366f1',
        line: '',
        fabricName: '',
        customerName: ''
      });
      setShowDailyWorkModal(false);
    } catch (error) {
      console.error('Error adding daily work:', error);
    } finally {
      setUpdatingId(null);
    }
  };

  // Delete Daily Work Entry
  const handleDeleteDailyWork = async (workId: string) => {
    if (!window.confirm('هل أنت متأكد من حذف هذا العمل؟')) return;
    
    setUpdatingId(workId);
    try {
      await deleteDoc(doc(db, 'sampleDailyWork', workId));
    } catch (error) {
      console.error('Error deleting daily work:', error);
    } finally {
      setUpdatingId(null);
    }
  };

  // Update Work Entry Line
  const handleUpdateLine = async (workId: string, newLine: string) => {
    try {
      await updateDoc(doc(db, 'sampleDailyWork', workId), {
        line: newLine
      });
      setEditingLineWorkId(null);
      setEditingLineValue('');
    } catch (error) {
      console.error('Error updating line:', error);
    }
  };

  // Compress image before upload
  const compressImage = (file: File, maxWidth: number = 800, quality: number = 0.7): Promise<Blob> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = (event) => {
        const img = new window.Image();
        img.src = event.target?.result as string;
        img.onload = () => {
          const canvas = document.createElement('canvas');
          let width = img.width;
          let height = img.height;
          
          if (width > maxWidth) {
            height = (height * maxWidth) / width;
            width = maxWidth;
          }
          
          canvas.width = width;
          canvas.height = height;
          
          const ctx = canvas.getContext('2d');
          ctx?.drawImage(img, 0, 0, width, height);
          
          canvas.toBlob(
            (blob) => {
              if (blob) resolve(blob);
              else reject(new Error('Failed to compress image'));
            },
            'image/jpeg',
            quality
          );
        };
        img.onerror = reject;
      };
      reader.onerror = reject;
    });
  };

  // Upload Image for Work Entry
  const handleImageUpload = async (workId: string, file: File) => {
    if (!file) return;
    
    setUploadingImageFor(workId);
    try {
      // Compress the image
      const compressedBlob = await compressImage(file);
      
      // Create unique path
      const timestamp = Date.now();
      const imagePath = `samples/${workId}_${timestamp}.jpg`;
      const imageRef = ref(storage, imagePath);
      
      // Upload to Firebase Storage
      await uploadBytes(imageRef, compressedBlob);
      
      // Get download URL
      const imageUrl = await getDownloadURL(imageRef);
      
      // Update Firestore document
      await updateDoc(doc(db, 'sampleDailyWork', workId), {
        imageUrl,
        imagePath
      });
      
    } catch (error) {
      console.error('Error uploading image:', error);
      alert('فشل رفع الصورة. حاول مرة أخرى.');
    } finally {
      setUploadingImageFor(null);
    }
  };

  // Delete Image from Work Entry
  const handleDeleteImage = async (workId: string, imagePath: string) => {
    if (!window.confirm('هل تريد حذف هذه الصورة؟')) return;
    
    setUploadingImageFor(workId);
    try {
      // Delete from Storage
      const imageRef = ref(storage, imagePath);
      await deleteObject(imageRef);
      
      // Update Firestore document
      await updateDoc(doc(db, 'sampleDailyWork', workId), {
        imageUrl: null,
        imagePath: null
      });
    } catch (error) {
      console.error('Error deleting image:', error);
      alert('فشل حذف الصورة. حاول مرة أخرى.');
    } finally {
      setUploadingImageFor(null);
    }
  };

  // Save Sample Data (measurements)
  const handleSaveSampleData = async () => {
    if (!showSampleDataModal) return;
    
    setUpdatingId(showSampleDataModal.id);
    try {
      await updateDoc(doc(db, 'samples', showSampleDataModal.id), {
        rawWeight: sampleDataForm.rawWeight ? parseFloat(sampleDataForm.rawWeight) : null,
        zeroWeight: sampleDataForm.zeroWeight ? parseFloat(sampleDataForm.zeroWeight) : null,
        rawWidth: sampleDataForm.rawWidth ? parseFloat(sampleDataForm.rawWidth) : null,
        zeroWidth: sampleDataForm.zeroWidth ? parseFloat(sampleDataForm.zeroWidth) : null,
        // Finishing Plan
        requiredFinishedWeight: sampleDataForm.requiredFinishedWeight ? parseFloat(sampleDataForm.requiredFinishedWeight) : null,
        requiredFinishedWidth: sampleDataForm.requiredFinishedWidth ? parseFloat(sampleDataForm.requiredFinishedWidth) : null,
        finishingNazeem: sampleDataForm.finishingNazeem,
        finishingTathbeet: sampleDataForm.finishingTathbeet,
        finishingKasra: sampleDataForm.finishingKasra,
        finishingCarbon: sampleDataForm.finishingCarbon,
        finishingRam: sampleDataForm.finishingRam,
        finishingCompacter: sampleDataForm.finishingCompacter,
        updatedAt: serverTimestamp(),
        updatedBy: auth.currentUser?.email || 'unknown'
      });
      setShowSampleDataModal(null);
      setSampleDataForm({ rawWeight: '', zeroWeight: '', rawWidth: '', zeroWidth: '', requiredFinishedWeight: '', requiredFinishedWidth: '', finishingNazeem: false, finishingTathbeet: false, finishingKasra: false, finishingCarbon: false, finishingRam: false, finishingCompacter: false });
    } catch (error) {
      console.error('Error saving sample data:', error);
      alert('فشل حفظ البيانات. حاول مرة أخرى.');
    } finally {
      setUpdatingId(null);
    }
  };

  // Format date for display (Arabic style)
  const formatDateArabic = (dateStr: string) => {
    if (!dateStr) return '-';
    const date = new Date(dateStr);
    const options: Intl.DateTimeFormatOptions = { 
      weekday: 'long', 
      year: 'numeric', 
      month: 'long', 
      day: 'numeric' 
    };
    return date.toLocaleDateString('ar-EG', options);
  };

  // Filter Samples
  const filteredSamples = useMemo(() => {
    return samples.filter(sample => {
      const matchesSearch = 
        sample.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        sample.notes.toLowerCase().includes(searchTerm.toLowerCase()) ||
        sample.machineName.toLowerCase().includes(searchTerm.toLowerCase());
      
      const matchesStatus = filterStatus === 'ALL' || sample.status === filterStatus;
      const matchesMachine = filterMachine === 'ALL' || sample.machineId === filterMachine;
      
      return matchesSearch && matchesStatus && matchesMachine;
    });
  }, [samples, searchTerm, filterStatus, filterMachine]);

  // Group by Status (sorted by priority)
  const groupedSamples = useMemo(() => {
    const groups: Record<string, Sample[]> = {
      'PLANNED': [],
      'IN_PROGRESS': [], // Combined MACHINE_SETUP + QUALITY_CHECK
      'DONE': []
    };
    
    filteredSamples.forEach(sample => {
      if (sample.status === 'PLANNED') {
        groups['PLANNED'].push(sample);
      } else if (sample.status === 'MACHINE_SETUP' || sample.status === 'QUALITY_CHECK') {
        groups['IN_PROGRESS'].push(sample);
      } else if (sample.status === 'DONE') {
        groups['DONE'].push(sample);
      }
    });
    
    // Sort each group by priority (lower number = higher priority)
    Object.keys(groups).forEach(key => {
      groups[key].sort((a, b) => (a.priority || 999) - (b.priority || 999));
    });
    
    return groups;
  }, [filteredSamples]);

  // Add Sample
  const handleAddSample = async () => {
    if (!formData.name || !formData.machineId) return;
    
    setUpdatingId('adding');
    try {
      const now = new Date().toISOString();
      const machine = machines.find(m => m.id === formData.machineId);
      const { startDate, endDate } = calculateExpectedDate(
        formData.machineId,
        formData.estimatedDays,
        formData.priority
      );
      
      await addDoc(collection(db, 'samples'), {
        name: formData.name,
        notes: formData.notes || '',
        expectedDate: endDate,
        machineId: formData.machineId,
        machineName: machine?.name || formData.machineId,
        priority: formData.priority || 1,
        estimatedDays: formData.estimatedDays || 1,
        calculatedStartDate: startDate,
        calculatedEndDate: endDate,
        status: 'PLANNED' as SampleStatus,
        statusHistory: [{
          status: 'PLANNED' as SampleStatus,
          date: now,
          enteredAt: now,
          updatedBy: auth.currentUser?.email || 'unknown'
        }],
        createdAt: serverTimestamp(),
        createdBy: auth.currentUser?.email || 'unknown'
      });
      
      setFormData({ name: '', notes: '', expectedDate: new Date().toISOString().split('T')[0], machineId: '', machineName: '', priority: 1, estimatedDays: 1 });
      setShowAddModal(false);
    } catch (error) {
      console.error('Error adding sample:', error);
    } finally {
      setUpdatingId(null);
    }
  };

  // Update Sample Status
  const handleStatusChange = async (sample: Sample, newStatus: SampleStatus) => {
    if (sample.status === newStatus) return;
    
    setUpdatingId(sample.id);
    try {
      const now = new Date().toISOString();
      const newStatusIndex = STATUS_ORDER.indexOf(newStatus);
      
      // Filter history to remove statuses after the new status (if going backward)
      const filteredHistory = (sample.statusHistory || []).filter(h => {
        const historyIndex = STATUS_ORDER.indexOf(h.status);
        return historyIndex < newStatusIndex;
      });
      
      // Add new status to history
      const newHistory = [
        ...filteredHistory,
        {
          status: newStatus,
          date: now,
          enteredAt: now,
          updatedBy: auth.currentUser?.email || 'unknown'
        }
      ];
      
      await updateDoc(doc(db, 'samples', sample.id), {
        status: newStatus,
        statusHistory: newHistory,
        updatedAt: serverTimestamp(),
        updatedBy: auth.currentUser?.email || 'unknown'
      });
    } catch (error) {
      console.error('Error updating sample status:', error);
    } finally {
      setUpdatingId(null);
    }
  };

  // Update Sample Details
  const handleUpdateSample = async () => {
    if (!editingSample || !formData.name || !formData.machineId) return;
    
    setUpdatingId(editingSample.id);
    try {
      const machine = machines.find(m => m.id === formData.machineId);
      const { startDate, endDate } = calculateExpectedDate(
        formData.machineId,
        formData.estimatedDays,
        formData.priority
      );
      
      await updateDoc(doc(db, 'samples', editingSample.id), {
        name: formData.name,
        notes: formData.notes,
        expectedDate: endDate,
        machineId: formData.machineId,
        machineName: machine?.name || formData.machineId,
        priority: formData.priority,
        estimatedDays: formData.estimatedDays,
        calculatedStartDate: startDate,
        calculatedEndDate: endDate,
        updatedAt: serverTimestamp(),
        updatedBy: auth.currentUser?.email || 'unknown'
      });
      
      setEditingSample(null);
      setFormData({ name: '', notes: '', expectedDate: new Date().toISOString().split('T')[0], machineId: '', machineName: '', priority: 1, estimatedDays: 1 });
    } catch (error) {
      console.error('Error updating sample:', error);
    } finally {
      setUpdatingId(null);
    }
  };

  // Delete Sample
  const handleDeleteSample = async (sampleId: string) => {
    if (!window.confirm('هل أنت متأكد من حذف هذه العينة؟\nAre you sure you want to delete this sample?')) return;
    
    setUpdatingId(sampleId);
    try {
      await deleteDoc(doc(db, 'samples', sampleId));
    } catch (error) {
      console.error('Error deleting sample:', error);
    } finally {
      setUpdatingId(null);
    }
  };

  // Open Edit Modal
  const openEditModal = (sample: Sample) => {
    setEditingSample(sample);
    setFormData({
      name: sample.name,
      notes: sample.notes,
      expectedDate: sample.expectedDate,
      machineId: sample.machineId,
      machineName: sample.machineName,
      priority: sample.priority || 1,
      estimatedDays: sample.estimatedDays || 1
    });
  };

  // Format Date
  const formatDate = (dateStr: string) => {
    if (!dateStr) return '-';
    const date = new Date(dateStr);
    const day = date.getDate();
    const month = date.toLocaleString('en-US', { month: 'short' });
    return `${day}-${month}`;
  };

  // Get Status Index
  const getStatusIndex = (status: SampleStatus) => STATUS_ORDER.indexOf(status);

  // Render Status Timeline
  const renderStatusTimeline = (sample: Sample) => {
    const activeIndex = getStatusIndex(sample.status);
    
    return (
      <div className="relative py-1 sm:py-2 mt-1">
        {/* Track Line */}
        <div className="absolute top-1/2 left-1 sm:left-2 right-1 sm:right-2 h-0.5 sm:h-1 bg-slate-100 -translate-y-1/2 rounded-full z-0"></div>
        
        {/* Progress Line */}
        <div 
            className="absolute top-1/2 right-1 sm:right-2 h-0.5 sm:h-1 bg-emerald-400 -translate-y-1/2 rounded-full z-0 transition-all duration-500 ease-out"
            style={{ 
              width: `calc(${(activeIndex / (STATUS_ORDER.length - 1)) * 100}% - 8px)`
            }}
        ></div>

        <div className="relative z-10 flex justify-between w-full px-0.5 sm:px-1">
          {STATUS_ORDER.map((status, index) => {
            const isActive = index === activeIndex;
            const isCompleted = index < activeIndex;
            const config = STATUS_CONFIG[status];
            const Icon = config.icon;
            
            return (
              <button
                key={status}
                onClick={(e) => {
                  e.stopPropagation();
                  handleStatusChange(sample, status);
                }}
                disabled={updatingId === sample.id}
                className="group flex flex-col items-center relative"
                title={config.labelAr}
              >
                <div className={`
                  w-5 h-5 sm:w-7 sm:h-7 rounded-full flex items-center justify-center transition-all duration-300 border-2 sm:border-[3px]
                  ${isActive 
                    ? `bg-white border-${config.color.split('-')[1]}-500 text-${config.color.split('-')[1]}-600 scale-110 shadow-md` 
                    : isCompleted 
                        ? 'bg-emerald-500 border-white text-white shadow-sm ring-1 ring-emerald-100' 
                        : 'bg-slate-50 border-white text-slate-300 ring-1 ring-slate-100'}
                `}>
                  {isCompleted ? <CheckCircle size={10} className="sm:w-3.5 sm:h-3.5" strokeWidth={3} /> : <Icon size={10} className="sm:w-3.5 sm:h-3.5" strokeWidth={isActive ? 2.5 : 2} />}
                </div>
                
                {/* Active Label - Hidden on mobile */}
                {isActive && (
                  <div className={`
                    hidden sm:block absolute -bottom-6 text-[10px] font-bold whitespace-nowrap px-2 py-0.5 rounded-full shadow-sm animate-in fade-in slide-in-from-top-1
                    ${config.bg} ${config.color}
                  `}>
                    {config.labelAr}
                  </div>
                )}
              </button>
            );
          })}
        </div>
      </div>
    );
  };

  // Upload Image for Sample
  const handleSampleImageUpload = async (sampleId: string, file: File) => {
    if (!file) return;
    
    setUploadingImageFor(sampleId);
    try {
      const compressedBlob = await compressImage(file);
      const timestamp = Date.now();
      const imagePath = `samples/sample_${sampleId}_${timestamp}.jpg`;
      const imageRef = ref(storage, imagePath);
      
      await uploadBytes(imageRef, compressedBlob);
      const imageUrl = await getDownloadURL(imageRef);
      
      await updateDoc(doc(db, 'samples', sampleId), {
        imageUrl,
        imagePath
      });
    } catch (error) {
      console.error('Error uploading sample image:', error);
      alert('فشل رفع الصورة. حاول مرة أخرى.');
    } finally {
      setUploadingImageFor(null);
    }
  };

  // Delete Image from Sample
  const handleDeleteSampleImage = async (sampleId: string, imagePath: string) => {
    if (!window.confirm('هل تريد حذف هذه الصورة؟')) return;
    
    setUploadingImageFor(sampleId);
    try {
      const imageRef = ref(storage, imagePath);
      await deleteObject(imageRef);
      
      await updateDoc(doc(db, 'samples', sampleId), {
        imageUrl: null,
        imagePath: null
      });
    } catch (error) {
      console.error('Error deleting sample image:', error);
      alert('فشل حذف الصورة. حاول مرة أخرى.');
    } finally {
      setUploadingImageFor(null);
    }
  };

  // Render Sample Card
  const renderSampleCard = (sample: Sample) => {
    const daysUntilExpected = sample.expectedDate 
      ? Math.ceil((new Date(sample.expectedDate).getTime() - new Date().getTime()) / (1000 * 3600 * 24))
      : null;
    
    const isOverdue = daysUntilExpected !== null && daysUntilExpected < 0 && sample.status !== 'DONE';
    const isDueSoon = daysUntilExpected !== null && daysUntilExpected >= 0 && daysUntilExpected <= 2 && sample.status !== 'DONE';
    
    return (
      <div 
        key={sample.id}
        className="group relative bg-white rounded-xl sm:rounded-2xl shadow-sm hover:shadow-xl transition-all duration-300 border border-slate-100 overflow-hidden"
      >
        {/* Status Indicator Strip */}
        <div className={`absolute top-0 bottom-0 left-0 w-0.5 sm:w-1 ${
          isOverdue ? 'bg-red-500' : 
          isDueSoon ? 'bg-amber-400' : 
          'bg-slate-200'
        }`} />

        {/* Mobile: Vertical Layout, Desktop: Horizontal Layout */}
        <div className="flex flex-col sm:flex-row sm:h-full">
          {/* Image Section - Square on mobile */}
          <div className="aspect-square sm:aspect-auto sm:h-auto sm:w-32 relative flex-shrink-0 bg-slate-50">
            {sample.imageUrl ? (
              <div className="relative w-full h-full group/image overflow-hidden">
                <img 
                  src={sample.imageUrl} 
                  alt={sample.name}
                  className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110 cursor-pointer"
                  onClick={() => setViewingImage(sample.imageUrl!)}
                />
                <div className="absolute inset-0 bg-black/0 group-hover/image:bg-black/10 transition-colors" />
                <button
                  onClick={() => handleDeleteSampleImage(sample.id, sample.imagePath!)}
                  disabled={uploadingImageFor === sample.id}
                  className="absolute bottom-1 right-1 sm:bottom-2 sm:right-2 p-1 sm:p-1.5 bg-red-500/90 text-white rounded-full opacity-0 group-hover/image:opacity-100 transition-all hover:bg-red-600 scale-90 hover:scale-100 shadow-sm backdrop-blur-sm"
                >
                  {uploadingImageFor === sample.id ? (
                    <Loader size={10} className="sm:w-3 sm:h-3 animate-spin" />
                  ) : (
                    <Trash2 size={10} className="sm:w-3 sm:h-3" />
                  )}
                </button>
              </div>
            ) : (
              <label className="flex flex-col items-center justify-center h-full cursor-pointer hover:bg-slate-100 text-slate-300 hover:text-slate-400 transition-all">
                {uploadingImageFor === sample.id ? (
                  <Loader size={20} className="sm:w-5 sm:h-5 animate-spin text-slate-400" />
                ) : (
                  <>
                    <div className="p-2 sm:p-2 rounded-full bg-white shadow-sm mb-1">
                      <Camera size={16} className="sm:w-4 sm:h-4" />
                    </div>
                    <span className="text-[10px] sm:text-[10px] font-medium">صورة</span>
                  </>
                )}
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleSampleImageUpload(sample.id, file);
                    e.target.value = '';
                  }}
                  disabled={uploadingImageFor === sample.id}
                />
              </label>
            )}
          </div>
          
          {/* Content Section */}
          <div className="flex-1 p-2 sm:p-4 flex flex-col justify-between">
            {/* Header */}
            <div>
              <div className="flex items-start justify-between gap-1 sm:gap-3 mb-1 sm:mb-2">
                <div className="flex-1 min-w-0">
                  <h3 className="font-bold text-slate-800 truncate text-sm sm:text-base leading-tight" title={sample.name}>
                    {sample.name}
                  </h3>
                  {sample.notes && (
                    <p className="text-[10px] sm:text-sm text-slate-600 line-clamp-2 sm:line-clamp-3 leading-relaxed mt-1 bg-slate-50 rounded-lg p-1 sm:p-2 border border-slate-100">{sample.notes}</p>
                  )}
                </div>
                
                {/* Actions - Hidden on mobile for space */}
                <div className="hidden sm:flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity translate-x-2 group-hover:translate-x-0 duration-200">
                  <button
                    onClick={() => handleQuickAddToTodayWork(sample)}
                    disabled={updatingId === sample.id}
                    className="p-1.5 text-slate-400 hover:text-green-600 hover:bg-green-50 rounded-lg transition-colors"
                    title="أضف لعمل اليوم"
                  >
                    {updatingId === sample.id ? (
                      <Loader size={14} className="animate-spin" />
                    ) : (
                      <Plus size={14} />
                    )}
                  </button>
                  <button
                    onClick={() => {
                      setShowSampleDataModal(sample);
                      setSampleDataForm({
                        rawWeight: sample.rawWeight?.toString() || '',
                        zeroWeight: sample.zeroWeight?.toString() || '',
                        rawWidth: sample.rawWidth?.toString() || '',
                        zeroWidth: sample.zeroWidth?.toString() || '',
                        requiredFinishedWeight: sample.requiredFinishedWeight?.toString() || '',
                        requiredFinishedWidth: sample.requiredFinishedWidth?.toString() || '',
                        finishingNazeem: sample.finishingNazeem || false,
                        finishingTathbeet: sample.finishingTathbeet || false,
                        finishingKasra: sample.finishingKasra || false,
                        finishingCarbon: sample.finishingCarbon || false,
                        finishingRam: sample.finishingRam || false,
                        finishingCompacter: sample.finishingCompacter || false
                      });
                    }}
                    className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                    title="بيانات العينة"
                  >
                    <Activity size={14} />
                  </button>
                  <button
                    onClick={() => openEditModal(sample)}
                    className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"
                  >
                    <Edit3 size={14} />
                  </button>
                  <button
                    onClick={() => handleDeleteSample(sample.id)}
                    className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>

              {/* Tags/Badges Row - Hidden on mobile */}
              <div className="hidden sm:flex flex-wrap items-center gap-2 mb-3">
                <div className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-slate-50 border border-slate-100">
                  <Settings size={12} className="text-slate-400" />
                  <span className="text-[10px] font-bold text-slate-600 truncate max-w-[80px]">{sample.machineName}</span>
                </div>
                
                <div className={`flex items-center gap-1.5 px-2 py-1 rounded-md border ${
                   isOverdue ? 'bg-red-50 border-red-100' : 
                   isDueSoon ? 'bg-amber-50 border-amber-100' : 
                   'bg-slate-50 border-slate-100'
                }`}>
                  <Calendar size={12} className={isOverdue ? 'text-red-500' : isDueSoon ? 'text-amber-500' : 'text-slate-400'} />
                  <span className={`text-[10px] font-bold ${
                    isOverdue ? 'text-red-700' : isDueSoon ? 'text-amber-700' : 'text-slate-600'
                  }`}>
                    {formatDate(sample.expectedDate)}
                  </span>
                  {(daysUntilExpected !== null && sample.status !== 'DONE' && (isOverdue || isDueSoon)) && (
                     <span className={`text-[9px] px-1 rounded-sm ${
                        isOverdue ? 'bg-red-200 text-red-800' : 'bg-amber-200 text-amber-800'
                     }`}>
                       {Math.abs(daysUntilExpected)} يوم
                     </span>
                  )}
                </div>
              </div>

              {/* Mobile: Machine name */}
              <div className="sm:hidden text-[10px] text-slate-500 truncate mt-1 flex items-center gap-1">
                <Settings size={10} className="text-slate-400" />
                {sample.machineName}
              </div>

              {/* Mobile: Quick Add to Today Button */}
              <button
                onClick={() => handleQuickAddToTodayWork(sample)}
                disabled={updatingId === sample.id}
                className="sm:hidden mt-2 w-full py-1.5 bg-indigo-500 hover:bg-indigo-600 text-white text-[10px] font-bold rounded-lg flex items-center justify-center gap-1 transition-colors disabled:opacity-50"
              >
                {updatingId === sample.id ? (
                  <Loader size={12} className="animate-spin" />
                ) : (
                  <>
                    <Plus size={12} />
                    أضف لعمل اليوم
                  </>
                )}
              </button>
            </div>

            {/* Status Timeline Compact - Shows on both mobile and desktop */}
            <div className="py-1 sm:py-2 border-t border-slate-100 mt-1">
              {renderStatusTimeline(sample)}
            </div>
          </div>
        </div>
      </div>
    );
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <RefreshCw className="w-8 h-8 text-slate-600 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6" dir="rtl">
      {/* Compact Header - Add Sample Icon */}
      <div className="flex items-center justify-end mb-2">
        <button
          onClick={() => setShowAddModal(true)}
          className="flex items-center justify-center w-10 h-10 bg-indigo-600 text-white rounded-full hover:bg-indigo-700 transition-colors shadow-lg"
          title="إضافة عينة"
        >
          <Beaker size={20} />
        </button>
      </div>

      {/* قلب اليوم - Daily Work Section with Date Picker */}
      <div className="bg-white rounded-3xl border border-slate-200 overflow-hidden shadow-sm ring-1 ring-slate-100">
        {/* Header with Date Picker */}
        <div className="bg-white px-4 sm:px-8 py-4 sm:py-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-b border-slate-100">
          <div className="flex items-center gap-3 sm:gap-4">
            <div className="p-2 sm:p-3 bg-violet-50 rounded-xl sm:rounded-2xl border border-violet-100 shadow-sm">
              <Zap size={22} className="sm:w-7 sm:h-7 text-violet-600 fill-violet-600/10" />
            </div>
            <div>
              <h2 className="text-xl sm:text-2xl font-black text-slate-800 tracking-tight">قلب اليوم</h2>
              <div className="flex items-center gap-2 text-slate-500 text-xs sm:text-sm font-medium mt-0.5">
                <Activity size={12} className="sm:w-[14px] sm:h-[14px]" />
                <span>سجل العمل اليومي</span>
              </div>
            </div>
          </div>
          
          <div className="flex items-center gap-2 sm:gap-4 w-full sm:w-auto flex-wrap">
            {/* Date Picker */}
            <div className="group flex items-center gap-2 sm:gap-3 bg-slate-50 hover:bg-slate-100/80 transition-colors px-3 sm:px-4 py-2 sm:py-3 rounded-xl sm:rounded-2xl border border-slate-200 flex-1 sm:flex-none">
              <Calendar size={16} className="sm:w-5 sm:h-5 text-slate-400 group-hover:text-slate-600" />
              <input
                type="date"
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                className="bg-transparent text-slate-700 text-xs sm:text-sm font-bold outline-none cursor-pointer font-mono flex-1 sm:flex-none"
              />
              {isToday && (
                <span className="px-1.5 sm:px-2 py-0.5 bg-violet-100 text-violet-700 rounded-md text-[9px] sm:text-[10px] font-black tracking-wide uppercase">اليوم</span>
              )}
            </div>
            
            <div className="hidden sm:block h-10 w-px bg-slate-200 mx-2"></div>

            <div className="flex flex-col items-center px-2">
              <span className="text-xl sm:text-2xl font-black text-slate-800 leading-none">{selectedDateWork.length}</span>
              <span className="text-[10px] sm:text-xs font-bold text-slate-400 uppercase tracking-wider">سجل</span>
            </div>
            
            <button
              onClick={() => setShowDailyWorkModal(true)}
              className="flex items-center gap-1.5 sm:gap-2 px-4 sm:px-6 py-2 sm:py-3 bg-slate-900 text-white rounded-xl sm:rounded-2xl font-bold text-sm hover:bg-slate-800 hover:shadow-lg hover:-translate-y-0.5 transition-all duration-300"
            >
              <Plus size={18} className="sm:w-5 sm:h-5" />
              <span className="hidden sm:inline">إضافة عمل</span>
              <span className="sm:hidden">إضافة</span>
            </button>
          </div>
        </div>
        
        {/* Technicians Bar */}
        <div className="px-4 py-3 bg-slate-50 border-b border-slate-200">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-bold text-slate-600">الفنيين:</span>
            {technicians.length === 0 ? (
              <span className="text-xs text-slate-400 italic">لا يوجد فنيين</span>
            ) : (
              technicians.map(tech => {
                const techWorks = selectedDateWork.filter(w => 
                  (w.technicians && w.technicians.some(t => t.id === tech.id)) || 
                  w.technicianId === tech.id
                );
                const isAssigned = techWorks.length > 0;
                return (
                  <div 
                    key={tech.id}
                    className={`px-2 py-1 rounded text-xs font-medium flex items-center gap-1 ${
                      isAssigned 
                        ? 'bg-slate-700 text-white' 
                        : 'bg-slate-200 text-slate-500'
                    }`}
                  >
                    <span>{tech.name}</span>
                    {isAssigned && (
                      <span className="text-[10px] opacity-75">({techWorks.map(w => w.machineName).join(', ')})</span>
                    )}
                  </div>
                );
              })
            )}
            <button
              onClick={() => setShowAddTechnicianModal(true)}
              className="px-2 py-1 rounded text-xs font-medium bg-slate-300 text-slate-600 hover:bg-slate-400 transition-colors flex items-center gap-1"
            >
              <Plus size={10} />
              إضافة فني
            </button>
          </div>
        </div>
        
        {/* Work Cards */}
        <div className="p-4">
          {selectedDateWork.length === 0 ? (
            <div className="text-center py-12 text-slate-400">
              <Zap size={48} className="mx-auto mb-3 opacity-30" />
              <p className="font-medium">لا يوجد عمل مسجل في هذا اليوم</p>
              <button
                onClick={() => setShowDailyWorkModal(true)}
                className="mt-3 text-sm text-slate-600 hover:text-slate-800 underline"
              >
                إضافة عمل جديد
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {selectedDateWork.map((work, index) => {
                const workTechs = work.technicians || (work.technicianId ? [{ id: work.technicianId, name: work.technicianName }] : []);
                const isAssigning = assigningTechnicianTo === work.id;
                // Get linked sample to show its image and status
                const linkedSample = work.sampleId ? samples.find(s => s.id === work.sampleId) : null;
                // Use work's own image, or fall back to linked sample's image
                const displayImage = work.imageUrl || linkedSample?.imageUrl;
                const displayImagePath = work.imagePath || linkedSample?.imagePath;
                
                return (
                  <div 
                    key={work.id}
                    className="bg-white rounded-xl border border-slate-200 shadow-sm hover:shadow-md transition-all"
                  >
                    <div className="flex">
                      {/* Image Section - Left Side */}
                      <div className="w-24 flex-shrink-0 border-l border-slate-100">
                        {displayImage ? (
                          <div className="relative group h-full">
                            <img 
                              src={displayImage} 
                              alt={work.sampleName}
                              className="w-full h-full min-h-[160px] object-cover rounded-r-xl cursor-pointer"
                              onClick={() => setViewingImage(displayImage)}
                            />
                            {/* Only show delete if it's the work's own image */}
                            {work.imageUrl && (
                              <button
                                onClick={() => handleDeleteImage(work.id, work.imagePath!)}
                                disabled={uploadingImageFor === work.id}
                                className="absolute top-1 right-1 p-1 bg-red-500 text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-600"
                              >
                                {uploadingImageFor === work.id ? (
                                  <Loader size={10} className="animate-spin" />
                                ) : (
                                  <Trash2 size={10} />
                                )}
                              </button>
                            )}
                          </div>
                        ) : (
                          <label className="flex flex-col items-center justify-center h-full min-h-[160px] cursor-pointer hover:bg-slate-50 transition-colors rounded-r-xl">
                            {uploadingImageFor === work.id ? (
                              <Loader size={20} className="animate-spin text-slate-400" />
                            ) : (
                              <>
                                <Camera size={20} className="text-slate-300" />
                                <span className="text-[10px] text-slate-400 mt-1">صورة</span>
                              </>
                            )}
                            <input
                              type="file"
                              accept="image/*"
                              className="hidden"
                              onChange={(e) => {
                                const file = e.target.files?.[0];
                                if (file) handleImageUpload(work.id, file);
                                e.target.value = '';
                              }}
                              disabled={uploadingImageFor === work.id}
                            />
                          </label>
                        )}
                      </div>
                      
                      {/* Content Section - Right Side */}
                      <div className="flex-1 p-3">
                        {/* Header */}
                        <div className="flex items-start justify-between mb-2">
                          <div className="flex items-center gap-2">
                            <span className={`px-2 py-0.5 rounded text-xs font-bold ${
                              work.workType === 'SAMPLE' ? 'bg-slate-200 text-slate-700' : 'bg-slate-700 text-white'
                            }`}>
                              {WORK_TYPE_CONFIG[work.workType]?.labelAr || work.workType}
                            </span>
                            <Beaker size={14} className="text-violet-600" />
                            <h4 className="font-bold text-slate-800 text-sm">{work.sampleName}</h4>
                          </div>
                          <button
                            onClick={() => handleDeleteDailyWork(work.id)}
                            disabled={updatingId === work.id}
                            className="p-1 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded transition-colors"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                        
                        {/* Info Row */}
                        <div className="flex flex-wrap items-center gap-2 mb-2 text-xs">
                          <button
                            onClick={() => setShowMachineScheduleModal(work.machineId)}
                            className="flex items-center gap-1 text-slate-600 hover:text-slate-800"
                          >
                            <Settings size={11} className="text-slate-400" />
                            <span className="font-medium">{work.machineName}</span>
                          </button>
                          {work.line && (
                            <div className="flex items-center gap-1 text-slate-600">
                              <ListOrdered size={11} className="text-slate-400" />
                              <span className="font-medium">خط {work.line}</span>
                            </div>
                          )}
                        </div>
                        
                        {/* Notes - show from work or linked sample */}
                        {(work.notes || linkedSample?.notes) && (
                          <div className="mb-2 bg-slate-50 rounded-lg p-2 border border-slate-100">
                            <p className="text-sm text-slate-600 leading-relaxed">{work.notes || linkedSample?.notes}</p>
                          </div>
                        )}
                        
                        {/* Status Timeline - from linked sample */}
                        {linkedSample && (
                          <div className="mb-2 pb-2 border-b border-slate-100">
                            {renderStatusTimeline(linkedSample)}
                          </div>
                        )}
                        
                        {/* Technicians */}
                        <div className="pt-1">
                          {isAssigning ? (
                            <div className="p-2 bg-slate-50 rounded-lg">
                              <p className="text-[10px] text-slate-500 mb-1.5 font-medium">اختر الفنيين:</p>
                              <div className="flex flex-wrap gap-1">
                                {technicians.map(tech => {
                                  const isSelected = workTechs.some(t => t.id === tech.id);
                                  return (
                                    <button
                                      key={tech.id}
                                      onClick={() => handleAssignTechnician(work.id, tech.id, tech.name)}
                                      className={`px-2 py-0.5 text-[10px] rounded font-medium transition-colors ${
                                        isSelected 
                                          ? 'bg-slate-700 text-white' 
                                          : 'bg-white text-slate-600 hover:bg-slate-100 border border-slate-200'
                                      }`}
                                    >
                                      {isSelected && '✓ '}{tech.name}
                                    </button>
                                  );
                                })}
                              </div>
                              <button
                                onClick={() => setAssigningTechnicianTo(null)}
                                className="mt-1.5 w-full px-2 py-1 text-[10px] rounded font-medium bg-slate-700 text-white hover:bg-slate-800"
                              >
                                تم ✓
                              </button>
                            </div>
                          ) : (
                            <button
                              onClick={() => setAssigningTechnicianTo(work.id)}
                              className="flex items-center gap-2 text-xs text-slate-600 hover:text-slate-800 transition-colors"
                            >
                              {workTechs.length > 0 ? (
                                <>
                                  <div className="flex -space-x-1 rtl:space-x-reverse">
                                    {workTechs.slice(0, 2).map((t, i) => (
                                      <div key={t.id} className="w-5 h-5 bg-slate-600 rounded-full flex items-center justify-center text-white text-[10px] font-bold border border-white" style={{ zIndex: 2 - i }}>
                                        {t.name[0]}
                                      </div>
                                    ))}
                                    {workTechs.length > 2 && (
                                      <div className="w-5 h-5 bg-slate-400 rounded-full flex items-center justify-center text-white text-[8px] font-bold border border-white">
                                        +{workTechs.length - 2}
                                      </div>
                                    )}
                                  </div>
                                  <span className="font-medium">{workTechs.map(t => t.name).join('، ')}</span>
                                </>
                              ) : (
                                <>
                                  <div className="w-5 h-5 bg-slate-200 rounded-full flex items-center justify-center text-slate-400 text-[10px]">؟</div>
                                  <span className="text-slate-400">تعيين فني</span>
                                </>
                              )}
                              <Edit3 size={10} className="text-slate-300" />
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-3 sm:p-4">
        <div className="flex flex-col sm:flex-row sm:flex-wrap items-stretch sm:items-center gap-2 sm:gap-3">
          {/* Search */}
          <div className="relative flex-1 min-w-0 sm:min-w-[200px]">
            <Search size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="بحث..."
              className="w-full pr-10 pl-4 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-slate-500 focus:border-slate-500 outline-none"
            />
          </div>
          
          <div className="flex gap-2">
            {/* Status Filter */}
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value as SampleStatus | 'ALL')}
              className="flex-1 sm:flex-none px-3 py-2 border border-slate-200 rounded-lg text-xs sm:text-sm focus:ring-2 focus:ring-slate-500 outline-none"
            >
              <option value="ALL">كل الحالات</option>
              {STATUS_ORDER.map(status => (
                <option key={status} value={status}>{STATUS_CONFIG[status].labelAr}</option>
              ))}
            </select>
            
            {/* Machine Filter */}
            <select
              value={filterMachine}
              onChange={(e) => setFilterMachine(e.target.value)}
              className="flex-1 sm:flex-none px-3 py-2 border border-slate-200 rounded-lg text-xs sm:text-sm focus:ring-2 focus:ring-violet-500 outline-none"
            >
              <option value="ALL">كل الماكينات</option>
              {machines.map(machine => (
                <option key={machine.id} value={machine.id}>{machine.name}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Samples by Group */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 sm:gap-6 items-start">
        {/* Planned */}
        <div className="flex flex-col gap-2 sm:gap-4 bg-slate-50/80 rounded-xl sm:rounded-3xl p-2 sm:p-4 border border-slate-100 min-h-[200px] sm:min-h-[400px]">
          <div className="flex items-center justify-between px-1 mb-1 sm:mb-2">
            <div className="flex items-center gap-1.5 sm:gap-3">
              <div className="p-1.5 sm:p-2.5 bg-white rounded-lg sm:rounded-xl shadow-sm border border-slate-100">
                <Target size={14} className="sm:w-5 sm:h-5 text-slate-600" />
              </div>
              <div>
                <h2 className="font-ex-bold text-sm sm:text-lg text-slate-800">مخطط</h2>
                <p className="hidden sm:block text-xs text-slate-400 font-medium">خطط مستقبلية</p>
              </div>
            </div>
            <span className="px-1.5 sm:px-3 py-0.5 sm:py-1 bg-white text-slate-600 border border-slate-200 rounded-full text-[10px] sm:text-xs font-black shadow-sm">
              {groupedSamples['PLANNED'].length}
            </span>
          </div>
          
          <div className="grid grid-cols-2 sm:grid-cols-1 gap-2 sm:gap-4">
            {groupedSamples['PLANNED'].map(sample => renderSampleCard(sample))}
            {groupedSamples['PLANNED'].length === 0 && (
              <div className="col-span-2 sm:col-span-1 flex flex-col items-center justify-center py-8 sm:py-12 text-slate-300 border-2 border-dashed border-slate-200 rounded-xl sm:rounded-2xl">
                <Target size={24} className="sm:w-8 sm:h-8 mb-2 opacity-50" />
                <p className="text-xs sm:text-sm font-medium">لا توجد عينات مخططة</p>
              </div>
            )}
          </div>
        </div>
        
        {/* In Progress */}
        <div className="flex flex-col gap-2 sm:gap-4 bg-amber-50/30 rounded-xl sm:rounded-3xl p-2 sm:p-4 border border-amber-100/50 min-h-[200px] sm:min-h-[400px]">
          <div className="flex items-center justify-between px-1 mb-1 sm:mb-2">
            <div className="flex items-center gap-1.5 sm:gap-3">
              <div className="p-1.5 sm:p-2.5 bg-white rounded-lg sm:rounded-xl shadow-sm border border-amber-100">
                <Play size={14} className="sm:w-5 sm:h-5 text-amber-500" fill="currentColor" fillOpacity={0.2} />
              </div>
              <div>
                <h2 className="font-ex-bold text-sm sm:text-lg text-amber-900">قيد التنفيذ</h2>
                <p className="hidden sm:block text-xs text-amber-600/70 font-medium">جاري العمل عليها</p>
              </div>
            </div>
            <span className="px-1.5 sm:px-3 py-0.5 sm:py-1 bg-white text-amber-600 border border-amber-100 rounded-full text-[10px] sm:text-xs font-black shadow-sm">
              {groupedSamples['IN_PROGRESS'].length}
            </span>
          </div>
          
          <div className="grid grid-cols-2 sm:grid-cols-1 gap-2 sm:gap-4">
            {groupedSamples['IN_PROGRESS'].map(sample => renderSampleCard(sample))}
            {groupedSamples['IN_PROGRESS'].length === 0 && (
              <div className="col-span-2 sm:col-span-1 flex flex-col items-center justify-center py-8 sm:py-12 text-amber-300 border-2 border-dashed border-amber-200/50 rounded-xl sm:rounded-2xl">
                <Play size={24} className="sm:w-8 sm:h-8 mb-2 opacity-50" />
                <p className="text-xs sm:text-sm font-medium">لا توجد عينات قيد التنفيذ</p>
              </div>
            )}
          </div>
        </div>
        
        {/* Done */}
        <div className="flex flex-col gap-2 sm:gap-4 bg-emerald-50/30 rounded-xl sm:rounded-3xl p-2 sm:p-4 border border-emerald-100/50 min-h-[200px] sm:min-h-[400px]">
          <div className="flex items-center justify-between px-1 mb-1 sm:mb-2">
            <div className="flex items-center gap-1.5 sm:gap-3">
              <div className="p-1.5 sm:p-2.5 bg-white rounded-lg sm:rounded-xl shadow-sm border border-emerald-100">
                <CheckCircle size={14} className="sm:w-5 sm:h-5 text-emerald-500" />
              </div>
              <div>
                <h2 className="font-ex-bold text-sm sm:text-lg text-emerald-900">مكتمل</h2>
                <p className="hidden sm:block text-xs text-emerald-600/70 font-medium">تم الانتهاء منها</p>
              </div>
            </div>
            <span className="px-1.5 sm:px-3 py-0.5 sm:py-1 bg-white text-emerald-600 border border-emerald-100 rounded-full text-[10px] sm:text-xs font-black shadow-sm">
              {groupedSamples['DONE'].length}
            </span>
          </div>
          
          <div className="grid grid-cols-2 sm:grid-cols-1 gap-2 sm:gap-4">
            {groupedSamples['DONE'].map(sample => renderSampleCard(sample))}
            {groupedSamples['DONE'].length === 0 && (
              <div className="col-span-2 sm:col-span-1 flex flex-col items-center justify-center py-8 sm:py-12 text-emerald-300 border-2 border-dashed border-emerald-200/50 rounded-xl sm:rounded-2xl">
                <CheckCircle size={24} className="sm:w-8 sm:h-8 mb-2 opacity-50" />
                <p className="text-xs sm:text-sm font-medium">لا توجد عينات مكتملة</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Add/Edit Modal */}
      {(showAddModal || editingSample) && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => { setShowAddModal(false); setEditingSample(null); }}>
          <div 
            className="bg-white rounded-2xl shadow-2xl max-w-lg w-full max-h-[90vh] overflow-y-auto"
            onClick={e => e.stopPropagation()}
          >
            <div className="p-6 border-b border-slate-100">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                  <Beaker className="text-violet-600" size={20} />
                  {editingSample ? 'تعديل العينة' : 'إضافة عينة جديدة'}
                </h2>
                <button
                  onClick={() => { setShowAddModal(false); setEditingSample(null); }}
                  className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
                >
                  <X size={20} />
                </button>
              </div>
            </div>
            
            <div className="p-6 space-y-4">
              {/* Sample Name */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">اسم العينة *</label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="مثال: عينة جاكار أزرق"
                  className="w-full px-4 py-2.5 border border-slate-200 rounded-lg focus:ring-2 focus:ring-violet-500 focus:border-violet-500 outline-none"
                />
              </div>
              

              
              {/* Machine Selection */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">الماكينة *</label>
                <select
                  value={formData.machineId}
                  onChange={(e) => {
                    const machine = machines.find(m => m.id === e.target.value);
                    setFormData({ 
                      ...formData, 
                      machineId: e.target.value,
                      machineName: machine?.name || ''
                    });
                  }}
                  className="w-full px-4 py-2.5 border border-slate-200 rounded-lg focus:ring-2 focus:ring-violet-500 focus:border-violet-500 outline-none"
                >
                  <option value="">اختر الماكينة...</option>
                  {machines.map(machine => (
                    <option key={machine.id} value={machine.id}>{machine.name}</option>
                  ))}
                </select>
              </div>
              
              {/* Machine Schedule Info */}
              {formData.machineId && machineSchedules[formData.machineId] && (
                <div className="bg-slate-50 rounded-xl p-4 border border-slate-200">
                  <div className="flex items-center gap-2 mb-3">
                    <Info size={16} className="text-blue-600" />
                    <span className="font-bold text-slate-700 text-sm">حالة الماكينة</span>
                  </div>
                  
                  {/* Current Work */}
                  {machineSchedules[formData.machineId].isCurrentlyWorking && machineSchedules[formData.machineId].currentWork && (
                    <div className="flex items-center gap-2 mb-2 p-2 bg-amber-50 rounded-lg border border-amber-200">
                      <div className="w-2 h-2 bg-amber-500 rounded-full animate-pulse" />
                      <span className="text-xs text-amber-700">
                        تعمل حالياً على: <strong>{machineSchedules[formData.machineId].currentWork!.fabric}</strong>
                        {machineSchedules[formData.machineId].currentWork!.remaining && (
                          <span> - متبقي: {machineSchedules[formData.machineId].currentWork!.remaining} كج</span>
                        )}
                      </span>
                    </div>
                  )}
                  
                  {/* Future Plans */}
                  {machineSchedules[formData.machineId].futurePlans.length > 0 && (
                    <div className="mb-3">
                      <p className="text-xs font-medium text-slate-600 mb-2">الخطط القادمة:</p>
                      <div className="space-y-1 max-h-32 overflow-y-auto">
                        {machineSchedules[formData.machineId].futurePlans.slice(0, 5).map((plan, idx) => (
                          <div key={idx} className="flex items-center justify-between text-xs bg-white rounded p-2 border border-slate-100">
                            <span className="font-medium text-slate-700">{plan.fabric || plan.orderName}</span>
                            <span className="text-slate-500">{plan.days} يوم ({formatDate(plan.startDate)} - {formatDate(plan.endDate)})</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  
                  {/* Summary */}
                  <div className="flex items-center justify-between pt-2 border-t border-slate-200">
                    <div className="text-xs">
                      <span className="text-slate-500">إجمالي الأيام في الطابور:</span>
                      <span className="font-bold text-slate-700 mr-1">{machineSchedules[formData.machineId].totalQueuedDays} يوم</span>
                    </div>
                    <div className="text-xs">
                      <span className="text-slate-500">متاحة من:</span>
                      <span className="font-bold text-emerald-600 mr-1">{formatDate(machineSchedules[formData.machineId].nextAvailableDate)}</span>
                    </div>
                  </div>
                </div>
              )}
              

              
              {/* Notes */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">ملاحظات</label>
                <textarea
                  value={formData.notes}
                  onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                  placeholder="تفاصيل إضافية..."
                  rows={2}
                  className="w-full px-4 py-2.5 border border-slate-200 rounded-lg focus:ring-2 focus:ring-violet-500 focus:border-violet-500 outline-none resize-none"
                />
              </div>
            </div>
            
            <div className="p-6 border-t border-slate-100 flex gap-3">
              <button
                onClick={() => { setShowAddModal(false); setEditingSample(null); }}
                className="flex-1 px-4 py-2.5 border border-slate-200 text-slate-700 rounded-lg font-medium hover:bg-slate-50 transition-colors"
              >
                إلغاء
              </button>
              <button
                onClick={editingSample ? handleUpdateSample : handleAddSample}
                disabled={!formData.name || !formData.machineId || updatingId !== null}
                className="flex-1 px-4 py-2.5 bg-violet-600 text-white rounded-lg font-bold hover:bg-violet-700 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {updatingId ? (
                  <RefreshCw size={16} className="animate-spin" />
                ) : (
                  <>
                    <Save size={16} />
                    {editingSample ? 'حفظ التعديلات' : 'إضافة'}
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Daily Work Modal */}
      {showDailyWorkModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setShowDailyWorkModal(false)}>
          <div 
            className="bg-white rounded-2xl shadow-2xl max-w-md w-full max-h-[90vh] overflow-y-auto"
            onClick={e => e.stopPropagation()}
          >
            <div className="p-6 border-b border-slate-100 bg-slate-800 rounded-t-2xl">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-bold text-white flex items-center gap-2">
                  <Zap size={20} />
                  إضافة عمل جديد
                </h2>
                <button
                  onClick={() => setShowDailyWorkModal(false)}
                  className="p-2 text-slate-400 hover:text-white hover:bg-slate-700 rounded-lg transition-colors"
                >
                  <X size={20} />
                </button>
              </div>
              <p className="text-slate-400 text-sm mt-1">{formatDateArabic(selectedDate)}</p>
            </div>
            
            <div className="p-6 space-y-4">
              {/* Work Type - Only 2 Options */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">نوع العمل *</label>
                <div className="grid grid-cols-2 gap-2">
                  {Object.entries(WORK_TYPE_CONFIG).map(([type, config]) => (
                    <button
                      key={type}
                      onClick={() => setDailyWorkForm({ ...dailyWorkForm, workType: type as any })}
                      className={`px-4 py-3 rounded-lg border-2 font-bold text-sm transition-all ${
                        dailyWorkForm.workType === type 
                          ? `${config.bg} ${config.color} border-slate-400` 
                          : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
                      }`}
                    >
                      {config.labelAr}
                    </button>
                  ))}
                </div>
              </div>
              
              {/* SAMPLE: Sample Selection */}
              {dailyWorkForm.workType === 'SAMPLE' && (
                <>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">العينة *</label>
                    <select
                      value={dailyWorkForm.sampleId}
                      onChange={(e) => {
                        const sample = samples.find(s => s.id === e.target.value);
                        setDailyWorkForm({ 
                          ...dailyWorkForm, 
                          sampleId: e.target.value,
                          sampleName: sample?.name || '',
                          machineId: sample?.machineId || dailyWorkForm.machineId,
                          machineName: sample?.machineName || dailyWorkForm.machineName
                        });
                      }}
                      className="w-full px-4 py-2.5 border border-slate-200 rounded-lg focus:ring-2 focus:ring-slate-500 focus:border-slate-500 outline-none"
                    >
                      <option value="">اختر العينة...</option>
                      {samples.filter(s => s.status !== 'DONE').map(sample => (
                        <option key={sample.id} value={sample.id}>{sample.name} - {sample.machineName}</option>
                      ))}
                    </select>
                  </div>
                  
                  {/* Machine */}
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">الماكينة *</label>
                    <select
                      value={dailyWorkForm.machineId}
                      onChange={(e) => {
                        const machine = machines.find(m => m.id === e.target.value);
                        setDailyWorkForm({ 
                          ...dailyWorkForm, 
                          machineId: e.target.value,
                          machineName: machine?.name || ''
                        });
                      }}
                      className="w-full px-4 py-2.5 border border-slate-200 rounded-lg focus:ring-2 focus:ring-slate-500 focus:border-slate-500 outline-none"
                    >
                      <option value="">اختر الماكينة...</option>
                      {machines.map(machine => (
                        <option key={machine.id} value={machine.id}>{machine.name}</option>
                      ))}
                    </select>
                  </div>
                </>
              )}
              
              {/* ORDER_WORK: Fabric Name, Customer, Machine */}
              {dailyWorkForm.workType === 'ORDER_WORK' && (
                <>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">اسم الخامة *</label>
                    <input
                      type="text"
                      value={dailyWorkForm.fabricName}
                      onChange={(e) => setDailyWorkForm({ ...dailyWorkForm, fabricName: e.target.value, sampleName: e.target.value })}
                      placeholder="مثال: جاكار، انترلوك..."
                      className="w-full px-4 py-2.5 border border-slate-200 rounded-lg focus:ring-2 focus:ring-slate-500 focus:border-slate-500 outline-none"
                    />
                  </div>
                  
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">العميل *</label>
                    <input
                      type="text"
                      value={dailyWorkForm.customerName}
                      onChange={(e) => setDailyWorkForm({ ...dailyWorkForm, customerName: e.target.value })}
                      placeholder="اسم العميل..."
                      className="w-full px-4 py-2.5 border border-slate-200 rounded-lg focus:ring-2 focus:ring-slate-500 focus:border-slate-500 outline-none"
                    />
                  </div>
                  
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">الماكينة *</label>
                    <select
                      value={dailyWorkForm.machineId}
                      onChange={(e) => {
                        const machine = machines.find(m => m.id === e.target.value);
                        setDailyWorkForm({ 
                          ...dailyWorkForm, 
                          machineId: e.target.value,
                          machineName: machine?.name || ''
                        });
                      }}
                      className="w-full px-4 py-2.5 border border-slate-200 rounded-lg focus:ring-2 focus:ring-slate-500 focus:border-slate-500 outline-none"
                    >
                      <option value="">اختر الماكينة...</option>
                      {machines.map(machine => (
                        <option key={machine.id} value={machine.id}>{machine.name}</option>
                      ))}
                    </select>
                  </div>
                </>
              )}
              
              {/* Notes - for both types */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">ملاحظات</label>
                <textarea
                  value={dailyWorkForm.notes}
                  onChange={(e) => setDailyWorkForm({ ...dailyWorkForm, notes: e.target.value })}
                  placeholder="تفاصيل العمل..."
                  rows={2}
                  className="w-full px-4 py-2.5 border border-slate-200 rounded-lg focus:ring-2 focus:ring-slate-500 focus:border-slate-500 outline-none resize-none"
                />
              </div>
            </div>
            
            <div className="p-6 border-t border-slate-100 flex gap-3">
              <button
                onClick={() => setShowDailyWorkModal(false)}
                className="flex-1 px-4 py-2.5 border border-slate-200 text-slate-700 rounded-lg font-medium hover:bg-slate-50 transition-colors"
              >
                إلغاء
              </button>
              <button
                onClick={handleAddDailyWork}
                disabled={
                  !dailyWorkForm.machineId || 
                  (dailyWorkForm.workType === 'SAMPLE' && !dailyWorkForm.sampleId) || 
                  (dailyWorkForm.workType === 'ORDER_WORK' && !dailyWorkForm.fabricName) ||
                  updatingId === 'adding-work'
                }
                className="flex-1 px-4 py-2.5 bg-slate-800 text-white rounded-lg font-bold hover:bg-slate-900 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {updatingId === 'adding-work' ? (
                  <RefreshCw size={16} className="animate-spin" />
                ) : (
                  <>
                    <Zap size={16} />
                    إضافة
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add Technician Modal */}
      {showAddTechnicianModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setShowAddTechnicianModal(false)}>
          <div 
            className="bg-white rounded-2xl shadow-2xl max-w-sm w-full"
            onClick={e => e.stopPropagation()}
          >
            <div className="p-6 border-b border-slate-100 bg-slate-800 rounded-t-2xl">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-bold text-white flex items-center gap-2">
                  <Plus size={20} />
                  إضافة فني جديد
                </h2>
                <button
                  onClick={() => setShowAddTechnicianModal(false)}
                  className="p-2 text-slate-400 hover:text-white hover:bg-slate-700 rounded-lg transition-colors"
                >
                  <X size={20} />
                </button>
              </div>
            </div>
            
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">اسم الفني *</label>
                <input
                  type="text"
                  value={newTechnicianName}
                  onChange={(e) => setNewTechnicianName(e.target.value)}
                  placeholder="أدخل اسم الفني..."
                  className="w-full px-4 py-2.5 border border-slate-200 rounded-lg focus:ring-2 focus:ring-slate-500 focus:border-slate-500 outline-none"
                  autoFocus
                />
              </div>
              
              {/* Existing Technicians */}
              {technicians.length > 0 && (
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">الفنيين الحاليين:</label>
                  <div className="flex flex-wrap gap-2">
                    {technicians.map(tech => (
                      <div key={tech.id} className="flex items-center gap-1 px-3 py-1.5 bg-slate-100 rounded-full text-sm">
                        <span>{tech.name}</span>
                        <button
                          onClick={() => handleDeleteTechnician(tech.id)}
                          className="text-slate-400 hover:text-red-500 transition-colors"
                        >
                          <X size={14} />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
            
            <div className="p-6 border-t border-slate-100 flex gap-3">
              <button
                onClick={() => setShowAddTechnicianModal(false)}
                className="flex-1 px-4 py-2.5 border border-slate-200 text-slate-700 rounded-lg font-medium hover:bg-slate-50 transition-colors"
              >
                إغلاق
              </button>
              <button
                onClick={handleAddTechnician}
                disabled={!newTechnicianName.trim()}
                className="flex-1 px-4 py-2.5 bg-slate-800 text-white rounded-lg font-bold hover:bg-slate-900 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
              >
                <Plus size={16} />
                إضافة
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Machine Schedule Modal */}
      {showMachineScheduleModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setShowMachineScheduleModal(null)}>
          <div 
            className="bg-white rounded-2xl shadow-2xl max-w-lg w-full max-h-[80vh] overflow-hidden"
            onClick={e => e.stopPropagation()}
          >
            <div className="p-6 border-b border-slate-100 bg-slate-800 rounded-t-2xl">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-bold text-white flex items-center gap-2">
                  <Activity size={20} />
                  جدول الماكينة
                </h2>
                <button
                  onClick={() => setShowMachineScheduleModal(null)}
                  className="p-2 text-slate-400 hover:text-white hover:bg-slate-700 rounded-lg transition-colors"
                >
                  <X size={20} />
                </button>
              </div>
              <p className="text-slate-400 text-sm mt-1">{showMachineScheduleModal}</p>
            </div>
            
            <div className="p-6 overflow-y-auto max-h-[60vh]">
              {(() => {
                const machineInfo = machineSchedules[showMachineScheduleModal];
                if (!machineInfo) {
                  return (
                    <div className="text-center py-8 text-slate-500">
                      <Clock size={48} className="mx-auto mb-3 text-slate-300" />
                      <p>لا توجد معلومات عن هذه الماكينة</p>
                    </div>
                  );
                }
                
                return (
                  <div className="space-y-4">
                    {/* Current Status */}
                    <div className={`p-4 rounded-xl ${machineInfo.isCurrentlyWorking ? 'bg-slate-100 border-2 border-slate-300' : 'bg-slate-50 border border-slate-200'}`}>
                      <div className="flex items-center gap-2 mb-2">
                        <div className={`w-3 h-3 rounded-full ${machineInfo.isCurrentlyWorking ? 'bg-slate-800 animate-pulse' : 'bg-slate-400'}`} />
                        <span className="font-bold text-slate-800">
                          {machineInfo.isCurrentlyWorking ? 'تعمل حالياً' : 'متوقفة'}
                        </span>
                      </div>
                      {machineInfo.currentWork && (
                        <p className="text-sm text-slate-600 pr-5">{machineInfo.currentWork}</p>
                      )}
                    </div>
                    
                    {/* Queue Info */}
                    <div className="bg-slate-50 border border-slate-200 p-4 rounded-xl">
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-slate-600">الأعمال في الانتظار</span>
                        <span className="font-bold text-slate-800">{machineInfo.futurePlans.length} أعمال</span>
                      </div>
                      <div className="flex items-center justify-between mt-2">
                        <span className="text-sm text-slate-600">إجمالي أيام الانتظار</span>
                        <span className="font-bold text-slate-800">{machineInfo.totalQueuedDays} أيام</span>
                      </div>
                      <div className="flex items-center justify-between mt-2">
                        <span className="text-sm text-slate-600">أقرب موعد متاح</span>
                        <span className="font-bold text-slate-800">{machineInfo.nextAvailableDate}</span>
                      </div>
                    </div>
                    
                    {/* Future Plans */}
                    {machineInfo.futurePlans.length > 0 && (
                      <div>
                        <h3 className="font-bold text-slate-800 mb-3 flex items-center gap-2">
                          <Calendar size={16} />
                          الأعمال المجدولة
                        </h3>
                        <div className="space-y-2">
                          {machineInfo.futurePlans.map((plan, index) => (
                            <div key={index} className="bg-white border border-slate-200 rounded-lg p-3 flex items-center justify-between">
                              <div className="flex items-center gap-3">
                                <span className="w-6 h-6 rounded-full bg-slate-100 text-slate-600 text-sm font-bold flex items-center justify-center">
                                  {index + 1}
                                </span>
                                <span className="text-slate-700">{plan.fabric}</span>
                              </div>
                              <span className="text-sm px-2 py-1 bg-blue-100 text-blue-700 rounded-lg font-medium">
                                {plan.days} {plan.days === 1 ? 'يوم' : 'أيام'}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    
                    {machineInfo.futurePlans.length === 0 && !machineInfo.isCurrentlyWorking && (
                      <div className="text-center py-4 text-emerald-600 bg-emerald-50 rounded-xl">
                        <CheckCircle size={32} className="mx-auto mb-2" />
                        <p className="font-medium">الماكينة متاحة للعمل فوراً!</p>
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>
            
            <div className="p-4 border-t border-slate-100">
              <button
                onClick={() => setShowMachineScheduleModal(null)}
                className="w-full px-4 py-2.5 bg-slate-100 text-slate-700 rounded-lg font-medium hover:bg-slate-200 transition-colors"
              >
                إغلاق
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Sample Data Modal */}
      {showSampleDataModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full">
            <div className="p-6 border-b border-slate-100">
              <div className="flex items-center justify-between">
                <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2">
                  <Activity className="text-blue-600" size={24} />
                  بيانات العينة
                </h2>
                <button
                  onClick={() => setShowSampleDataModal(null)}
                  className="p-2 hover:bg-slate-100 rounded-lg transition-colors"
                >
                  <X size={20} />
                </button>
              </div>
              <p className="text-sm text-slate-500 mt-1">
                {samples.find(s => s.id === showSampleDataModal)?.name}
              </p>
            </div>
            
            <div className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                {/* Raw Weight */}
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">
                    وزن خام
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    value={sampleDataForm.rawWeight}
                    onChange={(e) => setSampleDataForm(prev => ({ ...prev, rawWeight: e.target.value }))}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    placeholder="أدخل الوزن"
                  />
                </div>
                
                {/* Zero Weight */}
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">
                    وزن زيرو
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    value={sampleDataForm.zeroWeight}
                    onChange={(e) => setSampleDataForm(prev => ({ ...prev, zeroWeight: e.target.value }))}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    placeholder="أدخل الوزن"
                  />
                </div>
                
                {/* Raw Width */}
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">
                    عرض خام
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    value={sampleDataForm.rawWidth}
                    onChange={(e) => setSampleDataForm(prev => ({ ...prev, rawWidth: e.target.value }))}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    placeholder="أدخل العرض"
                  />
                </div>
                
                {/* Zero Width */}
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">
                    عرض زيرو
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    value={sampleDataForm.zeroWidth}
                    onChange={(e) => setSampleDataForm(prev => ({ ...prev, zeroWidth: e.target.value }))}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    placeholder="أدخل العرض"
                  />
                </div>
              </div>
              
              {/* Finishing Plan Section */}
              <div className="border-t border-slate-200 pt-4 mt-4">
                <h3 className="text-sm font-bold text-slate-700 mb-3">خطة الجهيز</h3>
                
                {/* Required Finished Weight & Width */}
                <div className="grid grid-cols-2 gap-4 mb-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-2">
                      وزن مطلوب مجهز
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      value={sampleDataForm.requiredFinishedWeight}
                      onChange={(e) => setSampleDataForm(prev => ({ ...prev, requiredFinishedWeight: e.target.value }))}
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      placeholder="أدخل الوزن"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-2">
                      عرض مطلوب مجهز
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      value={sampleDataForm.requiredFinishedWidth}
                      onChange={(e) => setSampleDataForm(prev => ({ ...prev, requiredFinishedWidth: e.target.value }))}
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      placeholder="أدخل العرض"
                    />
                  </div>
                </div>
                
                <div className="space-y-3">
                  {/* First row - individual options */}
                  <div className="flex flex-wrap gap-3">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={sampleDataForm.finishingNazeem}
                        onChange={(e) => setSampleDataForm(prev => ({ ...prev, finishingNazeem: e.target.checked }))}
                        className="w-4 h-4 text-blue-600 rounded border-slate-300 focus:ring-blue-500"
                      />
                      <span className="text-sm text-slate-700">نزيم</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={sampleDataForm.finishingTathbeet}
                        onChange={(e) => setSampleDataForm(prev => ({ ...prev, finishingTathbeet: e.target.checked }))}
                        className="w-4 h-4 text-blue-600 rounded border-slate-300 focus:ring-blue-500"
                      />
                      <span className="text-sm text-slate-700">تثبيت</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={sampleDataForm.finishingKasra}
                        onChange={(e) => setSampleDataForm(prev => ({ ...prev, finishingKasra: e.target.checked }))}
                        className="w-4 h-4 text-blue-600 rounded border-slate-300 focus:ring-blue-500"
                      />
                      <span className="text-sm text-slate-700">كسترة</span>
                    </label>
                  </div>
                  {/* Second row - grouped options */}
                  <div className="flex items-center gap-4 bg-slate-50 p-3 rounded-lg">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={sampleDataForm.finishingCarbon}
                        onChange={(e) => setSampleDataForm(prev => ({ ...prev, finishingCarbon: e.target.checked }))}
                        className="w-4 h-4 text-blue-600 rounded border-slate-300 focus:ring-blue-500"
                      />
                      <span className="text-sm text-slate-700">كربون</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={sampleDataForm.finishingRam}
                        onChange={(e) => setSampleDataForm(prev => ({ ...prev, finishingRam: e.target.checked }))}
                        className="w-4 h-4 text-blue-600 rounded border-slate-300 focus:ring-blue-500"
                      />
                      <span className="text-sm text-slate-700">رام</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={sampleDataForm.finishingCompacter}
                        onChange={(e) => setSampleDataForm(prev => ({ ...prev, finishingCompacter: e.target.checked }))}
                        className="w-4 h-4 text-blue-600 rounded border-slate-300 focus:ring-blue-500"
                      />
                      <span className="text-sm text-slate-700">كومباكتر</span>
                    </label>
                  </div>
                </div>
              </div>
            </div>
            
            <div className="p-6 border-t border-slate-100 flex gap-3">
              <button
                onClick={() => setShowSampleDataModal(null)}
                className="flex-1 px-4 py-2.5 bg-slate-100 text-slate-700 rounded-lg font-medium hover:bg-slate-200 transition-colors"
              >
                إلغاء
              </button>
              <button
                onClick={handleSaveSampleData}
                className="flex-1 px-4 py-2.5 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors flex items-center justify-center gap-2"
              >
                <Save size={18} />
                حفظ البيانات
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Image Viewer Modal */}
      {viewingImage && (
        <div 
          className="fixed inset-0 bg-black/90 flex items-center justify-center z-50 p-4"
          onClick={() => setViewingImage(null)}
        >
          <button
            onClick={() => setViewingImage(null)}
            className="absolute top-4 left-4 p-2 bg-white/10 hover:bg-white/20 rounded-full text-white transition-colors"
          >
            <X size={24} />
          </button>
          <img 
            src={viewingImage} 
            alt="Sample"
            className="max-w-full max-h-full object-contain rounded-lg"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  );
};
