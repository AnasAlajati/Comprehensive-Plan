import React, { useState, useEffect } from 'react';
import { X, Calendar, Wrench, Save, History, ChevronDown, ChevronUp, Edit2, Trash2, PlusCircle } from 'lucide-react';
import { MachineRow } from '../types';

interface MachineMaintenanceModalProps {
  isOpen: boolean;
  onClose: () => void;
  machine: MachineRow;
  initialView?: 'form' | 'history';
  onSave: (machineId: string, date: string, notes: string) => Promise<void>;
  onDelete?: (machineId: string, logId: string) => Promise<void>;
  onUpdateLog?: (machineId: string, logId: string, date: string, notes: string) => Promise<void>;
}

export const MachineMaintenanceModal: React.FC<MachineMaintenanceModalProps> = ({
  isOpen,
  onClose,
  machine,
  initialView = 'form',
  onSave,
  onDelete,
  onUpdateLog
}) => {
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [notes, setNotes] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [viewMode, setViewMode] = useState<'form' | 'history'>('form');
  const [editingId, setEditingId] = useState<string | null>(null);

  const [localHistory, setLocalHistory] = useState<any[]>([]);

  useEffect(() => {
    if (isOpen) {
      // Reset form
      resetForm();
      setViewMode(initialView);
      setLocalHistory(machine.maintenanceHistory || []);
    }
  }, [isOpen, machine, initialView]);

  const resetForm = () => {
      setDate(new Date().toISOString().split('T')[0]);
      setNotes('');
      setEditingId(null);
  };

  const handleEditClick = (log: any) => {
    setEditingId(log.id);
    setDate(log.date);
    setNotes(log.notes);
    setViewMode('form');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!date || !notes.trim()) return;

    setIsSubmitting(true);
    try {
      const machineId = machine.firestoreId || machine.id.toString();
      
      if (editingId && onUpdateLog) {
          await onUpdateLog(machineId, editingId, date, notes);
      } else {
          await onSave(machineId, date, notes);
      }
      onClose();
    } catch (error: any) {
      console.error(error);
      alert(`Operation Failed:\n${error.message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async (logId: string) => {
      if (!onDelete || !window.confirm('Are you sure you want to delete this log?')) return;
      try {
          await onDelete(machine.firestoreId || machine.id.toString(), logId);
          // Instant UI update
          setLocalHistory(prev => prev.filter(h => h.id !== logId));
          alert('Log deleted successfully');
      } catch (e: any) {
          console.error(e);
          alert(`Delete Failed:\n${e.message}`);
      }
  };

  if (!isOpen) return null;

  const sortedHistory = [...localHistory].sort((a: any, b: any) => new Date(b.date).getTime() - new Date(a.date).getTime());

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 sm:p-6">
      <div className="bg-white w-full h-full sm:h-auto sm:max-h-[90vh] sm:max-w-2xl sm:rounded-2xl shadow-xl flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        
        {/* Header */}
        <div className="flex justify-between items-center p-4 border-b border-slate-100 bg-slate-50">
          <div>
            <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2">
              <Wrench className="text-orange-500" size={20} />
              {viewMode === 'form' ? (editingId ? 'Edit Maintenance Log' : 'Add Maintenance Log') : 'Maintenance History'}
            </h2>
            <p className="text-xs text-slate-500 font-mono mt-0.5">{machine.machineName} - {machine.brand}</p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-slate-200 rounded-full transition-colors text-slate-500">
            <X size={24} />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5">
          
          {viewMode === 'form' ? (
            /* Form View */
            <div className="space-y-6">
                <form onSubmit={handleSubmit} className="space-y-4">
                    <div>
                    <label className="block text-sm font-semibold text-slate-700 mb-1.5 ml-1">Maintenance Date</label>
                    <div className="relative">
                        <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                        <input 
                        type="date"
                        required
                        value={date}
                        onChange={(e) => setDate(e.target.value)}
                        className="w-full pl-10 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-orange-500 focus:border-orange-500 outline-none transition-all font-medium text-slate-800"
                        />
                    </div>
                    </div>

                    <div>
                    <label className="block text-sm font-semibold text-slate-700 mb-1.5 ml-1">Notes / Work Done</label>
                    <textarea 
                        required
                        value={notes}
                        onChange={(e) => setNotes(e.target.value)}
                        placeholder="Describe what was fixed, changed or serviced..."
                        rows={4}
                        className="w-full p-4 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-orange-500 focus:border-orange-500 outline-none transition-all resize-none text-slate-800 placeholder:text-slate-400"
                    />
                    </div>

                    <div className="flex gap-3">
                        {editingId && (
                            <button 
                                type="button" 
                                onClick={() => { setEditingId(null); setDate(new Date().toISOString().split('T')[0]); setNotes(''); }}
                                className="px-6 py-3.5 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-xl font-bold transition-all"
                            >
                                Cancel
                            </button>
                        )}
                        <button 
                        type="submit"
                        disabled={isSubmitting}
                        className="flex-1 py-3.5 bg-orange-600 hover:bg-orange-700 text-white rounded-xl font-bold shadow-lg shadow-orange-200 active:scale-[0.98] transition-all flex items-center justify-center gap-2 disabled:opacity-70 disabled:cursor-not-allowed"
                        >
                        {isSubmitting ? 'Saving...' : (
                            <>
                            {editingId ? <Save size={20} /> : <PlusCircle size={20} />}
                            {editingId ? 'Update Record' : 'Save Maintenance Record'}
                            </>
                        )}
                        </button>
                    </div>
                </form>

                {sortedHistory.length > 0 && (
                    <div className="pt-6 border-t border-slate-100">
                        <button 
                            onClick={() => setViewMode('history')}
                            className="w-full py-3 bg-white border border-slate-200 text-slate-600 font-bold rounded-xl hover:bg-slate-50 transition-colors flex items-center justify-center gap-2"
                        >
                            <History size={18} />
                            View Maintenance History ({sortedHistory.length})
                        </button>
                    </div>
                )}
            </div>
          ) : (
            /* History View */
            <div className="space-y-4">
                <button 
                    onClick={() => setViewMode('form')}
                    className="w-full py-3 mb-2 bg-orange-100 text-orange-700 font-bold rounded-xl hover:bg-orange-200 transition-colors flex items-center justify-center gap-2"
                >
                    <PlusCircle size={18} />
                    Add New Maintenance Log
                </button>

                {sortedHistory.length === 0 ? (
                  <div className="text-center py-12 bg-slate-50 rounded-xl border border-dashed border-slate-200 text-slate-400">
                    <History className="mx-auto mb-2 opacity-50" size={32} />
                    <p>No history records found.</p>
                  </div>
                ) : (
                  sortedHistory.map((item, idx) => (
                    <div key={idx} className="bg-white border border-slate-200 p-4 rounded-xl shadow-sm hover:shadow-md transition-all">
                      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-2 mb-3">
                        <span className="text-sm font-bold text-slate-700 bg-slate-100 px-3 py-1 rounded-lg w-fit">
                          {new Date(item.date).toLocaleDateString(undefined, {
                             weekday: 'short',
                             year: 'numeric',
                             month: 'short',
                             day: 'numeric'
                          })}
                        </span>
                        <div className="flex items-center gap-2">
                             {item.technician && (
                                <span className="text-xs font-semibold bg-blue-50 text-blue-600 px-2 py-0.5 rounded border border-blue-100">
                                    {item.technician}
                                </span>
                             )}
                            <span className="text-xs text-slate-400 font-mono">
                            {new Date(item.createdAt || item.date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </span>
                        </div>
                      </div>
                      <p className="text-slate-700 text-sm leading-relaxed whitespace-pre-wrap pl-3 border-l-4 border-orange-200 mb-4">
                        {item.notes}
                      </p>
                      
                      {/* Actions */}
                      <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-50">
                           <button 
                             onClick={() => handleEditClick(item)}
                             className="px-3 py-1.5 bg-white border border-slate-200 text-slate-600 rounded-lg text-xs font-bold hover:bg-slate-50 hover:text-blue-600 transition-colors flex items-center gap-1.5"
                           >
                               <Edit2 size={14} /> Edit
                           </button>
                           <button 
                             onClick={() => handleDelete(item.id)}
                             className="px-3 py-1.5 bg-white border border-slate-200 text-slate-600 rounded-lg text-xs font-bold hover:bg-red-50 hover:text-red-600 hover:border-red-100 transition-colors flex items-center gap-1.5"
                           >
                               <Trash2 size={14} /> Delete
                           </button>
                      </div>
                    </div>
                  ))
                )}
            </div>
          )}

        </div>
      </div>
    </div>
  );
};
