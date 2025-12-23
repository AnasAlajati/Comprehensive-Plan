import {
  collection,
  doc,
  setDoc,
  addDoc,
  getDocs,
  getDoc,
  query,
  where,
  Timestamp
} from 'firebase/firestore';
import { db } from './firebase';
import {
  Client,
  Fabric,
  Yarn,
  Order,
  CustomerOrder,
  OrderFabric,
  DailyLog,
  PlanItem,
  MachineRow,
  FabricDefinition
} from '../types';

export const DataService = {
  async getMachinesFromMachineSS(): Promise<any[]> {
    const snapshot = await getDocs(collection(db, 'MachineSS'));
    return snapshot.docs.map(doc => ({
      ...doc.data(),
      id: doc.id,
      firestoreId: doc.id
    }));
  },

  async updateMachineInMachineSS(machineId: string, updates: any): Promise<void> {
    const cleanUpdates = JSON.parse(JSON.stringify(updates));
    await setDoc(doc(db, 'MachineSS', machineId), cleanUpdates, { merge: true });
  },

  async getMachines(): Promise<MachineRow[]> {
    const snapshot = await getDocs(collection(db, 'machines'));
    return snapshot.docs.map(doc => ({ ...(doc.data() as MachineRow), id: Number(doc.id) }));
  },

  async getClients(): Promise<Client[]> {
    const snapshot = await getDocs(collection(db, 'CustomerSheets'));
    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Client));
  },

  async getFabrics(): Promise<FabricDefinition[]> {
    const snapshot = await getDocs(collection(db, 'FabricSS'));
    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as FabricDefinition));
  },

  async getYarns(): Promise<Yarn[]> {
    const snapshot = await getDocs(collection(db, 'yarns'));
    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Yarn));
  },

  async getOrders(): Promise<Order[]> {
    const snapshot = await getDocs(collection(db, 'orders'));
    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Order));
  },

  async getScrapReasons(): Promise<{ id: string; name: string }[]> {
    const snapshot = await getDocs(collection(db, 'scrap_reasons'));
    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as { id: string; name: string }));
  },

  async getDyehouses(): Promise<{ id: string; name: string }[]> {
    const snapshot = await getDocs(collection(db, 'dyehouses'));
    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as { id: string; name: string }));
  },

  async addDyehouse(name: string): Promise<string> {
    const docRef = await addDoc(collection(db, 'dyehouses'), {
      name,
      createdAt: Timestamp.now()
    });
    return docRef.id;
  },

  async addFabric(fabric: Omit<Fabric, 'id'>): Promise<string> {
    const docRef = await addDoc(collection(db, 'fabrics'), {
      ...fabric,
      createdAt: Timestamp.now()
    });
    return docRef.id;
  },



  async addClient(client: Omit<Client, 'id'>): Promise<string> {
    const docRef = await addDoc(collection(db, 'clients'), {
      ...client,
      createdAt: Timestamp.now()
    });
    return docRef.id;
  },

  async addYarn(yarn: Omit<Yarn, 'id'>): Promise<string> {
    const docRef = await addDoc(collection(db, 'yarns'), {
      ...yarn,
      createdAt: Timestamp.now()
    });
    return docRef.id;
  },

  async addOrder(order: Omit<Order, 'id'>): Promise<string> {
    const docRef = await addDoc(collection(db, 'orders'), {
      ...order,
      createdAt: Timestamp.now()
    }); v 
    return docRef.id;
  },

  async addScrapReason(name: string): Promise<string> {
    const docRef = await addDoc(collection(db, 'scrap_reasons'), {
      name,
      createdAt: Timestamp.now()
    });
    return docRef.id;
  },

  async addMachineToMachineSS(machine: any): Promise<string> {
    // If machine has an ID, use it as the doc ID, otherwise auto-generate
    const machineId = machine.id ? String(machine.id) : String(Date.now());
    await setDoc(doc(db, 'MachineSS', machineId), {
      ...machine,
      id: machineId,
      lastUpdated: new Date().toISOString()
    });
    return machineId;
  },

  async addFuturePlan(machineId: string, plan: PlanItem): Promise<void> {
    const machineRef = doc(db, 'MachineSS', machineId);
    const machineSnap = await getDoc(machineRef);
    
    if (machineSnap.exists()) {
      const machineData = machineSnap.data();
      const currentPlans = machineData.futurePlans || [];
      const updatedPlans = [...currentPlans, plan];
      
      await setDoc(machineRef, { 
        futurePlans: updatedPlans,
        lastUpdated: new Date().toISOString()
      }, { merge: true });
    } else {
      throw new Error(`Machine ${machineId} not found`);
    }
  },

  async addDailyLog(
    machineId: string, 
    logData: Partial<DailyLog>, 
    clientId?: string, 
    fabricId?: string, 
    orderId?: string
  ): Promise<string> {
    const machineRef = doc(db, 'MachineSS', machineId);
    const machineSnap = await getDoc(machineRef);
    
    if (!machineSnap.exists()) {
      throw new Error(`Machine ${machineId} not found`);
    }

    const machineData = machineSnap.data();
    const currentLogs = machineData.dailyLogs || [];
    
    // Check if log for this date already exists
    const existingLogIndex = currentLogs.findIndex((l: any) => l.date === logData.date);
    
    const newLog = {
      id: logData.date || new Date().toISOString().split('T')[0],
      ...logData,
      timestamp: new Date().toISOString()
    };

    let updatedLogs;
    if (existingLogIndex >= 0) {
      // Update existing log
      updatedLogs = [...currentLogs];
      updatedLogs[existingLogIndex] = { ...updatedLogs[existingLogIndex], ...newLog };
    } else {
      // Add new log
      updatedLogs = [...currentLogs, newLog];
    }

    // Update machine with new logs and update lastLogData if it's the latest log
    const updates: any = {
      dailyLogs: updatedLogs,
      lastUpdated: new Date().toISOString()
    };

    // If this log is for today or newer than last log, update current status
    if (!machineData.lastLogDate || newLog.date >= machineData.lastLogDate) {
      updates.lastLogDate = newLog.date;
      updates.lastLogData = {
        date: newLog.date,
        dayProduction: newLog.dayProduction || 0,
        scrap: newLog.scrap || 0,
        status: newLog.status,
        fabric: newLog.fabric || '',
        client: newLog.client || ''
      };
      // Also update top-level fields for backward compatibility/easy access
      updates.status = newLog.status;
      updates.dayProduction = newLog.dayProduction;
    }

    await setDoc(machineRef, updates, { merge: true });
    return newLog.id;
  },

  async updateClient(clientId: string, updates: Partial<Client>): Promise<void> {
    const docRef = doc(db, 'clients', clientId);
    await setDoc(docRef, { ...updates, lastUpdated: Timestamp.now() }, { merge: true });
  },

  async updateFabric(fabricId: string, updates: Partial<Fabric>): Promise<void> {
    const docRef = doc(db, 'fabrics', fabricId);
    await setDoc(docRef, { ...updates, lastUpdated: Timestamp.now() }, { merge: true });
  },

  async updateYarn(yarnId: string, updates: Partial<Yarn>): Promise<void> {
    const docRef = doc(db, 'yarns', yarnId);
    await setDoc(docRef, { ...updates, lastUpdated: Timestamp.now() }, { merge: true });
  },

  async updateOrder(orderId: string, updates: Partial<Order>): Promise<void> {
    const docRef = doc(db, 'orders', orderId);
    await setDoc(docRef, { ...updates, lastUpdated: Timestamp.now() }, { merge: true });
  },

  async getDailySummary(date: string): Promise<{ externalProduction: number } | null> {
    const docRef = doc(db, 'DailySummaries', date);
    const docSnap = await getDoc(docRef);
    if (docSnap.exists()) {
      return docSnap.data() as { externalProduction: number };
    }
    return null;
  },

  async updateDailySummary(date: string, data: { externalProduction: number }): Promise<void> {
    await setDoc(doc(db, 'DailySummaries', date), data, { merge: true });
  },

  // --- OrderSS Methods ---

  async getCustomerOrders(): Promise<CustomerOrder[]> {
    const snapshot = await getDocs(collection(db, 'OrderSS'));
    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as CustomerOrder));
  },

  async ensureCustomerOrder(customerName: string): Promise<void> {
    const docRef = doc(db, 'OrderSS', customerName);
    const snapshot = await getDoc(docRef);
    if (!snapshot.exists()) {
      await setDoc(docRef, {
        customerName,
        fabrics: [],
        lastUpdated: new Date().toISOString()
      });
    }
  },

  async updateOrderAllocations(orderId: string, fabricName: string, allocations: any[]): Promise<void> {
    const docRef = doc(db, 'OrderSS', orderId);
    const snapshot = await getDoc(docRef);
    
    if (snapshot.exists()) {
      const data = snapshot.data() as CustomerOrder;
      const updatedFabrics = data.fabrics.map(f => {
        if (f.fabricName === fabricName) {
          return { ...f, allocations };
        }
        return f;
      });
      
      await setDoc(docRef, { fabrics: updatedFabrics, lastUpdated: new Date().toISOString() }, { merge: true });
    }
  },
  
  async addFabricToOrder(customerName: string, fabricName: string, initialQuantity: number = 0): Promise<void> {
    const docRef = doc(db, 'OrderSS', customerName);
    const snapshot = await getDoc(docRef);
    
    if (snapshot.exists()) {
      const data = snapshot.data() as CustomerOrder;
      const exists = data.fabrics.some(f => f.fabricName === fabricName);
      
      if (!exists) {
        // Generate Unique Reference: [Client]-[Fabric]-[Random 3 chars]
        const clientCode = customerName.substring(0, 3).toUpperCase();
        const fabricCode = fabricName.split(/[\s-]+/).map(w => w[0]).join('').substring(0, 3).toUpperCase();
        const uniqueSuffix = Math.floor(100 + Math.random() * 900); // 3 digit random
        const orderReference = `${clientCode}-${fabricCode}-${uniqueSuffix}`;

        const newFabric: OrderFabric = {
          fabricName,
          orderReference,
          totalQuantity: initialQuantity,
          remainingQuantity: initialQuantity,
          assignedMachines: []
        };
        const updatedFabrics = [...data.fabrics, newFabric];
        await setDoc(docRef, { fabrics: updatedFabrics, lastUpdated: new Date().toISOString() }, { merge: true });
      }
    } else {
      // Create new if doesn't exist
      const clientCode = customerName.substring(0, 3).toUpperCase();
      const fabricCode = fabricName.split(/[\s-]+/).map(w => w[0]).join('').substring(0, 3).toUpperCase();
      const uniqueSuffix = Math.floor(100 + Math.random() * 900);
      const orderReference = `${clientCode}-${fabricCode}-${uniqueSuffix}`;

      await setDoc(docRef, {
        customerName,
        fabrics: [{
          fabricName,
          orderReference,
          totalQuantity: initialQuantity,
          remainingQuantity: initialQuantity,
          assignedMachines: []
        }],
        lastUpdated: new Date().toISOString()
      });
    }
  },
  
  async updateOrderFabric(customerName: string, fabricName: string, updates: Partial<OrderFabric>): Promise<void> {
     const docRef = doc(db, 'OrderSS', customerName);
     const snapshot = await getDoc(docRef);
     
     if (snapshot.exists()) {
        const data = snapshot.data() as CustomerOrder;
        const updatedFabrics = data.fabrics.map(f => {
           if (f.fabricName === fabricName) {
              return { ...f, ...updates };
           }
           return f;
        });
        await setDoc(docRef, { fabrics: updatedFabrics, lastUpdated: new Date().toISOString() }, { merge: true });
     }
  },

  async findOrderReference(customerName: string, fabricName: string): Promise<string | null> {
    try {
      const docRef = doc(db, 'OrderSS', customerName);
      const snapshot = await getDoc(docRef);
      
      if (snapshot.exists()) {
        const data = snapshot.data() as CustomerOrder;
        const fabric = data.fabrics.find(f => f.fabricName === fabricName);
        return fabric?.orderReference || null;
      }
      return null;
    } catch (error) {
      console.error("Error finding order reference:", error);
      return null;
    }
  },

  async updateGlobalSettings(settings: any): Promise<void> {
    await setDoc(doc(db, 'settings', 'global'), settings, { merge: true });
  }
};
