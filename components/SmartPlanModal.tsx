import React, { useState } from 'react';
import { PlanItem } from '../types';
import { parseTextToPlan } from '../services/ai';

interface SmartPlanModalProps {
  onClose: () => void;
  onSave: (plan: PlanItem) => void;
}

export const SmartPlanModal: React.FC<SmartPlanModalProps> = ({ onClose, onSave }) => {
  const [inputText, setInputText] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleProcess = async () => {
    if (!inputText.trim()) return;
    setLoading(true);
    setError('');

    try {
      const plan = await parseTextToPlan(inputText);
      if (plan) {
        onSave(plan);
        onClose();
      } else {
        setError("Could not extract a valid plan. Please try being more specific with quantities and material names.");
      }
    } catch (e) {
      setError("AI processing failed. Please check console for details.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg overflow-hidden border border-slate-200">
        <div className="bg-gradient-to-r from-blue-600 to-indigo-600 p-4 text-white flex justify-between items-center">
          <h3 className="font-bold text-lg">Smart Plan Creator (Gemini)</h3>
          <button onClick={onClose} className="text-white/80 hover:text-white">✕</button>
        </div>
        <div className="p-6 space-y-4 bg-white">
          <p className="text-sm text-slate-600">
            Paste an order request, email snippet, or WhatsApp message. Gemini will intelligently extract details.
          </p>
          <textarea
            className="w-full h-32 p-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none resize-none text-black bg-white placeholder-slate-400 text-sm"
            placeholder="e.g., 'We need 2500kg of Lycra Single Jersey on machine 5 for Order #5022 by next Tuesday.'"
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            disabled={loading}
          />
          {error && <div className="bg-red-50 text-red-600 text-xs p-2 rounded border border-red-100 font-bold">Error: {error}</div>}
        </div>
        <div className="bg-slate-50 p-4 border-t border-slate-100 flex justify-end gap-3">
          <button onClick={onClose} className="px-4 py-2 text-sm text-slate-600 hover:text-slate-800 font-medium" disabled={loading}>Cancel</button>
          <button onClick={handleProcess} disabled={!inputText.trim() || loading} className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold text-white transition-all ${loading ? 'bg-indigo-400 cursor-wait' : 'bg-indigo-600 hover:bg-indigo-700 shadow-lg'}`}>{loading ? 'Processing...' : '✨ Create Plan'}</button>
        </div>
      </div>
    </div>
  );
};