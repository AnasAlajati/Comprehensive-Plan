import React from 'react';

interface StatusBadgeProps {
  isConnected: boolean | null;
  error?: string;
}

export const StatusBadge: React.FC<StatusBadgeProps> = ({ isConnected, error }) => {
  if (isConnected === null) {
    return (
      <div className="flex items-center gap-2 bg-slate-100 border border-slate-200 px-3 py-1.5 rounded-full">
        <div className="w-2.5 h-2.5 bg-slate-400 rounded-full animate-pulse"></div>
        <span className="text-sm font-medium text-slate-600">Checking...</span>
      </div>
    );
  }

  if (isConnected) {
    return (
      <div className="flex items-center gap-2 bg-emerald-50 border border-emerald-200 px-3 py-1.5 rounded-full shadow-sm">
        <span className="relative flex h-2.5 w-2.5">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
          <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
        </span>
        <span className="text-sm font-bold text-emerald-700">Connected</span>
      </div>
    );
  }

  return (
    <div className="group relative cursor-pointer">
      <div className="flex items-center gap-2 bg-red-50 border border-red-200 px-3 py-1.5 rounded-full shadow-sm">
        <div className="w-2.5 h-2.5 bg-red-500 rounded-full"></div>
        <span className="text-sm font-bold text-red-700">Disconnected</span>
      </div>
      {error && (
        <div className="absolute right-0 top-full mt-2 w-64 bg-white p-3 rounded-lg shadow-xl border border-red-100 text-xs text-red-600 z-50 opacity-0 group-hover:opacity-100 transition-opacity">
          <strong>Error:</strong> {error}
        </div>
      )}
    </div>
  );
};