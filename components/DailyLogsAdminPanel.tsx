import React, { useState } from 'react';
import { collection, getDocs, doc, updateDoc, setDoc, deleteField, writeBatch } from 'firebase/firestore';
import { db } from '../services/firebase';
import { Download, Upload, Trash2, CheckCircle, AlertTriangle, Loader } from 'lucide-react';

type Status = { type: 'idle' | 'running' | 'success' | 'error'; message: string };

export const DailyLogsAdminPanel: React.FC = () => {
  const [backupStatus, setBackupStatus]   = useState<Status>({ type: 'idle', message: '' });
  const [deleteStatus, setDeleteStatus]   = useState<Status>({ type: 'idle', message: '' });
  const [restoreStatus, setRestoreStatus] = useState<Status>({ type: 'idle', message: '' });
  const [confirmed, setConfirmed] = useState(false);
  const [backupFilename, setBackupFilename] = useState<string>('');

  // ── 1. BACKUP ──────────────────────────────────────────────────────────────
  const handleBackup = async () => {
    setBackupStatus({ type: 'running', message: 'Reading MachineSS collection…' });
    try {
      const snapshot = await getDocs(collection(db, 'MachineSS'));
      const docs: Record<string, any> = {};
      snapshot.docs.forEach(d => { docs[d.id] = d.data(); });

      const json   = JSON.stringify(docs, null, 2);
      const blob   = new Blob([json], { type: 'application/json' });
      const url    = URL.createObjectURL(blob);
      const a      = document.createElement('a');
      const ts     = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const fname  = `MachineSS-backup-${ts}.json`;
      a.href       = url;
      a.download   = fname;
      a.click();
      URL.revokeObjectURL(url);

      setBackupFilename(fname);
      setBackupStatus({ type: 'success', message: `✅ Backup saved: ${fname} (${snapshot.size} machines)` });
    } catch (err: any) {
      setBackupStatus({ type: 'error', message: `❌ Backup failed: ${err.message}` });
    }
  };

  // ── 2. DELETE dailyLogs FIELD ──────────────────────────────────────────────
  const handleDelete = async () => {
    if (!confirmed) return;
    setDeleteStatus({ type: 'running', message: 'Deleting dailyLogs field from MachineSS docs…' });
    try {
      const snapshot = await getDocs(collection(db, 'MachineSS'));
      
      // Firestore writeBatch max 500 ops — split if needed
      const batchSize = 400;
      let count = 0;
      let batch = writeBatch(db);
      let batchCount = 0;

      for (const docSnap of snapshot.docs) {
        const data = docSnap.data();
        if ('dailyLogs' in data) {
          batch.update(doc(db, 'MachineSS', docSnap.id), { dailyLogs: deleteField() });
          batchCount++;
          count++;

          if (batchCount >= batchSize) {
            await batch.commit();
            batch = writeBatch(db);
            batchCount = 0;
            setDeleteStatus({ type: 'running', message: `Deleting… ${count} done so far` });
          }
        }
      }

      if (batchCount > 0) await batch.commit();

      setDeleteStatus({ type: 'success', message: `✅ Deleted dailyLogs from ${count} machines. Field is gone from Firestore.` });
      setConfirmed(false);
    } catch (err: any) {
      setDeleteStatus({ type: 'error', message: `❌ Delete failed: ${err.message}` });
    }
  };

  // ── 3. RESTORE ─────────────────────────────────────────────────────────────
  const handleRestoreFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setRestoreStatus({ type: 'running', message: `Reading ${file.name}…` });

    try {
      const text = await file.text();
      const docs: Record<string, any> = JSON.parse(text);
      const machineIds = Object.keys(docs);

      if (machineIds.length === 0) throw new Error('File contains no machine documents');

      setRestoreStatus({ type: 'running', message: `Restoring ${machineIds.length} machines…` });

      // Write in batches of 400
      const batchSize = 400;
      let batch = writeBatch(db);
      let batchCount = 0;
      let count = 0;

      for (const [machineId, data] of Object.entries(docs)) {
        // Only write back the dailyLogs field (don't overwrite the whole document)
        if (data.dailyLogs !== undefined) {
          batch.update(doc(db, 'MachineSS', machineId), { dailyLogs: data.dailyLogs });
          batchCount++;
          count++;

          if (batchCount >= batchSize) {
            await batch.commit();
            batch = writeBatch(db);
            batchCount = 0;
            setRestoreStatus({ type: 'running', message: `Restoring… ${count} done so far` });
          }
        }
      }

      if (batchCount > 0) await batch.commit();

      setRestoreStatus({
        type: 'success',
        message: `✅ Restored dailyLogs on ${count} machines from ${file.name}. Refresh the app.`
      });
    } catch (err: any) {
      setRestoreStatus({ type: 'error', message: `❌ Restore failed: ${err.message}` });
    }

    // Reset input so same file can be re-selected
    e.target.value = '';
  };

  const StatusBadge: React.FC<{ status: Status }> = ({ status }) => {
    if (status.type === 'idle') return null;
    const colors = {
      running: 'bg-blue-50 border-blue-200 text-blue-700',
      success: 'bg-green-50 border-green-200 text-green-700',
      error:   'bg-red-50 border-red-200 text-red-700',
    };
    return (
      <div className={`mt-3 p-3 rounded-lg border text-sm flex items-start gap-2 ${colors[status.type]}`}>
        {status.type === 'running' && <Loader size={16} className="mt-0.5 animate-spin shrink-0" />}
        {status.type === 'success' && <CheckCircle size={16} className="mt-0.5 shrink-0" />}
        {status.type === 'error'   && <AlertTriangle size={16} className="mt-0.5 shrink-0" />}
        <span>{status.message}</span>
      </div>
    );
  };

  return (
    <div className="max-w-2xl mx-auto p-6 space-y-6">
      <div className="text-center mb-8">
        <h1 className="text-2xl font-bold text-slate-800">MachineSS Admin Panel</h1>
        <p className="text-slate-500 text-sm mt-1">Manage the <code className="bg-slate-100 px-1 rounded">dailyLogs</code> embedded array migration</p>
      </div>

      {/* ── STEP 1: BACKUP ── */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center text-blue-700 font-bold text-sm">1</div>
          <div>
            <h2 className="font-semibold text-slate-800">Backup MachineSS</h2>
            <p className="text-xs text-slate-500">Downloads all MachineSS documents (including dailyLogs arrays) as a JSON file. Do this first.</p>
          </div>
        </div>
        <button
          onClick={handleBackup}
          disabled={backupStatus.type === 'running'}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          <Download size={16} />
          Download Backup JSON
        </button>
        <StatusBadge status={backupStatus} />
      </div>

      {/* ── STEP 2: DELETE ── */}
      <div className="bg-white border border-red-200 rounded-xl p-5 shadow-sm">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-8 h-8 bg-red-100 rounded-full flex items-center justify-center text-red-700 font-bold text-sm">2</div>
          <div>
            <h2 className="font-semibold text-slate-800">Delete <code className="bg-slate-100 px-1 rounded text-sm">dailyLogs</code> Arrays</h2>
            <p className="text-xs text-slate-500">Removes the embedded array field from every MachineSS document. This reduces Firestore read cost significantly. The sub-collection logs are not affected.</p>
          </div>
        </div>

        {backupStatus.type !== 'success' && (
          <div className="mb-3 p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-700 flex items-center gap-2">
            <AlertTriangle size={15} className="shrink-0" />
            Complete the backup in Step 1 first before deleting.
          </div>
        )}

        <label className="flex items-center gap-2 text-sm text-slate-600 mb-3 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={e => setConfirmed(e.target.checked)}
            className="w-4 h-4 accent-red-600"
          />
          I have downloaded the backup and understand this cannot be undone without restoring it
        </label>

        <button
          onClick={handleDelete}
          disabled={!confirmed || deleteStatus.type === 'running' || backupStatus.type !== 'success'}
          className="flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          <Trash2 size={16} />
          Delete dailyLogs from Firestore
        </button>
        <StatusBadge status={deleteStatus} />
      </div>

      {/* ── STEP 3: RESTORE ── */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-8 h-8 bg-green-100 rounded-full flex items-center justify-center text-green-700 font-bold text-sm">3</div>
          <div>
            <h2 className="font-semibold text-slate-800">Restore from Backup</h2>
            <p className="text-xs text-slate-500">
              If something breaks, upload the backup JSON file from Step 1 to restore the <code className="bg-slate-100 px-1 rounded">dailyLogs</code> arrays exactly as they were.
              Only the <code className="bg-slate-100 px-1 rounded">dailyLogs</code> field is written back — no other fields are touched.
            </p>
          </div>
        </div>

        <label className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 cursor-pointer transition-colors w-fit">
          <Upload size={16} />
          Upload Backup JSON to Restore
          <input
            type="file"
            accept=".json"
            onChange={handleRestoreFile}
            className="hidden"
            disabled={restoreStatus.type === 'running'}
          />
        </label>
        <StatusBadge status={restoreStatus} />
      </div>
    </div>
  );
};
