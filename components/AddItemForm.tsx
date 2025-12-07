import React, { useState } from 'react';

interface AddItemFormProps {
  onAdd: (title: string, description: string) => Promise<boolean>;
  isConnected: boolean;
}

export const AddItemForm: React.FC<AddItemFormProps> = ({ onAdd, isConnected }) => {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !isConnected) return;

    setIsSubmitting(true);
    const success = await onAdd(title, description);
    if (success) {
      setTitle('');
      setDescription('');
    }
    setIsSubmitting(false);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label htmlFor="title" className="block text-sm font-medium text-slate-700 mb-1">
          Item Title
        </label>
        <input
          id="title"
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. New User Profile"
          disabled={!isConnected || isSubmitting}
          className="w-full px-4 py-2 bg-slate-50 border border-slate-300 rounded-lg focus:ring-2 focus:ring-firebase-navy focus:border-firebase-navy transition-all disabled:opacity-50 disabled:cursor-not-allowed text-sm outline-none"
        />
      </div>
      
      <div>
        <label htmlFor="description" className="block text-sm font-medium text-slate-700 mb-1">
          Description
        </label>
        <textarea
          id="description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Enter additional details..."
          rows={3}
          disabled={!isConnected || isSubmitting}
          className="w-full px-4 py-2 bg-slate-50 border border-slate-300 rounded-lg focus:ring-2 focus:ring-firebase-navy focus:border-firebase-navy transition-all disabled:opacity-50 disabled:cursor-not-allowed text-sm resize-none outline-none"
        />
      </div>

      <button
        type="submit"
        disabled={!isConnected || isSubmitting || !title.trim()}
        className={`w-full flex justify-center items-center py-2.5 px-4 border border-transparent rounded-lg shadow-sm text-sm font-medium text-white transition-all
          ${isConnected && title.trim() 
            ? 'bg-firebase-navy hover:bg-blue-600 focus:ring-2 focus:ring-offset-2 focus:ring-firebase-navy' 
            : 'bg-slate-300 cursor-not-allowed'
          }
        `}
      >
        {isSubmitting ? (
          <>
            <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            Saving...
          </>
        ) : (
          'Add to Firestore'
        )}
      </button>
      
      {!isConnected && (
        <p className="text-xs text-red-500 text-center">
          Connection lost. Cannot add items.
        </p>
      )}
    </form>
  );
};