import React, { useState, useMemo } from 'react';
import * as XLSX from 'xlsx';
import { Upload, FileUp, AlertCircle, Check, ArrowLeft, Database, Search, Edit2, Info, Loader2 } from 'lucide-react';
import { ImportedScheduleRow } from '../types';

interface DyehouseScheduleImportPageProps {
  onBack: () => void;
  onSaveToFirestore: (data: ImportedScheduleRow[]) => Promise<void>;
}

export const DyehouseScheduleImportPage: React.FC<DyehouseScheduleImportPageProps> = ({ 
  onBack, 
  onSaveToFirestore 
}) => {
  const [file, setFile] = useState<File | null>(null);
  const [parsedRows, setParsedRows] = useState<ImportedScheduleRow[]>([]);
  const [parsing, setParsing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [sheetMachines, setSheetMachines] = useState<Record<string, string[]>>({});
  const [debugLogs, setDebugLogs] = useState<string[]>([]);

  const addLog = (msg: string) => {
      setDebugLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] ${msg}`]);
  };

  const processFile = async (selectedFile: File) => {
    setParsing(true);
    setDebugLogs([]);
    addLog(`INIT: Processing file: ${selectedFile.name}`);

    try {
      const data = await selectedFile.arrayBuffer();
      const workbook = XLSX.read(data, { cellDates: true, cellNF: false, cellText: false });
      
      const allRows: ImportedScheduleRow[] = [];
      const newSheetMachines: Record<string, string[]> = {};

      workbook.SheetNames.forEach(sheetName => {
        const sheet = workbook.Sheets[sheetName];
        if (!sheet['!ref']) return;

        // Convert to array of arrays (Top-Down scan)
        const jsonSheet = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as any[][];
        addLog(`SHEET: ${sheetName} (${jsonSheet.length} rows)`);

        // 1. HEADER DETECTION (Scan first 20 rows)
        let headerRowIdx = -1;
        for (let i = 0; i < Math.min(20, jsonSheet.length); i++) {
            const row = jsonSheet[i];
            if (!row || !Array.isArray(row)) continue;
            
            const hasClient = row.some(c => String(c).trim() === 'العميل' || String(c).toLowerCase().trim() === 'client');
            const hasDispatch = row.some(c => String(c).trim() === 'الرسالة' || String(c).trim() === 'الرساله' || String(c).toLowerCase().trim() === 'dispatch');
            
            if (hasClient || hasDispatch) {
                headerRowIdx = i;
                break;
            }
        }

        if (headerRowIdx === -1) {
            addLog(`WARN: No Header Row found in ${sheetName}. Skipping.`);
            return;
        }

        const headerRow = jsonSheet[headerRowIdx];
        addLog(`HEADER: Found at Row ${headerRowIdx + 1}`);

        // 2. COLUMN MAPPING
        const map: Record<string, number> = {};
        const machineCols: { index: number, name: string }[] = [];
        
        // Define known columns to EXCLUDE from being machines
        const knownKeywords = {
            client: ['العميل', 'client', 'customer'],
            color: ['اللون', 'color', 'col'],
            quantity: ['الكمية', 'الكميه', 'quantity', 'qty', 'kg'], 
            dispatch: ['الرسالة', 'الرساله', 'dispatch', 'id'],
            sentDate: ['التاريخ', 'date', 'sent'],
            formationDate: ['التشكيل', 'formation'],
            item: ['الصنف', 'item', 'fabric', 'design'],
            received: ['المستلم', 'received', 'rec'],
            remaining: ['المتبقي', 'remaining', 'balance'],
            waste: ['نسبة الهالك', 'waste', 'wastage']
        };

        const usedIndices = new Set<number>();

        headerRow.forEach((cell: any, idx: number) => {
            if (!cell) return;
            const val = String(cell).trim().toLowerCase();

            let matched = false;
            for (const [key, keywords] of Object.entries(knownKeywords)) {
                if (keywords.some(k => val === k || val.includes(k))) { 
                     // Specific exclusion: "kg" in quantity might conflict if machine is named "400kg"
                     // If header contains digits (likely machine name like 480) AND isn't strictly "kg" alone
                     if (key === 'quantity' && /\d/.test(val)) continue;
                     
                     map[key] = idx;
                     usedIndices.add(idx);
                     matched = true;
                     break; 
                }
            }
            
            if (!matched) {
                // If not a known column, assume it is a machine
                // Filter out empty or nonsense headers
                if (val.length > 0 && !['total', 'sum', 'avg'].includes(val)) {
                    machineCols.push({ index: idx, name: String(cell).trim() });
                }
            }
        });

        addLog(`MAP: Client:${map.client}, Color:${map.color}, Dispatch:${map.dispatch}`);
        addLog(`MACHINES: ${machineCols.map(m => m.name).join(', ')}`);
        
        newSheetMachines[sheetName] = machineCols.map(m => m.name);

        // 3. ROW PARSING
        let rowCount = 0;
        for (let i = headerRowIdx + 1; i < jsonSheet.length; i++) {
            const row = jsonSheet[i];
            if (!row || row.length === 0) continue;

            const client = row[map.client];
            const color = row[map.color];
            
            // Skip rows without minimal info
            if (!client && !color) continue;

            // Extract Data
            const quantity = Number(row[map.quantity]) || 0;
            const dispatchRaw = row[map.dispatch];
            const dispatchNumber = dispatchRaw ? String(dispatchRaw).trim() : '';

            // 4. FIND MACHINE ASSIGNMENT (The "1" Marker)
            let assignedMachine = '';
            for (const mc of machineCols) {
                const val = row[mc.index];
                if (val == 1 || val === '1' || val === true || String(val).toLowerCase() === 'x') {
                    assignedMachine = mc.name;
                    break; // Assign first found (usually only one)
                }
            }

            // Determine Status
            const received = Number(row[map.received]) || 0;
            let status: ImportedScheduleRow['status'] = 'Draft';

            if (received > 0 && received >= quantity * 0.9) status = 'Received';
            else if (row[map.sentDate]) status = 'Sent';
            else if (assignedMachine) status = 'Pending';
            else if (dispatchNumber) status = 'Draft'; // Has ID but no machine/date?

            allRows.push({
                id: Math.random().toString(36).substr(2, 9),
                dispatchNumber,
                sentDate: parseExcelDate(row[map.sentDate]),
                daysRaw: '',
                formationDate: parseExcelDate(row[map.formationDate]),
                daysFormation: '', 
                fabric: String(row[map.item] || ''),
                color: String(color || ''),
                client: String(client || ''),
                quantity,
                receivedQty: received,
                remainingQty: Number(row[map.remaining]) || 0,
                assignedMachine,
                dyehouseName: sheetName,
                status,
                originalRowIndex: i + 1
            });
            rowCount++;
        }
        addLog(`PARSED: ${rowCount} rows from ${sheetName}`);
      });

      setSheetMachines(newSheetMachines);
      setParsedRows(allRows);

      if (allRows.length === 0) {
          addLog("ERROR: No valid rows extracted.");
      }

    } catch (e: any) {
      console.error(e);
      addLog(`CRITICAL ERROR: ${e.message}`);
    } finally {
      setParsing(false);
    }
  };

  const parseExcelDate = (val: any): string => {
     if (!val) return '';
     if (val instanceof Date) return val.toISOString().split('T')[0];
     // Excel Serial Date
     if (typeof val === 'number') {
         // rough fix for Excel epoch
         const date = new Date(Math.round((val - 25569)*86400*1000));
         return !isNaN(date.getTime()) ? date.toISOString().split('T')[0] : '';
     }
     // String Date
     const d = new Date(val);
     return !isNaN(d.getTime()) ? d.toISOString().split('T')[0] : '';
  };

  const handleSave = async () => {
      setIsSaving(true);
      try {
          await onSaveToFirestore(parsedRows);
      } finally {
          setIsSaving(false);
      }
  };

  // Grouping for Matrix View
  const groupedRows = useMemo(() => {
      const groups: Record<string, ImportedScheduleRow[]> = {};
      parsedRows.forEach(r => {
          if (!groups[r.dyehouseName]) groups[r.dyehouseName] = [];
          groups[r.dyehouseName].push(r);
      });
      return groups;
  }, [parsedRows]);

  return (
    <div className="flex flex-col h-screen bg-slate-50">
      {/* Header */}
      <div className="bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between shadow-sm flex-none">
        <div className="flex items-center gap-4">
            <button onClick={onBack} className="p-2 hover:bg-slate-100 rounded-full text-slate-500">
                <ArrowLeft size={20} />
            </button>
            <div>
                <h1 className="text-xl font-bold text-slate-800 flex items-center gap-2">
                    <Database className="w-5 h-5 text-indigo-600" />
                    New Bulk Import
                </h1>
                <p className="text-xs text-slate-500">Smart Matrix Processing</p>
            </div>
        </div>
        
        {parsedRows.length > 0 && (
            <button 
                onClick={handleSave}
                disabled={isSaving}
                className="px-6 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-bold shadow-sm disabled:opacity-50 flex items-center gap-2"
            >
                {isSaving ? <Loader2 className="animate-spin w-4 h-4"/> : <Check className="w-4 h-4" />}
                Save {parsedRows.length} Updates
            </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        
        {/* Upload Area */}
        {!file && (
            <div className="max-w-xl mx-auto mt-12 bg-white border-2 border-dashed border-slate-300 rounded-xl p-12 text-center hover:bg-slate-50 transition-colors cursor-pointer"
                onDragOver={e => e.preventDefault()}
                onDrop={e => {
                    e.preventDefault();
                    if(e.dataTransfer.files[0]) {
                        setFile(e.dataTransfer.files[0]);
                        processFile(e.dataTransfer.files[0]);
                    }
                }}
            >
                <Upload className="w-16 h-16 text-indigo-400 mx-auto mb-4" />
                <h3 className="text-xl font-bold text-slate-700 mb-2">Drag & Drop Dyehouse Schedule</h3>
                <p className="text-slate-500 mb-6">Supports .xlsx with multiple sheets</p>
                <label className="inline-block px-6 py-2 bg-indigo-600 text-white rounded-lg cursor-pointer hover:bg-indigo-700 font-medium">
                    Browse Files
                    <input type="file" className="hidden" accept=".xlsx" onChange={e => e.target.files?.[0] && (setFile(e.target.files[0]), processFile(e.target.files[0]))} />
                </label>
            </div>
        )}

        {/* Processing State */}
        {parsing && (
            <div className="text-center mt-20">
                <Loader2 className="w-12 h-12 text-indigo-600 animate-spin mx-auto mb-4" />
                <h3 className="text-lg font-medium text-slate-600">Analyzing Excel Matrix...</h3>
                <p className="text-sm text-slate-400">Detecting headers, machines, and status updates</p>
            </div>
        )}

        {/* Results Viewer */}
        {!parsing && file && (
            <div className="space-y-6">
                
                {/* Stats Header */}
                <div className="bg-white p-4 rounded-lg border border-slate-200 shadow-sm flex items-center justify-between">
                    <div>
                        <span className="text-sm font-bold text-slate-500 uppercase tracking-wider">File</span>
                        <p className="font-mono text-slate-800">{file.name}</p>
                    </div>
                    <div className="flex gap-8">
                        <div className="text-center">
                            <span className="block text-2xl font-bold text-indigo-600">{parsedRows.length}</span>
                            <span className="text-xs text-slate-500">Rows Found</span>
                        </div>
                        <div className="text-center">
                            <span className="block text-2xl font-bold text-emerald-600">{parsedRows.filter(r => r.status === 'Received').length}</span>
                            <span className="text-xs text-slate-500">Received</span>
                        </div>
                         <div className="text-center">
                            <span className="block text-2xl font-bold text-slate-600">{Object.keys(groupedRows).length}</span>
                            <span className="text-xs text-slate-500">Dyehouses</span>
                        </div>
                    </div>
                    <button 
                        onClick={() => { setFile(null); setParsedRows([]); setDebugLogs([]); }}
                        className="text-sm text-red-600 hover:text-red-700 font-medium"
                    >
                        Reset / New File
                    </button>
                </div>

                {/* Error / No Data State */}
                {parsedRows.length === 0 && (
                    <div className="bg-red-50 border border-red-100 rounded-lg p-6">
                         <div className="flex items-center gap-3 mb-4">
                             <AlertCircle className="text-red-600" />
                             <h3 className="text-red-800 font-bold">No Valid Data Found</h3>
                         </div>
                         <div className="bg-slate-900 rounded-lg p-4 font-mono text-xs text-slate-300 max-h-64 overflow-y-auto">
                             {debugLogs.map((l, i) => <div key={i}>{l}</div>)}
                         </div>
                    </div>
                )}

                {/* Data Tables (Matrix Preview) */}
                {Object.keys(groupedRows).sort().map(dh => (
                    <div key={dh} className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                        <div className="bg-slate-50 px-6 py-3 border-b border-slate-200 flex justify-between items-center">
                            <h3 className="font-bold text-slate-700">{dh}</h3>
                            <span className="text-xs bg-white border border-slate-200 px-2 py-1 rounded text-slate-500">
                                {groupedRows[dh].length} Batches
                            </span>
                        </div>
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm text-left">
                                <thead className="bg-slate-50 text-slate-500 font-medium text-xs uppercase">
                                    <tr>
                                        <th className="px-4 py-2 w-32">Machine</th>
                                        <th className="px-4 py-2 w-32">Dispatch</th>
                                        <th className="px-4 py-2">Client / Color</th>
                                        <th className="px-4 py-2 w-24 text-right">Qty</th>
                                        <th className="px-4 py-2 w-24">Status</th>
                                        <th className="px-4 py-2 w-32 text-right">Sent Date</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100">
                                    {groupedRows[dh].map((row, idx) => (
                                        <tr key={idx} className="hover:bg-slate-50">
                                            <td className="px-4 py-2 font-mono font-bold text-indigo-600">
                                                {row.assignedMachine || <span className="text-slate-300">-</span>}
                                            </td>
                                            <td className="px-4 py-2 font-mono text-slate-600">
                                                {row.dispatchNumber || <span className="text-amner-500 text-xs italic">Auto-Gen</span>}
                                            </td>
                                            <td className="px-4 py-2">
                                                <div className="font-medium text-slate-800">{row.client}</div>
                                                <div className="text-slate-500 text-xs">{row.fabric} - {row.color}</div>
                                            </td>
                                            <td className="px-4 py-2 text-right font-mono">
                                                {row.quantity}
                                                {row.receivedQty > 0 && (
                                                    <div className="text-xs text-emerald-600">Rec: {row.receivedQty}</div>
                                                )}
                                            </td>
                                            <td className="px-4 py-2">
                                                 <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                                                     row.status === 'Received' ? 'bg-emerald-100 text-emerald-800' :
                                                     row.status === 'Sent' ? 'bg-blue-100 text-blue-800' :
                                                     row.status === 'Pending' ? 'bg-indigo-100 text-indigo-800' : 'bg-slate-100 text-slate-700'
                                                 }`}>
                                                     {row.status}
                                                 </span>
                                            </td>
                                            <td className="px-4 py-2 text-right font-mono text-xs text-slate-500">
                                                {row.sentDate || '-'}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                ))}

            </div>
        )}
      </div>
    </div>
  );
};
