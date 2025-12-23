import React, { useState, useEffect } from 'react';
import * as XLSX from 'xlsx';
import { collection, getDocs, writeBatch, doc, query, where, setDoc } from 'firebase/firestore';
import { db } from '../services/firebase';
import { parseFabricName } from '../services/data';
import { FabricDefinition, FabricYarn, FabricVariant } from '../types';
import { Upload, Save, CheckCircle, AlertCircle, Loader2, FileSpreadsheet, Database, Plus, Edit, X, Copy, Link as LinkIcon, Trash2 } from 'lucide-react';

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
  const [modalForm, setModalForm] = useState<{
    name: string;
    code: string;
    shortName: string;
    workCenters: string; // Comma separated
    variants: FabricVariant[];
  }>({ name: '', code: '', shortName: '', workCenters: '', variants: [] });

  useEffect(() => {
    fetchExistingFabrics();
  }, []);

  useEffect(() => {
    if (activeTab === 'mapping') {
      fetchMachines();
      extractWorkCenters();
    }
  }, [activeTab, existingFabrics]);

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
      setModalForm({
        name: fabric.name,
        code: fabric.code || '',
        shortName: fabric.shortName || '',
        workCenters: (fabric.workCenters || []).join(', '),
        variants: fabric.variants ? JSON.parse(JSON.stringify(fabric.variants)) : []
      });
    } else {
      setEditingFabric(null);
      setModalForm({ name: '', code: '', shortName: '', workCenters: '', variants: [] });
    }
    setIsModalOpen(true);
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
    setEditingFabric(null);
  };

  const handleOdooPaste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        const { code, shortName } = parseFabricName(text);
        setModalForm(prev => ({
          ...prev,
          name: text,
          code,
          shortName
        }));
      }
    } catch (err) {
      console.error("Failed to read clipboard:", err);
      // Fallback: prompt user
      const text = prompt("Paste ODOO Name here:");
      if (text) {
        const { code, shortName } = parseFabricName(text);
        setModalForm(prev => ({
          ...prev,
          name: text,
          code,
          shortName
        }));
      }
    }
  };

  const handleSaveFabric = async () => {
    if (!modalForm.name) return;

    setSaving(true);
    try {
      const docId = editingFabric?.id || modalForm.name.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
      const fabricData: FabricDefinition = {
        id: docId,
        name: modalForm.name,
        code: modalForm.code,
        shortName: modalForm.shortName,
        workCenters: modalForm.workCenters.split(',').map(s => s.trim()).filter(Boolean),
        variants: modalForm.variants
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

  const formatPercentage = (val: any): number => {
    if (!val) return 0;
    if (typeof val === 'number') {
      // If it's a decimal like 0.75, convert to 75. If it's 75, keep it.
      // Heuristic: if <= 1, assume decimal.
      return val <= 1 ? parseFloat((val * 100).toFixed(2)) : parseFloat(val.toFixed(2));
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
        let currentWorkCenter = '';
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
            currentWorkCenter = workCenter;
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
                percentage: formatPercentage(yarnPercentage),
                scrapPercentage: formatPercentage(yarnScrap)
              });
            }

          } else {
            // Continuation Row (Empty Product Name)
            // Add yarn to current variant
            if (yarnName) {
              currentYarns.push({
                name: yarnName,
                percentage: formatPercentage(yarnPercentage),
                scrapPercentage: formatPercentage(yarnScrap)
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

  const handleMigration = async () => {
    if (existingFabrics.length === 0) return;
    setSaving(true);
    setSuccess('');
    setError('');
    
    try {
      const batchSize = 500;
      let batch = writeBatch(db);
      let count = 0;
      let totalUpdated = 0;

      for (const fabric of existingFabrics) {
        const { code, shortName } = parseFabricName(fabric.name);
        
        // Only update if changes are needed
        if (fabric.code !== code || fabric.shortName !== shortName) {
            const docRef = doc(db, 'FabricSS', fabric.id!);
            batch.update(docRef, { code, shortName });
            count++;
            totalUpdated++;
        }

        if (count >= batchSize) {
          await batch.commit();
          batch = writeBatch(db);
          count = 0;
        }
      }

      if (count > 0) {
        await batch.commit();
      }

      setSuccess(`Successfully updated ${totalUpdated} fabrics with codes and short names.`);
      fetchExistingFabrics();
    } catch (err) {
      console.error("Migration error:", err);
      setError("Failed to update fabrics.");
    } finally {
      setSaving(false);
    }
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
              onClick={handleMigration}
              disabled={saving}
              className="px-4 py-2 rounded-lg text-sm font-medium text-amber-700 bg-amber-50 hover:bg-amber-100 border border-amber-200 transition-colors"
            >
              {saving ? 'Updating...' : 'Update Short Names'}
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
            <div className="p-4 border-b border-slate-200 bg-slate-50/50">
              <h3 className="font-bold text-slate-700">Existing Fabrics ({existingFabrics.length})</h3>
            </div>
            <div className="overflow-x-auto">
                <table className="w-full text-sm text-left">
                  <thead className="bg-slate-50 text-slate-700 font-bold uppercase text-xs">
                    <tr>
                      <th className="p-4 border-b border-slate-200">Code</th>
                      <th className="p-4 border-b border-slate-200">Short Name</th>
                      <th className="p-4 border-b border-slate-200">Work Centers</th>
                      <th className="p-4 border-b border-slate-200">Yarn Composition</th>
                      <th className="p-4 border-b border-slate-200 w-10"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {existingFabrics.map((fabric, idx) => (
                      <tr key={idx} className="hover:bg-slate-50 transition-colors group">
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
                    ))}
                  </tbody>
                </table>
            </div>
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
      {isModalOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg overflow-hidden">
            <div className="p-4 border-b border-slate-100 flex justify-between items-center bg-slate-50">
              <h3 className="font-bold text-slate-800">
                {editingFabric ? 'Edit Fabric' : 'Add New Fabric'}
              </h3>
              <button onClick={handleCloseModal} className="text-slate-400 hover:text-slate-600">
                <X size={20} />
              </button>
            </div>
            
            <div className="p-6 space-y-4">
              {/* ODOO Copy Button */}
              <div className="flex justify-end">
                <button
                  onClick={handleOdooPaste}
                  className="text-xs flex items-center gap-1.5 text-blue-600 hover:text-blue-700 font-medium bg-blue-50 hover:bg-blue-100 px-3 py-1.5 rounded-lg transition-colors"
                >
                  <Copy size={14} />
                  Paste from ODOO
                </button>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-bold text-slate-500 uppercase">Full Name (ODOO)</label>
                <textarea
                  value={modalForm.name}
                  onChange={(e) => {
                    const val = e.target.value;
                    const { code, shortName } = parseFabricName(val);
                    setModalForm(prev => ({ ...prev, name: val, code, shortName }));
                  }}
                  className="w-full p-3 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none min-h-[80px]"
                  placeholder="Paste full fabric name here..."
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-500 uppercase">Code</label>
                  <input
                    type="text"
                    value={modalForm.code}
                    onChange={(e) => setModalForm(prev => ({ ...prev, code: e.target.value }))}
                    className="w-full p-2 border border-slate-200 rounded-lg text-sm bg-slate-50"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-500 uppercase">Short Name</label>
                  <input
                    type="text"
                    value={modalForm.shortName}
                    onChange={(e) => setModalForm(prev => ({ ...prev, shortName: e.target.value }))}
                    className="w-full p-2 border border-slate-200 rounded-lg text-sm bg-slate-50"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-bold text-slate-500 uppercase">Work Centers</label>
                <input
                  type="text"
                  value={modalForm.workCenters}
                  onChange={(e) => setModalForm(prev => ({ ...prev, workCenters: e.target.value }))}
                  className="w-full p-2 border border-slate-200 rounded-lg text-sm"
                  placeholder="e.g. WC1, WC2"
                />
                <p className="text-[10px] text-slate-400">Comma separated values</p>
              </div>

              {/* Variants Section */}
              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <label className="text-xs font-bold text-slate-500 uppercase">Variants & Composition</label>
                  <button
                    onClick={() => setModalForm(prev => ({
                      ...prev,
                      variants: [...prev.variants, { id: `v${Date.now()}`, yarns: [] }]
                    }))}
                    className="text-xs flex items-center gap-1 text-blue-600 hover:text-blue-700 font-medium"
                  >
                    <Plus size={14} />
                    Add Variant
                  </button>
                </div>
                
                <div className="space-y-3 max-h-60 overflow-y-auto pr-2">
                  {modalForm.variants.map((variant, vIdx) => (
                    <div key={variant.id || vIdx} className="bg-slate-50 p-3 rounded-lg border border-slate-200 relative group">
                      <div className="flex justify-between items-center mb-2">
                        <span className="text-xs font-bold text-slate-400">VARIANT {vIdx + 1}</span>
                        <button
                          onClick={() => setModalForm(prev => ({
                            ...prev,
                            variants: prev.variants.filter((_, i) => i !== vIdx)
                          }))}
                          className="text-red-400 hover:text-red-600 opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>

                      <div className="space-y-2">
                        {variant.yarns.map((yarn, yIdx) => (
                          <div key={yIdx} className="flex gap-2 items-center">
                            <input
                              type="text"
                              placeholder="Yarn Name"
                              value={yarn.name}
                              onChange={(e) => {
                                const newVariants = [...modalForm.variants];
                                newVariants[vIdx].yarns[yIdx].name = e.target.value;
                                setModalForm(prev => ({ ...prev, variants: newVariants }));
                              }}
                              className="flex-1 p-1.5 text-xs border border-slate-200 rounded"
                            />
                            <input
                              type="number"
                              placeholder="%"
                              value={yarn.percentage}
                              onChange={(e) => {
                                const newVariants = [...modalForm.variants];
                                newVariants[vIdx].yarns[yIdx].percentage = parseFloat(e.target.value) || 0;
                                setModalForm(prev => ({ ...prev, variants: newVariants }));
                              }}
                              className="w-16 p-1.5 text-xs border border-slate-200 rounded"
                            />
                            <input
                              type="number"
                              placeholder="Scrap %"
                              value={yarn.scrapPercentage}
                              onChange={(e) => {
                                const newVariants = [...modalForm.variants];
                                newVariants[vIdx].yarns[yIdx].scrapPercentage = parseFloat(e.target.value) || 0;
                                setModalForm(prev => ({ ...prev, variants: newVariants }));
                              }}
                              className="w-16 p-1.5 text-xs border border-slate-200 rounded"
                            />
                            <button
                              onClick={() => {
                                const newVariants = [...modalForm.variants];
                                newVariants[vIdx].yarns = newVariants[vIdx].yarns.filter((_, i) => i !== yIdx);
                                setModalForm(prev => ({ ...prev, variants: newVariants }));
                              }}
                              className="text-slate-400 hover:text-red-500"
                            >
                              <X size={14} />
                            </button>
                          </div>
                        ))}
                        <button
                          onClick={() => {
                            const newVariants = [...modalForm.variants];
                            newVariants[vIdx].yarns.push({ name: '', percentage: 100, scrapPercentage: 0 });
                            setModalForm(prev => ({ ...prev, variants: newVariants }));
                          }}
                          className="text-xs text-blue-600 hover:text-blue-700 flex items-center gap-1 mt-2"
                        >
                          <Plus size={12} /> Add Yarn
                        </button>
                      </div>
                    </div>
                  ))}
                  {modalForm.variants.length === 0 && (
                    <div className="text-center p-4 text-slate-400 text-xs italic border border-dashed border-slate-200 rounded-lg">
                      No variants defined. Add one to specify yarn composition.
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="p-4 border-t border-slate-100 bg-slate-50 flex justify-end gap-2">
              <button
                onClick={handleCloseModal}
                className="px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-200 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveFabric}
                disabled={saving || !modalForm.name}
                className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors disabled:opacity-50 flex items-center gap-2"
              >
                {saving && <Loader2 size={14} className="animate-spin" />}
                {editingFabric ? 'Save Changes' : 'Create Fabric'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
