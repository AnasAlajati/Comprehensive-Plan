import React, { useState, useEffect } from 'react';
import { 
  X, 
  Droplets, 
  Ruler, 
  Scale, 
  FileText, 
  ArrowRightLeft, 
  Edit2,
  Check,
  Factory,
  Calendar,
  Trash2,
  Plus,
  ChevronDown,
  Truck,
  Package,
  Clock,
  AlertCircle,
  ArrowLeft
} from 'lucide-react';
import { OrderRow, DyeingBatch } from '../types';

interface FabricDyehouseModalProps {
  isOpen: boolean;
  onClose: () => void;
  order: OrderRow;
  onUpdateOrder: (orderId: string, updates: Partial<OrderRow>) => void;
  customerName: string;
  dyehouses: any[];
}

export const FabricDyehouseModal: React.FC<FabricDyehouseModalProps> = ({
  isOpen,
  onClose,
  order,
  onUpdateOrder: _onUpdateOrder,
  customerName,
  dyehouses = []
}) => {
  // 🛡️ Firestore Sanitizer: Auto-fix undefined values
  const onUpdateOrder = (id: string, updates: any) => {
    // Helper to clean an object
    const cleanObj = (obj: any) => {
        const result = { ...obj };
        Object.keys(result).forEach(k => {
            if (result[k] === undefined) result[k] = null;
        });
        return result;
    };

    if (updates.dyeingPlan) {
      updates.dyeingPlan = updates.dyeingPlan.map((b: any) => {
        let clean = cleanObj(b);

        // Deep Clean Events
        if (clean.sentEvents) {
            clean.sentEvents = clean.sentEvents.map(cleanObj);
        }
        if (clean.receiveEvents) {
            clean.receiveEvents = clean.receiveEvents.map(cleanObj);
        }
        return clean;
      });
    }
    _onUpdateOrder(id, updates);
  };
  const [specs, setSpecs] = useState({
    requiredWidth: order.requiredWidth || '',
    requiredGsm: order.requiredGsm || '',
    finishedWidth: order.finishedWidth || '',
    finishedGsm: order.finishedGsm || '',
    finishingNotes: order.finishingNotes || ''
  });
  const [isEditing, setIsEditing] = useState(false);

  // Modal States
  const [sentModal, setSentModal] = useState<{ isOpen: boolean; batchIdx: number; batch: any }>({ isOpen: false, batchIdx: -1, batch: null });
  const [receiveModal, setReceiveModal] = useState<{ isOpen: boolean; batchIdx: number; batch: any }>({ isOpen: false, batchIdx: -1, batch: null });
  
  // Form States for Modals
  const [newSent, setNewSent] = useState({ date: new Date().toISOString().split('T')[0], quantity: 0, accessorySent: 0, notes: '' });
  const [newReceive, setNewReceive] = useState({ date: new Date().toISOString().split('T')[0], quantity: 0, accessoryReceive: 0, notes: '', sentEventId: '' });

  useEffect(() => {
    if (isOpen) {
      setSpecs({
        requiredWidth: order.requiredWidth || '',
        requiredGsm: order.requiredGsm || '',
        finishedWidth: order.finishedWidth || '',
        finishedGsm: order.finishedGsm || '',
        finishingNotes: order.finishingNotes || ''
      });
      setIsEditing(false);
    }
  }, [isOpen, order]);

  if (!isOpen) return null;

  const handleSaveSpecs = () => {
    onUpdateOrder(order.id, {
      requiredWidth: Number(specs.requiredWidth) || 0,
      requiredGsm: Number(specs.requiredGsm) || 0,
      finishedWidth: Number(specs.finishedWidth) || 0,
      finishedGsm: Number(specs.finishedGsm) || 0,
      finishingNotes: specs.finishingNotes
    });
    setIsEditing(false);
  };

  const formatCompactDate = (dateStr?: string) => {
    if (!dateStr) return '-';
    try {
        const d = new Date(dateStr);
        // "13-Jan" format
        const day = d.getDate().toString().padStart(2, '0');
        const month = d.toLocaleString('en-GB', { month: 'short' });
        return `${day}-${month}`;
    } catch { return dateStr; }
  };

  const batches = order.dyeingPlan || [];
  
  // Calculate Totals (Fixed Logic: Include Accessory & Type Safety)
  const totalPlanned = batches.reduce((sum, b) => sum + (Number(b.quantity) || 0), 0);
  const totalSent = batches.reduce((sum, b) => {
      const sentEvents = b.sentEvents || [];
      const raw = sentEvents.reduce((s:number, e:any) => s + (Number(e.quantity) || 0), 0) + (Number(b.quantitySentRaw) || Number(b.quantitySent) || 0);
      const acc = sentEvents.reduce((s:number, e:any) => s + (Number(e.accessorySent) || 0), 0) + (Number(b.quantitySentAccessory) || 0);
      return sum + raw + acc;
  }, 0);
  
  const totalReceived = batches.reduce((sum, b) => {
      const recEvents = b.receiveEvents || [];
      const raw = recEvents.reduce((s:number, e:any) => s + (Number(e.quantityRaw) || 0), 0) + (Number(b.receivedQuantity) || 0);
      const acc = recEvents.reduce((s:number, e:any) => s + (Number(e.quantityAccessory) || 0), 0);
      return sum + raw + acc;
  }, 0);

  return (
    <div className="fixed inset-0 z-[100] bg-slate-50 flex flex-col animate-in slide-in-from-bottom-4 duration-300 font-sans">
      
      {/* 2. Professional Header - Clean & Centered */}
      <div className="bg-white border-b border-slate-200 flex items-center justify-between px-6 py-3 shrink-0 z-50 shadow-sm relative">
           
           {/* Left: Navigation */}
           <div className="flex items-center gap-3 w-1/3">
              <button 
                onClick={onClose}
                className="w-8 h-8 flex items-center justify-center rounded-lg bg-white border border-slate-200 text-slate-500 hover:bg-slate-50 hover:text-slate-800 transition-all hover:border-slate-300 shadow-sm"
                title="Back"
              >
                  <ArrowLeft size={16} strokeWidth={2.5} />
              </button>
              <span className="text-xs font-bold text-slate-400 uppercase tracking-widest hidden md:inline-block">Technical Sheet</span>
           </div>

           {/* Center: Title & Identity */}
           <div className="flex flex-col items-center justify-center w-1/3 text-center">
                  <h2 className="text-lg font-extrabold text-slate-800 tracking-tight leading-tight px-4 truncate max-w-full" title={order.material}>
                      {order.material}
                  </h2>
                  <div className="flex items-center gap-2 mt-0.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-indigo-500"></span>
                      <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">{customerName}</span>
                  </div>
           </div>

           {/* Right: Actions / Quick Stats */}
           <div className="flex items-center justify-end gap-3 w-1/3 text-right">
              {/* Could put print/export actions here later */}
              <div className="text-right hidden md:block">
                  <div className="text-[10px] text-slate-400 font-medium">Order ID</div>
                  <div className="text-xs font-mono font-bold text-slate-600">#{order.id.slice(-6)}</div>
              </div>
           </div>
      </div>

      {/* 3. Dashboard Strip - Summary Data */}
      <div className="bg-white border-b border-slate-200 px-8 py-4 flex flex-wrap items-center justify-center gap-8 shrink-0">
           {/* Planned Status */}
           <div className="flex flex-col items-center">
               <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Total Planned</span>
               <div className="flex items-baseline gap-1">
                   <span className="text-2xl font-black text-slate-700">{totalPlanned.toLocaleString()}</span>
                   <span className="text-xs font-bold text-slate-400">kg</span>
               </div>
           </div>
           
           <div className="h-8 w-px bg-slate-100"></div>

           {/* Sent Status */}
           <div className="flex flex-col items-center">
               <span className="text-[10px] font-bold text-blue-400 uppercase tracking-wider mb-1">Total Sent</span>
               <div className="flex items-baseline gap-1">
                   <span className="text-2xl font-black text-blue-600">{totalSent.toLocaleString()}</span>
                   <span className="text-xs font-bold text-blue-300">kg</span>
               </div>
           </div>

           <div className="h-8 w-px bg-slate-100"></div>

           {/* Received Status */}
           <div className="flex flex-col items-center">
               <span className="text-[10px] font-bold text-emerald-500 uppercase tracking-wider mb-1">Total Received</span>
               <div className="flex items-baseline gap-1">
                   <span className="text-2xl font-black text-emerald-500">{totalReceived.toLocaleString()}</span>
                   <span className="text-xs font-bold text-emerald-300">kg</span>
               </div>
           </div>

           {/* Progress Ring (Visual Flair) */}
           <div className="ml-4 flex items-center gap-3 bg-slate-50 px-4 py-2 rounded-full border border-slate-100">
                <div className="relative w-10 h-10">
                    <svg className="w-full h-full -rotate-90" viewBox="0 0 36 36">
                        <path className="text-slate-200" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" fill="none" stroke="currentColor" strokeWidth="4" />
                        <path className="text-emerald-500 transition-all duration-1000 ease-out" 
                              strokeDasharray={`${totalSent > 0 ? Math.min(100, (totalReceived / totalSent) * 100) : 0}, 100`} 
                              d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" 
                              fill="none" stroke="currentColor" strokeWidth="4" />
                    </svg>
                    <div className="absolute inset-0 flex items-center justify-center text-[10px] font-bold text-slate-600">
                        {totalSent > 0 ? Math.round((totalReceived / totalSent) * 100) : 0}%
                    </div>
                </div>
                <div className="flex flex-col">
                    <span className="text-xs font-bold text-slate-700">Completion</span>
                    <span className="text-[10px] text-slate-400 font-medium">Based on sent qty</span>
                </div>
           </div>
      </div>

      {/* 4. Main Content - Scrollable */}
      <div className="flex-1 overflow-y-auto bg-slate-50 p-6 md:p-8 scrollbar-thin scrollbar-thumb-slate-300 scrollbar-track-transparent">
         <div className="max-w-6xl mx-auto space-y-8">
             
             {/* Technical Specs Section - Redesigned */}
             <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
                  <div className="px-6 py-3 border-b border-slate-100 bg-slate-50/50 flex justify-between items-center text-left">
                      <h3 className="text-sm font-bold text-slate-700 flex items-center gap-2">
                          <Ruler size={16} className="text-indigo-500" />
                          Technical Specifications
                      </h3>
                      <button 
                          onClick={() => isEditing ? handleSaveSpecs() : setIsEditing(true)} 
                          className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${isEditing ? 'bg-indigo-600 text-white shadow-md shadow-indigo-200' : 'text-slate-500 hover:bg-slate-100'}`}
                      >
                          {isEditing ? <Check size={14} /> : <Edit2 size={14} />}
                          {isEditing ? 'Save Changes' : 'Edit Specs'}
                      </button>
                  </div>
                  
                  <div className="p-6 grid grid-cols-1 md:grid-cols-12 gap-8 items-start text-left">
                       {/* Required Specs Group */}
                       <div className="md:col-span-4 space-y-4">
                           <div className="text-[11px] font-bold text-slate-400 uppercase tracking-widest mb-2 border-b border-slate-100 pb-1">Required Standards</div>
                           <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="text-xs text-slate-500 font-medium block mb-1">Width</label>
                                    {isEditing ? (
                                        <div className="flex items-baseline border-b border-indigo-300">
                                            <input type="number" value={specs.requiredWidth} onChange={(e) => setSpecs({...specs, requiredWidth: e.target.value})} className="w-full font-bold text-slate-800 text-lg bg-transparent outline-none p-0" placeholder="-" />
                                            <span className="text-xs text-slate-400 ml-1">cm</span>
                                        </div>
                                    ) : (
                                        <div className="text-lg font-bold text-slate-700">{specs.requiredWidth || '-'} <span className="text-xs text-slate-400 font-normal">cm</span></div>
                                    )}
                                </div>
                                <div>
                                    <label className="text-xs text-slate-500 font-medium block mb-1">Weight (GSM)</label>
                                    {isEditing ? (
                                        <div className="flex items-baseline border-b border-indigo-300">
                                            <input type="number" value={specs.requiredGsm} onChange={(e) => setSpecs({...specs, requiredGsm: e.target.value})} className="w-full font-bold text-slate-800 text-lg bg-transparent outline-none p-0" placeholder="-" />
                                            <span className="text-xs text-slate-400 ml-1">gm</span>
                                        </div>
                                    ) : (
                                        <div className="text-lg font-bold text-slate-700">{specs.requiredGsm || '-'} <span className="text-xs text-slate-400 font-normal">gm</span></div>
                                    )}
                                </div>
                           </div>
                       </div>

                       {/* Divider */}
                       <div className="hidden md:block w-px bg-slate-100 h-24 col-span-1 mx-auto"></div>

                       {/* Finished Specs Group */}
                       <div className="md:col-span-4 space-y-4">
                           <div className="text-[11px] font-bold text-emerald-500/70 uppercase tracking-widest mb-2 border-b border-emerald-50 pb-1">Finished Results</div>
                           <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="text-xs text-emerald-600/70 font-medium block mb-1">Finished Width</label>
                                    {isEditing ? (
                                        <div className="flex items-baseline border-b border-emerald-300">
                                            <input type="number" value={specs.finishedWidth} onChange={(e) => setSpecs({...specs, finishedWidth: e.target.value})} className="w-full font-bold text-emerald-700 text-lg bg-transparent outline-none p-0" placeholder="-" />
                                            <span className="text-xs text-emerald-400 ml-1">cm</span>
                                        </div>
                                    ) : (
                                        <div className="text-lg font-bold text-emerald-600">{specs.finishedWidth || '-'} <span className="text-xs text-emerald-400 font-normal">cm</span></div>
                                    )}
                                </div>
                                <div>
                                    <label className="text-xs text-emerald-600/70 font-medium block mb-1">Finished GSM</label>
                                    {isEditing ? (
                                        <div className="flex items-baseline border-b border-emerald-300">
                                            <input type="number" value={specs.finishedGsm} onChange={(e) => setSpecs({...specs, finishedGsm: e.target.value})} className="w-full font-bold text-emerald-700 text-lg bg-transparent outline-none p-0" placeholder="-" />
                                            <span className="text-xs text-emerald-400 ml-1">gm</span>
                                        </div>
                                    ) : (
                                        <div className="text-lg font-bold text-emerald-600">{specs.finishedGsm || '-'} <span className="text-xs text-emerald-400 font-normal">gm</span></div>
                                    )}
                                </div>
                           </div>
                       </div>

                       {/* Notes Group */}
                       <div className="md:col-span-3 space-y-2 h-full flex flex-col">
                           <div className="text-[11px] font-bold text-slate-400 uppercase tracking-widest mb-1">Notes</div>
                           <textarea 
                              value={specs.finishingNotes} 
                              onChange={(e) => setSpecs({...specs, finishingNotes: e.target.value})} 
                              disabled={!isEditing} 
                              className={`w-full flex-1 text-xs p-3 resize-none outline-none leading-relaxed min-h-[80px] ${isEditing ? 'bg-slate-50 rounded-lg border border-slate-200 focus:bg-white focus:ring-2 ring-indigo-100 transition-all' : 'bg-slate-50/50 rounded-lg border border-transparent text-slate-500 italic'}`}
                              placeholder={isEditing ? "Add technical notes here..." : "No finishing notes added."} 
                            />
                       </div>
                  </div>
             </div>

             {/* Cards Grid */}
             <div className="flex flex-col gap-6 pb-10">
            {batches.map((batch, idx) => {
               const sentEvents = batch.sentEvents || [];
               
               // Sent Calc
               const sentRaw = sentEvents.reduce((s:number, e:any) => s + (e.quantity || 0), 0) + (batch.quantitySentRaw || batch.quantitySent || 0);
               const sentAcc = sentEvents.reduce((s:number, e:any) => s + (e.accessorySent || 0), 0) + (batch.quantitySentAccessory || 0);
               const totalSent = sentRaw + sentAcc;

               // Receive Calc
               const receiveEvents = batch.receiveEvents || [];
               const recRaw = receiveEvents.reduce((s:number, e:any) => s + (e.quantityRaw || 0), 0) + (batch.receivedQuantity || 0);
               const recAcc = receiveEvents.reduce((s:number, e:any) => s + (e.quantityAccessory || 0), 0);
               const totalReceived = recRaw + recAcc;
               
               const remainingRaw = Math.max(0, sentRaw - recRaw);
               const remainingAcc = Math.max(0, sentAcc - recAcc);

               const formaDays = batch.formationDate ? Math.floor((new Date().getTime() - new Date(batch.formationDate).getTime()) / (1000 * 60 * 60 * 24)) : null;
               const sentDays = batch.dateSent ? Math.floor((new Date().getTime() - new Date(batch.dateSent).getTime()) / (1000 * 60 * 60 * 24)) : null;
               
               return (
                 <div key={idx} className="bg-white rounded border border-slate-300 overflow-hidden shadow-sm flex flex-col md:flex-col min-h-[140px] transform transition-all hover:shadow-md">
                     
                     {/* Top Bar: Identity & Status */}
                     <div className="p-3 border-b border-slate-200 bg-slate-50 flex flex-wrap gap-4 justify-between items-center">
                        <div className="flex items-center gap-3">
                            <div className="w-1.5 h-8 rounded-full" style={{backgroundColor: batch.colorHex || '#ddd'}}></div>
                            <span className="font-mono text-sm font-bold text-slate-400">#{idx + 1}</span>
                            <h3 className="font-bold text-slate-800 text-sm">{batch.color}</h3>
                            
                            {/* Dyehouse Select */}
                            <div className="ml-4 flex items-center gap-1">
                                <Factory size={12} className="text-slate-400" />
                                <select 
                                   value={batch.dyehouse || ''} 
                                   onChange={(e) => {
                                      const val = e.target.value;
                                      const newPlan = [...batches];
                                      const selectedDh = dyehouses.find((d: any) => d.name === val);
                                      let recommended = batch.plannedCapacity || null;
                                      if (selectedDh && selectedDh.machines && selectedDh.machines.length > 0) {
                                          const sorted = [...selectedDh.machines].sort((a: any, b: any) => a.capacity - b.capacity);
                                          const best = sorted.find((m: any) => m.capacity >= (batch.quantity || 0));
                                          recommended = best ? best.capacity : sorted[sorted.length - 1].capacity;
                                      }
                                      newPlan[idx] = { ...batch, dyehouse: val, plannedCapacity: recommended || null };
                                      onUpdateOrder(order.id, { dyeingPlan: newPlan });
                                   }}
                                   className="bg-transparent border-b border-transparent hover:border-slate-300 text-xs font-medium text-slate-700 outline-none focus:border-indigo-500 cursor-pointer"
                                >
                                    <option value="">Select Dyehouse</option>
                                    {dyehouses.map((d:any, i:number) => <option key={i} value={d.name}>{d.name}</option>)}
                                </select>
                            </div>
                        </div>

                        <div className="flex items-center gap-3">
                            {/* Status */}
                            <select 
                               value={batch.status || 'draft'}
                               onChange={(e) => {
                                  const newPlan = [...batches];
                                  newPlan[idx] = { ...batch, status: e.target.value };
                                  onUpdateOrder(order.id, { dyeingPlan: newPlan });
                               }}
                               className={`text-[10px] uppercase tracking-wider font-bold py-1 px-2 rounded border outline-none cursor-pointer ${
                                 batch.status === 'received' ? 'bg-emerald-100 text-emerald-800 border-emerald-200' :
                                 batch.status === 'sent' ? 'bg-blue-100 text-blue-800 border-blue-200' :
                                 batch.status === 'pending' ? 'bg-indigo-50 text-indigo-800 border-indigo-200' :
                                 'bg-slate-100 text-slate-600 border-slate-200'
                               }`}
                             >
                                <option value="draft">Draft</option>
                                <option value="pending">Planned</option>
                                <option value="sent">Sent</option>
                                <option value="received">Done</option>
                           </select>
                           
                           <button 
                             onClick={() => {
                                if(confirm('Delete batch?')) {
                                  const newPlan = batches.filter((_, i) => i !== idx);
                                  onUpdateOrder(order.id, { dyeingPlan: newPlan });
                                }
                             }}
                             className="text-slate-300 hover:text-red-500 transition-colors"
                           >
                             <Trash2 size={14} />
                           </button>
                        </div>
                     </div>

                     {/* Main Grid Content */}
                     <div className="p-4 grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-6 items-start text-left">
                        
                        {/* 1. Production Specs */}
                        <div className="space-y-3">
                            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider pb-1 border-b border-slate-100">Production</div>
                            <div>
                                <label className="text-[10px] text-slate-500 font-medium block">Planned Qty</label>
                                <div className="flex items-baseline gap-1">
                                    <input 
                                        type="number" 
                                        value={batch.quantity || ''} 
                                        onChange={(e) => {
                                            const newPlan = [...batches];
                                            newPlan[idx] = { ...batch, quantity: Number(e.target.value) };
                                            onUpdateOrder(order.id, { dyeingPlan: newPlan });
                                        }}
                                        className="w-16 bg-transparent font-mono font-bold text-slate-800 text-sm outline-none border-b border-transparent focus:border-indigo-300 placeholder:text-slate-300"
                                        placeholder="0"
                                    />
                                    <span className="text-[10px] text-slate-400">kg</span>
                                </div>
                            </div>
                            <div>
                                <label className="text-[10px] text-slate-500 font-medium block">Machine Cap</label>
                                <span className="font-mono text-xs font-bold text-slate-700 bg-slate-100 px-1.5 py-0.5 rounded">{batch.plannedCapacity || '-'}</span>
                            </div>

                            {/* Accessory Details Section */}
                            {batch.accessoryType && (
                                <div className="mt-4 pt-3 border-t border-slate-200">
                                    <div className="flex items-center gap-1.5 mb-2">
                                        <div className="flex items-center gap-1 px-1.5 py-0.5 bg-indigo-50 border border-indigo-200 rounded text-[10px] font-bold text-indigo-600">
                                            <Package size={12} />
                                            <span>Accessory Details</span>
                                        </div>
                                    </div>
                                    <div className="bg-slate-50 border border-slate-200 rounded p-2.5 space-y-3">
                                        <div>
                                            <label className="text-[9px] text-slate-500 font-bold uppercase block mb-0.5">Accessory Type</label>
                                            <input 
                                                type="text" 
                                                value={batch.accessoryType || ''}
                                                onChange={(e) => {
                                                    const newPlan = [...batches];
                                                    newPlan[idx] = { ...batch, accessoryType: e.target.value };
                                                    onUpdateOrder(order.id, { dyeingPlan: newPlan });
                                                }}
                                                className="w-full text-[11px] bg-white border border-slate-200 outline-none focus:border-indigo-400 rounded px-2 py-1.5 text-slate-700"
                                                placeholder="e.g., Rib, Collar..."
                                            />
                                        </div>
                                        <div>
                                            <label className="text-[9px] text-slate-500 font-bold uppercase block mb-0.5">Accessory Dispatch #</label>
                                            <input 
                                                type="text" 
                                                value={batch.accessoryDispatchNumber || ''}
                                                onChange={(e) => {
                                                    const newPlan = [...batches];
                                                    newPlan[idx] = { ...batch, accessoryDispatchNumber: e.target.value };
                                                    onUpdateOrder(order.id, { dyeingPlan: newPlan });
                                                }}
                                                className="w-full text-[11px] bg-white border border-slate-200 rounded px-2 py-1.5 text-slate-700 focus:border-indigo-400 outline-none font-mono"
                                                placeholder="Enter dispatch #..."
                                            />
                                        </div>
                                        <div className="grid grid-cols-2 gap-3">
                                            <div>
                                                <label className="text-[9px] text-slate-500 font-bold uppercase block mb-0.5">Sent Date</label>
                                                <input 
                                                    type="date" 
                                                    value={batch.accessoryDateSent || ''}
                                                    onChange={(e) => {
                                                        const newPlan = [...batches];
                                                        newPlan[idx] = { ...batch, accessoryDateSent: e.target.value };
                                                        onUpdateOrder(order.id, { dyeingPlan: newPlan });
                                                    }}
                                                    className="w-full text-[11px] bg-white border border-slate-200 rounded px-2 py-1.5 text-slate-700 focus:border-indigo-400 outline-none cursor-pointer"
                                                />
                                            </div>
                                            <div>
                                                <label className="text-[9px] text-slate-500 font-bold uppercase block mb-0.5">Formation Date</label>
                                                <input 
                                                    type="date" 
                                                    value={batch.accessoryFormationDate || ''}
                                                    onChange={(e) => {
                                                        const newPlan = [...batches];
                                                        newPlan[idx] = { ...batch, accessoryFormationDate: e.target.value };
                                                        onUpdateOrder(order.id, { dyeingPlan: newPlan });
                                                    }}
                                                    className="w-full text-[11px] bg-white border border-slate-200 rounded px-2 py-1.5 text-slate-700 focus:border-indigo-400 outline-none cursor-pointer"
                                                />
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* 2. Timeline */}
                        <div className="space-y-3">
                            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider pb-1 border-b border-slate-100">Timeline</div>
                            <div>
                                <label className="text-[10px] text-slate-500 font-medium block flex justify-between">
                                    Formation
                                    {formaDays !== null && <span className="text-[9px] text-slate-400">{formaDays}d ago</span>}
                                </label>
                                <div className="relative group/date">
                                    <div className="flex items-center gap-1.5 mt-0.5 border-b border-transparent group-hover/date:border-slate-300 transition-colors">
                                        <Calendar size={10} className="text-slate-400" />
                                        <span className={`font-mono text-xs ${batch.formationDate ? 'text-slate-800' : 'text-slate-300'}`}>
                                            {formatCompactDate(batch.formationDate)}
                                        </span>
                                    </div>
                                    <input 
                                       type="date" 
                                       value={batch.formationDate || ''}
                                       onChange={(e) => {
                                           const newPlan = [...batches];
                                           newPlan[idx] = { ...batch, formationDate: e.target.value };
                                           onUpdateOrder(order.id, { dyeingPlan: newPlan });
                                       }}
                                       className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                                    />
                                </div>
                            </div>
                            <div>
                                <label className="text-[10px] text-slate-500 font-medium block flex justify-between">
                                    Sending Date
                                    {sentDays !== null && <span className="text-[9px] text-slate-400">{sentDays}d ago</span>}
                                </label>
                                <div className="relative group/date">
                                    <div className="flex items-center gap-1.5 mt-0.5 border-b border-transparent group-hover/date:border-slate-300 transition-colors">
                                        <Calendar size={10} className="text-slate-400" />
                                        <span className={`font-mono text-xs ${batch.dateSent ? 'text-slate-800' : 'text-slate-300'}`}>
                                            {formatCompactDate(batch.dateSent)}
                                        </span>
                                    </div>
                                    <input 
                                       type="date" 
                                       value={batch.dateSent || ''}
                                       onChange={(e) => {
                                           const newPlan = [...batches];
                                           newPlan[idx] = { ...batch, dateSent: e.target.value };
                                           onUpdateOrder(order.id, { dyeingPlan: newPlan });
                                       }}
                                       className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                                    />
                                </div>
                            </div>
                        </div>

                        {/* 3. Logistics */}
                        <div className="space-y-3">
                            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider pb-1 border-b border-slate-100">Logistics</div>
                            <div>
                                <label className="text-[10px] text-slate-500 font-medium block">Dispatch Number</label>
                                <input 
                                   type="text" 
                                   value={batch.dispatchNumber || ''} 
                                   onChange={(e) => {
                                     const newPlan = [...batches];
                                     newPlan[idx] = { ...batch, dispatchNumber: e.target.value };
                                     onUpdateOrder(order.id, { dyeingPlan: newPlan });
                                   }}
                                   className="w-full bg-transparent border-b border-slate-200 mt-0.5 text-xs font-mono text-slate-700 focus:border-indigo-500 outline-none" 
                                   placeholder="-" 
                                />
                            </div>
                            <div>
                                <label className="text-[10px] text-slate-500 font-medium block">Color Approval</label>
                                <input 
                                   type="text" 
                                   value={batch.colorApproval || ''} 
                                   onChange={(e) => {
                                     const newPlan = [...batches];
                                     newPlan[idx] = { ...batch, colorApproval: e.target.value };
                                     onUpdateOrder(order.id, { dyeingPlan: newPlan });
                                   }}
                                   className={`w-full bg-transparent border-b border-slate-200 mt-0.5 text-xs font-bold ${batch.colorApproval ? 'text-emerald-600' : 'text-slate-300'} focus:border-indigo-500 outline-none`} 
                                   placeholder="Pending" 
                                />
                            </div>
                        </div>

                        {/* 4. Execution (Buttons) */}
                        <div className="space-y-2 md:col-span-2 lg:col-span-1">
                            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider pb-1 border-b border-slate-100">Execution</div>
                            
                            {/* SENT */}
                            <button 
                                onClick={() => setSentModal({ isOpen: true, batchIdx: idx, batch })}
                                className={`w-full flex items-center justify-between px-3 py-2 rounded text-xs transition-colors border ${
                                    totalSent > 0 
                                    ? 'bg-blue-50 border-blue-200 text-blue-700' 
                                    : 'bg-white border-slate-200 text-slate-400 hover:border-blue-300 hover:text-blue-600'
                                }`}
                            >
                                <div className="flex flex-col items-start">
                                    <span className="text-[9px] uppercase font-bold opacity-70">Sent</span>
                                    <span className="font-mono font-bold text-sm leading-none">{sentRaw > 0 ? sentRaw : '-'}</span>
                                </div>
                                {sentAcc > 0 && <span className="text-[9px] bg-blue-100 text-blue-800 px-1.5 py-0.5 rounded-full font-bold">+{sentAcc} Acc</span>}
                            </button>

                            {/* RECEIVED */}
                            <button 
                                onClick={() => setReceiveModal({ isOpen: true, batchIdx: idx, batch })}
                                className={`w-full flex items-center justify-between px-3 py-2 rounded text-xs transition-colors border ${
                                    totalReceived > 0 
                                    ? 'bg-emerald-50 border-emerald-200 text-emerald-700' 
                                    : 'bg-white border-slate-200 text-slate-400 hover:border-emerald-300 hover:text-emerald-600'
                                }`}
                            >
                                <div className="flex flex-col items-start">
                                    <span className="text-[9px] uppercase font-bold opacity-70">Rcvd</span>
                                    <span className="font-mono font-bold text-sm leading-none">{recRaw > 0 ? Math.round(recRaw) : '-'}</span>
                                </div>
                                {recAcc > 0 && <span className="text-[9px] bg-emerald-100 text-emerald-800 px-1.5 py-0.5 rounded-full font-bold">+{recAcc} Acc</span>}
                            </button>
                            
                            {(remainingRaw > 0 || remainingAcc > 0) && totalSent > 0 && (
                                 <div className="text-[10px] text-right text-amber-600 font-medium mt-1">
                                     Missing: <span className="font-mono font-bold">-{remainingRaw + remainingAcc}</span>
                                 </div>
                            )}
                        </div>

                        {/* 5. Notes (Full remaining space on LG) */}
                        <div className="md:col-span-4 lg:col-span-1 border-t md:border-t-0 md:border-l border-slate-100 md:pl-4 pt-3 md:pt-0">
                            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider pb-1 border-b border-slate-100 mb-2">Notes</div>
                            <textarea 
                                value={batch.notes || ''} 
                                onChange={(e) => {
                                    const newPlan = [...batches];
                                    newPlan[idx] = { ...batch, notes: e.target.value };
                                    onUpdateOrder(order.id, { dyeingPlan: newPlan });
                                }}
                                className="w-full text-xs bg-slate-50 rounded p-2 text-slate-600 outline-none focus:bg-white focus:ring-1 ring-indigo-200 min-h-[80px] resize-none"
                                placeholder="Add technical notes..." 
                            />
                        </div>

                     </div>
                 </div>
               )
            })}
        </div>
      </div>
    </div>

       {/* SENT MODAL */}
       {sentModal.isOpen && sentModal.batch && (
        <div className="fixed inset-0 z-[150] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4 text-right" dir="rtl">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg overflow-hidden animate-in fade-in zoom-in-95">
                <div className="bg-slate-50 p-4 border-b border-slate-200 flex justify-between items-center">
                    <h3 className="font-bold text-slate-700">تسجيل شحنات مرسلة</h3>
                    <button onClick={() => setSentModal({ isOpen: false, batchIdx: -1, batch: null })} className="p-2 hover:bg-slate-200 rounded-full"><X size={18}/></button>
                </div>
                
                <div className="p-4 max-h-[400px] overflow-y-auto space-y-3">
                   {/* Existing Events */}
                   {(sentModal.batch.sentEvents || []).map((ev: any, i: number) => (
                       <div key={i} className="flex justify-between items-center p-3 bg-white border border-slate-200 rounded-lg">
                           <div className="text-right">
                               <div className="text-sm font-bold text-slate-700">{ev.quantity} kg <span className="text-[10px] text-slate-400 font-normal">Raw</span></div>
                               {ev.accessorySent > 0 && <div className="text-xs text-blue-600 font-bold">+{ev.accessorySent} kg <span className="font-normal text-slate-400">Acc</span></div>}
                               <div className="text-[10px] text-slate-400">{ev.date}</div>
                           </div>
                           <button onClick={() => {
                               const newPlan = [...batches];
                               newPlan[sentModal.batchIdx].sentEvents = newPlan[sentModal.batchIdx].sentEvents.filter((_:any, idx:number) => idx !== i);
                               onUpdateOrder(order.id, { dyeingPlan: newPlan });
                               setSentModal({...sentModal, batch: newPlan[sentModal.batchIdx]});
                           }} className="text-red-400 hover:text-red-600"><Trash2 size={14} /></button>
                       </div>
                   ))}

                   {/* Add New */}
                   <div className="bg-slate-50 p-4 rounded-lg mt-4 border border-slate-100">
                       <label className="block text-xs font-bold text-slate-500 mb-2">اضافة جديد</label>
                       
                       {/* Input Grid */}
                       <div className="grid grid-cols-2 gap-3 mb-3">
                           <input type="date" value={newSent.date} onChange={e => setNewSent({...newSent, date: e.target.value})} className="p-2 border rounded text-xs" />
                           <input type="number" placeholder="Raw Qty (kg)" value={newSent.quantity || ''} onChange={e => setNewSent({...newSent, quantity: Number(e.target.value)})} className="p-2 border rounded text-xs" />
                       </div>
                       <div className="mb-3">
                           <input type="number" placeholder="Accessory Qty (kg)" value={newSent.accessorySent || ''} onChange={e => setNewSent({...newSent, accessorySent: Number(e.target.value)})} className="w-full p-2 border rounded text-xs" />
                       </div>
                       
                       <input type="text" placeholder="ملاحظات" value={newSent.notes} onChange={e => setNewSent({...newSent, notes: e.target.value})} className="w-full p-2 border rounded text-xs mb-3" />
                       <button 
                         onClick={() => {
                             const newPlan = [...batches];
                             // Clone the target batch to avoid mutating the original reference in place
                             const updatedBatch = { ...newPlan[sentModal.batchIdx] }; 
                             const events = [...(updatedBatch.sentEvents || [])];
                             events.push({ ...newSent, id: Date.now().toString() });
                             updatedBatch.sentEvents = events;
                             
                             // Auto Update Status
                             if(updatedBatch.status === 'draft') updatedBatch.status = 'sent';
                             
                             newPlan[sentModal.batchIdx] = updatedBatch;

                             onUpdateOrder(order.id, { dyeingPlan: newPlan });
                             setSentModal({...sentModal, batch: updatedBatch});
                             setNewSent({ date: new Date().toISOString().split('T')[0], quantity: 0, accessorySent: 0, notes: '' });
                         }}
                         className="w-full py-2 bg-blue-600 text-white rounded-lg text-xs font-bold hover:bg-blue-700"
                       >
                           اضافة
                       </button>
                   </div>
                </div>
            </div>
        </div>
      )}

      {/* RECEIVE MODAL */}
       {receiveModal.isOpen && receiveModal.batch && (
        <div className="fixed inset-0 z-[150] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4 text-right" dir="rtl">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg overflow-hidden animate-in fade-in zoom-in-95">
                <div className="bg-slate-50 p-4 border-b border-slate-200 flex justify-between items-center">
                    <h3 className="font-bold text-slate-700">تسجيل استلام قماش</h3>
                    <button onClick={() => setReceiveModal({ isOpen: false, batchIdx: -1, batch: null })} className="p-2 hover:bg-slate-200 rounded-full"><X size={18}/></button>
                </div>

                {/* Scrap / Pending Summary (New) */}
                <div className="bg-slate-100 p-3 mx-4 mt-4 rounded-lg flex items-center justify-between text-xs">
                    {( () => {
                        const batch = receiveModal.batch;
                        
                        // Total Sent Logic
                        const rawSent = (batch.sentEvents || []).reduce((s:number,e:any)=>s+(e.quantity||0),0) + (batch.quantitySentRaw || batch.quantitySent || 0);
                        const accSent = (batch.sentEvents || []).reduce((s:number,e:any)=>s+(e.accessorySent||0),0) + (batch.quantitySentAccessory || 0);

                        // Total Received Logic
                        const rawRec = (batch.receiveEvents || []).reduce((s:number,e:any)=>s+(e.quantityRaw||0),0) + (batch.receivedQuantity || 0);
                        const accRec = (batch.receiveEvents || []).reduce((s:number,e:any)=>s+(e.quantityAccessory||0),0);

                        return (
                            <>
                               <div className="text-center">
                                   <div className="text-[10px] text-slate-400 uppercase font-bold">Planned To Receive</div>
                                   <div className="font-mono font-bold text-slate-700">{rawSent} <span className="text-[9px] text-slate-400">Raw</span> {accSent > 0 && <span className="text-blue-600">+{accSent} Acc</span>}</div>
                               </div>
                               <div className="h-6 w-px bg-slate-300 mx-2"></div>
                               <div className="text-center">
                                   <div className="text-[10px] text-slate-400 uppercase font-bold">Pending</div>
                                   <div className={`font-mono font-bold ${(rawSent + accSent - rawRec - accRec) > 0 ? 'text-amber-600' : 'text-emerald-600'}`}>
                                       {Math.max(0, (rawSent + accSent) - (rawRec + accRec))} <span className="text-[9px] opacity-70">kg</span>
                                   </div>
                               </div>
                            </>
                        );
                    })()}
                </div>
                
                <div className="p-4 max-h-[400px] overflow-y-auto space-y-3">
                   {/* Existing Events */}
                   {(receiveModal.batch.receiveEvents || []).map((ev: any, i: number) => (
                       <div key={i} className="flex justify-between items-center p-3 bg-white border border-slate-200 rounded-lg">
                           <div className="text-right">
                               <div className="text-sm font-bold text-emerald-700">{ev.quantityRaw} kg <span className="text-[10px] text-slate-400 font-normal">Raw</span></div>
                               {ev.quantityAccessory > 0 && <div className="text-xs text-blue-600 font-bold">+{ev.quantityAccessory} kg <span className="font-normal text-slate-400">Acc</span></div>}
                               <div className="text-xs text-slate-400">{ev.date}</div>
                           </div>
                           <button onClick={() => {
                               const newPlan = [...batches];
                               newPlan[receiveModal.batchIdx].receiveEvents = newPlan[receiveModal.batchIdx].receiveEvents.filter((_:any, idx:number) => idx !== i);
                               onUpdateOrder(order.id, { dyeingPlan: newPlan });
                               setReceiveModal({...receiveModal, batch: newPlan[receiveModal.batchIdx]});
                           }} className="text-red-400 hover:text-red-600"><Trash2 size={14} /></button>
                       </div>
                   ))}

                   {/* Add New */}
                   <div className="bg-slate-50 p-4 rounded-lg mt-4 border border-slate-100">
                       <label className="block text-xs font-bold text-slate-500 mb-2">اضافة جديد</label>
                       
                       {/* Input Grid */}
                       <div className="grid grid-cols-2 gap-3 mb-3">
                           <input type="date" value={newReceive.date} onChange={e => setNewReceive({...newReceive, date: e.target.value})} className="p-2 border rounded text-xs" />
                           <input type="number" placeholder="Raw Qty (kg)" value={newReceive.quantity || ''} onChange={e => setNewReceive({...newReceive, quantity: Number(e.target.value)})} className="p-2 border rounded text-xs" />
                       </div>
                       <div className="mb-3">
                           <input type="number" placeholder="Accessory Qty (kg)" value={newReceive.accessoryReceive || ''} onChange={e => setNewReceive({...newReceive, accessoryReceive: Number(e.target.value)})} className="w-full p-2 border rounded text-xs" />
                       </div>
                       
                       <input type="text" placeholder="ملاحظات" value={newReceive.notes} onChange={e => setNewReceive({...newReceive, notes: e.target.value})} className="w-full p-2 border rounded text-xs mb-3" />
                       <button 
                         onClick={() => {
                             const newPlan = [...batches];
                             const updatedBatch = { ...newPlan[receiveModal.batchIdx] };
                             const events = [...(updatedBatch.receiveEvents || [])];
                             events.push({ 
                                 ...newReceive, 
                                 id: Date.now().toString(),
                                 quantityRaw: newReceive.quantity, // Key mapping for compat
                                 quantityAccessory: newReceive.accessoryReceive 
                            });
                             updatedBatch.receiveEvents = events;
                             
                             // Auto Update Status
                             if(updatedBatch.status !== 'received') {
                                 const totalSent = (updatedBatch.sentEvents || []).reduce((s:number,e:any)=>s+(e.quantity||0),0);
                                 const totalRec = events.reduce((s:number,e:any)=>s+(e.quantityRaw||0),0);
                                 if (totalRec >= totalSent && totalSent > 0) updatedBatch.status = 'received';
                             }

                             newPlan[receiveModal.batchIdx] = updatedBatch;

                             onUpdateOrder(order.id, { dyeingPlan: newPlan });
                             setReceiveModal({...receiveModal, batch: updatedBatch});
                             setNewReceive({ date: new Date().toISOString().split('T')[0], quantity: 0, accessoryReceive: 0, notes: '', sentEventId: '' });
                         }}
                         className="w-full py-2 bg-emerald-600 text-white rounded-lg text-xs font-bold hover:bg-emerald-700"
                       >
                           اضافة استلام
                       </button>
                   </div>
                </div>
            </div>
        </div>
      )}

    </div>
  );
};
