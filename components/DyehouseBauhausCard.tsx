import React, { useEffect, useRef } from 'react';
import { Edit2, Trash2, Package, Settings } from 'lucide-react';
import { Dyehouse } from '../types';

const CARD_STYLES = `
.dh-bauhaus {
  position: relative;
  width: 100%;
  min-height: 160px;
  border-radius: 14px;
  border: 2px solid transparent;
  --rotation: 4.2rad;
  --mx: 50%;
  --my: 50%;
  background-image:
    linear-gradient(#ffffff, #ffffff),
    linear-gradient(calc(var(--rotation, 4.2rad)), #7c3aed 0%, #e5e7eb 45%, transparent 75%);
  background-origin: border-box;
  background-clip: padding-box, border-box;
  box-shadow: 0 1px 3px rgba(0,0,0,0.07), 0 2px 8px rgba(0,0,0,0.04);
  overflow: hidden;
  transition: box-shadow 0.25s ease;
}
.dh-bauhaus:hover {
  box-shadow: 0 4px 16px rgba(0,0,0,0.09), 0 0 0 1px rgba(124,58,237,0.1);
}
.dh-bauhaus::before {
  content: '';
  position: absolute;
  inset: 0;
  background: radial-gradient(
    circle at var(--mx) var(--my),
    rgba(124, 58, 237, 0.06) 0%,
    transparent 60%
  );
  pointer-events: none;
  z-index: 0;
  opacity: 0;
  transition: opacity 0.2s;
}
.dh-bauhaus:hover::before {
  opacity: 1;
}
.dh-bauhaus > * {
  position: relative;
  z-index: 1;
}
.dh-bauhaus-chip {
  background: #ffffff;
  border: 1px solid #e2e8f0;
  color: #374151;
  font-weight: 700;
  transition: border-color 0.15s, box-shadow 0.15s, background 0.15s;
}
.dh-bauhaus-chip:hover {
  border-color: #a78bfa;
  box-shadow: 0 0 0 3px rgba(124,58,237,0.08);
  background: #faf5ff;
}
`;

// Always overwrite to pick up CSS changes across hot reloads
function injectStyles() {
  if (typeof window === 'undefined') return;
  let el = document.getElementById('dh-bauhaus-styles') as HTMLStyleElement | null;
  if (!el) {
    el = document.createElement('style');
    el.id = 'dh-bauhaus-styles';
    document.head.appendChild(el);
  }
  el.innerHTML = CARD_STYLES;
}

const isRTL = (text: string) => /[\u0590-\u05FF\u0600-\u06FF\u0700-\u074F]/.test(text);

interface DyehouseBauhausCardProps {
  dyehouse: Dyehouse;
  machineCounts: Record<string, { sent: number; planned: number }>;
  stock: number;
  canEdit: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onMachineClick: (capacity: number) => void;
}

export const DyehouseBauhausCard: React.FC<DyehouseBauhausCardProps> = ({
  dyehouse,
  machineCounts,
  stock,
  canEdit,
  onEdit,
  onDelete,
  onMachineClick,
}) => {
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    injectStyles();
    const card = cardRef.current;
    const handleMouseMove = (e: MouseEvent) => {
      if (!card) return;
      const rect = card.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      card.style.setProperty('--rotation', Math.atan2(-(x - rect.width / 2), y - rect.height / 2) + 'rad');
      card.style.setProperty('--mx', `${(x / rect.width) * 100}%`);
      card.style.setProperty('--my', `${(y / rect.height) * 100}%`);
    };
    card?.addEventListener('mousemove', handleMouseMove);
    return () => card?.removeEventListener('mousemove', handleMouseMove);
  }, []);

  const hasMachines = dyehouse.machines && dyehouse.machines.length > 0;

  return (
    <div ref={cardRef} className="dh-bauhaus">
      {/* Header */}
      <div className="flex items-start justify-between px-4 pt-4 pb-3 border-b border-slate-100">
        <div className="flex flex-col gap-1.5 min-w-0">
          <h3
            className="font-bold text-lg text-slate-800 leading-tight"
            style={{ direction: isRTL(dyehouse.name) ? 'rtl' : 'ltr' }}
          >
            {dyehouse.name}
          </h3>
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 text-xs font-bold border border-blue-200 w-fit">
            <Package size={11} />
            Stock: {stock.toLocaleString()} kg
          </span>
        </div>

        <div className="flex gap-0.5 shrink-0 ml-3 mt-0.5">
          <button
            onClick={() => canEdit && onEdit()}
            disabled={!canEdit}
            className={`p-1.5 rounded-lg transition-colors ${
              canEdit
                ? 'text-slate-400 hover:text-blue-600 hover:bg-blue-50'
                : 'text-slate-300 cursor-not-allowed opacity-60'
            }`}
            title={canEdit ? 'Edit' : 'No permission to edit'}
          >
            <Edit2 size={15} />
          </button>
          <button
            onClick={() => canEdit && onDelete()}
            disabled={!canEdit}
            className={`p-1.5 rounded-lg transition-colors ${
              canEdit
                ? 'text-slate-400 hover:text-red-500 hover:bg-red-50'
                : 'text-slate-300 cursor-not-allowed opacity-60'
            }`}
            title={canEdit ? 'Delete' : 'No permission to delete'}
          >
            <Trash2 size={15} />
          </button>
        </div>
      </div>

      {/* Machine Config */}
      <div className="px-4 py-3">
        <div className="flex items-center gap-1 mb-2.5">
          <Settings size={11} className="text-slate-400" />
          <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
            Machine Configuration
          </span>
        </div>

        {hasMachines ? (
          <div className="flex flex-wrap gap-2">
            {dyehouse.machines.map((machine: { capacity: number; count: number }, idx: number) => {
              const stats = machineCounts[`${dyehouse.name}-${machine.capacity}`] || { sent: 0, planned: 0 };
              return (
                <button
                  key={idx}
                  onClick={() => onMachineClick(machine.capacity)}
                  className="dh-bauhaus-chip flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm shadow-sm"
                >
                  {machine.capacity}kg

                  {(stats.sent > 0 || stats.planned > 0) && (
                    <div className="flex gap-1 text-xs font-medium">
                      {stats.sent > 0 && (
                        <span className="text-purple-600 bg-purple-50 px-1.5 rounded border border-purple-100">
                          {stats.sent} Sent
                        </span>
                      )}
                      {stats.planned > 0 && (
                        <span className="text-orange-600 bg-orange-50 px-1.5 rounded border border-orange-100">
                          {stats.planned} Planned
                        </span>
                      )}
                    </div>
                  )}

                  {machine.count > 1 && (
                    <span className="ml-0.5 px-1.5 py-0.5 bg-slate-100 text-slate-500 text-xs rounded-full font-medium">
                      x{machine.count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        ) : (
          <p className="text-slate-400 text-sm italic py-1">
            No machines configured. Click edit to add.
          </p>
        )}
      </div>
    </div>
  );
};
