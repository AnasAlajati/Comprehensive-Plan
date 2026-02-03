import React, { useState, useEffect, useMemo } from 'react';
import { collection, getDocs, collectionGroup, query, doc, updateDoc, onSnapshot } from 'firebase/firestore';
import { db, auth } from '../services/firebase';
import { parseFabricName } from '../services/data';
import { OrderRow, FabricDefinition, DyeingBatch } from '../types';
import { 
  Search, 
  RefreshCw,
  Factory,
  User,
  Package,
  Calendar,
  Clock,
  Droplets,
  Box,
  PenBox,
  Ship,
  Check,
  ChevronDown,
  ChevronUp,
  Eye,
  Layers,
  AlertTriangle,
  Cpu,
  Plus,
  FlaskConical,
  Trash2,
  Link2,
  X
} from 'lucide-react';

// Status Configuration - Clean professional colors
const DYEHOUSE_STEPS = [
  { id: 'STORE_RAW', label: 'مخزن مصبغة', shortLabel: 'مخزن', icon: Box, color: '#64748b' },
  { id: 'DYEING', label: 'صباغة', shortLabel: 'صباغة', icon: PenBox, color: '#7c3aed' },
  { id: 'FINISHING', label: 'تجهيز', shortLabel: 'تجهيز', icon: Factory, color: '#f59e0b' },
  { id: 'STORE_FINISHED', label: 'منتهي مخزن', shortLabel: 'منتهي', icon: Ship, color: '#10b981' },
  { id: 'RECEIVED', label: 'مستلم', shortLabel: 'مستلم', icon: Check, color: '#3b82f6' }
] as const;

type DyehouseStatusType = 'STORE_RAW' | 'DYEING' | 'FINISHING' | 'STORE_FINISHED' | 'RECEIVED';

interface PartialItem {
  id: string;
  quantity: number;
  note: string;
  createdAt: string;
  createdBy?: string;
  dyehouseStatus?: DyehouseStatusType;
  dyehouseStatusDate?: string;
  dyehouseHistory?: any[];
}

interface ActiveWorkItem {
  id: string;
  orderId: string;
  batchIdx: number;
  clientId: string;
  clientName: string;
  orderReference?: string;
  fabric: string;
  fabricShortName?: string;
  color: string;
  colorHex?: string;
  quantity: number;
  quantitySent: number;
  quantitySentRaw: number;
  quantitySentAccessory: number;
  totalReceived: number;
  totalReceivedRaw: number;
  totalReceivedAccessory: number;
  dyehouse: string;
  machine: string;
  plannedCapacity?: number;
  dispatchNumber?: string;
  dateSent?: string;
  formationDate?: string;
  status: 'draft' | 'pending' | 'sent' | 'received';
  dyehouseStatus?: DyehouseStatusType;
  dyehouseStatusDate?: string;
  dyehouseHistory?: any[];
  notes?: string;
  accessoryType?: string;
  batch: DyeingBatch;
  partials?: PartialItem[];
}

interface FabricGroup {
  fabric: string;
  fabricShortName: string;
  clientName: string;
  clientId: string;
  orderReference?: string;
  items: ActiveWorkItem[];
  totalSent: number;
  totalReceived: number;
  totalRemaining: number;
  machine: string;
  plannedCapacity?: number;
}

export const DyehouseActiveWorkPage: React.FC = () => {
  const [items, setItems] = useState<ActiveWorkItem[]>([]);
  const [allDyehouses, setAllDyehouses] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  
  const [selectedDyehouse, setSelectedDyehouse] = useState<string>('');
  const [selectedClient, setSelectedClient] = useState<string>(''); // NEW: Client filter
  const [filterStatus, setFilterStatus] = useState<DyehouseStatusType | 'All'>('All');
  const [updatingItemId, setUpdatingItemId] = useState<string | null>(null);
  const [expandedMachineQueue, setExpandedMachineQueue] = useState<string | null>(null);
  
  // Date picker modal state
  const [datePickerModal, setDatePickerModal] = useState<{
    item: ActiveWorkItem;
    status: DyehouseStatusType;
    selectedDate: string;
    partialId?: string; // If editing a partial's status
  } | null>(null);
  
  // Partial/Test modal state
  const [partialModal, setPartialModal] = useState<{
    item: ActiveWorkItem;
    quantity: string;
    note: string;
  } | null>(null);

  useEffect(() => {
    setLoading(true);
    
    const fetchDyehouses = async () => {
      const snapshot = await getDocs(collection(db, 'dyehouses'));
      const list = snapshot.docs.map(doc => doc.data().name as string).sort();
      setAllDyehouses(list);
      if (list.length > 0 && !selectedDyehouse) {
        setSelectedDyehouse(list[0]);
      }
    };
    fetchDyehouses();

    const unsubscribe = onSnapshot(query(collectionGroup(db, 'orders')), async (snapshot) => {
      const clientsSnapshot = await getDocs(collection(db, 'CustomerSheets'));
      const clientMap: Record<string, string> = {};
      clientsSnapshot.docs.forEach(doc => {
        const data = doc.data();
        clientMap[doc.id] = data.name || 'Unknown Client';
      });

      const fabricsSnapshot = await getDocs(collection(db, 'fabrics'));
      const fabricMap: Record<string, string> = {};
      fabricsSnapshot.docs.forEach(doc => {
        const data = doc.data() as FabricDefinition;
        fabricMap[data.name] = data.shortName || data.name;
      });

      const allItems: ActiveWorkItem[] = [];

      snapshot.docs.forEach(docSnap => {
        const order = { id: docSnap.id, ...docSnap.data() } as OrderRow;
        const clientId = order.customerId || 'unknown';
        const clientName = clientMap[clientId] || 'Unknown Client';

        if (order.dyeingPlan && Array.isArray(order.dyeingPlan)) {
          order.dyeingPlan.forEach((batch, idx) => {
            if (batch.status !== 'sent') return;
            
            // Calculate sent quantities (same logic as ClientOrdersPage)
            const sentEvents = batch.sentEvents || [];
            const sentRaw = sentEvents.reduce((s, e) => s + (Number(e.quantity) || 0), 0) + (Number(batch.quantitySentRaw) || Number(batch.quantitySent) || 0);
            const sentAcc = sentEvents.reduce((s, e) => s + (Number(e.accessorySent) || 0), 0) + (Number(batch.quantitySentAccessory) || 0);
            const totalSent = sentRaw + sentAcc;
            
            // Calculate received quantities (same logic as ClientOrdersPage)
            const receiveEvents = batch.receiveEvents || [];
            const recRaw = receiveEvents.reduce((s, e) => s + (Number(e.quantityRaw) || 0), 0) + (Number(batch.receivedQuantity) || 0);
            const recAcc = receiveEvents.reduce((s, e) => s + (Number(e.quantityAccessory) || 0), 0);
            const totalReceived = recRaw + recAcc;
            
            const dyehouseName = batch.dyehouse || order.dyehouse || 'Unassigned';
            const machineName = batch.plannedCapacity ? `${batch.plannedCapacity}kg` : (batch.machine || order.dyehouseMachine || '');
            
            allItems.push({
              id: `${order.id}-${idx}`,
              orderId: order.id,
              batchIdx: idx,
              clientId: clientId,
              clientName: clientName,
              orderReference: order.orderReference,
              fabric: order.material,
              fabricShortName: parseFabricName(order.material).shortName || order.material,
              color: batch.color,
              colorHex: batch.colorHex,
              quantity: batch.quantity,
              quantitySent: totalSent,
              quantitySentRaw: sentRaw,
              quantitySentAccessory: sentAcc,
              totalReceived: totalReceived,
              totalReceivedRaw: recRaw,
              totalReceivedAccessory: recAcc,
              dyehouse: dyehouseName,
              machine: machineName,
              plannedCapacity: batch.plannedCapacity,
              dispatchNumber: batch.dispatchNumber,
              dateSent: batch.dateSent,
              formationDate: batch.formationDate,
              status: batch.status || 'draft',
              // Smart status detection:
              // - If no dyehouseStatus set but has received qty -> RECEIVED
              // - If no dyehouseStatus set but has sent qty -> STORE_RAW (مخزن)
              dyehouseStatus: batch.dyehouseStatus || (
                totalReceived > 0 ? 'RECEIVED' :
                totalSent > 0 ? 'STORE_RAW' :
                undefined
              ),
              dyehouseStatusDate: batch.dyehouseStatusDate,
              dyehouseHistory: batch.dyehouseHistory,
              notes: batch.notes,
              accessoryType: batch.accessoryType,
              batch: batch,
              partials: batch.partials || []
            });
          });
        }
      });

      setItems(allItems);
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  // Utility functions (defined before useMemos that need them)
  const calculateDays = (dateStr?: string) => {
    if (!dateStr) return null;
    const sent = new Date(dateStr);
    const now = new Date();
    return Math.floor((now.getTime() - sent.getTime()) / (1000 * 60 * 60 * 24));
  };

  const formatDate = (dateStr?: string) => {
    if (!dateStr) return '-';
    return new Date(dateStr).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });
  };

  const getStatusIndex = (status?: DyehouseStatusType) => {
    if (!status) return -1;
    return DYEHOUSE_STEPS.findIndex(s => s.id === status);
  };

  // Check for delay alerts
  // Rule 1: 15+ days after تشكيل and NOT yet dyed → needs attention
  // Rule 2: In DYEING for more than 2 days without moving → needs attention  
  const getDelayAlert = (item: ActiveWorkItem): { type: 'formation' | 'dyeing' | null, message: string, days: number } => {
    const daysFormation = calculateDays(item.formationDate);
    const statusIndex = getStatusIndex(item.dyehouseStatus);
    const dyeingIndex = DYEHOUSE_STEPS.findIndex(s => s.id === 'DYEING');
    
    // Alert 1: 15+ days after formation and NOT yet dyed (status is before DYEING)
    if (daysFormation !== null && daysFormation >= 15 && statusIndex < dyeingIndex) {
      return {
        type: 'formation',
        message: `${daysFormation} يوم بعد التشكيل ولم تصبغ بعد!`,
        days: daysFormation
      };
    }
    
    // Alert 2: In DYEING status for more than 2 days
    if (item.dyehouseStatus === 'DYEING') {
      const dyeingEntry = item.dyehouseHistory?.find(h => h.status === 'DYEING');
      if (dyeingEntry) {
        const daysSinceDyeing = calculateDays(dyeingEntry.date);
        if (daysSinceDyeing !== null && daysSinceDyeing > 2) {
          return {
            type: 'dyeing',
            message: `${daysSinceDyeing} يوم في الصباغة بدون تحريك!`,
            days: daysSinceDyeing
          };
        }
      }
    }
    
    return { type: null, message: '', days: 0 };
  };

  // Get unique clients for filter dropdown
  const uniqueClients = useMemo(() => {
    const clientsMap = new Map<string, string>();
    items.forEach(item => {
      if (item.clientId && item.clientName) {
        clientsMap.set(item.clientId, item.clientName);
      }
    });
    return Array.from(clientsMap.entries())
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [items]);

  const filteredItems = useMemo(() => {
    return items.filter(item => {
      // If client is selected, show across all dyehouses
      if (selectedClient) {
        if (item.clientId !== selectedClient) return false;
      } else {
        // If no client selected, filter by dyehouse
        if (!selectedDyehouse || item.dyehouse !== selectedDyehouse) return false;
      }
      
      if (filterStatus !== 'All' && item.dyehouseStatus !== filterStatus) return false;
      
      if (searchTerm) {
        const search = searchTerm.toLowerCase();
        const matchesSearch = 
          item.clientName.toLowerCase().includes(search) ||
          item.fabric.toLowerCase().includes(search) ||
          item.color.toLowerCase().includes(search) ||
          (item.dispatchNumber && item.dispatchNumber.toLowerCase().includes(search)) ||
          (item.orderReference && item.orderReference.toLowerCase().includes(search));
        if (!matchesSearch) return false;
      }
      
      return true;
    });
  }, [items, selectedDyehouse, selectedClient, filterStatus, searchTerm]);

  // Group items by fabric for multi-color display
  const fabricGroups = useMemo(() => {
    const groups: Record<string, FabricGroup> = {};
    
    filteredItems.forEach(item => {
      // When filtering by client, include dyehouse in the key to separate by dyehouse
      const key = selectedClient 
        ? `${item.clientId}-${item.fabric}-${item.orderId}-${item.dyehouse}`
        : `${item.clientId}-${item.fabric}-${item.orderId}`;
      
      if (!groups[key]) {
        groups[key] = {
          fabric: item.fabric,
          fabricShortName: item.fabricShortName || item.fabric,
          clientName: item.clientName,
          clientId: item.clientId,
          orderReference: item.orderReference,
          items: [],
          totalSent: 0,
          totalReceived: 0,
          totalRemaining: 0,
          machine: item.machine,
          plannedCapacity: item.plannedCapacity
        };
      }
      
      groups[key].items.push(item);
      groups[key].totalSent += item.quantitySent;
      groups[key].totalReceived += item.totalReceived;
      groups[key].totalRemaining += Math.max(0, item.quantitySent - item.totalReceived);
      
      // Use the largest machine
      if (item.plannedCapacity && (!groups[key].plannedCapacity || item.plannedCapacity > groups[key].plannedCapacity)) {
        groups[key].plannedCapacity = item.plannedCapacity;
        groups[key].machine = item.machine;
      }
    });
    
    return Object.values(groups).sort((a, b) => {
      // When filtering by client, sort by dyehouse first
      if (selectedClient) {
        const dyeA = a.items[0]?.dyehouse || '';
        const dyeB = b.items[0]?.dyehouse || '';
        if (dyeA !== dyeB) return dyeA.localeCompare(dyeB);
      }
      return a.clientName.localeCompare(b.clientName);
    });
  }, [filteredItems, selectedClient]);

  const statusGroups = useMemo(() => {
    const groups: Record<string, ActiveWorkItem[]> = {};
    DYEHOUSE_STEPS.forEach(step => {
      groups[step.id] = filteredItems.filter(item => item.dyehouseStatus === step.id);
    });
    groups['UNSET'] = filteredItems.filter(item => !item.dyehouseStatus);
    return groups;
  }, [filteredItems]);

  const stats = useMemo(() => {
    const totalItems = filteredItems.length;
    const totalQuantity = filteredItems.reduce((sum, item) => sum + (item.quantitySent || 0), 0);
    const inDyeing = statusGroups['DYEING']?.length || 0;
    const inFinishing = statusGroups['FINISHING']?.length || 0;
    const inStore = (statusGroups['STORE_RAW']?.length || 0) + (statusGroups['STORE_FINISHED']?.length || 0);
    
    // Count delayed items
    const delayed = filteredItems.filter(item => getDelayAlert(item).type !== null).length;
    
    return { totalItems, totalQuantity, inDyeing, inFinishing, inStore, delayed };
  }, [filteredItems, statusGroups]);

  // Group items by machine for queue tracking (only items that have entered DYEING or later)
  const machineQueues = useMemo(() => {
    const queues: Record<string, ActiveWorkItem[]> = {};
    const dyeingIndex = DYEHOUSE_STEPS.findIndex(s => s.id === 'DYEING');
    
    // Only include items that are in DYEING or later (relevant to machine work)
    filteredItems.forEach(item => {
      if (!item.plannedCapacity) return; // Must have a machine assigned
      
      const machineKey = `${item.dyehouse}-${item.plannedCapacity}kg`;
      if (!queues[machineKey]) {
        queues[machineKey] = [];
      }
      queues[machineKey].push(item);
    });
    
    // Sort each queue by formation date (earlier = first in queue)
    Object.keys(queues).forEach(key => {
      queues[key].sort((a, b) => {
        const dateA = a.formationDate ? new Date(a.formationDate).getTime() : Infinity;
        const dateB = b.formationDate ? new Date(b.formationDate).getTime() : Infinity;
        return dateA - dateB;
      });
    });
    
    return queues;
  }, [filteredItems]);

  // Get machine queue info for a specific item
  const getMachineQueueInfo = (item: ActiveWorkItem) => {
    if (!item.plannedCapacity) return null;
    
    const machineKey = `${item.dyehouse}-${item.plannedCapacity}kg`;
    const queue = machineQueues[machineKey] || [];
    const position = queue.findIndex(q => q.id === item.id) + 1;
    const total = queue.length;
    
    if (total <= 1) return null; // Don't show if only one item
    
    // Count how many items before this one have finished dyeing (moved past DYEING)
    const dyeingIndex = DYEHOUSE_STEPS.findIndex(s => s.id === 'DYEING');
    const itemsBefore = queue.slice(0, position - 1);
    const finishedBefore = itemsBefore.filter(q => getStatusIndex(q.dyehouseStatus) > dyeingIndex).length;
    const stillInQueueBefore = position - 1 - finishedBefore;
    
    return {
      position,
      total,
      queue,
      finishedBefore,
      stillInQueueBefore,
      machineKey
    };
  };

  const handleStatusChange = async (item: ActiveWorkItem, newStatus: DyehouseStatusType, customDate?: string) => {
    setUpdatingItemId(item.id);
    try {
      const orderSnapshot = await getDocs(query(collectionGroup(db, 'orders')));
      const orderDoc = orderSnapshot.docs.find(d => d.id === item.orderId);
      
      if (!orderDoc) {
        console.error('Order not found');
        return;
      }
      
      const orderData = orderDoc.data() as OrderRow;
      const newDyeingPlan = [...(orderData.dyeingPlan || [])];
      
      const today = new Date().toISOString().split('T')[0];
      const actualDate = customDate || today; // The date the status actually happened
      const existingHistory = newDyeingPlan[item.batchIdx]?.dyehouseHistory || [];
      
      // Get the index of the new status in the workflow
      const newStatusIndex = DYEHOUSE_STEPS.findIndex(s => s.id === newStatus);
      
      // Remove all statuses that come AFTER the new status (user is going back)
      let newHistory = existingHistory.filter((h: any) => {
        const hIndex = DYEHOUSE_STEPS.findIndex(s => s.id === h.status);
        return hIndex <= newStatusIndex;
      });
      
      const existingEntryIndex = newHistory.findIndex((h: any) => h.status === newStatus);
      
      if (existingEntryIndex === -1) {
        newHistory.push({
          status: newStatus,
          date: actualDate,        // When it actually happened
          enteredAt: today,        // When this was recorded (for audit trail)
          updatedBy: auth.currentUser?.email || 'Unknown'
        });
      } else {
        // Update existing entry with new date
        newHistory[existingEntryIndex] = {
          ...newHistory[existingEntryIndex],
          date: actualDate,
          lastModified: today,
          modifiedBy: auth.currentUser?.email || 'Unknown'
        };
      }
      
      newDyeingPlan[item.batchIdx] = {
        ...newDyeingPlan[item.batchIdx],
        dyehouseStatus: newStatus,
        dyehouseStatusDate: actualDate,
        dyehouseHistory: newHistory
      };
      
      await updateDoc(orderDoc.ref, {
        dyeingPlan: newDyeingPlan
      });
      
    } catch (error) {
      console.error('Error updating status:', error);
    } finally {
      setUpdatingItemId(null);
      setDatePickerModal(null);
    }
  };

  // Open date picker modal for status change
  const openStatusDatePicker = (item: ActiveWorkItem, status: DyehouseStatusType, partialId?: string) => {
    const today = new Date().toISOString().split('T')[0];
    setDatePickerModal({
      item,
      status,
      selectedDate: today,
      partialId
    });
  };

  // Add a partial/test quantity
  const handleAddPartial = async () => {
    if (!partialModal) return;
    
    const { item, quantity, note } = partialModal;
    const qty = parseFloat(quantity);
    
    if (isNaN(qty) || qty <= 0) {
      alert('الرجاء إدخال كمية صحيحة');
      return;
    }
    
    // Calculate remaining quantity (main - sum of existing partials)
    const existingPartialsTotal = (item.partials || []).reduce((sum, p) => sum + p.quantity, 0);
    const mainQuantity = item.quantitySent - existingPartialsTotal;
    
    if (qty > mainQuantity) {
      alert(`الكمية أكبر من المتبقي (${mainQuantity} كجم)`);
      return;
    }
    
    setUpdatingItemId(item.id);
    try {
      const orderSnapshot = await getDocs(query(collectionGroup(db, 'orders')));
      const orderDoc = orderSnapshot.docs.find(d => d.id === item.orderId);
      
      if (!orderDoc) {
        console.error('Order not found');
        return;
      }
      
      const orderData = orderDoc.data() as OrderRow;
      const newDyeingPlan = [...(orderData.dyeingPlan || [])];
      const today = new Date().toISOString().split('T')[0];
      
      const newPartial: PartialItem = {
        id: `partial-${Date.now()}`,
        quantity: qty,
        note: note || '',
        createdAt: today,
        createdBy: auth.currentUser?.email || 'Unknown',
        dyehouseStatus: item.dyehouseStatus, // Start with same status as main
        dyehouseStatusDate: today,
        dyehouseHistory: item.dyehouseStatus ? [{
          status: item.dyehouseStatus,
          date: today,
          enteredAt: today,
          updatedBy: auth.currentUser?.email || 'Unknown'
        }] : []
      };
      
      const existingPartials = newDyeingPlan[item.batchIdx]?.partials || [];
      
      newDyeingPlan[item.batchIdx] = {
        ...newDyeingPlan[item.batchIdx],
        partials: [...existingPartials, newPartial]
      };
      
      await updateDoc(orderDoc.ref, {
        dyeingPlan: newDyeingPlan
      });
      
    } catch (error) {
      console.error('Error adding partial:', error);
    } finally {
      setUpdatingItemId(null);
      setPartialModal(null);
    }
  };

  // Update partial status
  const handlePartialStatusChange = async (item: ActiveWorkItem, partialId: string, newStatus: DyehouseStatusType, customDate?: string) => {
    setUpdatingItemId(item.id);
    try {
      const orderSnapshot = await getDocs(query(collectionGroup(db, 'orders')));
      const orderDoc = orderSnapshot.docs.find(d => d.id === item.orderId);
      
      if (!orderDoc) {
        console.error('Order not found');
        return;
      }
      
      const orderData = orderDoc.data() as OrderRow;
      const newDyeingPlan = [...(orderData.dyeingPlan || [])];
      const today = new Date().toISOString().split('T')[0];
      const actualDate = customDate || today;
      
      const partials = [...(newDyeingPlan[item.batchIdx]?.partials || [])];
      const partialIndex = partials.findIndex(p => p.id === partialId);
      
      if (partialIndex === -1) return;
      
      const partial = partials[partialIndex];
      const newStatusIndex = DYEHOUSE_STEPS.findIndex(s => s.id === newStatus);
      const existingHistory = partial.dyehouseHistory || [];
      
      // Remove statuses after the new status
      let newHistory = existingHistory.filter((h: any) => {
        const hIndex = DYEHOUSE_STEPS.findIndex(s => s.id === h.status);
        return hIndex <= newStatusIndex;
      });
      
      const existingEntryIndex = newHistory.findIndex((h: any) => h.status === newStatus);
      
      if (existingEntryIndex === -1) {
        newHistory.push({
          status: newStatus,
          date: actualDate,
          enteredAt: today,
          updatedBy: auth.currentUser?.email || 'Unknown'
        });
      } else {
        newHistory[existingEntryIndex] = {
          ...newHistory[existingEntryIndex],
          date: actualDate,
          lastModified: today,
          modifiedBy: auth.currentUser?.email || 'Unknown'
        };
      }
      
      partials[partialIndex] = {
        ...partial,
        dyehouseStatus: newStatus,
        dyehouseStatusDate: actualDate,
        dyehouseHistory: newHistory
      };
      
      newDyeingPlan[item.batchIdx] = {
        ...newDyeingPlan[item.batchIdx],
        partials
      };
      
      await updateDoc(orderDoc.ref, {
        dyeingPlan: newDyeingPlan
      });
      
    } catch (error) {
      console.error('Error updating partial status:', error);
    } finally {
      setUpdatingItemId(null);
      setDatePickerModal(null);
    }
  };

  // Delete a partial
  const handleDeletePartial = async (item: ActiveWorkItem, partialId: string) => {
    if (!confirm('هل تريد حذف هذا الجزء؟')) return;
    
    setUpdatingItemId(item.id);
    try {
      const orderSnapshot = await getDocs(query(collectionGroup(db, 'orders')));
      const orderDoc = orderSnapshot.docs.find(d => d.id === item.orderId);
      
      if (!orderDoc) return;
      
      const orderData = orderDoc.data() as OrderRow;
      const newDyeingPlan = [...(orderData.dyeingPlan || [])];
      
      const partials = (newDyeingPlan[item.batchIdx]?.partials || []).filter((p: any) => p.id !== partialId);
      
      newDyeingPlan[item.batchIdx] = {
        ...newDyeingPlan[item.batchIdx],
        partials
      };
      
      await updateDoc(orderDoc.ref, {
        dyeingPlan: newDyeingPlan
      });
      
    } catch (error) {
      console.error('Error deleting partial:', error);
    } finally {
      setUpdatingItemId(null);
    }
  };

  // Timeline Status Component (like the first image)
  const TimelineStatus = ({ item }: { item: ActiveWorkItem }) => {
    const activeIndex = getStatusIndex(item.dyehouseStatus);
    const historyMap = new Map((item.dyehouseHistory || []).map(h => [h.status, h]));
    
    // Get the most recent history entry for "last modified by" info
    const lastHistoryEntry = (item.dyehouseHistory || [])
      .filter(h => h.updatedBy || h.modifiedBy)
      .sort((a, b) => {
        const dateA = new Date(a.lastModified || a.enteredAt || a.date);
        const dateB = new Date(b.lastModified || b.enteredAt || b.date);
        return dateB.getTime() - dateA.getTime();
      })[0];
    
    const lastModifiedBy = lastHistoryEntry?.modifiedBy || lastHistoryEntry?.updatedBy;
    const lastModifiedDate = lastHistoryEntry?.lastModified || lastHistoryEntry?.enteredAt;
    
    return (
      <div className="py-4 px-3">
        {/* Progress Line Background */}
        <div className="relative">
          <div className="absolute top-6 left-8 right-8 h-0.5 bg-slate-200 rounded-full" />
          
          {/* Progress Line Active */}
          <div 
            className="absolute top-6 left-8 h-0.5 bg-indigo-500 rounded-full transition-all duration-500" 
            style={{ 
              width: activeIndex >= 0 ? `calc(${(activeIndex / (DYEHOUSE_STEPS.length - 1)) * 100}% - 32px)` : '0%' 
            }}
          />
          
          <div className="relative flex justify-between items-start">
            {DYEHOUSE_STEPS.map((step, idx) => {
              const Icon = step.icon;
              const isActive = item.dyehouseStatus === step.id;
              const isCompleted = historyMap.has(step.id);
              const isPast = activeIndex > idx;
              
              return (
                <button
                  key={step.id}
                  onClick={() => openStatusDatePicker(item, step.id)}
                  className="flex flex-col items-center group w-14"
                >
                  <div className="relative">
                    <div 
                      className={`
                        w-12 h-12 rounded-full flex items-center justify-center border-2 transition-all duration-300 z-10
                        ${isActive 
                          ? 'bg-white border-indigo-500 text-indigo-600 ring-4 ring-indigo-50 scale-110' 
                          : isCompleted || isPast
                            ? 'bg-indigo-500 border-indigo-500 text-white' 
                            : 'bg-white border-slate-200 text-slate-300 hover:border-slate-300 hover:text-slate-400'
                        }
                      `}
                    >
                      {/* Always show the icon */}
                      <Icon size={20} strokeWidth={1.5} />
                    </div>
                    
                    {/* Small checkmark badge for completed steps */}
                    {(isCompleted || isPast) && !isActive && (
                      <div className="absolute -top-1 -right-1 w-5 h-5 bg-emerald-500 rounded-full flex items-center justify-center border-2 border-white shadow-sm">
                        <Check strokeWidth={3} size={12} className="text-white" />
                      </div>
                    )}
                  </div>
                  
                  <span className={`mt-2 text-[10px] font-semibold text-center leading-tight ${
                    isActive ? 'text-indigo-700' : isCompleted ? 'text-slate-700' : 'text-slate-400'
                  }`}>
                    {step.shortLabel}
                  </span>
                  
                  {historyMap.has(step.id) && (
                    <span className="text-[9px] text-slate-400 font-mono mt-0.5">
                      {formatDate(historyMap.get(step.id)?.date).slice(0, 5)}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
        
        {/* Last Modified By Info */}
        {lastModifiedBy && (
          <div className="mt-2 pt-2 border-t border-slate-100 flex items-center justify-center gap-2 text-[9px] text-slate-400">
            <User size={10} />
            <span>آخر تعديل:</span>
            <span className="font-medium text-slate-500">{lastModifiedBy.split('@')[0]}</span>
            {lastModifiedDate && (
              <>
                <span>•</span>
                <span className="font-mono">{formatDate(lastModifiedDate)}</span>
              </>
            )}
          </div>
        )}
      </div>
    );
  };

  // Mini Machine Queue Component - shows position in machine queue
  const MiniMachineQueue = ({ item }: { item: ActiveWorkItem }) => {
    const queueInfo = getMachineQueueInfo(item);
    const dyeingIndex = DYEHOUSE_STEPS.findIndex(s => s.id === 'DYEING');
    const currentStatusIndex = getStatusIndex(item.dyehouseStatus);
    
    // Show for all items that have queue info (removed dyeing requirement)
    if (!queueInfo) return null;
    
    const { position, total, queue, finishedBefore, stillInQueueBefore, machineKey } = queueInfo;
    const isExpanded = expandedMachineQueue === `${item.id}-${machineKey}`;
    
    return (
      <div className="px-4 py-2 bg-gradient-to-r from-violet-50 to-white border-t border-violet-100">
        {/* Compact View */}
        <button
          onClick={() => setExpandedMachineQueue(isExpanded ? null : `${item.id}-${machineKey}`)}
          className="w-full flex items-center gap-3 group"
        >
          <div className="flex items-center gap-2">
            <Cpu size={14} className="text-violet-500" />
            <span className="text-xs font-medium text-violet-700">الماكينة {item.plannedCapacity}kg</span>
          </div>
          
          {/* Position Badge */}
          <div className="flex items-center gap-1.5 px-2 py-0.5 bg-violet-100 rounded-full">
            <span className="text-sm font-bold text-violet-700">{position}</span>
            <span className="text-violet-400">/</span>
            <span className="text-sm font-medium text-violet-500">{total}</span>
          </div>
          
          {/* Mini Timeline Bar */}
          <div className="flex-1 flex items-center gap-0.5 max-w-[120px]">
            {queue.map((q, idx) => {
              const isCurrent = q.id === item.id;
              const qStatusIndex = getStatusIndex(q.dyehouseStatus);
              const isDone = qStatusIndex > dyeingIndex; // Past DYEING
              
              return (
                <div
                  key={q.id}
                  className={`h-2 flex-1 rounded-full transition-all ${
                    isCurrent 
                      ? 'bg-violet-500 ring-2 ring-violet-300 ring-offset-1' 
                      : isDone 
                        ? 'bg-emerald-400' 
                        : idx < position - 1 
                          ? 'bg-amber-400' 
                          : 'bg-slate-200'
                  }`}
                  title={`${q.clientName} - ${q.color}`}
                />
              );
            })}
          </div>
          
          {/* Status Summary */}
          {stillInQueueBefore > 0 && (
            <span className="text-[10px] text-amber-600 font-medium">
              {stillInQueueBefore} قبلك
            </span>
          )}
          {finishedBefore > 0 && (
            <span className="text-[10px] text-emerald-600 font-medium flex items-center gap-0.5">
              <Check size={10} /> {finishedBefore} خلصوا
            </span>
          )}
          
          {isExpanded ? (
            <ChevronUp size={14} className="text-violet-400" />
          ) : (
            <ChevronDown size={14} className="text-violet-400 group-hover:text-violet-600" />
          )}
        </button>
        
        {/* Expanded Queue List */}
        {isExpanded && (
          <div className="mt-2 pt-2 border-t border-violet-100 space-y-1">
            <div className="text-[10px] text-slate-500 mb-1.5">كل الأصناف على الماكينة:</div>
            {queue.map((q, idx) => {
              const isCurrent = q.id === item.id;
              const qStatusIndex = getStatusIndex(q.dyehouseStatus);
              const isDone = qStatusIndex > dyeingIndex;
              const statusLabel = DYEHOUSE_STEPS.find(s => s.id === q.dyehouseStatus)?.shortLabel || 'بدون';
              
              return (
                <div 
                  key={q.id}
                  className={`flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs ${
                    isCurrent 
                      ? 'bg-violet-100 ring-1 ring-violet-300' 
                      : isDone 
                        ? 'bg-emerald-50' 
                        : 'bg-white'
                  }`}
                >
                  <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${
                    isCurrent 
                      ? 'bg-violet-500 text-white' 
                      : isDone 
                        ? 'bg-emerald-500 text-white' 
                        : 'bg-slate-200 text-slate-600'
                  }`}>
                    {idx + 1}
                  </span>
                  <div 
                    className="w-3 h-3 rounded-full border flex-shrink-0"
                    style={{ 
                      backgroundColor: q.colorHex || '#94a3b8',
                      borderColor: q.colorHex || '#64748b'
                    }}
                  />
                  <span className={`font-medium ${isCurrent ? 'text-violet-700' : 'text-slate-700'}`}>
                    {q.clientName}
                  </span>
                  <span className="text-slate-400">-</span>
                  <span className="text-indigo-600 font-medium">{q.fabricShortName || q.fabric}</span>
                  <span className="text-slate-400">-</span>
                  <span className="text-slate-500">{q.color}</span>
                  <div className="ml-auto flex items-center gap-2">
                    {/* Dates for sorting context */}
                    <div className="flex items-center gap-1 text-[9px]">
                      <span className="text-slate-400">ارسال:</span>
                      <span className="text-slate-500 font-mono">{q.dateSent ? new Date(q.dateSent).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }).replace(' ', '-') : '-'}</span>
                    </div>
                    <div className="flex items-center gap-1 text-[9px]">
                      <span className="text-amber-500">تشكيل:</span>
                      <span className="text-amber-600 font-mono font-medium">{q.formationDate ? new Date(q.formationDate).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }).replace(' ', '-') : '-'}</span>
                    </div>
                    <span className="text-[10px] text-slate-400">{q.quantitySent}kg</span>
                    <span className={`px-1.5 py-0.5 rounded text-[9px] font-medium ${
                      isDone 
                        ? 'bg-emerald-100 text-emerald-700' 
                        : qStatusIndex === dyeingIndex
                          ? 'bg-violet-100 text-violet-700'
                          : 'bg-slate-100 text-slate-600'
                    }`}>
                      {statusLabel}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <RefreshCw className="animate-spin text-indigo-600" size={32} />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-slate-100 -m-6 min-h-[calc(100vh-200px)]">
      {/* Header */}
      <div className="bg-white border-b border-slate-200 px-6 py-4 shadow-sm">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div>
            <h1 className="text-xl font-bold text-slate-800 flex items-center gap-2">
              <Droplets className="text-indigo-600" />
              Dyehouse Active Work
            </h1>
            <p className="text-slate-500 text-sm mt-0.5">وضع جوا المصبغة - Live tracking</p>
          </div>
          
          <div className="flex items-center gap-3">
            {/* Client Filter */}
            <div className="relative">
              <User className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
              <select
                value={selectedClient}
                onChange={(e) => {
                  setSelectedClient(e.target.value);
                  if (e.target.value) {
                    setSelectedDyehouse(''); // Clear dyehouse when client is selected
                  }
                }}
                className={`pl-10 pr-8 py-2 border rounded-lg shadow-sm font-medium appearance-none cursor-pointer min-w-[180px] focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none text-sm ${
                  selectedClient 
                    ? 'bg-indigo-50 border-indigo-300 text-indigo-700' 
                    : 'bg-white border-slate-200 text-slate-700'
                }`}
              >
                <option value="">كل العملاء</option>
                {uniqueClients.map(client => (
                  <option key={client.id} value={client.id}>{client.name}</option>
                ))}
              </select>
              <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" size={16} />
            </div>
            
            {/* Dyehouse Filter */}
            <div className="relative">
              <Factory className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
              <select
                value={selectedDyehouse}
                onChange={(e) => {
                  setSelectedDyehouse(e.target.value);
                  if (e.target.value) {
                    setSelectedClient(''); // Clear client when dyehouse is selected
                  }
                }}
                disabled={!!selectedClient}
                className={`pl-10 pr-8 py-2 border rounded-lg shadow-sm font-medium appearance-none cursor-pointer min-w-[180px] focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none text-sm ${
                  selectedClient 
                    ? 'bg-slate-100 border-slate-200 text-slate-400 cursor-not-allowed' 
                    : 'bg-white border-slate-200 text-slate-700'
                }`}
              >
                <option value="">اختر المصبغة</option>
                {allDyehouses.map(dh => (
                  <option key={dh} value={dh}>{dh}</option>
                ))}
              </select>
              <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" size={16} />
            </div>
          </div>
        </div>
      </div>

      {(selectedDyehouse || selectedClient) ? (
        <>
          {/* Stats */}
          <div className="px-6 py-3 bg-white border-b border-slate-200">
            <div className="flex items-center gap-6">
              <div className="flex items-center gap-2">
                <span className="text-2xl font-bold text-slate-800">{stats.totalItems}</span>
                <span className="text-xs text-slate-500">أصناف</span>
              </div>
              <div className="h-8 w-px bg-slate-200" />
              <div className="flex items-center gap-2">
                <span className="text-2xl font-bold text-indigo-600">{stats.totalQuantity.toLocaleString()}</span>
                <span className="text-xs text-slate-500">كجم</span>
              </div>
              <div className="h-8 w-px bg-slate-200" />
              <div className="flex items-center gap-4 text-sm">
                <span className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-violet-500" />
                  <span className="text-slate-600">{stats.inDyeing} صباغة</span>
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-amber-500" />
                  <span className="text-slate-600">{stats.inFinishing} تجهيز</span>
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-slate-400" />
                  <span className="text-slate-600">{stats.inStore} مخزن</span>
                </span>
              </div>
              
              {/* Delayed Items Alert */}
              {stats.delayed > 0 && (
                <>
                  <div className="h-8 w-px bg-slate-200" />
                  <div className="flex items-center gap-2 px-3 py-1.5 bg-red-50 rounded-lg border border-red-200">
                    <AlertTriangle size={16} className="text-red-600 animate-pulse" />
                    <span className="text-red-700 font-bold">{stats.delayed}</span>
                    <span className="text-red-600 text-sm">تأخير يحتاج متابعة</span>
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Filters */}
          <div className="px-6 py-2 bg-slate-50 border-b border-slate-200 flex items-center gap-3">
            <div className="relative flex-1 max-w-xs">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
              <input
                type="text"
                placeholder="بحث..."
                className="w-full pl-9 pr-4 py-1.5 border border-slate-200 rounded-md outline-none focus:ring-2 focus:ring-indigo-500 text-sm bg-white"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
            
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value as DyehouseStatusType | 'All')}
              className="px-3 py-1.5 border border-slate-200 rounded-md bg-white text-sm outline-none focus:ring-2 focus:ring-indigo-500"
            >
              <option value="All">كل الحالات</option>
              {DYEHOUSE_STEPS.map(step => (
                <option key={step.id} value={step.id}>{step.label}</option>
              ))}
            </select>

            {(statusGroups['UNSET']?.length || 0) > 0 && (
              <span className="flex items-center gap-1.5 px-2 py-1 bg-amber-100 text-amber-700 rounded-md text-xs font-medium">
                <Eye size={12} />
                {statusGroups['UNSET']?.length} بدون وضع
              </span>
            )}
            
            {/* Show selected client indicator */}
            {selectedClient && (
              <div className="flex items-center gap-2 px-3 py-1.5 bg-indigo-100 text-indigo-700 rounded-lg border border-indigo-200">
                <User size={14} />
                <span className="text-sm font-medium">
                  {uniqueClients.find(c => c.id === selectedClient)?.name} - كل المصابغ
                </span>
                <button 
                  onClick={() => setSelectedClient('')}
                  className="p-0.5 hover:bg-indigo-200 rounded transition-colors"
                >
                  <X size={14} />
                </button>
              </div>
            )}
          </div>

          {/* Cards Grid */}
          <div className="flex-1 overflow-y-auto p-4">
            {fabricGroups.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-slate-400">
                <Package size={48} strokeWidth={1} />
                <p className="mt-4 text-lg">
                  {selectedClient ? 'لا توجد أصناف لهذا العميل' : 'لا توجد أصناف في هذه المصبغة'}
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
                {fabricGroups.map(group => {
                  const hasMultipleColors = group.items.length > 1;
                  // Get dyehouse name for this group (when filtering by client)
                  const groupDyehouse = group.items[0]?.dyehouse;
                  
                  return (
                    <div 
                      key={`${group.clientId}-${group.fabric}-${groupDyehouse}`}
                      className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden"
                    >
                      {/* Card Header */}
                      <div className="px-4 py-3 bg-gradient-to-r from-indigo-50 via-white to-white border-b border-slate-100">
                        {/* Show Dyehouse badge when filtering by client */}
                        {selectedClient && groupDyehouse && (
                          <div className="mb-2 flex items-center gap-1.5">
                            <Factory size={12} className="text-slate-400" />
                            <span className="text-xs font-bold text-slate-500 bg-slate-100 px-2 py-0.5 rounded">
                              {groupDyehouse}
                            </span>
                          </div>
                        )}
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            {/* Machine Badge - Prominent */}
                            {group.plannedCapacity && (
                              <div className="bg-indigo-600 text-white px-3 py-1.5 rounded-lg font-bold text-sm shadow-sm">
                                {group.plannedCapacity}kg
                              </div>
                            )}
                            <div>
                              {/* Fabric Name - On Top */}
                              <div className="text-base font-bold text-indigo-900 flex items-center gap-1.5">
                                <Layers size={14} className="text-indigo-500" />
                                {group.fabricShortName}
                              </div>
                              {/* Customer Name - Below */}
                              <div className="text-sm font-bold text-slate-700 flex items-center gap-1 mt-0.5">
                                <User size={12} className="text-slate-500" />
                                {group.clientName}
                              </div>
                            </div>
                          </div>
                          
                          {group.orderReference && (
                            <span className="text-[10px] bg-slate-100 text-slate-600 px-2 py-0.5 rounded font-mono">
                              {group.orderReference}
                            </span>
                          )}
                        </div>

                        {/* Totals Row */}
                        <div className="flex items-center gap-4 mt-3 pt-2 border-t border-slate-100">
                          <div className="flex-1 text-center">
                            <div className="text-lg font-bold text-slate-700">{group.totalSent}</div>
                            <div className="text-[10px] text-slate-400 uppercase tracking-wide">مرسل</div>
                          </div>
                          <div className="flex-1 text-center">
                            <div className="text-lg font-bold text-emerald-600">{group.totalReceived}</div>
                            <div className="text-[10px] text-emerald-500 uppercase tracking-wide">مستلم</div>
                          </div>
                          <div className="flex-1 text-center">
                            <div className="text-lg font-bold text-amber-600">{group.totalRemaining}</div>
                            <div className="text-[10px] text-amber-500 uppercase tracking-wide">متبقي</div>
                          </div>
                        </div>
                      </div>

                      {/* Colors Section */}
                      <div className={`divide-y divide-slate-100 ${hasMultipleColors ? 'bg-slate-50/50' : ''}`}>
                        {group.items.map((item, colorIdx) => {
                          const daysSent = calculateDays(item.dateSent);
                          const daysFormation = calculateDays(item.formationDate);
                          const remaining = item.quantitySent - item.totalReceived;
                          const delayAlert = getDelayAlert(item);
                          
                          return (
                            <div 
                              key={item.id}
                              className={`${updatingItemId === item.id ? 'opacity-50 pointer-events-none' : ''} ${delayAlert.type ? 'ring-2 ring-red-200 ring-inset' : ''}`}
                            >
                              {/* Delay Alert Banner */}
                              {delayAlert.type && (
                                <div className={`px-4 py-2 flex items-center gap-2 text-sm font-semibold ${
                                  delayAlert.type === 'formation' 
                                    ? 'bg-red-50 text-red-700 border-b border-red-200' 
                                    : 'bg-amber-50 text-amber-700 border-b border-amber-200'
                                }`}>
                                  <AlertTriangle size={16} className="animate-pulse" />
                                  <span>{delayAlert.message}</span>
                                  <span className={`ml-auto px-2 py-0.5 rounded text-xs font-bold ${
                                    delayAlert.type === 'formation' ? 'bg-red-200 text-red-800' : 'bg-amber-200 text-amber-800'
                                  }`}>
                                    ⚠️ تأخير
                                  </span>
                                </div>
                              )}

                              {/* Color Header */}
                              <div className="px-4 py-2 flex items-center justify-between bg-white">
                                <div className="flex items-center gap-2">
                                  <div 
                                    className="w-4 h-4 rounded-full border-2 shadow-inner flex-shrink-0"
                                    style={{ 
                                      backgroundColor: item.colorHex || '#94a3b8',
                                      borderColor: item.colorHex || '#64748b'
                                    }}
                                  />
                                  <span className="font-semibold text-slate-700 text-sm">{item.color}</span>
                                  
                                  {item.dispatchNumber && (
                                    <span className="text-[10px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded font-mono">
                                      #{item.dispatchNumber}
                                    </span>
                                  )}
                                </div>
                                
                                <div className="flex items-center gap-3 text-xs">
                                  <span className="text-slate-600 font-medium">{item.quantitySent}</span>
                                  <span className="text-emerald-600 font-medium">{item.totalReceived}</span>
                                  <span className={`font-bold ${remaining > 0 ? 'text-amber-600' : 'text-emerald-600'}`}>
                                    {remaining > 0 ? `-${remaining}` : '✓'}
                                  </span>
                                </div>
                              </div>

                              {/* Dates Row - Days After Send & Days After Formation */}
                              <div className="px-4 py-2 bg-slate-50/70 flex items-center justify-around border-y border-slate-100">
                                {/* Days After Send */}
                                <div className="flex flex-col items-center">
                                  <div className="flex items-center gap-1">
                                    <span className={`text-lg font-bold ${
                                      daysSent !== null && daysSent > 14 ? 'text-red-600' : 
                                      daysSent !== null && daysSent > 7 ? 'text-amber-600' : 'text-slate-700'
                                    }`}>
                                      {daysSent !== null ? daysSent : '-'}
                                    </span>
                                    <span className="text-[10px] text-slate-400">يوم</span>
                                  </div>
                                  <div className="text-[9px] text-slate-400 mt-0.5">
                                    ايام بعد الارسال
                                  </div>
                                  <div className="text-[9px] text-slate-400 font-mono flex items-center gap-1">
                                    <Calendar size={8} />
                                    {item.dateSent ? formatDate(item.dateSent).slice(0, 10) : '-'}
                                  </div>
                                </div>

                                <div className="h-8 w-px bg-slate-200" />

                                {/* Days After Formation */}
                                <div className="flex flex-col items-center">
                                  <div className="flex items-center gap-1">
                                    <span className={`text-lg font-bold ${
                                      daysFormation !== null && daysFormation > 10 ? 'text-orange-600' : 
                                      daysFormation !== null && daysFormation > 5 ? 'text-amber-600' : 'text-slate-700'
                                    }`}>
                                      {daysFormation !== null ? daysFormation : '-'}
                                    </span>
                                    <span className="text-[10px] text-slate-400">يوم</span>
                                  </div>
                                  <div className="text-[9px] text-slate-400 mt-0.5">
                                    ايام بعد التشكيل
                                  </div>
                                  <div className="text-[9px] text-slate-400 font-mono flex items-center gap-1">
                                    <Clock size={8} />
                                    {item.formationDate ? formatDate(item.formationDate).slice(0, 10) : '-'}
                                  </div>
                                </div>
                              </div>

                              {/* Timeline Status */}
                              <TimelineStatus item={item} />
                              
                              {/* Add Partial Button - only in مخزن/صباغة/تجهيز */}
                              {item.dyehouseStatus && ['STORE_RAW', 'DYEING', 'FINISHING'].includes(item.dyehouseStatus) && (
                                <div className="px-4 py-1.5 border-t border-slate-100 flex justify-end">
                                  <button
                                    onClick={() => setPartialModal({ item, quantity: '', note: '' })}
                                    className="flex items-center gap-1 px-2 py-1 text-xs text-slate-400 hover:text-violet-600 hover:bg-violet-50 rounded transition-colors"
                                  >
                                    <FlaskConical size={12} />
                                    <span>جزء تجريبي</span>
                                  </button>
                                </div>
                              )}
                              
                              {/* Partials List - show linked partial batches */}
                              {item.partials && item.partials.length > 0 && (
                                <div className="border-t border-violet-200 bg-violet-50/50">
                                  {item.partials.map((partial, pIdx) => {
                                    const partialHistoryMap = new Map((partial.dyehouseHistory || []).map(h => [h.status, h]));
                                    const partialActiveIndex = getStatusIndex(partial.dyehouseStatus);
                                    
                                    return (
                                      <div key={partial.id} className="relative">
                                        {/* Connecting Line */}
                                        <div className="absolute left-6 -top-2 w-0.5 h-4 bg-violet-300" />
                                        <div className="absolute left-4 top-2 w-4 h-0.5 bg-violet-300" />
                                        
                                        <div className="mx-3 my-2 bg-white rounded-lg border border-violet-200 shadow-sm overflow-hidden">
                                          {/* Partial Header */}
                                          <div className="px-3 py-2 bg-gradient-to-r from-violet-100 to-white flex items-center justify-between">
                                            <div className="flex items-center gap-2">
                                              <Link2 size={14} className="text-violet-500" />
                                              <FlaskConical size={14} className="text-violet-600" />
                                              <span className="text-sm font-bold text-violet-800">{partial.quantity} كجم</span>
                                              <span className="text-xs text-violet-500">جزء تجريبي</span>
                                            </div>
                                            <button
                                              onClick={() => handleDeletePartial(item, partial.id)}
                                              className="p-1 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded transition-colors"
                                              title="حذف"
                                            >
                                              <Trash2 size={14} />
                                            </button>
                                          </div>
                                          
                                          {/* Partial Note */}
                                          {partial.note && (
                                            <div className="px-3 py-1.5 text-xs text-slate-600 bg-slate-50 border-b border-slate-100">
                                              📝 {partial.note}
                                            </div>
                                          )}
                                          
                                          {/* Partial Mini Timeline */}
                                          <div className="px-2 py-3">
                                            <div className="relative">
                                              <div className="absolute top-4 left-4 right-4 h-0.5 bg-slate-200 rounded-full" />
                                              <div 
                                                className="absolute top-4 left-4 h-0.5 bg-violet-500 rounded-full transition-all duration-500"
                                                style={{ 
                                                  width: partialActiveIndex >= 0 ? `calc(${(partialActiveIndex / (DYEHOUSE_STEPS.length - 1)) * 100}% - 16px)` : '0%' 
                                                }}
                                              />
                                              
                                              <div className="relative flex justify-between items-start">
                                                {DYEHOUSE_STEPS.map((step, idx) => {
                                                  const Icon = step.icon;
                                                  const isActive = partial.dyehouseStatus === step.id;
                                                  const isCompleted = partialHistoryMap.has(step.id);
                                                  const isPast = partialActiveIndex > idx;
                                                  
                                                  return (
                                                    <button
                                                      key={step.id}
                                                      onClick={() => openStatusDatePicker(item, step.id, partial.id)}
                                                      className="flex flex-col items-center group w-10"
                                                    >
                                                      <div className="relative">
                                                        <div 
                                                          className={`
                                                            w-8 h-8 rounded-full flex items-center justify-center border-2 transition-all duration-300 z-10
                                                            ${isActive 
                                                              ? 'bg-white border-violet-500 text-violet-600 ring-2 ring-violet-100 scale-110' 
                                                              : isCompleted || isPast
                                                                ? 'bg-violet-500 border-violet-500 text-white' 
                                                                : 'bg-white border-slate-200 text-slate-300 hover:border-slate-300'
                                                            }
                                                          `}
                                                        >
                                                          <Icon size={14} strokeWidth={1.5} />
                                                        </div>
                                                        {(isCompleted || isPast) && !isActive && (
                                                          <div className="absolute -top-0.5 -right-0.5 w-3.5 h-3.5 bg-emerald-500 rounded-full flex items-center justify-center border border-white">
                                                            <Check strokeWidth={3} size={8} className="text-white" />
                                                          </div>
                                                        )}
                                                      </div>
                                                      <span className={`mt-1 text-[8px] font-medium text-center leading-tight ${
                                                        isActive ? 'text-violet-700' : isCompleted ? 'text-slate-600' : 'text-slate-400'
                                                      }`}>
                                                        {step.shortLabel}
                                                      </span>
                                                    </button>
                                                  );
                                                })}
                                              </div>
                                            </div>
                                          </div>
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
                              )}
                              
                              {/* Mini Machine Queue - shows after item enters صباغة */}
                              <MiniMachineQueue item={item} />
                              
                              {/* Notes */}
                              {item.notes && (
                                <div className="px-4 py-1.5 bg-amber-50 text-xs text-amber-700 border-t border-amber-100">
                                  📝 {item.notes}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </>
      ) : (
        <div className="flex-1 flex flex-col items-center justify-center text-slate-400 py-20">
          <Factory size={64} strokeWidth={1} />
          <p className="mt-4 text-xl font-medium">اختر مصبغة للبدء</p>
          <p className="text-sm mt-2">Select a dyehouse to view active work</p>
        </div>
      )}

      {/* Date Picker Modal */}
      {datePickerModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setDatePickerModal(null)}>
          <div 
            className="bg-white rounded-xl shadow-2xl p-6 max-w-sm w-full mx-4"
            onClick={e => e.stopPropagation()}
          >
            <h3 className="text-lg font-bold text-slate-800 mb-1">
              تغيير الحالة إلى: {DYEHOUSE_STEPS.find(s => s.id === datePickerModal.status)?.label}
            </h3>
            <p className="text-sm text-slate-500 mb-4">
              {datePickerModal.item.clientName} - {datePickerModal.item.fabricShortName} - {datePickerModal.item.color}
            </p>
            
            <div className="mb-4">
              <label className="block text-sm font-medium text-slate-700 mb-1">
                تاريخ الحالة
              </label>
              <input
                type="date"
                value={datePickerModal.selectedDate}
                onChange={(e) => setDatePickerModal({...datePickerModal, selectedDate: e.target.value})}
                max={new Date().toISOString().split('T')[0]}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none"
              />
              <p className="text-xs text-slate-400 mt-1">
                اختر التاريخ الفعلي للحالة (يمكنك اختيار تاريخ سابق)
              </p>
            </div>
            
            {/* Quick date buttons */}
            <div className="flex gap-2 mb-4">
              <button
                onClick={() => setDatePickerModal({...datePickerModal, selectedDate: new Date().toISOString().split('T')[0]})}
                className="px-3 py-1.5 text-xs bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg transition-colors"
              >
                اليوم
              </button>
              <button
                onClick={() => {
                  const yesterday = new Date();
                  yesterday.setDate(yesterday.getDate() - 1);
                  setDatePickerModal({...datePickerModal, selectedDate: yesterday.toISOString().split('T')[0]});
                }}
                className="px-3 py-1.5 text-xs bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg transition-colors"
              >
                أمس
              </button>
              <button
                onClick={() => {
                  const twoDaysAgo = new Date();
                  twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);
                  setDatePickerModal({...datePickerModal, selectedDate: twoDaysAgo.toISOString().split('T')[0]});
                }}
                className="px-3 py-1.5 text-xs bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg transition-colors"
              >
                قبل يومين
              </button>
            </div>
            
            <div className="flex gap-3">
              <button
                onClick={() => setDatePickerModal(null)}
                className="flex-1 px-4 py-2 border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50 transition-colors"
              >
                إلغاء
              </button>
              <button
                onClick={() => {
                  if (datePickerModal.partialId) {
                    handlePartialStatusChange(datePickerModal.item, datePickerModal.partialId, datePickerModal.status, datePickerModal.selectedDate);
                  } else {
                    handleStatusChange(datePickerModal.item, datePickerModal.status, datePickerModal.selectedDate);
                  }
                }}
                disabled={updatingItemId !== null}
                className="flex-1 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {updatingItemId ? (
                  <RefreshCw size={16} className="animate-spin" />
                ) : (
                  <>
                    <Check size={16} />
                    تأكيد
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Partial/Test Modal */}
      {partialModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setPartialModal(null)}>
          <div 
            className="bg-white rounded-xl shadow-2xl p-6 max-w-sm w-full mx-4"
            onClick={e => e.stopPropagation()}
          >
            <h3 className="text-lg font-bold text-slate-800 mb-1 flex items-center gap-2">
              <FlaskConical className="text-violet-600" size={20} />
              إضافة جزء تجريبي
            </h3>
            <p className="text-sm text-slate-500 mb-4">
              {partialModal.item.clientName} - {partialModal.item.fabricShortName} - {partialModal.item.color}
            </p>
            
            {/* Available quantity info */}
            <div className="mb-4 p-3 bg-slate-50 rounded-lg">
              <div className="flex justify-between text-sm">
                <span className="text-slate-500">الكمية الكلية:</span>
                <span className="font-bold text-slate-700">{partialModal.item.quantitySent} كجم</span>
              </div>
              <div className="flex justify-between text-sm mt-1">
                <span className="text-slate-500">الأجزاء الموجودة:</span>
                <span className="font-medium text-violet-600">
                  {(partialModal.item.partials || []).reduce((sum, p) => sum + p.quantity, 0)} كجم
                </span>
              </div>
              <div className="flex justify-between text-sm mt-1 pt-1 border-t border-slate-200">
                <span className="text-slate-500">المتبقي للتقسيم:</span>
                <span className="font-bold text-emerald-600">
                  {partialModal.item.quantitySent - (partialModal.item.partials || []).reduce((sum, p) => sum + p.quantity, 0)} كجم
                </span>
              </div>
            </div>
            
            <div className="mb-4">
              <label className="block text-sm font-medium text-slate-700 mb-1">
                الكمية (كجم)
              </label>
              <input
                type="number"
                value={partialModal.quantity}
                onChange={(e) => setPartialModal({...partialModal, quantity: e.target.value})}
                placeholder="مثال: 50"
                className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-violet-500 focus:border-violet-500 outline-none"
              />
            </div>
            
            <div className="mb-4">
              <label className="block text-sm font-medium text-slate-700 mb-1">
                ملاحظة (اختياري)
              </label>
              <input
                type="text"
                value={partialModal.note}
                onChange={(e) => setPartialModal({...partialModal, note: e.target.value})}
                placeholder="مثال: تجربة لون، عينة للعميل..."
                className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-violet-500 focus:border-violet-500 outline-none"
              />
            </div>
            
            <div className="flex gap-3">
              <button
                onClick={() => setPartialModal(null)}
                className="flex-1 px-4 py-2 border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50 transition-colors"
              >
                إلغاء
              </button>
              <button
                onClick={handleAddPartial}
                disabled={updatingItemId !== null || !partialModal.quantity}
                className="flex-1 px-4 py-2 bg-violet-600 text-white rounded-lg hover:bg-violet-700 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {updatingItemId ? (
                  <RefreshCw size={16} className="animate-spin" />
                ) : (
                  <>
                    <Plus size={16} />
                    إضافة
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
