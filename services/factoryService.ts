import { 
  doc, 
  writeBatch, 
  Timestamp, 
  collection 
} from 'firebase/firestore';
import { db } from './firebase';
import { MachineRow, MachineStatus } from '../types';

/**
 * FactoryService
 * Handles the business logic for updating the database.
 * Instead of just updating the 'machines' document, this service
 * distributes the data to 'daily_logs', 'orders', and 'factory_stats'
 * to build a robust history.
 */
export const FactoryService = {

  /**
   * updateMachine
   * Updates a machine and creates historical logs in one atomic operation.
   * @param machine The updated machine object
   * @param reportDate The date for the daily log (default: today)
   */
  updateMachine: async (machine: MachineRow, reportDate?: string) => {
    const batch = writeBatch(db);
    const today = reportDate || new Date().toISOString().split('T')[0];
    const timestamp = Timestamp.now();

    // 1. Update the Main Machine Document (Legacy/UI View)
    // ----------------------------------------------------
    const machineRef = doc(db, 'machines', String(machine.id));
    batch.set(machineRef, machine, { merge: true });

    // 2. Create/Update Daily Log (History)
    // ----------------------------------------------------
    // Path: machines/{machineId}/daily_logs/{date}
    const dailyLogRef = doc(db, `machines/${machine.id}/daily_logs`, today);
    batch.set(dailyLogRef, {
      date: today,
      machineId: machine.id,
      machineName: machine.machineName,
      status: machine.status,
      dayProduction: Number(machine.dayProduction) || 0,
      scrap: Number(machine.scrap) || 0,
      fabric: machine.material || '',
      client: machine.client || '',
      customStatusNote: machine.customStatusNote || '',
      timestamp: timestamp
    }, { merge: true });

    // 3. Upsert Order Document (Order Management)
    // ----------------------------------------------------
    // We create an ID based on Client + Fabric to group similar work
    // Path: orders/{orderId}
    if (machine.client && machine.material && machine.status === MachineStatus.WORKING) {
      // Sanitize ID
      const orderId = `${machine.client.replace(/\s+/g, '_')}_${machine.material.replace(/\s+/g, '_')}`.toUpperCase();
      const orderRef = doc(db, 'orders', orderId);
      
      batch.set(orderRef, {
        orderId: orderId,
        client: machine.client,
        fabricType: machine.material,
        lastUpdated: timestamp,
        // We use arrayUnion logic usually, but here we just merge true to indicate existence
        status: 'active'
      }, { merge: true });
    }

    // 4. Update Factory Stats (Aggregated Data)
    // ----------------------------------------------------
    // Path: factory_stats/{date}
    // Note: Calculating TRUE totals requires reading all docs. 
    // Here we just ensure the document exists so a cloud function can aggregate it later,
    // or we store a simple timestamp showing activity occurred.
    const statsRef = doc(db, 'factory_stats', today);
    batch.set(statsRef, {
      lastUpdated: timestamp,
      // We can't easily increment totalProduction here without reading the previous value safely,
      // so usually this is done via Cloud Functions. For now, we timestamp it.
      active: true
    }, { merge: true });

    // Commit all changes atomically
    await batch.commit();
  },

  /**
   * updateOrderSequence (Drag and Drop in Machine List)
   */
  updateMachineOrder: async (machines: MachineRow[]) => {
    const batch = writeBatch(db);
    machines.forEach((machine, index) => {
      const ref = doc(db, 'machines', String(machine.id));
      batch.update(ref, { orderIndex: index });
    });
    await batch.commit();
  }
};

/**
 * createReportFromMachines
 * Convenience helper: create per-machine daily_logs/{date} documents for a given set of machines.
 * This avoids reading the machines collection again and is useful when the UI already has the machine list.
 */
export const createReportFromMachines = async (date: string, machines: MachineRow[]) => {
  if (!date) throw new Error('date required');
  const commits: Promise<void>[] = [];
  let batch = writeBatch(db);
  let ops = 0;

  machines.forEach((m) => {
    const ref = doc(db, `machines/${m.id}/daily_logs`, date);
    batch.set(ref, {
      date,
      machineId: m.id,
      machineName: m.machineName,
      status: m.status,
      dayProduction: Number(m.dayProduction) || 0,
      scrap: Number(m.scrap) || 0,
      fabric: m.material || '',
      client: m.client || '',
      customStatusNote: m.customStatusNote || '',
      timestamp: Timestamp.now()
    }, { merge: true });

    ops++;
    if (ops >= 450) {
      commits.push(batch.commit());
      batch = writeBatch(db);
      ops = 0;
    }
  });

  commits.push(batch.commit());
  await Promise.all(commits);
};
