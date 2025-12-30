import React, { useState } from 'react';
import { Plus } from 'lucide-react';
import { doc, setDoc } from 'firebase/firestore';
import { db } from '../services/firebase';
import { FabricDefinition } from '../types';
import { FabricFormModal } from './FabricFormModal';

interface GlobalFabricButtonProps {
  machines: any[];
}

export const GlobalFabricButton: React.FC<GlobalFabricButtonProps> = ({ machines }) => {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const handleSaveFabric = async (formData: Partial<FabricDefinition>) => {
    if (!formData.name) return;

    setSaving(true);
    try {
      const docId = formData.name.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
      
      // Auto-calculate specs based on work centers
      const workCenterList = formData.workCenters || [];
      let specs = undefined;
      
      if (workCenterList.length > 0) {
        // Find all machines linked to these work centers
        const linkedMachines = machines.filter(m => workCenterList.includes(m.machineName || m.name));
        
        if (linkedMachines.length > 0) {
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
      
      setIsModalOpen(false);
      // Optional: Show a toast or notification here
    } catch (err) {
      console.error("Error saving fabric:", err);
      alert("Failed to save fabric");
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <button
        onClick={() => setIsModalOpen(true)}
        className="fixed bottom-6 right-6 z-50 bg-blue-600 hover:bg-blue-700 text-white p-4 rounded-full shadow-lg transition-all duration-200 hover:scale-110 flex items-center justify-center group"
        title="Add New Fabric"
      >
        <Plus className="w-6 h-6" />
        <span className="max-w-0 overflow-hidden group-hover:max-w-xs transition-all duration-300 ease-in-out whitespace-nowrap group-hover:ml-2">
          Add Fabric
        </span>
      </button>

      {isModalOpen && (
        <FabricFormModal
          isOpen={isModalOpen}
          onClose={() => setIsModalOpen(false)}
          onSave={handleSaveFabric}
          machines={machines}
          initialData={null}
        />
      )}
    </>
  );
};
