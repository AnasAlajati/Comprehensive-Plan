import { MachineRow, MachineStatus, PlanItem } from '../types';

// Helper to parse fabric names
export const parseFabricName = (fullName: string): { code: string, shortName: string } => {
  if (!fullName) return { code: '', shortName: '' };
  
  let code = '';
  let shortName = fullName;

  // Extract Code [CODE]
  const codeMatch = fullName.match(/^\[(.*?)\]/);
  if (codeMatch) {
    code = codeMatch[1];
    shortName = fullName.replace(codeMatch[0], '').trim();
  }

  // Remove keywords
  // "جاكار " (with space) and "خام"
  const keywordsToRemove = ["جاكار ", "خام"]; 
  keywordsToRemove.forEach(keyword => {
    // Use global flag to remove all occurrences
    shortName = shortName.replace(new RegExp(keyword, 'g'), '').trim();
  });
  
  // Remove empty parentheses ()
  shortName = shortName.replace(/\(\s*\)/g, '').trim();

  // Clean up double spaces
  shortName = shortName.replace(/\s+/g, ' ').trim();

  return { code, shortName };
};

// Helper to generate dates for initial data
export const addDays = (dateStr: string, daysToAdd: number): string => {
  // Be defensive: accept empty/invalid dateStr and invalid daysToAdd
  let date = dateStr ? new Date(dateStr) : new Date();
  if (isNaN(date.getTime())) {
    // fallback to today if invalid input
    date = new Date();
  }

  const days = Number(daysToAdd);
  const add = Number.isFinite(days) ? Math.ceil(days) : 0;

  date.setDate(date.getDate() + add);
  return date.toISOString().split('T')[0];
};

/**
 * Intelligent Scheduling Engine
 * Recalculates start/end dates for a list of plans based on the machine's current status.
 */
export const recalculateSchedule = (plans: PlanItem[], machine: MachineRow): PlanItem[] => {
  const updatedPlans = [...plans];
  
  // 1. Calculate when the CURRENT active work finishes
  // If working, use dayProduction. If 0 (stopped), avoid division by zero (use avgProduction or default 1)
  const dailyRate = machine.dayProduction > 0 ? machine.dayProduction : (machine.avgProduction || 1);
  const remaining = typeof machine.remainingMfg === 'number' && isFinite(machine.remainingMfg) ? machine.remainingMfg : 0;
  const daysLeftForCurrent = remaining > 0 && dailyRate > 0 ? remaining / dailyRate : 0;

  // Start date for the FIRST plan is Today + DaysLeftForCurrent
  let nextStartDate = addDays(new Date().toISOString().split('T')[0], daysLeftForCurrent);

  // 2. Iterate through plans and chain dates
  for (let i = 0; i < updatedPlans.length; i++) {
    const plan = { ...updatedPlans[i] };
    
    // Set Start Date
    plan.startDate = nextStartDate;

    // Calculate Duration (Days) based on Type
    if (plan.type === 'PRODUCTION' || !plan.type) {
       // Auto-calculate days based on Qty / Rate
       const rate = plan.productionPerDay > 0 ? plan.productionPerDay : 1;
       plan.days = Math.ceil(plan.quantity / rate);
    } else {
       // Settings: Duration is manual, ensure it's at least 1
       plan.days = plan.days > 0 ? plan.days : 1;
    }

    // Calculate End Date
    plan.endDate = addDays(plan.startDate, plan.days);
    
    // Update the plan in the array
    updatedPlans[i] = plan;

    // Set cursor for next plan
    nextStartDate = plan.endDate;
  }

  return updatedPlans;
};

const generatePlans = (id: number): PlanItem[] => {
  const today = new Date().toISOString().split('T')[0];
  
  // Generates dummy plan data based on the machine ID
  return [
    {
      type: 'PRODUCTION',
      fabric: 'قطن 100%',
      productionPerDay: 250,
      quantity: 5000,
      days: 20,
      startDate: today,
      endDate: addDays(today, 20),
      remaining: 1200,
      client: 'Zara',
      orderName: 'ORD-2023-001',
      originalSampleMachine: 'M-5',
      notes: ''
    },
    {
      type: 'SETTINGS', // Example of a settings row
      fabric: '',
      productionPerDay: 0,
      quantity: 0,
      days: 2,
      startDate: addDays(today, 20),
      endDate: addDays(today, 22),
      remaining: 0,
      client: '',
      orderName: '',
      originalSampleMachine: '',
      notes: 'Change Settings for Polyester'
    },
    {
      type: 'PRODUCTION',
      fabric: 'بوليستر',
      productionPerDay: 300,
      quantity: 3000,
      days: 10,
      startDate: addDays(today, 22),
      endDate: addDays(today, 32),
      remaining: 3000,
      client: 'H&M',
      orderName: 'ORD-2024-ABC',
      originalSampleMachine: 'M-2',
      notes: ''
    }
  ];
};

export const INITIAL_DATA: MachineRow[] = [
  { id: 1, brand: 'Mayer', type: 'MELTON', machineName: 'ميلتون 1', status: MachineStatus.WORKING, avgProduction: 250, dayProduction: 241.5, remainingMfg: 3050, scrap: 1, reason: 'فضلات', material: 'هيفي براسولا قطن', client: 'OR', futurePlans: generatePlans(1) },
  { id: 2, brand: 'Mayer', type: 'MELTON', machineName: 'ميلتون 2', status: MachineStatus.WORKING, avgProduction: 250, dayProduction: 192.5, remainingMfg: 3260, scrap: 0, reason: '', material: 'هيفي براسولا قطن', client: 'OR', futurePlans: generatePlans(2) },
  { id: 3, brand: 'JUMBERCA', type: 'MELTON', machineName: 'ميلتون 3', status: MachineStatus.WORKING, avgProduction: 140, dayProduction: 146, remainingMfg: 915, scrap: 4, reason: 'فضلات', material: 'سمر ميلتون ضهر دياجونال', client: 'XD', futurePlans: generatePlans(3) },
  { id: 4, brand: 'HUIXING', type: 'MELTON', machineName: 'ميلتون 4', status: MachineStatus.UNDER_OP, avgProduction: 200, dayProduction: 0, remainingMfg: 0, scrap: 0, reason: '', material: '-', client: '-', futurePlans: generatePlans(4) },
  { id: 5, brand: 'Orizio', type: 'DOUBLE', machineName: '30 C', status: MachineStatus.WORKING, avgProduction: 100, dayProduction: 95, remainingMfg: 255, scrap: 0, reason: '', material: 'نيو بوليفر سادة', client: 'LOT', futurePlans: generatePlans(5) },
  { id: 6, brand: 'Orizio', type: 'DOUBLE', machineName: '30 D', status: MachineStatus.WORKING, avgProduction: 150, dayProduction: 139, remainingMfg: 1150, scrap: 1, reason: 'فضلات', material: 'بيكا انترلوك لاكوست', client: 'OR', futurePlans: generatePlans(6) },
  { id: 7, brand: 'Orizio', type: 'DOUBLE', machineName: '34 B', status: MachineStatus.WORKING, avgProduction: 150, dayProduction: 133, remainingMfg: 870, scrap: 1, reason: 'فضلات', material: 'شانيل ريب', client: 'GB', futurePlans: generatePlans(7) },
  { id: 8, brand: 'Mayer', type: 'DOUBLE', machineName: '34 A', status: MachineStatus.WORKING, avgProduction: 110, dayProduction: 100, remainingMfg: 200, scrap: 0, reason: '', material: 'كشمير مسحب بيلر', client: 'ZZ', futurePlans: generatePlans(8) },
  { id: 9, brand: 'JINJANG', type: 'DOUBLE', machineName: '34 D', status: MachineStatus.WORKING, avgProduction: 120, dayProduction: 108, remainingMfg: 1050, scrap: 0, reason: '', material: 'انترلوك مسحب مفرغ', client: 'ZZ', futurePlans: generatePlans(9) },
  { id: 10, brand: 'Terrot', type: 'DOUBLE', machineName: '11 A', status: MachineStatus.WORKING, avgProduction: 300, dayProduction: 21, remainingMfg: 4775, scrap: 0, reason: '', material: 'درى ليكرا قطن', client: 'CO', futurePlans: generatePlans(10) },
  { id: 11, brand: 'Pilotilli', type: 'DOUBLE', machineName: '12 B', status: MachineStatus.UNDER_OP, avgProduction: 200, dayProduction: 0, remainingMfg: 0, scrap: 0, reason: '', material: '-', client: '-', futurePlans: generatePlans(11) },
  { id: 12, brand: 'Keumyong', type: 'SINGLE', machineName: 'JAC 3', status: MachineStatus.WORKING, avgProduction: 150, dayProduction: 147, remainingMfg: 1185, scrap: 0, reason: '', material: 'جاكار ضهر دياجونال', client: 'OR', futurePlans: generatePlans(12) },
  { id: 13, brand: 'Keumyong', type: 'SINGLE', machineName: '34 E', status: MachineStatus.WORKING, avgProduction: 120, dayProduction: 102, remainingMfg: 55, scrap: 0, reason: '', material: 'نيو بوليفر مسحب', client: 'LOT', futurePlans: generatePlans(13) },
  { id: 14, brand: 'Keumyong', type: 'SINGLE', machineName: 'سنجل 28/18', status: MachineStatus.UNDER_OP, avgProduction: 180, dayProduction: 0, remainingMfg: 380, scrap: 0, reason: '', material: 'جاكار بلاتيد عريض', client: 'STG', futurePlans: generatePlans(14) },
  { id: 15, brand: 'Keumyong', type: 'SINGLE', machineName: 'فل جاكار 1', status: MachineStatus.WORKING, avgProduction: 80, dayProduction: 78.5, remainingMfg: 515, scrap: 1, reason: 'فضلات', material: 'جاكار ليكرا سيمنت', client: 'GB', futurePlans: generatePlans(15) },
  { id: 16, brand: 'Keumyong', type: 'SINGLE', machineName: 'فل جاكار 2', status: MachineStatus.WORKING, avgProduction: 100, dayProduction: 86.5, remainingMfg: 1845, scrap: 1, reason: 'فضلات', material: 'جاكار فينتنج', client: 'RA', futurePlans: generatePlans(16) },
  { id: 17, brand: 'Vignoni', type: 'SINGLE', machineName: 'جاكار سنجل (M 8)', status: MachineStatus.UNDER_OP, avgProduction: 170, dayProduction: 0, remainingMfg: 0, scrap: 0, reason: '', material: '-', client: '-', futurePlans: generatePlans(17) },
  { id: 18, brand: 'MAYER', type: 'INTERLOCK', machineName: 'ماير انترلوك (M 9)', status: MachineStatus.UNDER_OP, avgProduction: 150, dayProduction: 0, remainingMfg: 0, scrap: 0, reason: '', material: '-', client: '-', futurePlans: generatePlans(18) },
  { id: 19, brand: 'Marchisio', type: 'INTERLOCK', machineName: 'انترلوك (M 6)', status: MachineStatus.WORKING, avgProduction: 75, dayProduction: 67, remainingMfg: 1200, scrap: 0, reason: '', material: 'انترلوك كريب', client: 'RA', futurePlans: generatePlans(19) },
  { id: 20, brand: 'Pailung', type: 'SINGLE', machineName: '21', status: MachineStatus.WORKING, avgProduction: 120, dayProduction: 97, remainingMfg: 35, scrap: 6, reason: 'اهمال عامل + فضلات', material: 'بيكا نيو لاكوست', client: 'SL', futurePlans: generatePlans(20) },
  { id: 21, brand: 'Pailung', type: 'SINGLE', machineName: '20', status: MachineStatus.NO_ORDER, avgProduction: 130, dayProduction: 0, remainingMfg: 0, scrap: 0, reason: '', material: 'براسولا', client: '-', futurePlans: generatePlans(21) },
  { id: 24, brand: 'Pailung', type: 'SINGLE', machineName: '17 b', status: MachineStatus.NO_ORDER, avgProduction: 120, dayProduction: 0, remainingMfg: 0, scrap: 0, reason: '', material: 'براسولا', client: '-', futurePlans: generatePlans(24) },
  { id: 25, brand: 'Pailung', type: 'SINGLE', machineName: '17 a', status: MachineStatus.OUT_OF_SERVICE, avgProduction: 110, dayProduction: 0, remainingMfg: 0, scrap: 0, reason: '', material: 'براسولا', client: '-', futurePlans: generatePlans(25) },
  { id: 29, brand: 'Tien yang', type: 'SINGLE', machineName: '1', status: MachineStatus.WORKING, avgProduction: 170, dayProduction: 172.5, remainingMfg: 875, scrap: 3, reason: 'فضلات', material: 'مسحب طولى ميني', client: 'ZZ', futurePlans: generatePlans(29) },
  { id: 30, brand: 'Tien yang', type: 'SINGLE', machineName: '2', status: MachineStatus.WORKING, avgProduction: 250, dayProduction: 180, remainingMfg: 600, scrap: 1, reason: 'فضلات', material: 'سمر مطعجة ويقي', client: 'GB', futurePlans: generatePlans(30) },
  { id: 38, brand: 'BOSHYO', type: 'SINGLE', machineName: 'open 5', status: MachineStatus.WORKING, avgProduction: 150, dayProduction: 141, remainingMfg: 160, scrap: 0, reason: '', material: 'سمر ميلتون', client: 'RA', futurePlans: generatePlans(38) },
];