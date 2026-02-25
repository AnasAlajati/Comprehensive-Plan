import React, { useState, useEffect } from 'react';
import { Factory, Ship, Box, Check, PenBox, X } from 'lucide-react';
import { DyeingBatch } from '../types';

interface DyehouseTrackingModalProps {
  isOpen: boolean;
  onClose: () => void;
  batch: DyeingBatch;
  onSave: (updatedBatch: DyeingBatch) => void;
  userName?: string;
}

// Helper to determine if a hex color is light or dark
const isLightColor = (hex: string): boolean => {
  if (!hex) return true;
  const color = hex.replace('#', '');
  const r = parseInt(color.substr(0, 2), 16);
  const g = parseInt(color.substr(2, 2), 16);
  const b = parseInt(color.substr(4, 2), 16);
  const brightness = (r * 299 + g * 587 + b * 114) / 1000;
  return brightness > 128;
};

const STEPS = [
  { id: 'STORE_RAW', label: 'مخزن مصبغة', icon: Box, color: 'slate' },
  { id: 'DYEING', label: 'صباغة', icon: PenBox, color: 'purple' },
  { id: 'FINISHING', label: 'تجهيز', icon: Factory, color: 'orange' },
  { id: 'STORE_FINISHED', label: 'منتهي مخزن', icon: Ship, color: 'emerald' },
  { id: 'RECEIVED', label: 'مستلم', icon: Check, color: 'blue' }
] as const;

export const DyehouseTrackingModal: React.FC<DyehouseTrackingModalProps> = ({
  isOpen,
  onClose,
  batch,
  onSave,
  userName
}) => {
  const [history, setHistory] = useState<NonNullable<DyeingBatch['dyehouseHistory']>>([]);
  const [activeStatus, setActiveStatus] = useState<string>(batch.dyehouseStatus || '');

  useEffect(() => {
    if (isOpen) {
      setHistory(batch.dyehouseHistory || []);

      // Auto-infer status when none is manually set
      let inferredStatus = batch.dyehouseStatus || '';
      if (!inferredStatus) {
        // Collect sent quantities
        const sentEvents = batch.sentEvents || [];
        const sentRaw =
          sentEvents.reduce((s, e) => s + (Number(e.quantity) || 0), 0) +
          (Number(batch.quantitySentRaw) || Number(batch.quantitySent) || 0);
        const hasSent = sentRaw > 0;

        // Collect received quantities
        const receiveEvents = batch.receiveEvents || [];
        const recRaw =
          receiveEvents.reduce((s, e) => s + (Number(e.quantityRaw) || 0), 0) +
          (Number(batch.receivedQuantity) || 0);

        // Check scrap / completion signals
        const remainingPct =
          sentRaw > 0 ? ((sentRaw - recRaw) / sentRaw) * 100 : 100;
        const isReceived =
          batch.isComplete === true ||
          (Number(batch.scrapRaw) || 0) > 0 ||
          (recRaw > 0 && remainingPct <= 10);

        if (isReceived) {
          inferredStatus = 'RECEIVED';
        } else if (hasSent) {
          inferredStatus = 'STORE_RAW';
        }
      }

      setActiveStatus(inferredStatus);
    }
  }, [isOpen, batch]);

  if (!isOpen) return null;

  const handleStatusClick = (stepId: string) => {
    const now = new Date().toISOString();
    const today = now.split('T')[0];
    
    const existingEntryIndex = history.findIndex(h => h.status === stepId);
    let newHistory = [...history];

    if (existingEntryIndex === -1) {
       newHistory.push({
         status: stepId as any,
         date: today,
         updatedBy: userName
       });
    }

    setActiveStatus(stepId);
    setHistory(newHistory);

    const activeEntry = newHistory.find(h => h.status === stepId);
    onSave({
        ...batch,
        dyehouseStatus: stepId as any,
        dyehouseStatusDate: activeEntry?.date || today,
        dyehouseHistory: newHistory
    });
  };

  const handleDateChange = (stepId: string, date: string) => {
    const newHistory = history.map(h => 
        h.status === stepId ? { ...h, date } : h
    );
    
    if (activeStatus === stepId) {
         onSave({
            ...batch,
            dyehouseHistory: newHistory,
            dyehouseStatusDate: date
         });
    } else {
         onSave({
            ...batch,
            dyehouseHistory: newHistory
         });
    }
    setHistory(newHistory);
  };

  const getEntry = (stepId: string) => history.find(h => h.status === stepId);

  return (
    <div 
      className="fixed inset-0 bg-black/40 backdrop-blur-[2px] flex items-center justify-center z-[100] animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div 
        className="bg-white rounded-xl shadow-2xl w-full max-w-4xl p-8 border border-slate-100 flex flex-col mx-4 relative"
        onClick={e => e.stopPropagation()}
      >
        {/* Close Button */}
        <button 
          onClick={onClose}
          className="absolute top-4 right-4 p-2 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-500 hover:text-slate-700 transition-colors z-10"
        >
          <X size={20} />
        </button>
        
        {/* Header */}
        <div className="flex justify-between items-start mb-12 pr-10">
            <div>
                <h2 className="text-2xl font-bold text-slate-800 tracking-tight mb-2">Dyehouse Live Status</h2>
                <div className="flex items-center gap-3 text-slate-500 text-sm">
                    <span 
                        className="font-medium px-3 py-1 rounded-full border"
                        style={{ 
                            backgroundColor: batch.colorHex || '#e0e7ff',
                            color: batch.colorHex ? (isLightColor(batch.colorHex) ? '#1e293b' : '#ffffff') : '#4338ca',
                            borderColor: batch.colorHex || '#c7d2fe'
                        }}
                    >
                        {batch.color || 'No Color'}
                    </span>
                    <span className="text-slate-300">|</span>
                    <span className="flex items-center gap-1">
                        <Factory size={14} />
                        {batch.dyehouse || 'Unknown Dyehouse'}
                    </span>
                </div>
            </div>
            
            {/* Legend / Status Pill */}
             <div className="flex items-center gap-2">
                 <span className={`px-4 py-1.5 rounded-full text-sm font-bold border ${
                    activeStatus === 'RECEIVED' ? 'bg-blue-50 text-blue-700 border-blue-200' :
                    activeStatus === 'FINISHING' ? 'bg-orange-50 text-orange-700 border-orange-200' : 
                    activeStatus === 'DYEING' ? 'bg-purple-50 text-purple-700 border-purple-200' :
                    'bg-slate-50 text-slate-600 border-slate-200'
                 }`}>
                    {STEPS.find(s => s.id === activeStatus)?.label || 'Not Started'}
                 </span>
             </div>
        </div>

        {/* Horizontal Timeline */}
        <div className="relative py-8 px-4">
             {/* Progress Line Background */}
            <div className="absolute top-1/2 left-0 right-0 h-1 bg-slate-100 -translate-y-1/2 rounded-full" />
            
            {/* Progress Line Active (Dynamic width based on active step) */}
            <div 
                className="absolute top-1/2 left-0 h-1 bg-gradient-to-r from-blue-600 to-indigo-600 -translate-y-1/2 rounded-full transition-all duration-700 ease-in-out" 
                style={{ 
                    width: `${Math.max(0, (STEPS.findIndex(s => s.id === activeStatus) / (STEPS.length - 1)) * 100)}%` 
                }}
            />

            <div className="relative flex justify-between items-start w-full">
                {STEPS.map((step, idx) => {
                    const entry = getEntry(step.id);
                    const isActive = activeStatus === step.id;
                    const isCompleted = !!entry;
                    const isFuture = !isCompleted && !isActive;
                    const Icon = step.icon;
                    
                    return (
                        <div key={step.id} className="flex flex-col items-center group relative w-32">
                             {/* Connector Dot */}
                             <button
                                onClick={() => handleStatusClick(step.id)}
                                className={`
                                    w-14 h-14 rounded-full flex items-center justify-center border-4 transition-all duration-300 z-10 shadow-sm
                                    ${isActive 
                                        ? `bg-white border-indigo-600 text-indigo-600 ring-4 ring-indigo-50 scale-110` 
                                        : isCompleted 
                                            ? 'bg-indigo-600 border-indigo-600 text-white hover:bg-indigo-700' 
                                            : 'bg-white border-slate-200 text-slate-300 hover:border-slate-300 hover:bg-slate-50'
                                    }
                                `}
                             >
                                {isCompleted && !isActive ? <Check strokeWidth={3} size={20} /> : <Icon size={24} strokeWidth={1.5} />}
                             </button>

                             {/* Label & Date */}
                             <div className="mt-4 text-center flex flex-col items-center gap-1 transition-all duration-300">
                                <span className={`text-sm font-bold ${isActive ? 'text-indigo-900 scale-105' : isCompleted ? 'text-slate-700' : 'text-slate-400'}`}>
                                    {step.label}
                                </span>
                                
                                {entry ? (
                                    <div className="flex flex-col items-center animate-in slide-in-from-bottom-2 fade-in">
                                        <div className="relative group/date">
                                             <input 
                                                type="date" 
                                                value={entry.date}
                                                onChange={(e) => handleDateChange(step.id, e.target.value)}
                                                className="bg-transparent text-center text-[11px] font-mono text-slate-500 w-24 outline-none hover:text-indigo-600 cursor-pointer"
                                            />
                                            <div className="opacity-0 group-hover/date:opacity-100 absolute -right-3 top-0 text-slate-300">
                                                <PenBox size={10} />
                                            </div>
                                        </div>
                                    </div>
                                ) : (
                                    <span className="text-[10px] text-slate-300 font-mono h-[17px] opacity-0 group-hover:opacity-100 transition-opacity">--/--/----</span>
                                )}
                             </div>
                        </div>
                    );
                })}
            </div>
        </div>
      </div>
    </div>
  );
};
