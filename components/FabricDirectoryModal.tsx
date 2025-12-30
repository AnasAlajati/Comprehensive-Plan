import React, { useState, useEffect, useMemo } from 'react';
import { collection, getDocs, doc, setDoc } from 'firebase/firestore';
import { db } from '../services/firebase';
import { FabricDefinition } from '../types';
import { FabricFormModal } from './FabricFormModal';
import { Search, X, Edit, Loader2, Book } from 'lucide-react';

interface FabricDirectoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  machines: any[];
}

export const FabricDirectoryModal: React.FC<FabricDirectoryModalProps> = ({ isOpen, onClose, machines }) => {
  const [fabrics, setFabrics] = useState<FabricDefinition[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [editingFabric, setEditingFabric] = useState<FabricDefinition | null>(null);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);

  useEffect(() => {
    if (isOpen) {
      fetchFabrics();
    }
  }, [isOpen]);

  const fetchFabrics = async () => {
    setLoading(true);
    try {
      const querySnapshot = await getDocs(collection(db, 'FabricSS'));
      const data: FabricDefinition[] = [];
      querySnapshot.forEach((doc) => {
        data.push({ id: doc.id, ...doc.data() } as FabricDefinition);
      });
      setFabrics(data.sort((a, b) => {
        const aComplete = !!(a.shortName && a.code && a.variants && a.variants.length > 0);
        const bComplete = !!(b.shortName && b.code && b.variants && b.variants.length > 0);
        
        if (aComplete === bComplete) return a.name.localeCompare(b.name);
        return aComplete ? 1 : -1; // Incomplete first
      }));
    } catch (error) {
      console.error("Error fetching fabrics:", error);
    } finally {
      setLoading(false);
    }
  };

  const filteredFabrics = useMemo(() => {
    if (!searchTerm) return fabrics;
    const lower = searchTerm.toLowerCase();
    return fabrics.filter(f => 
      f.name.toLowerCase().includes(lower) || 
      (f.shortName && f.shortName.toLowerCase().includes(lower)) ||
      (f.code && f.code.toLowerCase().includes(lower))
    );
  }, [fabrics, searchTerm]);

  const handleEditClick = (fabric: FabricDefinition) => {
    setEditingFabric(fabric);
    setIsEditModalOpen(true);
  };

  const handleSaveFabric = async (formData: Partial<FabricDefinition>) => {
    if (!formData.name) return;

    try {
      const docId = editingFabric?.id || formData.name.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
      
      const fabricData: FabricDefinition = {
        ...editingFabric, // Keep existing data
        id: docId,
        name: formData.name,
        code: formData.code || '',
        shortName: formData.shortName || '',
        // Preserve other fields if they exist in formData or editingFabric
        variants: formData.variants || editingFabric?.variants || [],
        workCenters: formData.workCenters || editingFabric?.workCenters || [],
      };

      if (formData.specs) {
        fabricData.specs = formData.specs;
      }

      await setDoc(doc(db, 'FabricSS', docId), fabricData, { merge: true });
      
      // Update local list
      setFabrics(prev => prev.map(f => f.id === docId ? fabricData : f));
      setIsEditModalOpen(false);
      setEditingFabric(null);
    } catch (err) {
      console.error("Error saving fabric:", err);
      alert("Failed to save fabric changes");
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-4xl max-h-[85vh] flex flex-col">
        
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-slate-100">
          <div className="flex items-center gap-3">
            <div className="bg-blue-100 p-2 rounded-lg text-blue-600">
              <Book size={24} />
            </div>
            <div>
              <h2 className="text-xl font-bold text-slate-800">Fabric Directory</h2>
              <p className="text-xs text-slate-500">View and edit fabric definitions</p>
            </div>
          </div>
          <button 
            onClick={onClose}
            className="p-2 hover:bg-slate-100 rounded-full text-slate-400 hover:text-slate-600 transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        {/* Search Bar */}
        <div className="p-4 bg-slate-50 border-b border-slate-100">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-5 h-5" />
            <input
              type="text"
              placeholder="Search by name, short name, or code..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-3 bg-white border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none shadow-sm text-sm"
              autoFocus
            />
          </div>
        </div>

        {/* List Content */}
        <div className="flex-1 overflow-y-auto p-2">
          {loading ? (
            <div className="flex flex-col items-center justify-center h-64 text-slate-400">
              <Loader2 className="w-8 h-8 animate-spin mb-2" />
              <p>Loading fabrics...</p>
            </div>
          ) : filteredFabrics.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 text-slate-400">
              <p>No fabrics found matching "{searchTerm}"</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-2">
              {filteredFabrics.map((fabric) => {
                const isComplete = !!(fabric.shortName && fabric.code && fabric.variants && fabric.variants.length > 0);
                return (
                <div 
                  key={fabric.id}
                  className={`group flex items-center justify-between p-3 border rounded-lg hover:shadow-sm transition-all ${
                    isComplete 
                      ? 'bg-white border-slate-100 hover:border-blue-200' 
                      : 'bg-red-50 border-red-200 hover:border-red-300'
                  }`}
                >
                  <div className="flex-1 min-w-0 mr-4">
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className={`font-semibold truncate ${isComplete ? 'text-slate-800' : 'text-red-800'}`} title={fabric.name}>
                        {fabric.name}
                      </h3>
                      {fabric.code && (
                        <span className="px-1.5 py-0.5 bg-slate-100 text-slate-500 text-[10px] rounded font-mono">
                          {fabric.code}
                        </span>
                      )}
                      {!isComplete && (
                        <span className="px-1.5 py-0.5 bg-red-100 text-red-600 text-[10px] rounded font-bold">
                          Incomplete
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 text-xs text-slate-500">
                      <span className="font-medium text-slate-400">Short Name:</span>
                      {fabric.shortName ? (
                        <span className="bg-blue-50 text-blue-700 px-2 py-0.5 rounded border border-blue-100">
                          {fabric.shortName}
                        </span>
                      ) : (
                        <span className="text-red-400 italic">Missing</span>
                      )}
                    </div>
                  </div>
                  
                  <button
                    onClick={() => handleEditClick(fabric)}
                    className={`p-2 rounded-lg transition-colors opacity-0 group-hover:opacity-100 focus:opacity-100 ${
                        isComplete 
                        ? 'text-slate-400 hover:text-blue-600 hover:bg-blue-50' 
                        : 'text-red-400 hover:text-red-700 hover:bg-red-100'
                    }`}
                    title="Edit Fabric"
                  >
                    <Edit size={18} />
                  </button>
                </div>
              )})}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-3 border-t border-slate-100 bg-slate-50 text-xs text-slate-500 text-center rounded-b-xl">
          Showing {filteredFabrics.length} of {fabrics.length} fabrics
        </div>
      </div>

      {/* Edit Modal */}
      {isEditModalOpen && (
        <FabricFormModal
          isOpen={isEditModalOpen}
          onClose={() => setIsEditModalOpen(false)}
          initialData={editingFabric || undefined}
          onSave={handleSaveFabric}
          machines={machines}
        />
      )}
    </div>
  );
};
