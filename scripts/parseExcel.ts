import * as XLSX from 'xlsx';
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, doc, setDoc } from 'firebase/firestore';
import * as fs from 'fs';
import * as path from 'path';

// Firebase config (use your existing config)
const firebaseConfig = {
  // Add your firebase config here
};

interface ParsedMachine {
  id: number;
  name: string;
  brand: string;
  type: string;
  status: string;
  avgProduction: number;
  dayProduction: number;
  fabric: string;
  client: string;
  remainingMfg: number;
  scrap: number;
  reason: string;
  date: string;
}

function parseExcelFile(filePath: string): ParsedMachine[] {
  // Read the Excel file
  const workbook = XLSX.readFile(filePath);
  const sheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];
  
  // Convert to JSON
  const data: any[] = XLSX.utils.sheet_to_json(worksheet);
  
  console.log('\n📊 RAW EXCEL DATA:');
  console.log(JSON.stringify(data, null, 2));
  
  const machines: ParsedMachine[] = [];
  
  data.forEach((row, index) => {
    // Parse each row - adjust column names based on your Excel file
    const machine: ParsedMachine = {
      id: row['ID'] || row['م'] || index + 1,
      brand: row['الماركة'] || row['Brand'] || '',
      type: row['النوع'] || row['Type'] || '',
      name: row['اسم الماكينة'] || row['Machine Name'] || '',
      status: row['الحالة'] || row['Status'] || 'Working',
      avgProduction: Number(row['متوسط'] || row['Avg Production'] || 0),
      dayProduction: Number(row['انتاج'] || row['Day Production'] || 0),
      fabric: row['الخامة'] || row['Fabric'] || '',
      client: row['العميل'] || row['Client'] || '',
      remainingMfg: Number(row['المتبقي'] || row['Remaining'] || 0),
      scrap: Number(row['السقط'] || row['Scrap'] || 0),
      reason: row['السبب'] || row['Reason'] || '',
      date: row['Date'] || new Date().toISOString().split('T')[0]
    };
    
    machines.push(machine);
  });
  
  return machines;
}

function convertToFirestoreFormat(machines: ParsedMachine[]) {
  // Group by machine ID
  const machineGroups = new Map<number, ParsedMachine[]>();
  
  machines.forEach(machine => {
    if (!machineGroups.has(machine.id)) {
      machineGroups.set(machine.id, []);
    }
    machineGroups.get(machine.id)!.push(machine);
  });
  
  // Convert to Firestore format
  const firestoreData: any[] = [];
  
  machineGroups.forEach((logs, machineId) => {
    const firstLog = logs[0];
    
    const machineDoc = {
      id: machineId.toString(),
      name: firstLog.name,
      brand: firstLog.brand,
      type: firstLog.type,
      status: firstLog.status,
      avgProduction: firstLog.avgProduction,
      dailyLogs: logs.map((log, idx) => ({
        id: `log-${machineId}-${idx}`,
        date: log.date,
        dayProduction: log.dayProduction,
        scrap: log.scrap,
        status: log.status,
        fabric: log.fabric,
        client: log.client,
        avgProduction: log.avgProduction,
        remainingMfg: log.remainingMfg,
        reason: log.reason,
        timestamp: new Date().toISOString()
      })),
      lastLogDate: logs[logs.length - 1].date,
      lastLogData: {
        date: logs[logs.length - 1].date,
        dayProduction: logs[logs.length - 1].dayProduction,
        scrap: logs[logs.length - 1].scrap,
        status: logs[logs.length - 1].status,
        fabric: logs[logs.length - 1].fabric,
        client: logs[logs.length - 1].client
      },
      lastUpdated: new Date().toISOString(),
      futurePlans: []
    };
    
    firestoreData.push(machineDoc);
  });
  
  return firestoreData;
}

async function uploadToFirestore(data: any[]) {
  const app = initializeApp(firebaseConfig);
  const db = getFirestore(app);
  
  console.log('\n🔥 Uploading to Firestore...\n');
  
  for (const machine of data) {
    try {
      await setDoc(doc(db, 'MachineSS', machine.id), machine);
      console.log(`✅ Uploaded machine ${machine.id}: ${machine.name}`);
    } catch (error) {
      console.error(`❌ Failed to upload machine ${machine.id}:`, error);
    }
  }
  
  console.log('\n✅ Upload complete!');
}

// Main execution
const excelFilePath = process.argv[2];

if (!excelFilePath) {
  console.error('❌ Please provide the Excel file path');
  console.log('Usage: ts-node parseExcel.ts <path-to-excel-file>');
  process.exit(1);
}

if (!fs.existsSync(excelFilePath)) {
  console.error(`❌ File not found: ${excelFilePath}`);
  process.exit(1);
}

console.log('📂 Reading Excel file:', excelFilePath);

const parsedMachines = parseExcelFile(excelFilePath);

console.log('\n✨ PARSED MACHINES:');
console.log(JSON.stringify(parsedMachines, null, 2));

const firestoreData = convertToFirestoreFormat(parsedMachines);

console.log('\n🔥 FIRESTORE FORMAT:');
console.log(JSON.stringify(firestoreData, null, 2));

// Ask for confirmation before uploading
console.log('\n⚠️  Review the data above. To upload to Firestore, uncomment the upload line below.');
// uploadToFirestore(firestoreData);
