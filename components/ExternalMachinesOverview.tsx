import React, { useEffect, useState, useMemo } from 'react';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '../services/firebase';
import { Factory, Clock, Package, AlertTriangle, CheckCircle2, RefreshCw, History, X } from 'lucide-react';

/**
 * "Machines Overview" — a read-only view built from the ACTUAL receiving log
 * (the `externalProduction` collection), not the manually-typed Rem/Status
 * fields on the External Schedule table. Those fields can silently drift
 * (Rem resets on edit, Status is a dropdown nobody is forced to update), so
 * this view answers "which machines are really still working" from real,
 * dated events instead: one flat table, one row per (factory, machine),
 * sorted by factory, using the most recent receiving entry per group for
 * client/fabric/remaining and how many days since that receipt.
 *
 * By default only groups with a receive in the last RECENT_DAYS window are
 * shown — a machine that hasn't received anything in months isn't "working,"
 * it's just old data. "Show all" reveals everything for occasional auditing;
 * the History button on each row always opens the full, unfiltered event
 * timeline for that specific machine, regardless of the toggle.
 *
 * Entries logged before the "Machine" field existed have no machine name —
 * those are grouped under "Unassigned" per factory rather than hidden, so
 * the gap is visible while the team transitions to recording it.
 */

interface ExternalProdEntry {
  id: string;
  factory: string;
  machine?: string;
  client: string;
  fabric: string;
  receivedQty: number;
  remainingQty: number;
  scrap?: number;
  notes?: string;
  date: string;
  orderId?: string;
  orderReference?: string;
}

interface MachineGroup {
  factory: string;
  machine: string; // '' = unassigned/legacy
  client: string;
  fabric: string;
  remainingQty: number;
  lastReceivedDate: string;
  daysSinceReceived: number;
  entries: ExternalProdEntry[]; // full history for this group, newest first
}

const STALE_DAYS = 14;   // no receive in this long -> flagged as "Stalled?" (still shown)
const RECENT_DAYS = 30;  // no receive in this long -> hidden by default as irrelevant/old

function daysSince(dateStr: string): number {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return Infinity;
  return Math.floor((Date.now() - d.getTime()) / 86400000);
}

// Active first, then Stalled, then Finished — within each, same factory stays together.
function statusRank(g: MachineGroup): number {
  if (g.remainingQty <= 0) return 2; // Finished
  if (g.daysSinceReceived > STALE_DAYS) return 1; // Stalled?
  return 0; // Active
}

export const ExternalMachinesOverview: React.FC = () => {
  const [entries, setEntries] = useState<ExternalProdEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAll, setShowAll] = useState(false);
  const [historyFor, setHistoryFor] = useState<MachineGroup | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const snap = await getDocs(collection(db, 'externalProduction'));
      setEntries(snap.docs.map(d => ({ id: d.id, ...d.data() } as ExternalProdEntry)));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const allGroups = useMemo(() => {
    const byKey = new Map<string, ExternalProdEntry[]>();
    entries.forEach(e => {
      const key = `${e.factory || 'Unknown Factory'}::${e.machine?.trim() || ''}`;
      if (!byKey.has(key)) byKey.set(key, []);
      byKey.get(key)!.push(e);
    });

    const built: MachineGroup[] = [];
    byKey.forEach((list, key) => {
      const [factory, machine] = key.split('::');
      const sorted = [...list].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
      const latest = sorted[0];
      built.push({
        factory,
        machine,
        client: latest.client || '',
        fabric: latest.fabric || '',
        remainingQty: Number(latest.remainingQty) || 0,
        lastReceivedDate: latest.date || '',
        daysSinceReceived: daysSince(latest.date),
        entries: sorted,
      });
    });

    return built.sort((a, b) => a.factory.localeCompare(b.factory) || a.machine.localeCompare(b.machine));
  }, [entries]);

  // Default view: hide anything with no receive in RECENT_DAYS — that's the
  // "old irrelevant data" case (e.g. a 207-day-old snapshot for a factory
  // that has no active plan anymore). "Show all" reveals it for auditing.
  const visibleGroups = useMemo(() => {
    const filtered = showAll ? allGroups : allGroups.filter(g => g.daysSinceReceived <= RECENT_DAYS);
    return [...filtered].sort((a, b) =>
      statusRank(a) - statusRank(b) || a.factory.localeCompare(b.factory) || a.machine.localeCompare(b.machine)
    );
  }, [allGroups, showAll]);

  const stats = useMemo(() => {
    const active = visibleGroups.filter(g => g.remainingQty > 0 && g.daysSinceReceived <= STALE_DAYS);
    const stale = visibleGroups.filter(g => g.remainingQty > 0 && g.daysSinceReceived > STALE_DAYS);
    const finished = visibleGroups.filter(g => g.remainingQty <= 0);
    const unassigned = visibleGroups.filter(g => !g.machine).reduce((s, g) => s + g.entries.length, 0);
    const factories = new Set(visibleGroups.map(g => g.factory)).size;
    return { active: active.length, stale: stale.length, finished: finished.length, factories, unassigned };
  }, [visibleGroups]);

  const hiddenCount = allGroups.length - visibleGroups.length;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-slate-400 gap-2">
        <RefreshCw className="w-4 h-4 animate-spin" /> Loading receiving history...
      </div>
    );
  }

  if (allGroups.length === 0) {
    return (
      <div className="text-center py-16 text-slate-400">
        <Package className="w-10 h-10 mx-auto mb-3 opacity-30" />
        <p className="font-medium">No external receiving history yet</p>
        <p className="text-sm mt-1">This view is built from Daily Machine Plan → External Production entries.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Summary strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4">
          <p className="text-2xl font-bold text-emerald-700">{stats.active}</p>
          <p className="text-xs font-semibold text-emerald-600 uppercase tracking-wide mt-1">Active Machines</p>
        </div>
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
          <p className="text-2xl font-bold text-amber-700">{stats.stale}</p>
          <p className="text-xs font-semibold text-amber-600 uppercase tracking-wide mt-1">No Update {STALE_DAYS}+ Days</p>
        </div>
        <div className="bg-slate-100 border border-slate-200 rounded-xl p-4">
          <p className="text-2xl font-bold text-slate-600">{stats.finished}</p>
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mt-1">Finished (Remaining 0)</p>
        </div>
        <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-4">
          <p className="text-2xl font-bold text-indigo-700">{stats.factories}</p>
          <p className="text-xs font-semibold text-indigo-600 uppercase tracking-wide mt-1">External Factories</p>
        </div>
      </div>

      {stats.unassigned > 0 && (
        <div className="flex items-center gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          <AlertTriangle size={14} className="shrink-0" />
          {stats.unassigned} receiving {stats.unassigned === 1 ? 'entry has' : 'entries have'} no machine recorded — grouped under "Unassigned" below.
        </div>
      )}

      {/* Filter toggle */}
      <div className="flex items-center justify-between">
        <label className="flex items-center gap-2 text-xs font-medium text-slate-600 cursor-pointer select-none">
          <input type="checkbox" checked={showAll} onChange={e => setShowAll(e.target.checked)} />
          Show all (including no receive in {RECENT_DAYS}+ days)
        </label>
        {!showAll && hiddenCount > 0 && (
          <span className="text-[11px] text-slate-400">{hiddenCount} older {hiddenCount === 1 ? 'entry' : 'entries'} hidden</span>
        )}
      </div>

      {/* One flat table, sorted by factory */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <thead className="bg-slate-50 text-slate-500 text-[11px] uppercase tracking-wide">
            <tr>
              <th className="px-3 py-2 text-right font-medium">Factory</th>
              <th className="px-3 py-2 text-right font-medium">Machine</th>
              <th className="px-3 py-2 text-right font-medium">Client</th>
              <th className="px-3 py-2 text-right font-medium">Fabric</th>
              <th className="px-3 py-2 text-center font-medium">Last Received</th>
              <th className="px-3 py-2 text-center font-medium">Remaining</th>
              <th className="px-3 py-2 text-center font-medium">Status</th>
              <th className="px-2 py-2 w-10"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {visibleGroups.length === 0 ? (
              <tr><td colSpan={8} className="text-center py-10 text-slate-400 text-sm">
                Nothing received in the last {RECENT_DAYS} days. <button onClick={() => setShowAll(true)} className="text-indigo-600 font-medium hover:underline">Show all</button>
              </td></tr>
            ) : visibleGroups.map(g => {
              const isFinished = g.remainingQty <= 0;
              const isStale = !isFinished && g.daysSinceReceived > STALE_DAYS;
              const isActive = !isFinished && !isStale;
              return (
                <tr key={`${g.factory}-${g.machine}`} className="hover:bg-slate-50/60">
                  <td className="px-3 py-2 font-semibold text-slate-800 whitespace-nowrap">
                    <span className="inline-flex items-center gap-1.5"><Factory size={12} className="text-indigo-400" />{g.factory}</span>
                  </td>
                  <td className="px-3 py-2 text-slate-600">{g.machine || <span className="text-slate-400 italic">Unassigned</span>}</td>
                  <td className="px-3 py-2 text-slate-700 font-medium">{g.client || <span className="text-slate-400">—</span>}</td>
                  <td className="px-3 py-2 text-slate-500 max-w-[220px] truncate" title={g.fabric}>{g.fabric || '—'}</td>
                  <td className="px-3 py-2 text-center text-slate-500 whitespace-nowrap">
                    <span className="inline-flex items-center gap-1"><Clock size={11} />{g.lastReceivedDate ? `${g.daysSinceReceived}d ago` : 'never'}</span>
                  </td>
                  <td className={`px-3 py-2 text-center font-bold ${isFinished ? 'text-slate-400' : 'text-orange-600'}`}>
                    {g.remainingQty.toLocaleString()} kg
                  </td>
                  <td className="px-3 py-2 text-center">
                    {isActive && <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded-full"><CheckCircle2 size={10} /> Active</span>}
                    {isStale && <span className="inline-flex items-center gap-1 text-[10px] font-bold text-amber-700 bg-amber-100 px-2 py-0.5 rounded-full"><AlertTriangle size={10} /> Stalled?</span>}
                    {isFinished && <span className="text-[10px] font-bold text-slate-500 bg-slate-200 px-2 py-0.5 rounded-full">Finished</span>}
                  </td>
                  <td className="px-2 py-2 text-center">
                    <button onClick={() => setHistoryFor(g)}
                      className="p-1.5 rounded-md text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 transition-colors"
                      title={`View production history (${g.entries.length} ${g.entries.length === 1 ? 'entry' : 'entries'})`}>
                      <History size={15} />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="text-[11px] text-slate-400 text-center">
        Remaining kg and last-received date reflect the most recent Daily Machine Plan → External Production entry —
        not the manually-edited "Rem" field on the Schedule table.
      </p>

      {/* History drill-down modal — always shows the FULL history, ignoring the show-all filter */}
      {historyFor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setHistoryFor(null)}>
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[80vh] flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-100">
              <div>
                <p className="font-bold text-slate-800 text-sm">{historyFor.factory} — {historyFor.machine || 'Unassigned'}</p>
                <p className="text-xs text-slate-400">{historyFor.entries.length} receiving {historyFor.entries.length === 1 ? 'entry' : 'entries'}</p>
              </div>
              <button onClick={() => setHistoryFor(null)} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400"><X size={18} /></button>
            </div>
            <div className="overflow-y-auto flex-1 divide-y divide-slate-100">
              {historyFor.entries.map(e => (
                <div key={e.id} className="px-5 py-3 flex items-center gap-3">
                  <div className="w-16 shrink-0 text-xs font-mono text-slate-400">{e.date}</div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-slate-700 truncate">{e.client} — {e.fabric}</p>
                    {e.notes && <p className="text-xs text-slate-400 truncate">{e.notes}</p>}
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-sm font-bold text-blue-600">+{e.receivedQty} kg</p>
                    <p className="text-[10px] text-slate-400">rem {e.remainingQty}kg{e.scrap ? ` · scrap ${e.scrap}kg` : ''}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
