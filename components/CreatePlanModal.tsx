import React, { useState, useEffect, useMemo } from 'react';
import { OrderRow, MachineRow, PlanItem, MachineStatus, FabricDefinition } from '../types';
import { DataService } from '../services/dataService';
import { recalculateSchedule } from '../services/data';
import { X, Save, Loader, Calendar, Clock, AlertCircle, CheckCircle2, Factory, Users, Sparkles, ArrowRight, Filter, ArrowUp, ArrowDown, Settings } from 'lucide-react';

interface CreatePlanModalProps {
  isOpen: boolean;
  onClose: () => void;
  order: OrderRow;
  customerName: string;
}

interface MachineRecommendation {
  machine: MachineRow;
  score: number;
  reasons: string[];
  daysUntilFree: number;
  finishDate: Date;
  isCompatible: boolean;
}

// Helper to calculate changeover days
const getChangeoverDays = (machineType: string): number => {
    const type = (machineType || '').toLowerCase();
    if (type.includes('single')) return 2;
    if (type.includes('double')) return 4;
    if (type.includes('jacquard')) return 4;
    return 2; // Default
};

export const CreatePlanModal: React.FC<CreatePlanModalProps> = ({
  isOpen,
  onClose,
  order,
  customerName
}) => {
  const [machines, setMachines] = useState<MachineRow[]>([]);
  const [selectedMachineId, setSelectedMachineId] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [recommendations, setRecommendations] = useState<MachineRecommendation[]>([]);
  const [showAll, setShowAll] = useState(false);
  const [targetFabric, setTargetFabric] = useState<FabricDefinition | null>(null);
  const [inferredSpecs, setInferredSpecs] = useState<{gauge?: string, dia?: string}[]>([]);
  const [showDebugDetails, setShowDebugDetails] = useState(false);
  
  // New State for Row Placement
  const [insertionIndex, setInsertionIndex] = useState<number>(-1); // -1 means "End of list"

  useEffect(() => {
    if (isOpen) {
      loadMachines();
    }
  }, [isOpen]);

  // Reset insertion index when machine changes
  useEffect(() => {
      if (selectedMachineId) {
          const machine = machines.find(m => String(m.id) === selectedMachineId);
          if (machine) {
              setInsertionIndex(machine.futurePlans?.length || 0);
          }
      }
  }, [selectedMachineId, machines]);

  const loadMachines = async () => {
    setLoading(true);
    try {
      const [machinesData, fabricsData] = await Promise.all([
        DataService.getMachinesFromMachineSS(),
        DataService.getFabrics()
      ]);
      
      // Fix: Map 'name' to 'machineName' if missing (Firestore uses 'name')
      const mappedMachines = machinesData.map((m: any) => ({
        ...m,
        machineName: m.machineName || m.name || `Machine ${m.id}`
      }));
      
      setMachines(mappedMachines);
      
      // Find the fabric definition for the current order
      const foundFabric = fabricsData.find(f => 
        f.name.toLowerCase().trim() === order.material.toLowerCase().trim()
      );
      setTargetFabric(foundFabric || null);

      calculateRecommendations(mappedMachines, foundFabric);
    } catch (err) {
      console.error("Failed to load data", err);
    } finally {
      setLoading(false);
    }
  };

  const calculateRecommendations = (machineList: MachineRow[], targetFabric?: FabricDefinition) => {
    // 1. Infer Specs from History if needed
    const historyMachineNames = (targetFabric?.workCenters || []).map(n => n.toLowerCase().trim());
    const hasHistory = historyMachineNames.length > 0;
    
    let allowedSpecs: {gauge?: string, dia?: string}[] = [];

    // If fabric has explicit specs, add them first
    if (targetFabric?.specs?.gauge || targetFabric?.specs?.diameter) {
        allowedSpecs.push({
            gauge: targetFabric.specs.gauge,
            dia: targetFabric.specs.diameter
        });
    }

    // Identify "History Groups" and Collect Specs from History Machines
    const historyGroups = new Set<string>();
    if (hasHistory) {
        machineList.forEach(m => {
            if (historyMachineNames.includes((m.machineName || '').toLowerCase().trim())) {
                if (m.type) historyGroups.add(m.type);
                
                // Add this machine's specs to allowed list if not already present
                const specExists = allowedSpecs.some(s => 
                    (s.gauge === m.gauge || (!s.gauge && !m.gauge)) && 
                    (s.dia === m.dia || (!s.dia && !m.dia))
                );
                
                if (!specExists && (m.gauge || m.dia)) {
                    allowedSpecs.push({ gauge: m.gauge, dia: m.dia });
                }
            }
        });
    }
    
    setInferredSpecs(allowedSpecs);

    const scored = machineList.map(machine => {
      let score = 0;
      const reasons: string[] = [];
      let isCompatible = true;
      const currentMachineName = (machine.machineName || '').toLowerCase().trim();

      // 2. Strict History Filter (User Request: "Only recommend machines that it worked before")
      if (hasHistory) {
          // Check if this machine's name is in the history list
          if (historyMachineNames.includes(currentMachineName)) {
              score += 100;
              reasons.push("⭐ History: Proven Match (+100)");
          } else {
              // NEW: Check if it belongs to a "History Group" (Same Type as a proven machine)
              // But ONLY if it also matches specs (checked later)
              if (machine.type && historyGroups.has(machine.type)) {
                  // It's not in history, but it's the same TYPE as a machine in history.
                  // We give it a chance (don't mark incompatible immediately), but lower score.
                  score += 50;
                  reasons.push(`🔹 History: Group Match (Same Type) (+50)`);
              } else {
                  isCompatible = false;
                  reasons.push(`❌ History: Not in Proven History (-2000)`);
                  score = -2000; // Push to bottom
              }
          }
      }

      // 3. Technical Constraints Check (Gauge/Dia)
      // Check against ALL allowed specs found in history or definition
      if (isCompatible || !hasHistory) {
         if (allowedSpecs.length > 0) {
             // Must match AT LEAST ONE of the allowed spec combinations
             const matchesAnySpec = allowedSpecs.some(spec => {
                 const gaugeMatch = !spec.gauge || !machine.gauge || spec.gauge.trim() === machine.gauge.trim();
                 const diaMatch = !spec.dia || !machine.dia || spec.dia.trim() === machine.dia.trim();
                 return gaugeMatch && diaMatch;
             });

             if (!matchesAnySpec) {
                 isCompatible = false;
                 reasons.push(`❌ Specs: Gauge/Dia Mismatch (-1000)`);
                 score = -1000;
             }
         }
      }

      if (!isCompatible) {
          // Ensure score is low if incompatible
          if (score > -1000) score = -1000;
      }


      
      // 1. Calculate Availability (When does the machine finish everything?)
      let finishDate = new Date();
      let totalRemaining = Number(machine.remainingMfg) || 0;
      
      // Add future plans to total remaining
      if (machine.futurePlans) {
        machine.futurePlans.forEach(p => totalRemaining += (Number(p.quantity) || 0));
      }

      const dailyProd = Number(machine.avgProduction) || 150; // Fallback to 150
      let daysToFinish = dailyProd > 0 ? Math.ceil(totalRemaining / dailyProd) : 999;

      // --- Changeover Time Calculation ---
      // If the last fabric running on the machine is different from the new order,
      // we must add setup time (2 days for Single, 4 days for Double).
      const orderFabric = (order.material || '').toLowerCase().trim();
      let lastFabric = (machine.material || '').toLowerCase().trim();
      
      if (machine.futurePlans && machine.futurePlans.length > 0) {
          lastFabric = (machine.futurePlans[machine.futurePlans.length - 1].fabric || '').toLowerCase().trim();
      }

      let changeoverDays = 0;
      if (lastFabric && lastFabric !== orderFabric) {
          const type = (machine.type || '').toLowerCase();
          if (type.includes('single')) {
              changeoverDays = 2;
          } else if (type.includes('double')) {
              changeoverDays = 4;
          } else {
              // Default fallback for other types (e.g. Jacquard usually complex like Double, others like Single)
              changeoverDays = type.includes('jacquard') ? 4 : 2;
          }
          
          daysToFinish += changeoverDays;
      }
      
      finishDate.setDate(finishDate.getDate() + daysToFinish);
      const daysUntilFree = daysToFinish;

      if (isCompatible) {
        // 2. Availability Score (Dynamic: 50 points max, -5 per day wait)
        // Base Score: 50
        // Penalty: 5 points per day
        // Min Score: -20 (Cap penalty at 14 days)
        
        const availabilityBaseScore = 50;
        const penaltyPerDay = 5;
        const waitPenalty = Math.min(daysUntilFree * penaltyPerDay, 70); // Cap penalty at 70 points (resulting in -20)
        const availabilityScore = availabilityBaseScore - waitPenalty;
        
        score += availabilityScore;
        
        if (daysUntilFree <= 0) {
            reasons.push(`✅ Availability: Available Now (+${availabilityScore})`);
        } else {
            const sign = availabilityScore >= 0 ? '+' : '';
            reasons.push(`🕒 Availability: Free in ${daysUntilFree} days (${sign}${availabilityScore})`);
        }
        
        if (changeoverDays > 0) {
            reasons.push(`🛠️ Setup: +${changeoverDays} days changeover (${machine.type})`);
        }

        // 3. Zero-Changeover Bonus (Current Fabric)
        // Normalize strings for comparison
        const currentFabric = (machine.material || '').toLowerCase().trim();
        
        if (currentFabric && currentFabric === orderFabric) {
          score += 80; // Increased from 50 to 80 (Very High Priority)
          reasons.push("✨ Efficiency: Currently Running this Fabric (+80)");
        }

        // 4. Zero-Changeover Bonus (Last Planned Fabric)
        if (machine.futurePlans && machine.futurePlans.length > 0) {
          const lastPlan = machine.futurePlans[machine.futurePlans.length - 1];
          const lastFabric = (lastPlan.fabric || '').toLowerCase().trim();
          if (lastFabric === orderFabric) {
             score += 60; // Increased from 40 to 60
             reasons.push("✨ Efficiency: Seamless Transition (Matches last plan) (+60)");
          }
        } else if (machine.futurePlans && machine.futurePlans.length === 0 && currentFabric === orderFabric) {
             // If no future plans, and current is same, it's even better because it's free SOON
             score += 20; // Extra bonus for being the *immediate* next job
             reasons.push("🚀 Immediate Continuity (+20)");
        }

        // 5. Continuity Bonus (Client)
        const currentClient = (machine.client || '').toLowerCase().trim();
        const orderClient = (customerName || '').toLowerCase().trim();
        
        if (currentClient && currentClient === orderClient) {
          score += 30;
          reasons.push("🤝 Client: Same Client Continuity (+30)");
        }
      }

      return {
        machine,
        score,
        reasons,
        daysUntilFree,
        finishDate,
        isCompatible
      };
    });

    // Sort by score descending
    scored.sort((a, b) => b.score - a.score);
    setRecommendations(scored);
    
    // Auto-select top recommendation if available and compatible
    if (scored.length > 0 && scored[0].isCompatible) {
      setSelectedMachineId(String(scored[0].machine.id));
    }
  };

  const selectedMachine = useMemo(() => {
    return machines.find(m => String(m.id) === String(selectedMachineId));
  }, [machines, selectedMachineId]);

  const handleSave = async () => {
    if (!selectedMachineId || !selectedMachine) return;

    // Safety Check for Incompatible Machines
    const recommendation = recommendations.find(r => String(r.machine.id) === selectedMachineId);
    if (recommendation && !recommendation.isCompatible) {
      const proceed = window.confirm(
        "⚠️ WARNING: This machine is marked as INCOMPATIBLE with the fabric requirements (Gauge/Diameter mismatch).\n\nAre you sure you want to force this assignment?"
      );
      if (!proceed) return;
    }

    setSaving(true);
    try {
      const newPlan: PlanItem = {
        type: 'PRODUCTION',
        fabric: order.material,
        productionPerDay: selectedMachine.avgProduction || 150,
        quantity: order.requiredQty,
        days: 0, // Will be calculated
        startDate: '', // Will be calculated
        endDate: '', // Will be calculated
        remaining: order.requiredQty,
        client: customerName,
        orderName: '', // Optional
        orderReference: order.id, // Link back to order
        notes: order.notes || ''
      };

      const currentPlans = selectedMachine.futurePlans || [];
      const updatedPlans = [...currentPlans];
      
      // Insert at the correct position
      const effectiveIndex = (insertionIndex === -1 || insertionIndex > currentPlans.length) 
          ? currentPlans.length 
          : insertionIndex;

      // Determine Previous Fabric to check for Changeover
      let previousFabric = '';
      if (effectiveIndex === 0) {
          // Check current job
          if (selectedMachine.status === 'Working') {
              previousFabric = selectedMachine.material || '';
          }
      } else {
          // Check previous plan
          const prevPlan = currentPlans[effectiveIndex - 1];
          previousFabric = prevPlan.fabric || '';
      }

      const itemsToInsert: PlanItem[] = [];

      // Check for Changeover
      // Only add settings if there is a previous fabric and it differs
      if (previousFabric && previousFabric !== order.material) {
          const changeoverDays = getChangeoverDays(selectedMachine.type);
          if (changeoverDays > 0) {
              itemsToInsert.push({
                  type: 'SETTINGS',
                  fabric: 'Settings / Changeover',
                  productionPerDay: 0,
                  quantity: 0,
                  days: changeoverDays,
                  startDate: '',
                  endDate: '',
                  remaining: 0,
                  client: 'Internal',
                  orderName: 'Changeover',
                  notes: `Switching from ${previousFabric} to ${order.material}`
              });
          }
      }
      
      itemsToInsert.push(newPlan);
          
      updatedPlans.splice(effectiveIndex, 0, ...itemsToInsert);
      
      const machineRow: MachineRow = {
        ...selectedMachine,
        dayProduction: Number(selectedMachine.dayProduction) || 0,
        avgProduction: Number(selectedMachine.avgProduction) || 0,
        remainingMfg: Number(selectedMachine.remainingMfg) || 0
      };

      const recalculated = recalculateSchedule(updatedPlans, machineRow);

      await DataService.updateMachineInMachineSS(selectedMachine.firestoreId || String(selectedMachine.id), {
        futurePlans: recalculated,
        lastUpdated: new Date().toISOString()
      });

      onClose();
      // Ideally show a toast here, but alert is fine for now
    } catch (err) {
      console.error("Failed to create plan", err);
      alert("Failed to create plan");
    } finally {
      setSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[9999] p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-[95vw] flex flex-col h-[90vh]">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50/50 rounded-t-xl">
          <div>
            <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-purple-600" />
              Smart Schedule Planner
            </h2>
            <p className="text-sm text-slate-500 mt-1">
              AI-Recommended machines for <span className="font-medium text-slate-700">{order.material}</span> ({order.requiredQty} kg)
            </p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-full transition-colors text-slate-400 hover:text-slate-600">
            <X size={20} />
          </button>
        </div>

        <div className="flex-1 overflow-hidden flex flex-col md:flex-row">
          {/* Left Panel: Recommendations */}
          <div className="w-full md:w-2/5 p-0 border-r border-slate-200 bg-slate-50 flex flex-col">
            
            {/* AI INSIGHTS PANEL (Collapsible) */}
            <div className="border-b border-slate-200 bg-white">
                <button 
                  onClick={() => setShowDebugDetails(!showDebugDetails)}
                  className="w-full flex items-center justify-between px-4 py-3 text-xs font-medium text-slate-600 hover:bg-slate-50 transition-colors border-b border-transparent hover:border-slate-100"
                >
                  <span className="flex items-center gap-2">
                    <Sparkles size={14} className="text-purple-500" />
                    AI Matching Insights
                    {targetFabric && <span className="px-1.5 py-0.5 bg-emerald-100 text-emerald-700 rounded text-[10px]">Verified Fabric</span>}
                  </span>
                  <span className="text-slate-400 flex items-center gap-1">
                    {showDebugDetails ? 'Hide Analysis' : 'View Analysis'}
                    {showDebugDetails ? <ArrowUp size={12}/> : <ArrowDown size={12}/>}
                  </span>
                </button>
                
                {showDebugDetails && (
                    <div className="bg-slate-50/50 border-b border-slate-200 max-h-[300px] overflow-y-auto custom-scrollbar">
                        <div className="p-4 grid grid-cols-2 gap-4">
                            <div className="bg-white p-3 rounded-lg border border-slate-100 shadow-sm">
                                <div className="text-[10px] text-slate-400 uppercase tracking-wider font-bold mb-1">Order Requirements</div>
                                <div className="text-slate-800 font-bold text-sm">{order.material}</div>
                                <div className="text-slate-500 text-xs mt-0.5">{order.requiredQty} kg required</div>
                            </div>
                            <div className="bg-white p-3 rounded-lg border border-slate-100 shadow-sm">
                                <div className="text-[10px] text-slate-400 uppercase tracking-wider font-bold mb-1">Fabric Database Match</div>
                                <div className={`font-bold text-sm flex items-center gap-1.5 ${targetFabric ? "text-emerald-600" : "text-amber-600"}`}>
                                    {targetFabric ? <CheckCircle2 size={14}/> : <AlertCircle size={14}/>}
                                    {targetFabric ? "Exact Match Found" : "Using Generic Specs"}
                                </div>
                                <div className="text-slate-500 text-xs mt-0.5">
                                    {inferredSpecs.length > 0 
                                        ? <span className="font-mono bg-slate-100 px-1 rounded">Specs: {inferredSpecs.map(s => `${s.gauge || '?'}G / ${s.dia || '?'}”`).join(', ')}</span>
                                        : 'No technical specs inferred'}
                                </div>
                            </div>
                        </div>

                        <div className="px-4 pb-4">
                            <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">Scoring Breakdown</h4>
                            <div className="bg-white rounded-lg border border-slate-200 overflow-hidden shadow-sm">
                                <table className="w-full text-left text-xs">
                                    <thead className="bg-slate-50 border-b border-slate-100">
                                        <tr>
                                            <th className="py-2 px-3 font-medium text-slate-500">Machine</th>
                                            <th className="py-2 px-3 font-medium text-center text-slate-500">Score</th>
                                            <th className="py-2 px-3 font-medium text-slate-500">Key Factors</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100">
                                        {recommendations.slice(0, 10).map(rec => (
                                            <tr key={rec.machine.id} className="hover:bg-slate-50/80 transition-colors">
                                                <td className="py-2 px-3 align-top">
                                                    <div className="font-medium text-slate-700">{rec.machine.machineName}</div>
                                                    <div className="text-[10px] text-slate-400">{rec.machine.type}</div>
                                                </td>
                                                <td className="py-2 px-3 align-top text-center">
                                                    <span className={`inline-block px-1.5 py-0.5 rounded font-bold text-[10px] ${
                                                        rec.score >= 80 ? 'bg-emerald-100 text-emerald-700' :
                                                        rec.score >= 50 ? 'bg-blue-100 text-blue-700' :
                                                        rec.score > 0 ? 'bg-amber-100 text-amber-700' :
                                                        'bg-red-100 text-red-700'
                                                    }`}>
                                                        {rec.score}
                                                    </span>
                                                </td>
                                                <td className="py-2 px-3 align-top">
                                                    <div className="space-y-1">
                                                        {rec.reasons.map((r, i) => (
                                                            <div key={i} className="text-[10px] text-slate-600 flex items-start gap-1">
                                                                <span className="mt-0.5 opacity-70">
                                                                    {r.includes('✅') || r.includes('✨') ? '•' : '-'}
                                                                </span>
                                                                <span>{r.replace(/^[✅✨⭐❌🕒📅⏳🔹🤝] /, '')}</span>
                                                            </div>
                                                        ))}
                                                    </div>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                                {recommendations.length > 10 && (
                                    <div className="p-2 text-center text-[10px] text-slate-400 bg-slate-50 border-t border-slate-100">
                                        Showing top 10 of {recommendations.length} machines
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                )}
            </div>

            <div className="p-4 border-b border-slate-200 bg-white sticky top-0 z-10 shadow-sm">
               <div className="flex justify-between items-center">
                 <div>
                    <h3 className="text-sm font-bold text-slate-800">Recommended Machines</h3>
                    <p className="text-xs text-slate-500 mt-0.5">Sorted by AI Compatibility Score</p>
                 </div>
                 <button 
                   onClick={() => setShowAll(!showAll)}
                   className="text-xs px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-full font-medium transition-colors flex items-center gap-1"
                 >
                   <Filter size={12} />
                   {showAll ? 'Top Picks' : 'All'}
                 </button>
               </div>
            </div>
            
            <div className="overflow-y-auto flex-1 p-2 space-y-2 bg-slate-50">
              {loading ? (
                <div className="flex flex-col items-center justify-center py-12 text-slate-400">
                  <Loader className="animate-spin mb-3 text-purple-500" size={32} />
                  <p className="text-sm font-medium">Analyzing factory schedule...</p>
                </div>
              ) : (
                recommendations
                  .filter(rec => showAll || rec.score > 0) // Show only positive scores by default
                  .map((rec) => {
                    const isSelected = String(rec.machine.id) === selectedMachineId;
                    return (
                      <div 
                        key={rec.machine.id}
                        onClick={() => setSelectedMachineId(String(rec.machine.id))}
                        className={`group p-3 rounded-lg border cursor-pointer transition-all relative overflow-hidden ${
                          isSelected 
                            ? 'bg-white border-purple-500 shadow-md ring-1 ring-purple-500 z-10' 
                            : !rec.isCompatible 
                              ? 'bg-slate-100 border-slate-200 opacity-60 hover:opacity-100 grayscale hover:grayscale-0'
                              : 'bg-white border-slate-200 hover:border-purple-300 hover:shadow-sm'
                        }`}
                      >
                        <div className="flex justify-between items-start mb-1">
                            <div className="flex flex-col">
                                <div className="font-bold text-slate-800 text-sm group-hover:text-purple-700 transition-colors flex items-center gap-2">
                                    {rec.machine.machineName || `Machine ${rec.machine.id}`}
                                    <span className="text-[10px] font-normal text-slate-500 bg-slate-100 px-1.5 rounded border border-slate-200">
                                        {rec.machine.brand} • {rec.machine.type}
                                    </span>
                                </div>
                            </div>
                            
                            {/* Compact Score Badge */}
                            <div className={`px-2 py-0.5 text-[10px] font-bold rounded-full flex items-center gap-1 ${
                                !rec.isCompatible ? 'bg-red-100 text-red-700' :
                                rec.score >= 80 ? 'bg-emerald-100 text-emerald-700' :
                                rec.score >= 50 ? 'bg-blue-100 text-blue-700' :
                                'bg-slate-100 text-slate-600'
                            }`}>
                                {!rec.isCompatible ? <AlertCircle size={10}/> : <Sparkles size={10}/>}
                                {rec.score} pts
                            </div>
                        </div>

                        {/* Compact Reasons List (Top 2 only) */}
                        <div className="space-y-1 mb-2">
                          {rec.reasons.slice(0, 2).map((reason, idx) => (
                            <div key={idx} className="text-[10px] flex items-center gap-1.5 text-slate-600 leading-tight truncate">
                              {reason.includes('✅') || reason.includes('✨') || reason.includes('⭐') ? (
                                <CheckCircle2 size={10} className="text-emerald-500 shrink-0" />
                              ) : reason.includes('❌') ? (
                                <X size={10} className="text-red-500 shrink-0" />
                              ) : (
                                <div className="w-2 h-2 rounded-full bg-blue-100 border border-blue-200 shrink-0 flex items-center justify-center">
                                    <div className="w-0.5 h-0.5 bg-blue-500 rounded-full"></div>
                                </div>
                              )}
                              <span className={reason.includes('❌') ? 'text-red-600 font-medium' : ''}>
                                {reason.replace(/^[✅✨⭐❌🕒📅⏳🔹🤝] /, '').split('(')[0]}
                              </span>
                            </div>
                          ))}
                        </div>

                        {/* Ultra Compact Availability Bar */}
                        <div className="flex items-center gap-2">
                          <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden border border-slate-200">
                            <div 
                              className={`h-full rounded-full ${
                                rec.daysUntilFree <= 0 ? 'bg-emerald-500' :
                                rec.daysUntilFree <= 3 ? 'bg-blue-500' :
                                rec.daysUntilFree <= 7 ? 'bg-amber-500' :
                                'bg-red-400'
                              }`}
                              style={{ width: `${Math.max(5, 100 - (rec.daysUntilFree * 5))}%` }} 
                            ></div>
                          </div>
                          <div className={`text-[9px] font-medium whitespace-nowrap ${rec.daysUntilFree <= 0 ? 'text-emerald-600' : 'text-slate-500'}`}>
                             {rec.daysUntilFree <= 0 ? 'Now' : `${rec.daysUntilFree}d`}
                          </div>
                        </div>
                      </div>
                    );
                  })
              )}
              
              {!loading && recommendations.filter(rec => showAll || rec.score > 0).length === 0 && (
                <div className="text-center py-12 bg-white rounded-xl border border-dashed border-slate-300 mx-4">
                  <div className="w-12 h-12 bg-slate-50 rounded-full flex items-center justify-center mx-auto mb-3">
                    <AlertCircle className="w-6 h-6 text-slate-400" />
                  </div>
                  <h3 className="text-slate-900 font-medium mb-1">No perfect matches found</h3>
                  <p className="text-slate-500 text-sm mb-4">Try viewing all machines to see lower-scoring options.</p>
                  <button 
                    onClick={() => setShowAll(true)} 
                    className="text-purple-600 hover:text-purple-700 text-sm font-medium hover:underline"
                  >
                    View All Machines
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Right Panel: Schedule Visualization */}
          <div className="w-full md:w-3/5 p-6 overflow-y-auto bg-white flex flex-col">
            <h3 className="text-sm font-bold text-slate-800 mb-4 flex items-center gap-2">
              <Clock className="w-4 h-4 text-slate-500" />
              Projected Schedule
            </h3>
            
            {!selectedMachine ? (
              <div className="h-full flex flex-col items-center justify-center text-slate-400 min-h-[300px]">
                <Factory className="w-12 h-12 mb-3 opacity-20" />
                <p>Select a machine from the list to simulate this order</p>
              </div>
            ) : (
              <div className="flex-1 overflow-auto">
                <table className="w-full text-xs text-left border-collapse">
                  <thead className="sticky top-0 bg-white z-10 shadow-sm">
                    <tr className="bg-slate-50 border-b border-slate-200 text-slate-500">
                      <th className="p-3 font-medium whitespace-nowrap">Start Date</th>
                      <th className="p-3 font-medium whitespace-nowrap">End Date</th>
                      <th className="p-3 font-medium text-center">Days</th>
                      <th className="p-3 font-medium">Client</th>
                      <th className="p-3 font-medium text-right">Qty</th>
                      <th className="p-3 font-medium text-right">Prod/Day</th>
                      <th className="p-3 font-medium">Fabric / Notes</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {(() => {
                        if (!selectedMachine) return null;

                        // --- 1. Build the Sequence of Events ---
                        const sequence: any[] = [];
                        let currentDate = new Date();
                        
                        // A. Current Job
                        let lastFabric = '';
                        if (selectedMachine.status === 'Working') {
                            const daysRemaining = Math.ceil(selectedMachine.remainingMfg / selectedMachine.avgProduction);
                            const endDate = new Date(currentDate);
                            endDate.setDate(endDate.getDate() + daysRemaining);
                            
                            sequence.push({
                                type: 'current',
                                startDate: new Date(currentDate),
                                endDate: endDate,
                                days: daysRemaining,
                                client: selectedMachine.client,
                                qty: selectedMachine.remainingMfg,
                                fabric: selectedMachine.material,
                                productionPerDay: selectedMachine.avgProduction
                            });
                            
                            currentDate = new Date(endDate);
                            lastFabric = selectedMachine.material;
                        }

                        // B. Merge Existing Plans + New Order
                        const existingPlans = selectedMachine.futurePlans || [];
                        const effectiveIndex = (insertionIndex === -1 || insertionIndex > existingPlans.length) 
                            ? existingPlans.length 
                            : insertionIndex;

                        const combinedPlans = [...existingPlans];
                        const newOrderPlan = {
                            type: 'new',
                            client: customerName,
                            qty: order.requiredQty,
                            fabric: order.material,
                            days: Math.ceil(order.requiredQty / selectedMachine.avgProduction),
                            productionPerDay: selectedMachine.avgProduction
                        };
                        
                        combinedPlans.splice(effectiveIndex, 0, newOrderPlan);

                        // C. Process Sequence with Changeovers
                        combinedPlans.forEach((plan, idx) => {
                            // Check for Changeover
                            // We specifically highlight changeovers involving the NEW order for clarity,
                            // but logically we should show it for any transition.
                            // For now, let's enforce it strictly for the New Order to match the user's visual request
                            // and also for general correctness if fabrics differ.
                            
                            const planFabric = plan.fabric || plan.material; // Handle different naming if any
                            
                            if (lastFabric && planFabric !== lastFabric) {
                                const changeoverDays = getChangeoverDays(selectedMachine.type);
                                if (changeoverDays > 0) {
                                    const settingsEnd = new Date(currentDate);
                                    settingsEnd.setDate(settingsEnd.getDate() + changeoverDays);
                                    
                                    sequence.push({
                                        type: 'settings',
                                        startDate: new Date(currentDate),
                                        endDate: settingsEnd,
                                        days: changeoverDays,
                                        fabric: 'Settings / Changeover'
                                    });
                                    currentDate = new Date(settingsEnd);
                                }
                            }

                            // Add the Plan
                            const planDays = plan.days || Math.ceil(plan.quantity / selectedMachine.avgProduction);
                            const planEnd = new Date(currentDate);
                            planEnd.setDate(planEnd.getDate() + planDays);
                            
                            sequence.push({
                                ...plan,
                                startDate: new Date(currentDate),
                                endDate: planEnd,
                                days: planDays,
                                isNew: plan.type === 'new'
                            });
                            
                            currentDate = new Date(planEnd);
                            lastFabric = planFabric;
                        });

                        // --- 2. Render the Sequence ---
                        return sequence.map((item, idx) => {
                            if (item.type === 'current') {
                                return (
                                    <tr key={`curr-${idx}`} className="bg-emerald-50/50 hover:bg-emerald-50 transition-colors">
                                        <td className="p-3 text-emerald-700 font-medium">Today</td>
                                        <td className="p-3 text-slate-600">{item.endDate.toISOString().split('T')[0]}</td>
                                        <td className="p-3 text-center font-mono text-slate-600">{item.days}</td>
                                        <td className="p-3 text-slate-700">{item.client}</td>
                                        <td className="p-3 text-right font-mono text-slate-700">{item.qty}</td>
                                        <td className="p-3 text-right font-mono text-slate-500">{item.productionPerDay}</td>
                                        <td className="p-3 text-emerald-700 font-medium flex items-center gap-1">
                                            <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></div>
                                            {item.fabric}
                                        </td>
                                    </tr>
                                );
                            }

                            if (item.type === 'settings') {
                                return (
                                    <tr key={`set-${idx}`} className="bg-amber-100 border-l-4 border-l-amber-500">
                                        <td className="p-3 text-amber-800 font-medium">
                                            {item.startDate.toISOString().split('T')[0]}
                                        </td>
                                        <td className="p-3 text-amber-800 font-medium">
                                            {item.endDate.toISOString().split('T')[0]}
                                        </td>
                                        <td className="p-3 text-center font-mono text-amber-800 font-bold">{item.days}</td>
                                        <td className="p-3 text-amber-800 italic" colSpan={3}>
                                            Machine Adjustment & Setup
                                        </td>
                                        <td className="p-3 text-amber-800 font-bold flex items-center gap-2">
                                            <Settings size={14} />
                                            {item.fabric}
                                        </td>
                                    </tr>
                                );
                            }

                            if (item.isNew) {
                                return (
                                    <tr key={`new-${idx}`} className="bg-purple-50 border-l-4 border-l-purple-500 relative group">
                                        <td className="p-3 text-purple-700 font-bold">
                                            {item.startDate.toISOString().split('T')[0]}
                                        </td>
                                        <td className="p-3 text-purple-700 font-bold">
                                            {item.endDate.toISOString().split('T')[0]}
                                        </td>
                                        <td className="p-3 text-center font-mono text-purple-700 font-bold">{item.days}</td>
                                        <td className="p-3 text-purple-700">{item.client}</td>
                                        <td className="p-3 text-right font-mono text-purple-700 font-bold">{item.qty}</td>
                                        <td className="p-3 text-right font-mono text-purple-600">{item.productionPerDay}</td>
                                        <td className="p-3 text-purple-700 font-bold flex items-center justify-between gap-2">
                                            <div className="flex items-center gap-2">
                                                <Sparkles size={14} />
                                                {item.fabric} (NEW)
                                            </div>
                                            
                                            {/* Reordering Controls */}
                                            <div className="flex flex-col gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                                                <button 
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        if (effectiveIndex > 0) setInsertionIndex(effectiveIndex - 1);
                                                    }}
                                                    disabled={effectiveIndex <= 0}
                                                    className="p-0.5 hover:bg-purple-200 rounded disabled:opacity-30"
                                                    title="Move Earlier"
                                                >
                                                    <ArrowUp size={12} />
                                                </button>
                                                <button 
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        if (effectiveIndex < existingPlans.length) setInsertionIndex(effectiveIndex + 1);
                                                    }}
                                                    disabled={effectiveIndex >= existingPlans.length}
                                                    className="p-0.5 hover:bg-purple-200 rounded disabled:opacity-30"
                                                    title="Move Later"
                                                >
                                                    <ArrowDown size={12} />
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                );
                            }

                            // Existing Future Plan
                            return (
                                <tr key={`exist-${idx}`} className="hover:bg-slate-50 transition-colors">
                                    <td className="p-3 text-slate-600">{item.startDate.toISOString().split('T')[0]}</td>
                                    <td className="p-3 text-slate-600">{item.endDate.toISOString().split('T')[0]}</td>
                                    <td className="p-3 text-center font-mono text-slate-600">{item.days}</td>
                                    <td className="p-3 text-slate-700">{item.client || '-'}</td>
                                    <td className="p-3 text-right font-mono text-slate-700">{item.quantity || item.qty}</td>
                                    <td className="p-3 text-right font-mono text-slate-500">{item.productionPerDay}</td>
                                    <td className="p-3 text-slate-700">{item.fabric}</td>
                                </tr>
                            );
                        });
                    })()}
                  </tbody>
                </table>
                
                <div className="mt-6 p-4 bg-slate-50 rounded-lg border border-slate-200 text-xs text-slate-500">
                    <p className="font-semibold mb-1">Schedule Analysis:</p>
                    <ul className="list-disc pl-4 space-y-1">
                        <li>This machine has a production rate of <strong>{selectedMachine.avgProduction} kg/day</strong>.</li>
                        <li>The new order of <strong>{order.requiredQty} kg</strong> will take approximately <strong>{Math.ceil(order.requiredQty / selectedMachine.avgProduction)} days</strong>.</li>
                        {selectedMachine.status === 'Working' && (
                            <li>Current job ends in approx. {Math.ceil(selectedMachine.remainingMfg / selectedMachine.avgProduction)} days.</li>
                        )}
                    </ul>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-slate-100 bg-slate-50/50 rounded-b-xl flex justify-end gap-3">
          <button
            onClick={onClose}
            className="px-5 py-2.5 text-slate-600 hover:bg-white hover:shadow-sm border border-transparent hover:border-slate-200 rounded-lg transition-all text-sm font-medium"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={!selectedMachineId || saving}
            className="px-5 py-2.5 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center shadow-sm hover:shadow transition-all text-sm font-bold"
          >
            {saving ? <Loader className="animate-spin mr-2" size={16} /> : <Save className="mr-2" size={16} />}
            Confirm & Add to Schedule
          </button>
        </div>
      </div>
    </div>
  );
};
