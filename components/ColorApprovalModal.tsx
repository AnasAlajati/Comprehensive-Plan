import React, { useState } from 'react';
import { X, Plus, Trash2, Check, AlertCircle } from 'lucide-react';
import { DyeingBatch, ColorApproval } from '../types';

interface ColorApprovalModalProps {
  isOpen: boolean;
  onClose: () => void;
  batch: DyeingBatch;
  dyehouses: any[]; // List of available dyehouses
  onSave: (updatedBatch: DyeingBatch) => void;
}

export const ColorApprovalModal: React.FC<ColorApprovalModalProps> = ({
  isOpen,
  onClose,
  batch,
  dyehouses,
  onSave
}) => {
  // Use props directly for the list source of truth (managed by parent via onSave)
  const approvals = batch.colorApprovals || [];
  
  const [newApproval, setNewApproval] = useState<Partial<ColorApproval>>({
    dyehouseName: batch.dyehouse || '',
    approvalCode: '',
    dyehouseColor: '',
    notes: '',
    date: new Date().toISOString().split('T')[0]
  });

  const handleAdd = () => {
    if (!newApproval.approvalCode) return;

    const entry: ColorApproval = {
      id: `ca-${Date.now()}`,
      dyehouseName: newApproval.dyehouseName || 'Unknown',
      approvalCode: newApproval.approvalCode || '',
      dyehouseColor: newApproval.dyehouseColor || '',
      notes: newApproval.notes || '',
      date: newApproval.date || new Date().toISOString().split('T')[0]
    };

    const updatedApprovals = [...approvals, entry];
    
    // Auto-select if it's the only one
    let newSelectedCode = batch.colorApproval;
    if (updatedApprovals.length === 1) {
        newSelectedCode = entry.approvalCode;
    }
    
    // IMMEDIATE SAVE PATTERN (Like Sent Modal)
    const updatedBatch = {
      ...batch,
      colorApprovals: updatedApprovals,
      colorApproval: newSelectedCode
    };
    
    onSave(updatedBatch);
    
    // Reset form but keep dyehouse
    setNewApproval({
      ...newApproval,
      approvalCode: '',
      dyehouseColor: '',
      notes: ''
    });
  };

  const handleDelete = (id: string) => {
    const updatedApprovals = approvals.filter(a => a.id !== id);
    
    let newSelectedCode = batch.colorApproval;

    // If we deleted the actively selected approval, clear it
    if (batch.colorApproval === approvals.find(a => a.id === id)?.approvalCode) {
        newSelectedCode = '';
    }

    // Auto-select if ONLY 1 remains
    if (updatedApprovals.length === 1) {
        newSelectedCode = updatedApprovals[0].approvalCode;
    }

    const updatedBatch = {
        ...batch,
        colorApprovals: updatedApprovals,
        colorApproval: newSelectedCode
    };
    onSave(updatedBatch);
  };

  const handleSelect = (approval: ColorApproval) => {
    // Set this as the active approval for the batch immediately
    const updatedBatch = {
      ...batch,
      colorApproval: approval.approvalCode, 
    };
    onSave(updatedBatch);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg overflow-hidden animate-in fade-in zoom-in-95 duration-200" dir="rtl">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50">
          <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
            <Check className="w-5 h-5 text-indigo-600" />
            ادارة موافقات اللون
          </h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 transition-colors">
            <X size={20} />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 max-h-[70vh] overflow-y-auto custom-scrollbar">
          
          {/* Add New Form */}
          <div className="bg-slate-50 p-4 rounded-lg border border-slate-200 mb-6">
            <div className="text-sm font-semibold text-slate-700 mb-3 flex items-center gap-2">
                <Plus size={16} className="text-indigo-600" />
                اضافة موافقة جديدة
            </div>
            <div className="grid grid-cols-2 gap-3 mb-3">
                <div className="col-span-2">
                    <label className="block text-xs text-slate-500 mb-1">المصبغة</label>
                    <select
                        value={newApproval.dyehouseName}
                        onChange={e => setNewApproval({...newApproval, dyehouseName: e.target.value})}
                        className="w-full px-3 py-2 border border-slate-300 rounded-md text-sm outline-none focus:border-indigo-500"
                    >
                        <option value="">اختر مصبغة...</option>
                        {dyehouses.map((d: any) => (
                            <option key={d.name} value={d.name}>{d.name}</option>
                        ))}
                    </select>
                </div>
                <div>
                    <label className="block text-xs text-slate-500 mb-1">موافقة اللون (Reference)</label>
                    <input 
                        type="text"
                        value={newApproval.approvalCode}
                        onChange={e => setNewApproval({...newApproval, approvalCode: e.target.value})}
                        className="w-full px-3 py-2 border border-slate-300 rounded-md text-sm outline-none focus:border-indigo-500"
                        placeholder="K-123..."
                    />
                </div>
                <div>
                    <label className="block text-xs text-slate-500 mb-1">لون المصبغة (Dyehouse Color)</label>
                    <input 
                        type="text"
                        value={newApproval.dyehouseColor}
                        onChange={e => setNewApproval({...newApproval, dyehouseColor: e.target.value})}
                        className="w-full px-3 py-2 border border-slate-300 rounded-md text-sm outline-none focus:border-indigo-500"
                        placeholder="Navy Blue..."
                    />
                </div>
                <div className="col-span-2">
                    <label className="block text-xs text-slate-500 mb-1">ملاحظات</label>
                    <input 
                        type="text"
                        value={newApproval.notes}
                        onChange={e => setNewApproval({...newApproval, notes: e.target.value})}
                        className="w-full px-3 py-2 border border-slate-300 rounded-md text-sm outline-none focus:border-indigo-500"
                        placeholder="ملاحظات اضافية..."
                    />
                </div>
            </div>
            <button 
                onClick={handleAdd}
                disabled={!newApproval.approvalCode || !newApproval.dyehouseName}
                className="w-full py-2 bg-indigo-600 text-white rounded-md text-sm font-medium hover:bg-indigo-700 disabled:bg-slate-300 disabled:cursor-not-allowed transition-colors"
            >
                اضافة للقائمة
            </button>
          </div>

          {/* List */}
          <div className="space-y-3">
             <div className="flex items-center justify-between text-xs text-slate-500 px-1">
                <span>الموافقات المسجلة ({approvals.length})</span>
                <span>اضغط للتعيين كمعتمد</span>
             </div>
             
             {approvals.length === 0 ? (
                 <div className="text-center py-8 text-slate-400 border-2 border-dashed border-slate-200 rounded-lg">
                    لا توجد موافقات مسجلة
                 </div>
             ) : (
                 approvals.map((app) => (
                     <div 
                        key={app.id}
                        className={`group relative p-3 rounded-lg border transition-all ${
                            batch.colorApproval === app.approvalCode 
                                ? 'bg-emerald-50 border-emerald-200 shadow-sm ring-1 ring-emerald-200' 
                                : 'bg-white border-slate-200 hover:border-indigo-300 hover:shadow-sm'
                        }`}
                     >
                        {/* Header Row */}
                        <div className="flex justify-between items-start mb-2">
                             <div className="flex flex-col">
                                 <span className="font-bold text-slate-800 text-base">{app.approvalCode}</span>
                                 <span className="text-xs text-slate-500">{app.dyehouseName}</span>
                             </div>
                             
                             {/* Status Badge */}
                             {batch.colorApproval === app.approvalCode && (
                                 <div className="flex items-center gap-1 bg-emerald-100 text-emerald-700 px-2 py-1 rounded-full border border-emerald-200 shadow-sm">
                                    <Check size={12} strokeWidth={3} />
                                    <span className="text-[10px] font-bold">معتمد</span>
                                 </div>
                             )}
                        </div>
                        
                        {/* Details Grid */}
                        <div className="grid grid-cols-2 gap-2 text-xs text-slate-600 bg-slate-50/50 p-2 rounded mb-3">
                            {app.dyehouseColor && (
                                <div><span className="text-slate-400">لون المصبغة:</span> <span className="font-medium">{app.dyehouseColor}</span></div>
                            )}
                            <div className="text-left" dir="ltr">
                                <span className="text-slate-400 text-[10px]">{app.date}</span>
                            </div>
                            {app.notes && (
                                <div className="col-span-2 border-t border-slate-100 pt-1 mt-1"><span className="text-slate-400">ملاحظات:</span> {app.notes}</div>
                            )}
                        </div>

                        {/* Actions Footer */}
                        <div className="flex items-center justify-between pt-2 border-t border-slate-100 opacity-60 group-hover:opacity-100 transition-opacity">
                            {/* Delete Button (Left Side / Start) */}
                             <button 
                                onClick={(e) => { e.stopPropagation(); handleDelete(app.id); }}
                                className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors flex items-center gap-1"
                                title="حذف"
                            >
                                <Trash2 size={14} />
                                <span className="text-[10px]">حذف</span>
                            </button>

                            {/* Select Button (Right Side / End) - Only if not selected */}
                            {batch.colorApproval !== app.approvalCode && (
                                <button
                                    onClick={() => handleSelect(app)}
                                    className="px-3 py-1.5 bg-indigo-50 text-indigo-600 hover:bg-indigo-100 hover:text-indigo-700 rounded text-xs font-bold transition-colors shadow-sm flex items-center gap-1.5"
                                >
                                    <span>تعيين كمعتمد</span>
                                    <Check size={14} />
                                </button>
                            )}
                        </div>
                     </div>
                 ))
             )}
          </div>

        </div>

        {/* Footer */}
        <div className="px-6 py-4 bg-slate-50 border-t border-slate-200 flex justify-end gap-3">
          <button 
            onClick={onClose}
            className="px-6 py-2 bg-slate-800 text-white hover:bg-slate-900 rounded-lg text-sm font-medium transition-colors shadow-sm"
          >
            اغلاق (تم الحفظ)
          </button>
        </div>
      </div>
    </div>
  );
};
