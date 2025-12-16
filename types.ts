import { Timestamp } from 'firebase/firestore';

export interface DemoItem {
  id: string;
  title: string;
  description: string;
  createdAt?: Timestamp;
}

export enum MachineStatus {
  WORKING = 'Working',
  UNDER_OP = 'Under Operation',
  NO_ORDER = 'No Order',
  OUT_OF_SERVICE = 'Out of Service',
  QALB = 'Qalb', // New Status: Changeover
  OTHER = 'Other'
}

export type PlanType = 'PRODUCTION' | 'SETTINGS';

export interface PlanItem {
  type?: PlanType; // 'PRODUCTION' or 'SETTINGS'
  fabric: string;        // الخامة
  productionPerDay: number; // الانتاج كغ/ اليوم
  quantity: number;      // الكمية
  days: number;          // مدة التشغيل باليوم
  startDate?: string;    // تاريخ البدء (Calculated)
  endDate: string;       // تاريخ انتهاء الخام (Calculated)
  remaining: number;     // متبقى
  orderName?: string;    // الطلبية
  client?: string;       // NEW: Client Name
  originalSampleMachine?: string; // New Field: Original Sample Machine
  notes?: string;        // New Field: Notes for Settings/Maintenance
  orderReference?: string; // NEW: Generated reference (e.g., OR-Sj)
  orderId?: string;      // NEW: Link to orders collection
  fabricId?: string;     // NEW: Link to fabrics collection
}

export interface OrderFabric {
  fabricName: string;
  orderReference?: string; // NEW: Unique Reference Code (e.g., ZARA-SJ-001)
  totalQuantity: number;
  remainingQuantity: number;
  assignedMachines: string[];
}

export interface CustomerOrder {
  id?: string;
  customerName: string;
  fabrics: OrderFabric[];
  lastUpdated?: string;
}

export interface DailyLogEntry {
  date: string;
  dayProduction: number;
  scrap: number;
  status: MachineStatus;
  remainingMfg?: number;
  reason?: string;
  fabric?: string;
  client?: string;
  orderReference?: string; // NEW: Linked Order Reference
  orderId?: string;        // NEW: Linked Order ID
  customStatusNote?: string;
  lowStockAlertSent?: boolean; // NEW: Track if alert was sent
}

export interface MachineRow {
  id: number;
  orderIndex?: number; // For custom drag-and-drop ordering
  brand: string;
  type: string;
  machineName: string;
  status: MachineStatus;
  customStatusNote?: string; // Stores text if status is OTHER
  avgProduction: number;
  dayProduction: number;
  remainingMfg: number;
  scrap: number;
  reason: string;
  material: string;
  client: string;
  orderReference?: string; // NEW: Active Order Reference
  futurePlans: PlanItem[];
  dailyLogs?: DailyLogEntry[]; // Array of daily log objects
  lastLogDate?: string; // YYYY-MM-DD: Latest daily log date for quick filtering
  lastLogData?: {       // Cached recent log data for quick access
    date: string;
    dayProduction: number;
    scrap: number;
    status: MachineStatus;
    fabric: string;
    client: string;
    lowStockAlertSent?: boolean; // NEW
  };
}

export interface OrderRow {
  id: string;
  material: string;        // الخامة
  machine: string;         // الماكينة
  requiredQty: number;     // الكمية المطلوبة
  accessory: string;       // الاكسسوار
  manufacturedQty: number; // ما تم تصنيعه
  remainingQty: number;    // المتبقى
  orderReceiptDate: string;// تاريخ استلام الاوردر
  startDate: string;       // بداية
  endDate: string;         // نهاية
  scrapQty: number;        // كمية السقط
  others: string;          // Others
  notes: string;           // ملاحظات
  batchDeliveries: number; // تسليمات الاحواض
  accessoryDeliveries: number; // تسليمات الاكسسوار
  // New fields for enhanced accessory logic
  accessoryType?: string; // 'Rib', 'Derby', etc.
  accessoryPercentage?: number; // 3, 5, etc.
  accessoryQty?: number; // Calculated or manual quantity
}

export interface CustomerSheet {
  id: string;
  name: string;
  orders: OrderRow[];
}

// --- NEW ADVANCED STRUCTURE TYPES ---

export interface DailyLog {
  id?: string;
  date: string; // YYYY-MM-DD
  machineId: number;
  machineName: string;
  status: MachineStatus;
  avgProduction?: number;  // NEW: متوسط الانتاج
  dayProduction: number;
  remainingMfg?: number;   // NEW: المتبقي
  scrap: number;
  reason?: string;         // NEW: السبب
  fabricId?: string;  // NEW: Reference to fabrics
  fabric: string;     // Display name (for backward compatibility)
  clientId?: string;  // NEW: Reference to clients
  client: string;     // Display name (for backward compatibility)
  orderId?: string;   // NEW: Reference to orders
  timestamp: any;     // Firestore Timestamp
}

// --- NEW: Master Data Types ---

export interface Client {
  id?: string;
  clientId: string;
  name: string;
  contact?: string;
  paymentTerms?: string;
  metadata?: Record<string, any>;
}

export interface Fabric {
  id?: string;
  fabricId: string;
  name: string;
  type: string;
  weightGsm?: number;
  yarnComposition?: YarnComponent[];
  metadata?: Record<string, any>;
}

export interface YarnComponent {
  yarnId: string;
  percentage: number;
}

export interface Yarn {
  id?: string;
  yarnId: string;
  name: string;
  supplierId?: string;
  costPerKg?: number;
  metadata?: Record<string, any>;
}

export interface OrderItem {
  fabricId: string;
  quantity: number;
  colorId?: string;
}

export interface Order {
  id?: string;
  orderId: string;
  clientId: string;
  status: 'pending' | 'in-production' | 'completed' | 'cancelled';
  createdDate: string;
  items: OrderItem[];
  metadata?: Record<string, any>;
}

export interface OrderDoc {
  orderId: string;
  client: string;
  fabricType: string;
  quantityTotal: number;
  status: 'active' | 'completed';
  lastUpdated: any;
  assignedMachineIds: number[];
}

export interface FactoryStats {
  date: string;
  totalProduction: number;
  totalScrap: number;
  activeMachinesCount: number;
  lastUpdated: any;
}

// --- NEW MACHINE SCHEMA STRUCTURE (MachineSS) ---

export interface DailyLogEntry {
  date: string; // YYYY-MM-DD
  dayProduction: number;
  avgProduction?: number;  // متوسط الانتاج
  scrap: number;
  fabric: string;
  client: string;
  status: string;
  remainingMfg?: number;   // المتبقي
  reason?: string;         // السبب
  fabricId?: string;
  clientId?: string;
  orderId?: string;
}

export interface FuturePlanEntry {
  type: string;                    // 'PRODUCTION' or 'SETTINGS'
  days: number;                    // Number of days for this plan
  endDate: string;                 // End date (YYYY-MM-DD format)
  fabric: string;                  // Material/fabric type
  notes: string;                   // Notes or comments
  orderName: string;               // Order name/reference
  originalSampleMachine: string;   // Original sample machine reference
  productionPerDay: number;        // Production per day (kg/units)
  quantity: number;                // Total quantity
  remaining: number;               // Remaining quantity
  startDate: string;               // Start date (YYYY-MM-DD format)
  orderId?: string;                // NEW: Link to orders
  fabricId?: string;               // NEW: Link to fabrics
}

export interface MachineSS {
  name: string; // Machine name (static, doesn't change)
  brand: string; // Machine brand (static, doesn't change)
  machineid: number; // Machine ID (static, doesn't change)
  dailyLogs: DailyLogEntry[]; // Array of daily logs
  futurePlans: FuturePlanEntry[]; // Array of future plans
}
