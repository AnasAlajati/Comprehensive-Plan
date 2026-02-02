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
        notes: formData.notes,
        expectedDate: endDate,
        machineId: formData.machineId,
        machineName: machine?.name || formData.machineId,
        priority: formData.priority,
        estimatedDays: formData.estimatedDays,
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
      setFormData({ name: '', notes: '', expectedDate: new Date().toISOString().split('T')[0], machineId: '', machineName: '' });
    } catch (error) {
      console.error('Error updating sample:', error);
    } finally {
      setUpdatingId(null);
    }
  };

  // Delete Sample
  const handleDeleteSample = async (sampleId: string) => {
    if (!window.confirm('هل أنت متأكد من حذف هذا السامبل؟\nAre you sure you want to delete this sample?')) return;
    
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
    const historyMap = new Map((sample.statusHistory || []).map(h => [h.status, h]));
    
    return (
      <div className="flex items-center gap-1">
        {STATUS_ORDER.map((status, index) => {
          const config = STATUS_CONFIG[status];
          const Icon = config.icon;
          const isActive = index === activeIndex;
          const isCompleted = index < activeIndex;
          const historyEntry = historyMap.get(status);
          
          return (
            <React.Fragment key={status}>
              <button
                onClick={() => handleStatusChange(sample, status)}
                disabled={updatingId === sample.id}
                className={`relative flex flex-col items-center group transition-all ${
                  isActive ? 'scale-110' : 'hover:scale-105'
                }`}
                title={`${config.labelAr} / ${config.label}${historyEntry ? ` - ${formatDate(historyEntry.date)}` : ''}`}
              >
                <div className={`
                  w-8 h-8 rounded-full flex items-center justify-center border-2 transition-all
                  ${isActive ? `${config.bg} ${config.border} ${config.color} ring-2 ring-offset-1 ring-${config.color.split('-')[1]}-300` : 
                    isCompleted ? `bg-emerald-100 border-emerald-400 text-emerald-600` : 
                    'bg-slate-50 border-slate-200 text-slate-400'}
                `}>
                  <Icon size={14} />
                  {isCompleted && (
                    <div className="absolute -top-1 -right-1 w-3 h-3 bg-emerald-500 rounded-full flex items-center justify-center">
                      <CheckCircle size={8} className="text-white" />
                    </div>
                  )}
                </div>
                <span className={`text-[9px] mt-1 font-medium ${isActive ? config.color : isCompleted ? 'text-emerald-600' : 'text-slate-400'}`}>
                  {config.labelAr}
                </span>
              </button>
              
              {index < STATUS_ORDER.length - 1 && (
                <div className={`w-6 h-0.5 ${index < activeIndex ? 'bg-emerald-400' : 'bg-slate-200'}`} />
              )}
            </React.Fragment>
          );
        })}
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
        className={`bg-white rounded-xl border shadow-sm hover:shadow-md transition-all ${
          isOverdue ? 'border-red-300 bg-red-50/30' : 
          isDueSoon ? 'border-amber-300 bg-amber-50/30' : 
          'border-slate-200'
        }`}
      >
        <div className="flex">
          {/* Image Section - Left Side */}
          <div className="w-24 flex-shrink-0 border-l border-slate-100">
            {sample.imageUrl ? (
              <div className="relative group h-full">
                <img 
                  src={sample.imageUrl} 
                  alt={sample.name}
                  className="w-full h-full min-h-[120px] object-cover rounded-r-xl cursor-pointer"
                  onClick={() => setViewingImage(sample.imageUrl!)}
                />
                <button
                  onClick={() => handleDeleteSampleImage(sample.id, sample.imagePath!)}
                  disabled={uploadingImageFor === sample.id}
                  className="absolute top-1 right-1 p-1 bg-red-500 text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-600"
                >
                  {uploadingImageFor === sample.id ? (
                    <Loader size={10} className="animate-spin" />
                  ) : (
                    <Trash2 size={10} />
                  )}
                </button>
              </div>
            ) : (
              <label className="flex flex-col items-center justify-center h-full min-h-[120px] cursor-pointer hover:bg-slate-50 transition-colors rounded-r-xl">
                {uploadingImageFor === sample.id ? (
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
                    if (file) handleSampleImageUpload(sample.id, file);
                    e.target.value = '';
                  }}
                  disabled={uploadingImageFor === sample.id}
                />
              </label>
            )}
          </div>
          
          {/* Content Section - Right Side */}
          <div className="flex-1 p-4">
            {/* Header */}
            <div className="flex items-start justify-between mb-3">
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  {/* Priority Badge */}
                  <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-black ${
                    (sample.priority || 999) === 1 ? 'bg-red-100 text-red-700 ring-2 ring-red-300' :
                    (sample.priority || 999) === 2 ? 'bg-orange-100 text-orange-700' :
                    (sample.priority || 999) === 3 ? 'bg-amber-100 text-amber-700' :
                    'bg-slate-100 text-slate-600'
                  }`}>
                    {sample.priority || '-'}
                  </span>
                  <Beaker size={16} className="text-violet-600" />
                  <h3 className="font-bold text-slate-800">{sample.name}</h3>
                </div>
                {sample.notes && (
                  <p className="text-xs text-slate-500 mt-1 line-clamp-2">{sample.notes}</p>
                )}
              </div>
              
              <div className="flex items-center gap-1">
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
                  className="p-1.5 text-slate-400 hover:text-violet-600 hover:bg-violet-50 rounded-lg transition-colors"
                  title="بيانات العينة"
                >
                  <Activity size={14} />
                </button>
                <button
                  onClick={() => openEditModal(sample)}
                  className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                  title="Edit"
                >
                  <Edit3 size={14} />
                </button>
                <button
                  onClick={() => handleDeleteSample(sample.id)}
                  className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                  title="Delete"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          
          {/* Info Row */}
          <div className="flex flex-wrap items-center gap-3 mb-4 text-xs">
            <div className="flex items-center gap-1 text-slate-600">
              <Settings size={12} className="text-slate-400" />
              <span className="font-medium">{sample.machineName}</span>
            </div>
            <div className="flex items-center gap-1 text-slate-600">
              <Clock size={12} className="text-slate-400" />
              <span className="font-medium">{sample.estimatedDays || 1} يوم</span>
            </div>
            <div className={`flex items-center gap-1 ${isOverdue ? 'text-red-600' : isDueSoon ? 'text-amber-600' : 'text-slate-600'}`}>
              <Calendar size={12} />
              <span className="font-medium">{formatDate(sample.expectedDate)}</span>
              {daysUntilExpected !== null && sample.status !== 'DONE' && (
                <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                  isOverdue ? 'bg-red-100 text-red-700' : 
                  isDueSoon ? 'bg-amber-100 text-amber-700' : 
                  'bg-slate-100 text-slate-600'
                }`}>
                  {isOverdue ? `متأخر ${Math.abs(daysUntilExpected)} يوم` : 
                   daysUntilExpected === 0 ? 'اليوم' : 
                   `${daysUntilExpected} يوم`}
                </span>
              )}
            </div>
          </div>
          
          {/* Status Timeline */}
          <div className="pt-3 border-t border-slate-100">
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
          title="إضافة سامبل"
        >
          <Beaker size={20} />
        </button>
      </div>

      {/* قلب اليوم - Daily Work Section with Date Picker */}
      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm">
        {/* Header with Date Picker */}
        <div className="bg-slate-800 px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-slate-700 rounded-lg">
              <Zap size={24} className="text-white" />
            </div>
            <div>
              <h2 className="text-xl font-black text-white">قلب اليوم</h2>
              <p className="text-slate-400 text-sm">سجل العمل اليومي</p>
            </div>
          </div>
          
          <div className="flex items-center gap-3">
            {/* Date Picker */}
            <div className="flex items-center gap-2 bg-slate-700 px-3 py-2 rounded-lg">
              <Calendar size={16} className="text-slate-400" />
              <input
                type="date"
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                className="bg-transparent text-white text-sm font-medium outline-none cursor-pointer"
              />
              {isToday && (
                <span className="px-2 py-0.5 bg-slate-600 text-slate-300 rounded text-xs font-bold">اليوم</span>
              )}
            </div>
            
            <div className="text-left text-white px-3">
              <div className="text-2xl font-black">{selectedDateWork.length}</div>
              <div className="text-slate-400 text-xs">أعمال</div>
            </div>
            
            <button
              onClick={() => setShowDailyWorkModal(true)}
              className="flex items-center gap-2 px-4 py-2.5 bg-white text-slate-800 rounded-xl font-bold hover:bg-slate-100 transition-colors"
            >
              <Plus size={18} />
              إضافة عمل
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
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4">
        <div className="flex flex-wrap items-center gap-3">
          {/* Search */}
          <div className="relative flex-1 min-w-[200px]">
            <Search size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="بحث..."
              className="w-full pr-10 pl-4 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-slate-500 focus:border-slate-500 outline-none"
            />
          </div>
          
          {/* Status Filter */}
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value as SampleStatus | 'ALL')}
            className="px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-slate-500 outline-none"
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
            className="px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-violet-500 outline-none"
          >
            <option value="ALL">كل الماكينات</option>
            {machines.map(machine => (
              <option key={machine.id} value={machine.id}>{machine.name}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Samples by Group */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Planned */}
        <div className="space-y-4">
          <div className="flex items-center gap-2 px-2">
            <div className="p-2 bg-slate-100 rounded-lg">
              <Target size={18} className="text-slate-600" />
            </div>
            <h2 className="font-bold text-slate-700">مخطط</h2>
            <span className="px-2 py-0.5 bg-slate-100 text-slate-600 rounded-full text-xs font-bold">
              {groupedSamples['PLANNED'].length}
            </span>
          </div>
          
          <div className="space-y-3">
            {groupedSamples['PLANNED'].map(sample => renderSampleCard(sample))}
            {groupedSamples['PLANNED'].length === 0 && (
              <div className="text-center py-8 text-slate-400 text-sm">
                لا توجد سامبلات مخططة
              </div>
            )}
          </div>
        </div>
        
        {/* In Progress */}
        <div className="space-y-4">
          <div className="flex items-center gap-2 px-2">
            <div className="p-2 bg-amber-100 rounded-lg">
              <Play size={18} className="text-amber-600" />
            </div>
            <h2 className="font-bold text-amber-700">قيد التنفيذ</h2>
            <span className="px-2 py-0.5 bg-amber-100 text-amber-600 rounded-full text-xs font-bold">
              {groupedSamples['IN_PROGRESS'].length}
            </span>
          </div>
          
          <div className="space-y-3">
            {groupedSamples['IN_PROGRESS'].map(sample => renderSampleCard(sample))}
            {groupedSamples['IN_PROGRESS'].length === 0 && (
              <div className="text-center py-8 text-slate-400 text-sm">
                لا توجد سامبلات قيد التنفيذ
              </div>
            )}
          </div>
        </div>
        
        {/* Done */}
        <div className="space-y-4">
          <div className="flex items-center gap-2 px-2">
            <div className="p-2 bg-emerald-100 rounded-lg">
              <CheckCircle size={18} className="text-emerald-600" />
            </div>
            <h2 className="font-bold text-emerald-700">مكتمل</h2>
            <span className="px-2 py-0.5 bg-emerald-100 text-emerald-600 rounded-full text-xs font-bold">
              {groupedSamples['DONE'].length}
            </span>
          </div>
          
          <div className="space-y-3">
            {groupedSamples['DONE'].map(sample => renderSampleCard(sample))}
            {groupedSamples['DONE'].length === 0 && (
              <div className="text-center py-8 text-slate-400 text-sm">
                لا توجد سامبلات مكتملة
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
                  {editingSample ? 'تعديل السامبل' : 'إضافة سامبل جديد'}
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
                <label className="block text-sm font-medium text-slate-700 mb-1">اسم السامبل *</label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="مثال: سامبل جاكار أزرق"
                  className="w-full px-4 py-2.5 border border-slate-200 rounded-lg focus:ring-2 focus:ring-violet-500 focus:border-violet-500 outline-none"
                />
              </div>
              
              {/* Priority & Estimated Days Row */}
              <div className="grid grid-cols-2 gap-4">
                {/* Priority */}
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1 flex items-center gap-1">
                    <ListOrdered size={14} />
                    الأولوية *
                  </label>
                  <div className="flex items-center gap-1">
                    {[1, 2, 3, 4, 5].map(p => (
                      <button
                        key={p}
                        onClick={() => setFormData({ ...formData, priority: p })}
                        className={`w-10 h-10 rounded-lg font-bold text-lg transition-all ${
                          formData.priority === p
                            ? p === 1 ? 'bg-red-500 text-white ring-2 ring-red-300' :
                              p === 2 ? 'bg-orange-500 text-white ring-2 ring-orange-300' :
                              p === 3 ? 'bg-amber-500 text-white ring-2 ring-amber-300' :
                              'bg-slate-600 text-white ring-2 ring-slate-400'
                            : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                        }`}
                      >
                        {p}
                      </button>
                    ))}
                  </div>
                  <p className="text-[10px] text-slate-400 mt-1">1 = أعلى أولوية</p>
                </div>
                
                {/* Estimated Days */}
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1 flex items-center gap-1">
                    <Clock size={14} />
                    المدة المتوقعة (أيام) *
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="30"
                    value={formData.estimatedDays}
                    onChange={(e) => setFormData({ ...formData, estimatedDays: parseInt(e.target.value) || 1 })}
                    className="w-full px-4 py-2.5 border border-slate-200 rounded-lg focus:ring-2 focus:ring-violet-500 focus:border-violet-500 outline-none"
                  />
                </div>
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
              
              {/* Calculated Expected Date */}
              <div className="bg-violet-50 rounded-xl p-4 border border-violet-200">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs text-violet-600 mb-1">تاريخ الانتهاء المتوقع (محسوب تلقائياً)</p>
                    <p className="text-lg font-black text-violet-800">{formatDate(formData.expectedDate)}</p>
                  </div>
                  <Calendar size={32} className="text-violet-300" />
                </div>
              </div>
              
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
                    <label className="block text-sm font-medium text-slate-700 mb-1">السامبل *</label>
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
                      <option value="">اختر السامبل...</option>
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
