import React, { useState } from 'react';
import { Plus, Loader2 } from 'lucide-react';
import { FabricDefinition } from '../types';
import { DataService } from '../services/dataService';
import { FabricFormModal } from './FabricFormModal';

// ============================================================================
// GLOBAL FABRIC BUTTON (Simplified - now uses DataService.upsertFabric)
// For a floating action button to add fabrics from anywhere
// ============================================================================

interface GlobalFabricButtonProps {
  machines: any[];
  onFabricSaved?: (fabric: FabricDefinition) => void;
}

export const GlobalFabricButton: React.FC<GlobalFabricButtonProps> = ({ machines, onFabricSaved }) => {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const handleSave = async (formData: Partial<FabricDefinition>) => {
    if (!formData.name) return;

    setSaving(true);
    try {
      // Use centralized service function
      const savedFabric = await DataService.upsertFabric(formData, machines);
      
      setIsModalOpen(false);
      
      // Callback to refresh fabric list in parent
      if (onFabricSaved) onFabricSaved(savedFabric);
      
      // Dispatch global event so other components (like ClientOrdersPage) can refresh
      window.dispatchEvent(new CustomEvent('fabric-saved', { detail: savedFabric }));
      
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
        disabled={saving}
        className="fixed bottom-6 right-6 z-50 bg-blue-600 hover:bg-blue-700 text-white p-4 rounded-full shadow-lg transition-all duration-200 hover:scale-110 flex items-center justify-center group disabled:opacity-50"
        title="Add New Fabric"
      >
        {saving ? <Loader2 className="w-6 h-6 animate-spin" /> : <Plus className="w-6 h-6" />}
        <span className="max-w-0 overflow-hidden group-hover:max-w-xs transition-all duration-300 ease-in-out whitespace-nowrap group-hover:ml-2">
          Add Fabric
        </span>
      </button>

      {isModalOpen && (
        <FabricFormModal
          isOpen={isModalOpen}
          onClose={() => setIsModalOpen(false)}
          onSave={handleSave}
          machines={machines}
          initialData={null}
        />
      )}
    </>
  );
};
