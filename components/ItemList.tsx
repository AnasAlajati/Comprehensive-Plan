import React from 'react';
import { DemoItem } from '../types';

interface ItemListProps {
  items: DemoItem[];
  loading: boolean;
  onDelete: (id: string) => void;
}

export const ItemList: React.FC<ItemListProps> = ({ items, loading, onDelete }) => {
  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-48 space-y-3">
        <svg className="animate-spin h-8 w-8 text-firebase-orange" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
        </svg>
        <p className="text-slate-500 text-sm">Listening for data...</p>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-48 text-center px-4 border-2 border-dashed border-slate-200 rounded-lg">
        <p className="text-slate-400 font-medium mb-1">No items found</p>
        <p className="text-slate-400 text-xs">Use the form to add a document to the 'demo_items' collection.</p>
      </div>
    );
  }

  return (
    <ul className="space-y-3 max-h-[500px] overflow-y-auto pr-2 custom-scrollbar">
      {items.map((item) => (
        <li 
          key={item.id} 
          className="group bg-slate-50 hover:bg-white border border-slate-200 hover:border-firebase-amber/50 rounded-lg p-4 transition-all duration-200 relative"
        >
          <div className="flex justify-between items-start">
            <div className="flex-1 min-w-0">
              <h3 className="text-sm font-semibold text-slate-800 truncate">
                {item.title}
              </h3>
              <p className="text-xs text-slate-500 mt-1 line-clamp-2">
                {item.description || <span className="italic opacity-50">No description provided</span>}
              </p>
              <div className="flex items-center gap-2 mt-2">
                 <span className="text-[10px] uppercase tracking-wider text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded">
                   ID: {item.id.slice(0, 6)}...
                 </span>
                 {item.createdAt && (
                   <span className="text-[10px] text-slate-400">
                     {new Date(item.createdAt.seconds * 1000).toLocaleTimeString()}
                   </span>
                 )}
              </div>
            </div>
            
            <button 
              onClick={() => onDelete(item.id)}
              className="ml-4 p-1.5 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-md transition-colors"
              title="Delete Document"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </button>
          </div>
        </li>
      ))}
    </ul>
  );
};