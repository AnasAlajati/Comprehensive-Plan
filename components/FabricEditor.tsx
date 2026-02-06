import React, { useState, useCallback, createContext, useContext } from 'react';
import { Plus, Edit, Loader2 } from 'lucide-react';
import { FabricDefinition } from '../types';
import { DataService } from '../services/dataService';
import { FabricFormModal } from './FabricFormModal';

// ============================================================================
// CENTRALIZED FABRIC EDITOR
// Use this component everywhere for consistent Add/Edit fabric experience
// ============================================================================

interface FabricEditorState {
  isOpen: boolean;
  initialData: FabricDefinition | null;
  initialName?: string;
  targetRowId?: string; // For auto-selecting after save
}

interface FabricEditorContextType {
  openAddFabric: (initialName?: string, targetRowId?: string) => void;
  openEditFabric: (fabric: FabricDefinition, targetRowId?: string) => void;
  close: () => void;
  state: FabricEditorState;
  saving: boolean;
}

const FabricEditorContext = createContext<FabricEditorContextType | null>(null);

// Hook to use fabric editor from anywhere
export const useFabricEditor = () => {
  const context = useContext(FabricEditorContext);
  if (!context) {
    throw new Error('useFabricEditor must be used within FabricEditorProvider');
  }
  return context;
};

// ============================================================================
// PROVIDER COMPONENT - Wrap your app/page with this
// ============================================================================

interface FabricEditorProviderProps {
  children: React.ReactNode;
  machines: any[];
  onFabricSaved?: (fabric: FabricDefinition, targetRowId?: string) => void;
  onFabricsChange?: (fabrics: FabricDefinition[]) => void;
}

export const FabricEditorProvider: React.FC<FabricEditorProviderProps> = ({
  children,
  machines,
  onFabricSaved,
  onFabricsChange
}) => {
  const [state, setState] = useState<FabricEditorState>({
    isOpen: false,
    initialData: null,
    initialName: undefined,
    targetRowId: undefined
  });
  const [saving, setSaving] = useState(false);

  const openAddFabric = useCallback((initialName?: string, targetRowId?: string) => {
    setState({
      isOpen: true,
      initialData: initialName ? { name: initialName } as FabricDefinition : null,
      initialName,
      targetRowId
    });
  }, []);

  const openEditFabric = useCallback((fabric: FabricDefinition, targetRowId?: string) => {
    setState({
      isOpen: true,
      initialData: fabric,
      initialName: undefined,
      targetRowId
    });
  }, []);

  const close = useCallback(() => {
    setState({
      isOpen: false,
      initialData: null,
      initialName: undefined,
      targetRowId: undefined
    });
  }, []);

  const handleSave = useCallback(async (formData: Partial<FabricDefinition>) => {
    if (!formData.name) return;
    
    setSaving(true);
    try {
      // Use centralized service function
      const savedFabric = await DataService.upsertFabric(
        formData,
        machines,
        state.initialData?.id
      );

      // Notify parent
      if (onFabricSaved) {
        onFabricSaved(savedFabric, state.targetRowId);
      }

      // Optionally refresh full list
      if (onFabricsChange) {
        const allFabrics = await DataService.getFabrics();
        onFabricsChange(allFabrics);
      }

      close();
    } catch (error) {
      console.error('Error saving fabric:', error);
      alert('Failed to save fabric. Please try again.');
    } finally {
      setSaving(false);
    }
  }, [machines, state.initialData?.id, state.targetRowId, onFabricSaved, onFabricsChange, close]);

  const contextValue: FabricEditorContextType = {
    openAddFabric,
    openEditFabric,
    close,
    state,
    saving
  };

  return (
    <FabricEditorContext.Provider value={contextValue}>
      {children}
      
      {state.isOpen && (
        <FabricFormModal
          isOpen={state.isOpen}
          onClose={close}
          onSave={handleSave}
          machines={machines}
          initialData={state.initialData}
        />
      )}
    </FabricEditorContext.Provider>
  );
};

// ============================================================================
// SIMPLE BUTTON COMPONENTS - Use these for quick add/edit triggers
// ============================================================================

interface AddFabricButtonProps {
  initialName?: string;
  targetRowId?: string;
  variant?: 'icon' | 'full' | 'link' | 'fab';
  className?: string;
  size?: 'sm' | 'md' | 'lg';
}

export const AddFabricButton: React.FC<AddFabricButtonProps> = ({
  initialName,
  targetRowId,
  variant = 'full',
  className = '',
  size = 'md'
}) => {
  const { openAddFabric, saving } = useFabricEditor();

  const sizeClasses = {
    sm: 'text-xs px-2 py-1',
    md: 'text-sm px-3 py-2',
    lg: 'text-base px-4 py-3'
  };

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    openAddFabric(initialName, targetRowId);
  };

  if (variant === 'icon') {
    return (
      <button
        onClick={handleClick}
        disabled={saving}
        className={`p-1.5 text-blue-600 hover:bg-blue-50 rounded transition-colors ${className}`}
        title="Add New Fabric"
      >
        {saving ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
      </button>
    );
  }

  if (variant === 'link') {
    return (
      <button
        onClick={handleClick}
        disabled={saving}
        className={`text-blue-600 hover:text-blue-700 hover:underline flex items-center gap-1 ${sizeClasses[size]} ${className}`}
      >
        {saving ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
        <span>Create New</span>
      </button>
    );
  }

  if (variant === 'fab') {
    return (
      <button
        onClick={handleClick}
        disabled={saving}
        className={`fixed bottom-6 right-6 z-50 bg-blue-600 hover:bg-blue-700 text-white p-4 rounded-full shadow-lg transition-all duration-200 hover:scale-110 flex items-center justify-center group ${className}`}
        title="Add New Fabric"
      >
        {saving ? <Loader2 className="w-6 h-6 animate-spin" /> : <Plus className="w-6 h-6" />}
        <span className="max-w-0 overflow-hidden group-hover:max-w-xs transition-all duration-300 ease-in-out whitespace-nowrap group-hover:ml-2">
          Add Fabric
        </span>
      </button>
    );
  }

  // Default: full button
  return (
    <button
      onClick={handleClick}
      disabled={saving}
      className={`bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium flex items-center gap-2 disabled:opacity-50 ${sizeClasses[size]} ${className}`}
    >
      {saving ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
      <span>Add Fabric</span>
    </button>
  );
};

interface EditFabricButtonProps {
  fabric: FabricDefinition;
  targetRowId?: string;
  variant?: 'icon' | 'full' | 'link';
  className?: string;
  size?: 'sm' | 'md' | 'lg';
}

export const EditFabricButton: React.FC<EditFabricButtonProps> = ({
  fabric,
  targetRowId,
  variant = 'icon',
  className = '',
  size = 'md'
}) => {
  const { openEditFabric, saving } = useFabricEditor();

  const sizeClasses = {
    sm: 'text-xs px-2 py-1',
    md: 'text-sm px-3 py-2',
    lg: 'text-base px-4 py-3'
  };

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    openEditFabric(fabric, targetRowId);
  };

  if (variant === 'icon') {
    return (
      <button
        onClick={handleClick}
        disabled={saving}
        className={`p-1.5 text-slate-500 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors ${className}`}
        title="Edit Fabric"
      >
        {saving ? <Loader2 size={14} className="animate-spin" /> : <Edit size={14} />}
      </button>
    );
  }

  if (variant === 'link') {
    return (
      <button
        onClick={handleClick}
        disabled={saving}
        className={`text-slate-600 hover:text-blue-600 hover:underline flex items-center gap-1 ${sizeClasses[size]} ${className}`}
      >
        {saving ? <Loader2 size={14} className="animate-spin" /> : <Edit size={14} />}
        <span>Edit</span>
      </button>
    );
  }

  // Default: full button
  return (
    <button
      onClick={handleClick}
      disabled={saving}
      className={`bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg font-medium flex items-center gap-2 disabled:opacity-50 ${sizeClasses[size]} ${className}`}
    >
      {saving ? <Loader2 size={16} className="animate-spin" /> : <Edit size={16} />}
      <span>Edit</span>
    </button>
  );
};

// ============================================================================
// STANDALONE COMPONENT - For cases where you don't want to use the Provider
// ============================================================================

interface StandaloneFabricEditorProps {
  isOpen: boolean;
  onClose: () => void;
  machines: any[];
  initialData?: FabricDefinition | null;
  onSaved?: (fabric: FabricDefinition) => void;
  highlightAddVariant?: boolean;
}

export const StandaloneFabricEditor: React.FC<StandaloneFabricEditorProps> = ({
  isOpen,
  onClose,
  machines,
  initialData,
  onSaved,
  highlightAddVariant = false
}) => {
  const [saving, setSaving] = useState(false);

  const handleSave = async (formData: Partial<FabricDefinition>) => {
    if (!formData.name) return;
    
    setSaving(true);
    try {
      const savedFabric = await DataService.upsertFabric(
        formData,
        machines,
        initialData?.id
      );

      // Dispatch global event for cross-component sync
      window.dispatchEvent(new CustomEvent('fabric-saved', { detail: savedFabric }));

      if (onSaved) {
        onSaved(savedFabric);
      }

      onClose();
    } catch (error) {
      console.error('Error saving fabric:', error);
      alert('Failed to save fabric. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <FabricFormModal
      isOpen={isOpen}
      onClose={onClose}
      onSave={handleSave}
      machines={machines}
      initialData={initialData}
      highlightAddVariant={highlightAddVariant}
    />
  );
};
