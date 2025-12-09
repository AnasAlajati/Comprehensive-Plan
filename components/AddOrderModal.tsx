import React, { useState } from 'react';
import { X, Save, Loader2 } from 'lucide-react';
import { DataService } from '../services/dataService';

interface AddOrderModalProps {
  isOpen: boolean;
  onClose: () => void;
  onOrderAdded: () => void;
  existingClients?: string[]; // Optional: for autocomplete
}

export const AddOrderModal: React.FC<AddOrderModalProps> = ({ isOpen, onClose, onOrderAdded, existingClients = [] }) => {
  const [clientName, setClientName] = useState('');
  const [fabricName, setFabricName] = useState('');
  const [quantity, setQuantity] = useState<number>(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!clientName.trim() || !fabricName.trim()) {
      setError("Client Name and Fabric Name are required.");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      await DataService.addFabricToOrder(clientName.trim(), fabricName.trim(), quantity);
      onOrderAdded();
      onClose();
      // Reset form
      setClientName('');
      setFabricName('');
      setQuantity(0);
    } catch (err) {
      console.error("Error adding order:", err);
      setError("Failed to add order. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md overflow-hidden animate-in fade-in zoom-in duration-200">
        <div className="flex items-center justify-between p-4 border-b border-slate-100 bg-slate-50/50">
          <h3 className="font-bold text-lg text-slate-800">Add New Order</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && (
            <div className="p-3 bg-red-50 text-red-600 text-sm rounded-lg border border-red-100">
              {error}
            </div>
          )}

          <div className="space-y-2">
            <label className="block text-sm font-medium text-slate-700">Client Name</label>
            <input
              type="text"
              value={clientName}
              onChange={(e) => setClientName(e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all"
              placeholder="e.g. Zara"
              list="clients-list"
            />
            <datalist id="clients-list">
              {existingClients.map(client => (
                <option key={client} value={client} />
              ))}
            </datalist>
          </div>

          <div className="space-y-2">
            <label className="block text-sm font-medium text-slate-700">Fabric Name</label>
            <input
              type="text"
              value={fabricName}
              onChange={(e) => setFabricName(e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all"
              placeholder="e.g. Cotton 100%"
            />
          </div>

          <div className="space-y-2">
            <label className="block text-sm font-medium text-slate-700">Total Quantity (kg)</label>
            <input
              type="number"
              min="0"
              value={quantity}
              onChange={(e) => setQuantity(Number(e.target.value))}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all"
              placeholder="0"
            />
          </div>

          <div className="pt-4 flex gap-3">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg font-medium transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex-1 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-medium transition-colors flex items-center justify-center gap-2"
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              Save Order
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
