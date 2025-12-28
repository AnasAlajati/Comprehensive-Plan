import React, { useState, useEffect, useMemo } from 'react';
import * as XLSX from 'xlsx';
import { collection, getDocs, writeBatch, doc, query, where, setDoc } from 'firebase/firestore';
import { db } from '../services/firebase';
import { parseFabricName } from '../services/data';
import { FabricDefinition, FabricYarn, FabricVariant } from '../types';
import { FabricFormModal } from './FabricFormModal';
import { Upload, Save, CheckCircle, AlertCircle, Loader2, FileSpreadsheet, Database, Plus, Edit, X, Copy, Link as LinkIcon, Trash2, Sparkles, Search } from 'lucide-react';

// Helper to normalize machine type
const getMachineCategory = (type: string = '') => {
  const t = type.toLowerCase();
  if (t.includes('single') || t.includes('jersey') || t.includes('fleece')) return 'Single Jersey';
  if (t.includes('double') || t.includes('rib') || t.includes('interlock')) return 'Double Jersey';
  return 'Other';
};

export const FabricsPage: React.FC = () => {
  const [parsedFabrics, setParsedFabrics] = useState<FabricDefinition[]>([]);
  const [existingFabrics, setExistingFabrics] = useState<FabricDefinition[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [activeTab, setActiveTab] = useState<'preview' | 'database' | 'mapping'>('preview');
  
  // Mapping State
  const [machines, setMachines] = useState<any[]>([]);
  const [uniqueWorkCenters, setUniqueWorkCenters] = useState<string[]>([]);

  // Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingFabric, setEditingFabric] = useState<FabricDefinition | null>(null);
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => {
    fetchExistingFabrics();
    fetchMachines();
  }, []);

  useEffect(() => {
    if (activeTab === 'mapping') {
      extractWorkCenters();
    }
  }, [activeTab, existingFabrics]);

  const filteredAndSortedFabrics = useMemo(() => {
    let result = existingFabrics;

    // Filter
    if (searchTerm) {
      const lower = searchTerm.toLowerCase();
      result = result.filter(f => 
        f.name.toLowerCase().includes(lower) || 
        (f.code && f.code.toLowerCase().includes(lower)) ||
        (f.shortName && f.shortName.toLowerCase().includes(lower))
      );
    }

    // Sort: Incomplete first (no variants)
    return result.sort((a, b) => {
      const aIncomplete = !a.variants || a.variants.length === 0;
      const bIncomplete = !b.variants || b.variants.length === 0;

      if (aIncomplete && !bIncomplete) return -1;
      if (!aIncomplete && bIncomplete) return 1;
      return a.name.localeCompare(b.name);
    });
  }, [existingFabrics, searchTerm]);

  const fetchMachines = async () => {
    try {
      const snapshot = await getDocs(collection(db, 'MachineSS'));
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setMachines(data);
    } catch (err) {
      console.error("Error fetching machines:", err);
    }
  };

  const extractWorkCenters = () => {
    const wcSet = new Set<string>();
    existingFabrics.forEach(f => {
      if (f.workCenters) {
        f.workCenters.forEach(wc => wcSet.add(wc));
      }
    });
    setUniqueWorkCenters(Array.from(wcSet).sort());
  };

  const handleLinkWorkCenter = async (oldWc: string, newMachineName: string) => {
    if (!confirm(`Are you sure you want to replace "${oldWc}" with "${newMachineName}" in ALL fabrics?`)) return;
    
    setSaving(true);
    try {
      const batch = writeBatch(db);
      let count = 0;
      
      existingFabrics.forEach(fabric => {
        if (fabric.workCenters && fabric.workCenters.includes(oldWc)) {
          const newWCs = fabric.workCenters.filter(w => w !== oldWc);
          if (!newWCs.includes(newMachineName)) {
            newWCs.push(newMachineName);
          }
          
          const docRef = doc(db, 'FabricSS', fabric.id!);
          batch.update(docRef, { workCenters: newWCs });
          count++;
        }
      });

      if (count > 0) {
        await batch.commit();
        setSuccess(`Updated ${count} fabrics. Linked "${oldWc}" to "${newMachineName}".`);
        fetchExistingFabrics(); // Refresh
      } else {
        setSuccess('No fabrics needed updating.');
      }
    } catch (err) {
      console.error("Error linking work center:", err);
      setError("Failed to link work center.");
    } finally {
      setSaving(false);
    }
  };

  const handleOpenModal = (fabric?: FabricDefinition) => {
    if (fabric) {
      setEditingFabric(fabric);
    } else {
      setEditingFabric(null);
    }
    setIsModalOpen(true);
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
    setEditingFabric(null);
  };

  const handleCleanAllShortNames = async () => {
    setSaving(true);
    try {
      const batchSize = 500;
      let batch = writeBatch(db);
      let count = 0;
      let totalUpdated = 0;
      
      for (const fabric of existingFabrics) {
        if (fabric.name) {
          const { shortName } = parseFabricName(fabric.name);
          
          // Update if changed
          if (shortName !== fabric.shortName) {
            const docRef = doc(db, 'FabricSS', fabric.id!);
            batch.update(docRef, { shortName });
            count++;
            totalUpdated++;
          }

          if (count >= batchSize) {
            await batch.commit();
            batch = writeBatch(db);
            count = 0;
          }
        }
      }

      if (count > 0) {
        await batch.commit();
      }

      setSuccess(`Updated ${totalUpdated} fabrics.`);
      fetchExistingFabrics();
    } catch (err) {
      console.error("Error cleaning names:", err);
      setError("Failed to clean names.");
    } finally {
      setSaving(false);
    }
  };

  const handleSaveFabric = async (formData: Partial<FabricDefinition>) => {
    if (!formData.name) return;

    setSaving(true);
    try {
      const docId = editingFabric?.id || formData.name.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
      
      // Auto-calculate specs based on work centers
      const workCenterList = formData.workCenters || [];
      let specs = undefined;
      
      if (workCenterList.length > 0) {
        // Find all machines linked to these work centers
        const linkedMachines = machines.filter(m => workCenterList.includes(m.machineName || m.name));
        
        if (linkedMachines.length > 0) {
          // Check if they are all in the same group (Type + Gauge)
          // And ideally same SubGroup (Dia + Needles) for "Tier 1" DNA
          // For now, we take the first machine as the "DNA Source" if they are compatible
          // Or we can store the "Group DNA"
          
          const firstM = linkedMachines[0];
          specs = {
            gauge: firstM.gauge || 'Unknown',
            diameter: firstM.dia || 'Unknown',
            needles: Number(firstM.needles) || 0,
            type: firstM.type || 'Unknown'
          };
        }
      }

      const fabricData: FabricDefinition = {
        id: docId,
        name: formData.name,
        code: formData.code,
        shortName: formData.shortName,
        workCenters: workCenterList,
        variants: formData.variants,
        specs: specs
      };

      await setDoc(doc(db, 'FabricSS', docId), fabricData, { merge: true });
      
      setSuccess(editingFabric ? 'Fabric updated successfully' : 'Fabric added successfully');
      handleCloseModal();
      fetchExistingFabrics();
    } catch (err) {
      console.error("Error saving fabric:", err);
      setError("Failed to save fabric");
    } finally {
      setSaving(false);
    }
  };

  const fetchExistingFabrics = async () => {
    try {
      const q = query(collection(db, 'FabricSS'));
      const snapshot = await getDocs(q);
      const fabrics: FabricDefinition[] = [];
      snapshot.forEach(doc => {
        fabrics.push({ id: doc.id, ...doc.data() } as FabricDefinition);
      });
      setExistingFabrics(fabrics);
    } catch (err) {
      console.error("Error fetching fabrics:", err);
    }
  };

  const formatCompositionValue = (val: any): number => {
    if (!val) return 0;
    if (typeof val === 'number') {
      // Heuristic for Composition: if <= 1, assume decimal fraction (0.75 = 75%).
      return val <= 1 ? parseFloat((val * 100).toFixed(2)) : parseFloat(val.toFixed(2));
    }
    if (typeof val === 'string') {
      return parseFloat(val.replace('%', '').trim());
    }
    return 0;
  };

  const formatScrapValue = (val: any): number => {
    if (!val) return 0;
    if (typeof val === 'number') {
      // For Scrap, assume the value IS the percentage (0.3 = 0.3%, 1.3 = 1.3%).
      // Do NOT multiply by 100 even if small.
      return parseFloat(val.toFixed(2));
    }
    if (typeof val === 'string') {
      return parseFloat(val.replace('%', '').trim());
    }
    return 0;
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setLoading(true);
    setError('');
    setSuccess('');
    setParsedFabrics([]);

    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const bstr = evt.target?.result;
        const workbook = XLSX.read(bstr, { type: 'binary' });
        const wsname = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[wsname];
        const data = XLSX.utils.sheet_to_json(worksheet, { header: 1 }) as any[][];

        // Row 0 is header, start from 1
        const fabricMap = new Map<string, FabricDefinition>();
        
        let currentFabricName = '';
        let currentYarns: FabricYarn[] = [];

        // Helper to finalize a variant
        const finalizeVariant = (fabricName: string, yarns: FabricYarn[]) => {
          if (!fabricName || yarns.length === 0) return;
          
          const fabric = fabricMap.get(fabricName);
          if (!fabric) return;

          // Check if this variant already exists (same yarns and percentages)
          const variantExists = fabric.variants.some(v => {
            if (v.yarns.length !== yarns.length) return false;
            // Simple check: every yarn in new variant must exist in old variant with same %
            return yarns.every(ny => 
              v.yarns.some(oy => oy.name === ny.name && oy.percentage === ny.percentage)
            );
          });

          if (!variantExists) {
            fabric.variants.push({
              id: `v${fabric.variants.length + 1}`,
              yarns: [...yarns] // Clone
            });
          }
        };

        for (let i = 1; i < data.length; i++) {
          const row = data[i];
          // If row is totally empty, skip
          if (!row || row.length === 0) continue;

          const productName = row[0] ? String(row[0]).trim() : '';
          const yarnName = row[1] ? String(row[1]).trim() : '';
          const yarnPercentage = row[2];
          const yarnScrap = row[3];
          const workCenter = row[4] ? String(row[4]).trim() : '';

          // New Block Start (New Product Name)
          if (productName) {
            // 1. Finalize previous variant if exists
            if (currentFabricName && currentYarns.length > 0) {
               finalizeVariant(currentFabricName, currentYarns);
            }

            // 2. Start New Context
            currentFabricName = productName;
            currentYarns = [];

            // 3. Ensure Fabric Entry Exists
            if (!fabricMap.has(currentFabricName)) {
              const { code, shortName } = parseFabricName(currentFabricName);
              fabricMap.set(currentFabricName, {
                name: currentFabricName,
                code,
                shortName,
                workCenters: [],
                variants: []
              });
            }

            // 4. Add Work Center (if unique)
            const fabric = fabricMap.get(currentFabricName)!;
            if (workCenter && !fabric.workCenters.includes(workCenter)) {
              fabric.workCenters.push(workCenter);
            }

            // 5. Add First Yarn of this variant
            if (yarnName) {
              currentYarns.push({
                name: yarnName,
                percentage: formatCompositionValue(yarnPercentage),
                scrapPercentage: formatScrapValue(yarnScrap)
              });
            }

          } else {
            // Continuation Row (Empty Product Name)
            // Add yarn to current variant
            if (yarnName) {
              currentYarns.push({
                name: yarnName,
                percentage: formatCompositionValue(yarnPercentage),
                scrapPercentage: formatScrapValue(yarnScrap)
              });
            }
          }
        }

        // Finalize the very last variant after loop
        if (currentFabricName && currentYarns.length > 0) {
          finalizeVariant(currentFabricName, currentYarns);
        }

        setParsedFabrics(Array.from(fabricMap.values()));
        setSuccess(`Successfully parsed ${fabricMap.size} fabrics from Excel.`);
      } catch (err) {
        console.error("Error parsing Excel:", err);
        setError("Failed to parse Excel file. Please check the format.");
      } finally {
        setLoading(false);
      }
    };
    reader.readAsBinaryString(file);
  };

  const handleSaveToFirebase = async () => {
    if (parsedFabrics.length === 0) return;
    
    setSaving(true);
    setError('');
    setSuccess('');

    try {
      const batchSize = 500;
      let batch = writeBatch(db);
      let count = 0;
      let totalBatches = 0;

      for (const fabric of parsedFabrics) {
        // Use name as ID or auto-generate? 
        // Using name as ID ensures uniqueness and easy lookup, but need to sanitize.
        // Let's use auto-ID but query by name to update if exists?
        // Or just overwrite based on name?
        // User said: "if Single Jersey appears again... it puts as duplicate".
        // The parsing logic handled the duplicates within the file.
        // For Firestore, we should probably overwrite/merge if it exists.
        // For simplicity and efficiency, let's create new docs or overwrite by ID if we generate a consistent ID.
        // Let's generate a consistent ID from the name to avoid duplicates in DB.
        const docId = fabric.name.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
        const docRef = doc(db, 'FabricSS', docId);
        
        // Sanitize fabric object to remove undefined values
        const cleanFabric = JSON.parse(JSON.stringify({
          ...fabric,
          code: fabric.code || '',
          shortName: fabric.shortName || fabric.name
        }));
        batch.set(docRef, cleanFabric, { merge: true });
        count++;

        if (count >= batchSize) {
          await batch.commit();
          batch = writeBatch(db);
          count = 0;
          totalBatches++;
        }
      }

      if (count > 0) {
        await batch.commit();
      }

      setSuccess(`Successfully saved ${parsedFabrics.length} fabrics to Firestore!`);
      setParsedFabrics([]);
      fetchExistingFabrics();
    } catch (err) {
      console.error("Error saving to Firestore:", err);
      setError("Failed to save data to Firestore.");
    } finally {
      setSaving(false);
    }
  };



  const getFabricDNA = (workCenters: string[]) => {
    if (!workCenters || workCenters.length === 0) return { status: 'No Machines', groups: [] };
    
    const linkedMachines = machines.filter(m => workCenters.includes(m.machineName || m.name));
    if (linkedMachines.length === 0) return { status: 'No Machines', groups: [] };

    // Group by Type + Gauge
    const groupsMap = new Map<string, {
      id: string;
      type: string;
      gauge: string;
      brands: Set<string>;
      machines: any[];
    }>();

    linkedMachines.forEach(m => {
      const key = `${m.type}-${m.gauge}`;
      if (!groupsMap.has(key)) {
        groupsMap.set(key, {
          id: key,
          type: m.type,
          gauge: m.gauge,
          brands: new Set(),
          machines: []
        });
      }
      const group = groupsMap.get(key)!;
      group.machines.push(m);
      if (m.brand) group.brands.add(m.brand);
    });

    const groups = Array.from(groupsMap.values()).map(g => {
      const brandList = Array.from(g.brands);
      const brandName = brandList.length > 0 ? brandList.join(' & ') : 'Unknown Brand';
      const name = `${brandName} Group`;
      return {
        ...g,
        name,
        brandList
      };
    });

    // Check for conflicting types (Single vs Double)
    const categories = new Set(linkedMachines.map(m => getMachineCategory(m.type)));
    if (categories.has('Single Jersey') && categories.has('Double Jersey')) {
      return { status: 'Conflicting Types', groups };
    }

    if (groups.length > 1) {
      return { status: 'Multiple Groups', groups };
    }

    // Single Group Logic
    const group = groups[0];
    const subGroups = new Set(group.machines.map(m => `${m.dia}-${m.needles}`));
    
    const firstM = group.machines[0];
    const dna = {
      gauge: firstM.gauge,
      dia: firstM.dia,
      needles: firstM.needles,
      type: firstM.type
    };

    return { 
      status: subGroups.size === 1 ? 'Tier 1' : 'Tier 2', 
      groups: [group],
      dna,
      variants: subGroups.size
    };
  };

  return (
    <div className="min-h-screen bg-slate-50 p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        
        {/* Header */}
        <div className="flex justify-between items-center bg-white p-4 rounded-xl shadow-sm border border-slate-200">
          <div>
            <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
              <FileSpreadsheet className="text-green-600" />
              Fabric Import & Management
            </h1>
            <p className="text-slate-500 text-sm mt-1">Import fabrics, yarns, and work centers from Excel</p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => handleOpenModal()}
              className="px-4 py-2 rounded-lg text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 transition-colors flex items-center gap-2"
            >
              <Plus size={16} />
              Add Fabric
            </button>
            <button
              onClick={handleCleanAllShortNames}
              disabled={saving}
              className="px-4 py-2 rounded-lg text-sm font-medium text-amber-700 bg-amber-50 hover:bg-amber-100 border border-amber-200 transition-colors"
            >
              {saving ? 'Updating...' : 'Update Names'}
            </button>
            <button
              onClick={() => setActiveTab('preview')}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                activeTab === 'preview' 
                  ? 'bg-blue-100 text-blue-700' 
                  : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              Import Preview
            </button>
            <button
              onClick={() => setActiveTab('database')}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                activeTab === 'database' 
                  ? 'bg-blue-100 text-blue-700' 
                  : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              Database ({existingFabrics.length})
            </button>
            <button
              onClick={() => setActiveTab('mapping')}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                activeTab === 'mapping' 
                  ? 'bg-purple-100 text-purple-700' 
                  : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              <div className="flex items-center gap-2">
                <LinkIcon size={16} />
                Map Work Centers
              </div>
            </button>
          </div>
        </div>

        {/* Messages */}
        {error && (
          <div className="bg-red-50 text-red-700 p-4 rounded-lg flex items-center gap-2 border border-red-200">
            <AlertCircle size={20} />
            {error}
          </div>
        )}
        {success && (
          <div className="bg-green-50 text-green-700 p-4 rounded-lg flex items-center gap-2 border border-green-200">
            <CheckCircle size={20} />
            {success}
          </div>
        )}

        {/* Content */}
        {activeTab === 'preview' && (
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
            <div className="p-6 border-b border-slate-200 bg-slate-50/50 flex justify-between items-center">
              <div className="flex items-center gap-4">
                <label className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-300 rounded-lg cursor-pointer hover:bg-slate-50 transition-colors shadow-sm">
                  <Upload size={18} className="text-slate-500" />
                  <span className="text-sm font-medium text-slate-700">Select Excel File</span>
                  <input type="file" accept=".xlsx, .xls" onChange={handleFileUpload} className="hidden" />
                </label>
                {loading && <span className="text-sm text-slate-500 flex items-center gap-2"><Loader2 className="animate-spin" size={16}/> Parsing...</span>}
              </div>
              
              {parsedFabrics.length > 0 && (
                <button
                  onClick={handleSaveToFirebase}
                  disabled={saving}
                  className="flex items-center gap-2 px-6 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg font-bold shadow-sm transition-colors disabled:opacity-50"
                >
                  {saving ? <Loader2 className="animate-spin" size={18} /> : <Save size={18} />}
                  {saving ? 'Saving...' : 'Save to Firebase'}
                </button>
              )}
            </div>

            {parsedFabrics.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm text-left">
                  <thead className="bg-slate-50 text-slate-700 font-bold uppercase text-xs">
                    <tr>
                      <th className="p-4 border-b border-slate-200">Code</th>
                      <th className="p-4 border-b border-slate-200">Short Name</th>
                      <th className="p-4 border-b border-slate-200">Work Centers</th>
                      <th className="p-4 border-b border-slate-200">Yarn Composition</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {parsedFabrics.map((fabric, idx) => (
                      <tr key={idx} className="hover:bg-slate-50 transition-colors">
                        <td className="p-4 font-medium text-slate-600 align-top text-xs whitespace-nowrap">{fabric.code}</td>
                        <td className="p-4 font-medium text-slate-800 align-top" title={fabric.name}>
                          {fabric.shortName || fabric.name}
                        </td>
                        <td className="p-4 align-top">
                          <div className="flex flex-wrap gap-1">
                            {(fabric.workCenters || []).map((wc, i) => (
                              <span key={i} className="px-2 py-1 bg-blue-50 text-blue-700 rounded text-xs font-medium border border-blue-100">
                                {wc}
                              </span>
                            ))}
                            {(!fabric.workCenters || fabric.workCenters.length === 0) && <span className="text-slate-400 italic">None</span>}
                          </div>
                        </td>
                        <td className="p-4 align-top">
                          <div className="space-y-3">
                            {(fabric.variants || []).map((variant, vIdx) => (
                              <div key={vIdx} className="bg-slate-50 p-2 rounded border border-slate-100">
                                <div className="text-[10px] font-bold text-slate-400 mb-1 uppercase tracking-wider">Variant {vIdx + 1}</div>
                                {variant.yarns.map((yarn, i) => (
                                  <div key={i} className="flex items-center gap-2 text-xs mb-1 last:mb-0">
                                    <span className="font-medium text-slate-700 w-48 truncate" title={yarn.name}>{yarn.name}</span>
                                    <span className="px-1.5 py-0.5 bg-emerald-50 text-emerald-700 rounded border border-emerald-100">
                                      {yarn.percentage}%
                                    </span>
                                    <span className="text-slate-400 text-[10px]">
                                      (Scrap: {yarn.scrapPercentage}%)
                                    </span>
                                  </div>
                                ))}
                              </div>
                            ))}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="p-12 text-center text-slate-400">
                <FileSpreadsheet size={48} className="mx-auto mb-4 opacity-20" />
                <p>Upload an Excel file to preview fabrics</p>
              </div>
            )}
          </div>
        )}

        {activeTab === 'database' && (
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
            <div className="p-6 border-b border-slate-100 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
              <div>
                <h2 className="text-lg font-bold text-slate-800">Fabric Database</h2>
                <p className="text-slate-500 text-sm mt-1">Manage existing fabric definitions and compositions.</p>
              </div>
              <div className="relative w-full sm:w-64">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input 
                  type="text" 
                  placeholder="Search fabrics..." 
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full pl-10 pr-4 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>
            
            {existingFabrics.length === 0 ? (
              <div className="p-12 text-center text-slate-500">
                <Database size={48} className="mx-auto mb-4 text-slate-300" />
                <p>No fabrics in database yet.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="bg-slate-50 border-b border-slate-100">
                    <tr>
                      <th className="p-4 font-semibold text-slate-600 w-1/3">Fabric Details</th>
                      <th className="p-4 font-semibold text-slate-600">DNA Analysis</th>
                      <th className="p-4 font-semibold text-slate-600">Work Centers</th>
                      <th className="p-4 font-semibold text-slate-600">Composition</th>
                      <th className="p-4 font-semibold text-slate-600 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredAndSortedFabrics.map((fabric) => {
                      const isIncomplete = !fabric.variants || fabric.variants.length === 0;
                      return (
                        <tr key={fabric.id} className={`group hover:bg-slate-50 transition-colors ${isIncomplete ? 'bg-red-50/30' : ''}`}>
                          <td className="p-4 align-top">
                            <div className="font-bold text-slate-800 text-base mb-1 flex items-start gap-2">
                              {fabric.name}
                              {isIncomplete && (
                                <span className="px-2 py-0.5 bg-red-100 text-red-700 rounded text-[10px] font-bold border border-red-200 flex items-center gap-1 whitespace-nowrap mt-0.5">
                                  <AlertCircle size={10} />
                                  Incomplete Data
                                </span>
                              )}
                            </div>
                            <div className="flex flex-wrap gap-2 text-xs text-slate-500">
                              {fabric.code && (
                                <span className="px-1.5 py-0.5 bg-slate-100 rounded border border-slate-200">
                                  Code: {fabric.code}
                                </span>
                              )}
                              {fabric.shortName && (
                                <span className="px-1.5 py-0.5 bg-slate-100 rounded border border-slate-200">
                                  Short: {fabric.shortName}
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="p-4 align-top">
                            {(() => {
                              const { status, groups, dna, variants } = getFabricDNA(fabric.workCenters || []);
                              
                              if (status === 'No Machines') return <span className="text-slate-400 text-xs italic">No Linked Machines</span>;
                              
                              if (status === 'Multiple Groups') {
                                return (
                                  <div className="space-y-2">
                                    {groups.map(g => (
                                      <div key={g.id} className="bg-slate-50 p-1.5 rounded border border-slate-200">
                                        <div className="text-[10px] font-bold text-slate-700">{g.name}</div>
                                        <div className="text-[10px] text-slate-500">{g.gauge}G {g.type}</div>
                                      </div>
                                    ))}
                                  </div>
                                );
                              }

                              if (status === 'Conflicting Types') {
                                return (
                                  <div className="space-y-2">
                                    <div className="px-2 py-1 bg-red-100 text-red-700 rounded text-xs font-bold border border-red-200 flex items-center gap-1">
                                      <AlertCircle size={12} />
                                      Conflicting Types
                                    </div>
                                    {groups.map(g => (
                                      <div key={g.id} className="bg-red-50 p-1.5 rounded border border-red-100 opacity-75">
                                        <div className="text-[10px] font-bold text-red-800">{g.name}</div>
                                        <div className="text-[10px] text-red-600">{g.gauge}G {g.type}</div>
                                      </div>
                                    ))}
                                  </div>
                                );
                              }

                              return (
                                <div className="space-y-1">
                                  <div className="text-xs font-medium text-slate-700">
                                    {dna?.gauge}G / {dna?.dia}" / {dna?.needles}N
                                  </div>
                                  <div className="flex gap-1">
                                    {status === 'Tier 1' && (
                                      <span className="px-1.5 py-0.5 bg-green-100 text-green-700 rounded text-[10px] font-bold border border-green-200">
                                        Tier 1 (Exact)
                                      </span>
                                    )}
                                    {status === 'Tier 2' && (
                                      <span className="px-1.5 py-0.5 bg-amber-100 text-amber-700 rounded text-[10px] font-bold border border-amber-200">
                                        Tier 2 ({variants} Versions)
                                      </span>
                                    )}
                                  </div>
                                  <div className="text-[10px] text-slate-400">{groups[0].name}</div>
                                </div>
                              );
                            })()}
                          </td>
                          <td className="p-4 align-top">
                            <div className="flex flex-wrap gap-1">
                              {(fabric.workCenters || []).map((wc, i) => (
                                <span key={i} className="px-2 py-1 bg-blue-50 text-blue-700 rounded text-xs font-medium border border-blue-100">
                                  {wc}
                                </span>
                              ))}
                            </div>
                          </td>
                          <td className="p-4 align-top">
                            <div className="space-y-3">
                              {(fabric.variants || []).map((variant, vIdx) => (
                                <div key={vIdx} className="bg-slate-50 p-2 rounded border border-slate-100">
                                  <div className="text-[10px] font-bold text-slate-400 mb-1 uppercase tracking-wider">Variant {vIdx + 1}</div>
                                  {variant.yarns.map((yarn, i) => (
                                    <div key={i} className="flex items-center gap-2 text-xs mb-1 last:mb-0">
                                      <span className="font-medium text-slate-700 w-48 truncate" title={yarn.name}>{yarn.name}</span>
                                      <span className="px-1.5 py-0.5 bg-emerald-50 text-emerald-700 rounded border border-emerald-100">
                                        {yarn.percentage}%
                                      </span>
                                      <span className="text-slate-400 text-[10px]">
                                        (Scrap: {yarn.scrapPercentage}%)
                                      </span>
                                    </div>
                                  ))}
                                </div>
                              ))}
                            </div>
                          </td>
                          <td className="p-4 align-top text-right">
                            <button 
                              onClick={() => handleOpenModal(fabric)}
                              className="p-2 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors opacity-0 group-hover:opacity-100"
                            >
                              <Edit size={16} />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {activeTab === 'mapping' && (
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
            <div className="p-6 border-b border-slate-100">
              <h2 className="text-lg font-bold text-slate-800">Work Center Mapping</h2>
              <p className="text-slate-500 text-sm mt-1">
                Link abstract "Work Centers" from imported data to actual Machines in the system.
                Changing a mapping here will update ALL fabrics that use that Work Center.
              </p>
            </div>
            
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-50 border-b border-slate-100">
                  <tr>
                    <th className="p-4 font-semibold text-slate-600">Work Center Name</th>
                    <th className="p-4 font-semibold text-slate-600">Mapped Machine</th>
                    <th className="p-4 font-semibold text-slate-600">Usage Count</th>
                    <th className="p-4 font-semibold text-slate-600 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {uniqueWorkCenters.map((wc, idx) => {
                    // Check if this WC matches a known machine name exactly
                    const exactMatch = machines.find(m => m.name === wc);
                    const usageCount = existingFabrics.filter(f => f.workCenters?.includes(wc)).length;

                    return (
                      <tr key={idx} className="hover:bg-slate-50 transition-colors">
                        <td className="p-4 font-medium text-slate-800">
                          {wc}
                          {exactMatch && (
                            <span className="ml-2 px-2 py-0.5 bg-green-100 text-green-700 rounded-full text-xs">
                              Linked
                            </span>
                          )}
                        </td>
                        <td className="p-4">
                          <select
                            className="p-2 border border-slate-200 rounded-lg text-sm bg-white focus:ring-2 focus:ring-purple-500 outline-none w-64"
                            value={exactMatch ? exactMatch.name : ""}
                            onChange={(e) => {
                              if (e.target.value) {
                                handleLinkWorkCenter(wc, e.target.value);
                              }
                            }}
                          >
                            <option value="">-- Select Machine --</option>
                            {machines.map(m => (
                              <option key={m.id} value={m.name}>
                                {m.name} ({m.type})
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="p-4 text-slate-500">
                          Used in {usageCount} fabrics
                        </td>
                        <td className="p-4 text-right">
                          {/* Actions if needed */}
                        </td>
                      </tr>
                    );
                  })}
                  {uniqueWorkCenters.length === 0 && (
                    <tr>
                      <td colSpan={4} className="p-8 text-center text-slate-500">
                        No Work Centers found in existing fabrics.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* Add/Edit Modal */}
      <FabricFormModal
        isOpen={isModalOpen}
        onClose={handleCloseModal}
        onSave={handleSaveFabric}
        initialData={editingFabric || undefined}
        machines={machines}
      />

    </div>
  );
};
