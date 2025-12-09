

import React, { useState, useRef, useEffect } from 'react';
import { MachineRow, MachineStatus } from '../types';
import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';
import { DataService } from '../services/dataService';

interface MachineListProps {
  machines: MachineRow[];
  loading: boolean;
  onDelete?: (id: number) => void;
  onUploadDefaults?: () => void;
  onUpdate?: (machine: MachineRow) => Promise<void>;
}

export const MachineList: React.FC<MachineListProps> = ({ machines, loading, onDelete, onUploadDefaults, onUpdate }) => {
  const [editingId, setEditingId] = useState<number | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);
  const printRef = useRef<HTMLDivElement>(null);

  const handleDownloadPDF = async () => {
    if (!printRef.current) return;
    setIsDownloading(true);

    try {
      const element = printRef.current;
      
      const canvas = await html2canvas(element, {
        scale: 1.5,
        useCORS: true,
        backgroundColor: '#f8fafc',
        ignoreElements: (el) => el.classList.contains('no-print') || el.tagName === 'BUTTON',
      });

      const imgData = canvas.toDataURL('image/png');
      const pdf = new jsPDF('l', 'mm', 'a4');
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const margin = 10;
      
      const imgProps = pdf.getImageProperties(imgData);
      
      const contentWidth = pageWidth - (margin * 2);
      const contentHeight = (imgProps.height * contentWidth) / imgProps.width;

      if (contentHeight <= pageHeight - (margin * 2)) {
          pdf.addImage(imgData, 'PNG', margin, margin, contentWidth, contentHeight);
      } else {
          let y = margin;
          // Split across pages logic if needed, currently scaling width
          pdf.addImage(imgData, 'PNG', margin, margin, contentWidth, contentHeight);
      }

      pdf.save('machine-cards-view.pdf');

    } catch (err) {
      console.error("PDF Error:", err);
      alert("Failed to generate PDF");
    } finally {
      setIsDownloading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-48 space-y-3">
        <svg className="animate-spin h-8 w-8 text-slate-800" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
        </svg>
        <p className="text-slate-500 text-sm">Loading machines...</p>
      </div>
    );
  }

  if (machines.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-center px-4 border-2 border-dashed border-slate-200 rounded-xl bg-slate-50/50">
        <p className="text-slate-500 font-medium mb-1">No machines found</p>
        {onUploadDefaults && (
          <button onClick={onUploadDefaults} className="bg-slate-800 hover:bg-slate-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors shadow-sm mt-4">
             Initialize Database
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button 
          onClick={handleDownloadPDF} 
          disabled={isDownloading}
          className="bg-slate-800 hover:bg-slate-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors shadow-sm disabled:opacity-50 flex items-center gap-2"
        >
          {isDownloading ? 'Capturing...' : 'Download Cards PDF'}
        </button>
      </div>
      
      <div ref={printRef} className="p-4 bg-slate-50 rounded-xl">
         <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {machines.map((machine) => (
            <MachineCard 
              key={machine.id} 
              machine={machine} 
              onUpdate={onUpdate} 
              isEditing={editingId === machine.id}
              onEditToggle={() => setEditingId(editingId === machine.id ? null : machine.id)}
            />
          ))}
        </div>
      </div>
    </div>
  );
};

interface MachineCardProps {
  machine: MachineRow;
  onUpdate?: (machine: MachineRow) => Promise<void>;
  isEditing: boolean;
  onEditToggle: () => void;
}

const MachineCard: React.FC<MachineCardProps> = ({ machine, onUpdate, isEditing, onEditToggle }) => {
  const isWorking = machine.status === MachineStatus.WORKING;
  const [localMachine, setLocalMachine] = useState(machine);
  const [pendingRef, setPendingRef] = useState<string | null>(null);
  const [showRefConfirm, setShowRefConfirm] = useState(false);

  useEffect(() => {
    if (!isEditing) {
      setLocalMachine(machine);
      setShowRefConfirm(false);
      setPendingRef(null);
    }
  }, [machine, isEditing]);

  const handleLocalUpdate = (field: keyof MachineRow, value: any) => {
    setLocalMachine(prev => ({ ...prev, [field]: value }));
  };

  const handleSave = async () => {
    if (!onUpdate) return;

    // Check for OrderSS match if Working
    if (localMachine.status === MachineStatus.WORKING && localMachine.client && localMachine.material) {
      // Only check if we haven't already confirmed or if values changed significantly
      const ref = await DataService.findOrderReference(localMachine.client, localMachine.material);
      
      if (ref && ref !== localMachine.orderReference) {
        setPendingRef(ref);
        setShowRefConfirm(true);
        return; // Stop save to show confirmation
      }
    }

    // Proceed with save
    await onUpdate(localMachine);
    onEditToggle();
  };

  const confirmReference = async (useReference: boolean) => {
    const updatedMachine = { 
      ...localMachine, 
      orderReference: useReference && pendingRef ? pendingRef : localMachine.orderReference 
    };
    
    if (onUpdate) await onUpdate(updatedMachine);
    setShowRefConfirm(false);
    onEditToggle();
  };

  if (isEditing) {
    if (showRefConfirm) {
      return (
        <div className="bg-white border border-indigo-200 rounded-xl shadow-md p-4 flex flex-col gap-3 relative h-auto z-10 ring-2 ring-indigo-50 animate-in fade-in zoom-in duration-200">
          <h3 className="font-bold text-indigo-800 border-b border-indigo-100 pb-2">Order Found!</h3>
          <p className="text-sm text-slate-600">
            Found existing order reference <span className="font-mono font-bold text-indigo-600 bg-indigo-50 px-1 rounded">{pendingRef}</span> for this client/fabric.
          </p>
          <p className="text-xs text-slate-500">Do you want to link this machine to that order?</p>
          
          <div className="flex gap-2 mt-2">
            <button 
              onClick={() => confirmReference(true)}
              className="flex-1 bg-indigo-600 text-white text-xs font-bold py-2 rounded hover:bg-indigo-700 transition-colors"
            >
              Yes, Link Order
            </button>
            <button 
              onClick={() => confirmReference(false)}
              className="flex-1 bg-slate-100 text-slate-600 text-xs font-bold py-2 rounded hover:bg-slate-200 transition-colors"
            >
              No, Keep Separate
            </button>
          </div>
        </div>
      );
    }

    return (
      <div className="bg-white border border-slate-200 rounded-xl shadow-md p-4 flex flex-col gap-3 relative h-auto z-10 ring-2 ring-blue-50">
        <button onClick={handleSave} className="absolute top-2 right-2 text-xs bg-blue-600 text-white px-3 py-1 font-semibold rounded-md hover:bg-blue-700 shadow-sm transition-colors">Save</button>
        <h3 className="font-semibold text-slate-800 border-b pb-2">Edit {machine.machineName}</h3>
        
        <div className="grid grid-cols-2 gap-2">
            <div>
            <label className="text-[10px] text-slate-500 font-bold block mb-1">Status</label>
            <select 
                className="w-full border border-slate-300 rounded p-1.5 text-sm bg-white text-slate-900 outline-none focus:ring-2 focus:ring-blue-500"
                value={localMachine.status}
                onChange={(e) => handleLocalUpdate('status', e.target.value)}
            >
                {Object.values(MachineStatus).map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            </div>
            <div>
            <label className="text-[10px] text-slate-500 font-bold block mb-1">Remaining</label>
            <input 
                type="number"
                className="w-full border border-slate-300 rounded p-1.5 text-sm bg-white text-slate-900 outline-none focus:ring-2 focus:ring-blue-500"
                value={localMachine.remainingMfg}
                onChange={(e) => handleLocalUpdate('remainingMfg', Number(e.target.value))}
            />
            </div>
        </div>

        <div>
           <label className="text-[10px] text-slate-500 font-bold block mb-1">Material</label>
           <input 
             className="w-full border border-slate-300 rounded p-1.5 text-sm bg-white text-slate-900 outline-none focus:ring-2 focus:ring-blue-500"
             value={localMachine.material}
             onChange={(e) => handleLocalUpdate('material', e.target.value)}
           />
        </div>

        <div>
           <label className="text-[10px] text-slate-500 font-bold block mb-1">Client</label>
           <input 
             className="w-full border border-slate-300 rounded p-1.5 text-sm bg-white text-slate-900 outline-none focus:ring-2 focus:ring-blue-500"
             value={localMachine.client}
             onChange={(e) => handleLocalUpdate('client', e.target.value)}
           />
        </div>
      </div>
    );
  }

  // --- READ ONLY VIEW ---
  
  const cardStyles = isWorking
    ? "bg-white border border-emerald-100 shadow-sm ring-0"
    : "bg-white border border-slate-100 shadow-sm";

  const headerStyles = isWorking
    ? "bg-transparent text-emerald-800 border-b border-emerald-50"
    : "bg-transparent text-slate-700 border-b border-slate-100";

  return (
  <div className={`overflow-hidden flex flex-col h-auto min-h-[8rem] transition-all hover:shadow-md ${cardStyles} relative group page-break-inside-avoid rounded-lg`}>
      
      {/* Edit Trigger */}
      <button 
        onClick={onEditToggle}
        className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity bg-white p-1 rounded-md border border-slate-100 text-slate-500 hover:text-blue-600 z-10 no-print"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
      </button>

      {/* Header */}
    <div className={`px-3 py-1.5 flex justify-between items-start gap-2 ${headerStyles}`}>
      <div className="flex-1 min-w-0">
        <h3 className="font-semibold text-base leading-tight truncate">{machine.machineName}</h3>
        <span className="text-xs opacity-70 font-mono tracking-wider block truncate">{machine.brand} • {machine.type}</span>
      </div>
    {!isWorking && (
      <span className="px-2 py-0.5 bg-slate-700 text-white text-xs font-semibold rounded uppercase tracking-wide whitespace-nowrap">
        Stopped
      </span>
    )}
      </div>

      {/* Content */}
  <div className="flex-1 p-2 flex flex-col justify-center gap-2">
        {isWorking ? (
            <>
                {/* Fabric Info */}
                <div>
                   <span className="text-[11px] uppercase text-emerald-600/70 font-medium tracking-wider block mb-0.5">Fabric</span>
                   <p className="text-slate-800 font-medium text-sm leading-tight line-clamp-2" title={machine.material}>
                      {machine.material || "-"}
                   </p>
                </div>

                <div className="grid grid-cols-2 gap-2">
                    {/* Customer Info */}
          <div className="bg-white rounded p-1 border border-emerald-50">
            <span className="text-xs uppercase text-emerald-600/70 font-medium tracking-wider block">Client</span>
            <p className="text-slate-900 font-medium text-sm truncate" title={machine.client}>
              {machine.client || "-"}
            </p>
          </div>

                    {/* Remaining Info */}
          <div className="bg-emerald-50/40 rounded p-1 border border-emerald-50 text-center">
            <span className="text-xs uppercase text-emerald-600/70 font-medium tracking-wider block">Remaining</span>
            <p className="text-emerald-800 font-semibold text-sm leading-none">
              {machine.remainingMfg} <span className="text-xs font-normal">kg</span>
            </p>
          </div>
                </div>
            </>
        ) : (
            <div className="flex flex-col items-center justify-center py-2 text-slate-400 space-y-1">
                <div className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center">
                    <svg className="w-4 h-4 text-slate-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
                    </svg>
                </div>
                <div className="text-center">
                    <p className="font-bold text-sm text-slate-500">{machine.status === 'OTHER' ? 'Maintenance / Other' : machine.status}</p>
                    {machine.customStatusNote && <p className="text-xs italic text-slate-400 mt-1 line-clamp-2">"{machine.customStatusNote}"</p>}
                </div>
            </div>
        )}
      </div>
    </div>
  );
};
