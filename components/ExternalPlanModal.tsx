import React, { useState, useEffect } from 'react';
import { X, Factory, Plus, Trash2, Calendar, Package, CheckCircle, Clock, Play } from 'lucide-react';
import { ExternalPlanAssignment } from '../types';

interface ExternalFactory {
  id: string;
  name: string;
}

interface ExternalPlanModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (assignments: ExternalPlanAssignment[]) => Promise<void>;
  fabric: string;
  client: string;
  totalQuantity: number;
  existingAssignments?: ExternalPlanAssignment[];
  externalFactories: ExternalFactory[];
  userEmail?: string;
}

export const ExternalPlanModal: React.FC<ExternalPlanModalProps> = ({
  isOpen,
  onClose,
  onSave,
  fabric,
  client,
  totalQuantity,
  existingAssignments,
  externalFactories,
  userEmail
}) => {
  const [assignments, setAssignments] = useState<ExternalPlanAssignment[]>([]);
  const [saving, setSaving] = useState(false);
  const [selectedFactoryId, setSelectedFactoryId] = useState('');

  useEffect(() => {
    if (isOpen) {
      setAssignments(existingAssignments || []);
    }
  }, [isOpen, existingAssignments]);

  const addFactory = () => {
    if (!selectedFactoryId) return;
    
    const factory = externalFactories.find(f => f.id === selectedFactoryId);
    if (!factory) return;
    
    // Check if already added
    if (assignments.some(a => a.factoryId === selectedFactoryId)) return;

    const remaining = totalQuantity - assignments.reduce((sum, a) => sum + a.quantity, 0);

    setAssignments(prev => [...prev, {
      id: `ext-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      factoryId: selectedFactoryId,
      factoryName: factory.name,
      quantity: Math.max(0, remaining),
      status: 'planned',
      createdAt: new Date().toISOString(),
      createdBy: userEmail
    }]);
    
    setSelectedFactoryId('');
  };

  const updateAssignment = (index: number, field: keyof ExternalPlanAssignment, value: any) => {
    setAssignments(prev => {
      const updated = [...prev];
      updated[index] = { ...updated[index], [field]: value };
      return updated;
    });
  };

  const removeAssignment = (index: number) => {
    setAssignments(prev => prev.filter((_, i) => i !== index));
  };

  const totalExternal = assignments.reduce((sum, a) => sum + a.quantity, 0);

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave(assignments);
      onClose();
    } catch (error) {
      console.error("Error saving external plan:", error);
    } finally {
      setSaving(false);
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'completed': return <CheckCircle size={14} className="text-emerald-500" />;
      case 'in-progress': return <Play size={14} className="text-blue-500" />;
      default: return <Clock size={14} className="text-amber-500" />;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'completed': return 'bg-emerald-100 text-emerald-700 border-emerald-200';
      case 'in-progress': return 'bg-blue-100 text-blue-700 border-blue-200';
      default: return 'bg-amber-100 text-amber-700 border-amber-200';
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[9999] p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl overflow-hidden">
        {/* Header */}
        <div className="bg-gradient-to-r from-orange-500 to-red-500 p-4 text-white">
          <div className="flex justify-between items-center">
            <div className="flex items-center gap-3">
              <Factory size={24} />
              <div>
                <h3 className="font-bold text-lg">External Production</h3>
                <p className="text-orange-100 text-sm">{fabric} • {client}</p>
              </div>
            </div>
            <button onClick={onClose} className="text-white/80 hover:text-white">
              <X size={24} />
            </button>
          </div>
        </div>

        <div className="p-6 space-y-4 max-h-[70vh] overflow-y-auto">
          {/* Summary */}
          <div className="bg-orange-50 rounded-lg p-4 border border-orange-100">
            <div className="grid grid-cols-3 gap-4 text-center">
              <div>
                <div className="text-2xl font-bold text-orange-600">{totalQuantity.toLocaleString()}</div>
                <div className="text-xs text-orange-500">Order Total (kg)</div>
              </div>
              <div>
                <div className="text-2xl font-bold text-red-600">{totalExternal.toLocaleString()}</div>
                <div className="text-xs text-red-500">External (kg)</div>
              </div>
              <div>
                <div className="text-2xl font-bold text-slate-600">{(totalQuantity - totalExternal).toLocaleString()}</div>
                <div className="text-xs text-slate-500">Internal (kg)</div>
              </div>
            </div>
          </div>

          {/* Add Factory */}
          <div className="flex gap-2">
            <select
              value={selectedFactoryId}
              onChange={(e) => setSelectedFactoryId(e.target.value)}
              className="flex-1 p-2 border border-slate-200 rounded-lg text-sm"
            >
              <option value="">Select external factory...</option>
              {externalFactories
                .filter(f => !assignments.some(a => a.factoryId === f.id))
                .map(f => (
                  <option key={f.id} value={f.id}>{f.name}</option>
                ))}
            </select>
            <button
              onClick={addFactory}
              disabled={!selectedFactoryId}
              className="px-4 py-2 bg-orange-600 text-white rounded-lg font-medium hover:bg-orange-700 disabled:opacity-50 flex items-center gap-2"
            >
              <Plus size={16} />
              Add
            </button>
          </div>

          {/* Assignments List */}
          {assignments.length > 0 ? (
            <div className="space-y-3">
              <h4 className="font-medium text-slate-700">External Assignments</h4>
              
              {assignments.map((assign, idx) => (
                <div key={assign.id} className="bg-slate-50 rounded-lg p-4 border border-slate-200 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Factory size={18} className="text-orange-500" />
                      <span className="font-bold text-slate-800">{assign.factoryName}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <select
                        value={assign.status}
                        onChange={(e) => updateAssignment(idx, 'status', e.target.value)}
                        className={`text-xs px-2 py-1 rounded-full border font-medium ${getStatusColor(assign.status)}`}
                      >
                        <option value="planned">Planned</option>
                        <option value="in-progress">In Progress</option>
                        <option value="completed">Completed</option>
                      </select>
                      <button
                        onClick={() => removeAssignment(idx)}
                        className="text-slate-400 hover:text-red-500 p-1"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>
                  
                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <label className="text-[10px] text-slate-500 uppercase">Quantity (kg)</label>
                      <div className="flex items-center gap-2">
                        <Package size={14} className="text-slate-400" />
                        <input
                          type="number"
                          value={assign.quantity}
                          onChange={(e) => updateAssignment(idx, 'quantity', parseInt(e.target.value) || 0)}
                          className="w-full p-2 border border-slate-200 rounded text-sm"
                          min={0}
                        />
                      </div>
                    </div>
                    <div>
                      <label className="text-[10px] text-slate-500 uppercase">Start Date</label>
                      <div className="flex items-center gap-2">
                        <Calendar size={14} className="text-slate-400" />
                        <input
                          type="date"
                          value={assign.startDate || ''}
                          onChange={(e) => updateAssignment(idx, 'startDate', e.target.value)}
                          className="w-full p-2 border border-slate-200 rounded text-sm"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="text-[10px] text-slate-500 uppercase">End Date</label>
                      <div className="flex items-center gap-2">
                        <Calendar size={14} className="text-slate-400" />
                        <input
                          type="date"
                          value={assign.endDate || ''}
                          onChange={(e) => updateAssignment(idx, 'endDate', e.target.value)}
                          className="w-full p-2 border border-slate-200 rounded text-sm"
                        />
                      </div>
                    </div>
                  </div>
                  
                  <div>
                    <label className="text-[10px] text-slate-500 uppercase">Notes</label>
                    <input
                      type="text"
                      value={assign.notes || ''}
                      onChange={(e) => updateAssignment(idx, 'notes', e.target.value)}
                      placeholder="Add notes..."
                      className="w-full p-2 border border-slate-200 rounded text-sm"
                    />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-8 text-slate-400">
              <Factory size={48} className="mx-auto mb-2 opacity-50" />
              <p>No external factories assigned</p>
              <p className="text-xs mt-1">Select a factory above to outsource part of this order</p>
            </div>
          )}

          {/* Info Note */}
          {externalFactories.length === 0 && (
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-sm text-blue-700">
              <strong>Tip:</strong> Create external factories in the Planning Schedule → External view first, then come back here to assign orders to them.
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-slate-100 bg-slate-50 flex justify-between items-center">
          <div className="text-xs text-slate-500">
            {assignments.length} external assignment{assignments.length !== 1 ? 's' : ''}
          </div>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 text-slate-600 hover:bg-slate-200 rounded-lg font-medium"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-4 py-2 bg-orange-600 text-white rounded-lg font-medium hover:bg-orange-700 disabled:opacity-50 flex items-center gap-2"
            >
              {saving ? 'Saving...' : 'Save External Plan'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
