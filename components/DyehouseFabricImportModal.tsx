import React, { useState, useRef, useEffect } from 'react';
import {
  X, Upload, FileSpreadsheet, AlertTriangle, Check, Loader2,
  ChevronUp, ChevronDown, Trash2, Link2
} from 'lucide-react';
import { OrderRow, DyeingBatch, Dyehouse } from '../types';
import { DataService } from '../services/dataService';
import { parseDyehouseWorkbook, ParsedColor, ParsedAccessory } from '../utils/dyehouseExcelParser';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  order: OrderRow;
  dyehouses: Dyehouse[];
  /** Persist the freshly-built batches onto the order's dyeingPlan. */
  onImport: (batches: DyeingBatch[]) => Promise<void> | void;
}

type Step = 'upload' | 'review' | 'importing';

const today = () => new Date().toISOString().split('T')[0];
const round2 = (n: number) => Math.round((n || 0) * 100) / 100;

export const DyehouseFabricImportModal: React.FC<Props> = ({ isOpen, onClose, order, dyehouses, onImport }) => {
  const [step, setStep] = useState<Step>('upload');
  const [colors, setColors] = useState<ParsedColor[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [distinctDyehouses, setDistinctDyehouses] = useState<string[]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({}); // rawName -> dyehouseId
  const [remember, setRemember] = useState<Record<string, boolean>>({}); // rawName -> save alias?
  const [parseError, setParseError] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isOpen) {
      // reset on close
      setStep('upload');
      setColors([]);
      setWarnings([]);
      setDistinctDyehouses([]);
      setMapping({});
      setRemember({});
      setParseError('');
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const dyehouseById = (id: string) => dyehouses.find(d => d.id === id);

  const handleFile = async (file: File) => {
    setParseError('');
    try {
      const buf = await file.arrayBuffer();
      const result = parseDyehouseWorkbook(buf);
      if (result.colors.length === 0) {
        setParseError(result.warnings[0] || 'لم يتم العثور على أي ألوان في الملف.');
        return;
      }
      // Pre-resolve dyehouse aliases
      const aliases = await DataService.getDyehouseAliases().catch(() => []);
      const aliasMap: Record<string, string> = {};
      result.distinctDyehouses.forEach(raw => {
        const a = aliases.find(x => x.rawName.trim() === raw.trim());
        if (a) { aliasMap[raw] = a.dyehouseId; return; }
        // try a direct name match against system dyehouses
        const direct = dyehouses.find(d => d.name.trim() === raw.trim());
        if (direct) aliasMap[raw] = direct.id;
      });
      const rememberMap: Record<string, boolean> = {};
      result.distinctDyehouses.forEach(raw => { rememberMap[raw] = true; });

      setColors(result.colors);
      setWarnings(result.warnings);
      setDistinctDyehouses(result.distinctDyehouses);
      setMapping(aliasMap);
      setRemember(rememberMap);
      setStep('review');
    } catch (err: any) {
      console.error('Parse error', err);
      setParseError('تعذّر قراءة الملف. تأكد أنه ملف Excel صالح (.xlsx).');
    }
  };

  // ---- editing helpers ----
  const updateColor = (id: string, patch: Partial<ParsedColor>) =>
    setColors(prev => prev.map(c => (c.id === id ? { ...c, ...patch } : c)));

  const deleteColor = (id: string) =>
    setColors(prev => prev.filter(c => c.id !== id));

  const updateAccessory = (colorId: string, accId: string, patch: Partial<ParsedAccessory>) =>
    setColors(prev => prev.map(c => c.id === colorId
      ? { ...c, accessories: c.accessories.map(a => a.id === accId ? { ...a, ...patch } : a) }
      : c));

  const deleteAccessory = (colorId: string, accId: string) =>
    setColors(prev => prev.map(c => c.id === colorId
      ? { ...c, accessories: c.accessories.filter(a => a.id !== accId) }
      : c));

  // promote an accessory to a standalone color (inserted right after its parent)
  const promoteAccessory = (colorId: string, accId: string) =>
    setColors(prev => {
      const idx = prev.findIndex(c => c.id === colorId);
      if (idx === -1) return prev;
      const parent = prev[idx];
      const acc = parent.accessories.find(a => a.id === accId);
      if (!acc) return prev;
      const newColor: ParsedColor = {
        id: crypto.randomUUID(), color: acc.name, colorHex: '', quantity: 0, colorApproval: '',
        dyehouseColorName: '', rawDyehouse: parent.rawDyehouse, dispatchNumber: parent.dispatchNumber,
        dateSent: parent.dateSent, quantitySent: acc.sent, received: acc.received, formationDate: parent.formationDate,
        notes: '', receivedFlag: false, accessories: [], rowIndex: acc.rowIndex,
      };
      const next = [...prev];
      next[idx] = { ...parent, accessories: parent.accessories.filter(a => a.id !== accId) };
      next.splice(idx + 1, 0, newColor);
      return next;
    });

  // demote a color into an accessory of the previous color
  const demoteColor = (colorId: string) =>
    setColors(prev => {
      const idx = prev.findIndex(c => c.id === colorId);
      if (idx <= 0) return prev;
      const c = prev[idx];
      const prevColor = prev[idx - 1];
      const acc: ParsedAccessory = { id: crypto.randomUUID(), name: c.color, sent: c.quantitySent, received: c.received, rowIndex: c.rowIndex };
      const next = [...prev];
      next[idx - 1] = { ...prevColor, accessories: [...prevColor.accessories, acc] };
      next.splice(idx, 1);
      return next;
    });

  // ---- validation ----
  const unmappedDyehouses = distinctDyehouses.filter(raw => !mapping[raw]);
  const canImport = unmappedDyehouses.length === 0 && colors.length > 0;

  const handleImport = async () => {
    setStep('importing');
    try {
      // save aliases the user chose to remember
      await Promise.all(distinctDyehouses.map(async raw => {
        const id = mapping[raw];
        if (id && remember[raw]) {
          const d = dyehouseById(id);
          if (d) await DataService.saveDyehouseAlias(raw, d.id, d.name).catch(() => {});
        }
      }));

      const batches: DyeingBatch[] = colors.map(c => {
        const dye = c.rawDyehouse ? dyehouseById(mapping[c.rawDyehouse]) : undefined;
        const accessorySent = round2(c.accessories.reduce((s, a) => s + (a.sent || 0), 0));
        const accessoryReceived = round2(c.accessories.reduce((s, a) => s + (a.received || 0), 0));
        const hasSent = c.quantitySent > 0 || accessorySent > 0;
        const hasReceived = (c.received || 0) > 0 || accessoryReceived > 0;
        const sentDate = c.dateSent || today();

        const batch: DyeingBatch = {
          id: crypto.randomUUID(),
          color: c.color,
          colorHex: c.colorHex || undefined,
          quantity: c.quantity || 0,
          machine: '',
          notes: c.notes || '',
          colorApproval: c.colorApproval || undefined,
          dyehouse: dye?.name || '',
          dispatchNumber: c.dispatchNumber || undefined,
          dateSent: c.dateSent || undefined,
          formationDate: c.formationDate || undefined,
          // Raw & accessory sent are recorded once, via sentEvents / the accessories
          // array. Leaving these legacy fields set would double-count in the live row.
          quantitySentRaw: undefined,
          quantitySentAccessory: undefined,
          sentEvents: hasSent ? [{
            id: crypto.randomUUID(),
            date: sentDate,
            quantity: c.quantitySent || 0,
            accessorySent: 0,
            notes: c.notes || '',
          }] : [],
          receiveEvents: hasReceived ? [{
            id: crypto.randomUUID(),
            date: sentDate,
            quantityRaw: c.received || 0,
            quantityAccessory: accessoryReceived || 0,
            notes: c.notes || '',
          }] : [],
          accessories: c.accessories.map(a => ({
            id: a.id,
            name: a.name,
            sent: a.sent || 0,
            received: a.received || 0,
            dateSent: c.dateSent || undefined,
            dispatchNumber: c.dispatchNumber || undefined,
            formationDate: c.formationDate || undefined,
          })),
          status: hasReceived ? 'received' : hasSent ? 'sent' : 'pending',
        };
        return batch;
      });

      await onImport(batches);
      onClose();
    } catch (err) {
      console.error('Import failed', err);
      setParseError('فشل الاستيراد. حاول مرة أخرى.');
      setStep('review');
    }
  };

  const totalAccessories = colors.reduce((s, c) => s + c.accessories.length, 0);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" dir="rtl">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-[95vw] h-[90vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex justify-between items-center p-4 border-b border-slate-100">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-emerald-100 text-emerald-700 rounded-lg"><FileSpreadsheet size={22} /></div>
            <div>
              <h2 className="text-lg font-bold text-slate-800">استيراد بيانات المصبغة من إكسل</h2>
              <p className="text-xs text-slate-500">{order.material || 'طلبية'} — سيتم إضافة الألوان لهذه الطلبية</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-lg text-slate-500"><X size={20} /></button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-auto p-4">
          {step === 'upload' && (
            <div className="h-full flex flex-col items-center justify-center">
              <div
                onClick={() => fileInputRef.current?.click()}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f) handleFile(f); }}
                className="w-full max-w-lg border-2 border-dashed border-slate-300 rounded-xl p-10 text-center cursor-pointer hover:border-emerald-400 hover:bg-emerald-50/40 transition-colors"
              >
                <Upload className="w-10 h-10 mx-auto text-slate-400 mb-3" />
                <p className="font-semibold text-slate-700">اسحب ملف Excel هنا أو اضغط للاختيار</p>
                <p className="text-xs text-slate-500 mt-1">صيغة .xlsx — صف الألوان يتبعه صف الاكسسوار (مثل "15% ريبس شتوي")</p>
              </div>
              <input ref={fileInputRef} type="file" accept=".xlsx,.xls" className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
              {parseError && (
                <div className="mt-4 flex items-center gap-2 text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">
                  <AlertTriangle size={16} /> {parseError}
                </div>
              )}
            </div>
          )}

          {step === 'review' && (
            <div className="space-y-4">
              {/* Summary */}
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="px-2.5 py-1 rounded-full bg-slate-100 text-slate-700 font-medium">{colors.length} لون</span>
                <span className="px-2.5 py-1 rounded-full bg-slate-100 text-slate-700 font-medium">{totalAccessories} اكسسوار</span>
                {unmappedDyehouses.length > 0 && (
                  <span className="px-2.5 py-1 rounded-full bg-amber-100 text-amber-700 font-medium flex items-center gap-1">
                    <AlertTriangle size={12} /> {unmappedDyehouses.length} مصبغة بحاجة لربط
                  </span>
                )}
              </div>

              {/* Dyehouse alias mapping */}
              {distinctDyehouses.length > 0 && (
                <div className="border border-slate-200 rounded-lg p-3 bg-slate-50/60">
                  <div className="flex items-center gap-2 mb-2 text-sm font-semibold text-slate-700">
                    <Link2 size={15} /> ربط أسماء المصابغ
                  </div>
                  <div className="space-y-2">
                    {distinctDyehouses.map(raw => (
                      <div key={raw} className="flex flex-wrap items-center gap-2 text-sm">
                        <span className={`px-2 py-1 rounded font-medium ${mapping[raw] ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                          {raw}
                        </span>
                        <span className="text-slate-400">←</span>
                        <select
                          value={mapping[raw] || ''}
                          onChange={(e) => setMapping(m => ({ ...m, [raw]: e.target.value }))}
                          className="border border-slate-300 rounded px-2 py-1 text-sm bg-white min-w-[160px]"
                        >
                          <option value="">— اختر المصبغة —</option>
                          {dyehouses.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                        </select>
                        <label className="flex items-center gap-1 text-xs text-slate-500 cursor-pointer">
                          <input type="checkbox" checked={remember[raw] ?? true}
                            onChange={(e) => setRemember(r => ({ ...r, [raw]: e.target.checked }))} />
                          تذكّر هذا الربط
                        </label>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Warnings */}
              {warnings.length > 0 && (
                <div className="border border-amber-200 bg-amber-50 rounded-lg p-3 text-xs text-amber-800 space-y-1">
                  {warnings.map((w, i) => <div key={i} className="flex items-center gap-1"><AlertTriangle size={12} /> {w}</div>)}
                </div>
              )}

              {/* Colors table — styled to mirror the live dyeing-plan row */}
              <div className="border border-slate-200 rounded-lg overflow-x-auto">
                <table className="w-full text-sm border-collapse">
                  <thead className="bg-slate-50 text-slate-500 text-[11px] uppercase tracking-wide">
                    <tr>
                      <th className="px-3 py-2 text-right font-medium">اللون</th>
                      <th className="px-3 py-2 text-right font-medium w-24">موافقة اللون</th>
                      <th className="px-3 py-2 text-right font-medium w-24">رقم الازن</th>
                      <th className="px-3 py-2 text-center font-medium w-32">تاريخ التشكيل</th>
                      <th className="px-3 py-2 text-center font-medium w-32">تاريخ الارسال</th>
                      <th className="px-3 py-2 text-right font-medium w-28">المصبغة</th>
                      <th className="px-3 py-2 text-center font-medium w-16">مطلوب</th>
                      <th className="px-3 py-2 text-center font-medium w-16">اكسسوار</th>
                      <th className="px-3 py-2 text-center font-medium w-24">مرسل</th>
                      <th className="px-3 py-2 text-center font-medium w-16">مستلم</th>
                      <th className="px-3 py-2 text-center font-medium w-24">متبقي</th>
                      <th className="px-3 py-2 text-center font-medium w-24">الحالة</th>
                      <th className="px-3 py-2 text-right font-medium">ملاحظات</th>
                      <th className="px-2 py-2 w-10"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {colors.map((c, ci) => {
                      const accSent = round2(c.accessories.reduce((s, a) => s + (a.sent || 0), 0));
                      const accReceived = round2(c.accessories.reduce((s, a) => s + (a.received || 0), 0));
                      const hasSent = c.quantitySent > 0 || accSent > 0;
                      const hasReceived = (c.received || 0) > 0 || accReceived > 0;
                      const remRaw = Math.max(0, round2((c.quantitySent || 0) - (c.received || 0)));
                      const remAcc = Math.max(0, round2(accSent - accReceived));
                      const dyeId = c.rawDyehouse ? mapping[c.rawDyehouse] : '';
                      return (
                      <React.Fragment key={c.id}>
                        <tr className="hover:bg-slate-50/60">
                          {/* color + swatch */}
                          <td className="px-2 py-1">
                            <div className="flex items-center gap-2">
                              <div className="relative overflow-hidden w-5 h-5 rounded-full border border-slate-200 shadow-sm shrink-0 hover:scale-110 transition-transform">
                                <input type="color" value={c.colorHex || '#ffffff'}
                                  onChange={e => updateColor(c.id, { colorHex: e.target.value })}
                                  className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[150%] h-[150%] p-0 m-0 border-none cursor-pointer"
                                  title="اختر اللون" />
                              </div>
                              <input value={c.color} onChange={e => updateColor(c.id, { color: e.target.value })}
                                className="w-full px-1 py-1 bg-transparent outline-none text-right font-medium focus:bg-blue-50 rounded" placeholder="اللون..." />
                            </div>
                          </td>
                          {/* approval */}
                          <td className="px-2 py-1">
                            <input value={c.colorApproval} onChange={e => updateColor(c.id, { colorApproval: e.target.value })}
                              className="w-full px-1 py-1 bg-transparent outline-none text-center text-xs text-indigo-800 focus:bg-blue-50 rounded" placeholder="..." />
                          </td>
                          {/* dispatch */}
                          <td className="px-2 py-1">
                            <input value={c.dispatchNumber} onChange={e => updateColor(c.id, { dispatchNumber: e.target.value })}
                              className="w-full px-1 py-1 bg-transparent outline-none text-right focus:bg-blue-50 rounded" placeholder="رقم..." />
                          </td>
                          {/* formation date */}
                          <td className="px-1 py-1">
                            <input type="date" value={/^\d{4}-\d{2}-\d{2}$/.test(c.formationDate) ? c.formationDate : ''}
                              onChange={e => updateColor(c.id, { formationDate: e.target.value })}
                              className="w-full px-1 py-1 bg-transparent outline-none text-center text-[10px] font-mono text-slate-700 focus:bg-blue-50 rounded" />
                          </td>
                          {/* sent date */}
                          <td className="px-1 py-1">
                            <input type="date" value={/^\d{4}-\d{2}-\d{2}$/.test(c.dateSent) ? c.dateSent : ''}
                              onChange={e => updateColor(c.id, { dateSent: e.target.value })}
                              className="w-full px-1 py-1 bg-transparent outline-none text-center text-[10px] font-mono text-slate-700 focus:bg-blue-50 rounded" />
                          </td>
                          {/* dyehouse */}
                          <td className="px-2 py-1 text-xs text-right">
                            {c.rawDyehouse
                              ? <span className={dyeId ? 'text-slate-700 font-medium' : 'text-amber-600'}>
                                  {dyeId ? dyehouseById(dyeId)?.name : c.rawDyehouse}
                                </span>
                              : <span className="text-slate-300">—</span>}
                          </td>
                          {/* required */}
                          <td className="px-2 py-1 text-center">
                            <input type="number" value={c.quantity || ''} onChange={e => updateColor(c.id, { quantity: Number(e.target.value) })}
                              className="w-14 px-1 py-1 bg-transparent outline-none text-center focus:bg-blue-50 rounded" />
                          </td>
                          {/* accessory marker */}
                          <td className="px-2 py-1 text-center">
                            {c.accessories.length > 0
                              ? <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-indigo-100 text-indigo-600 font-bold">{c.accessories.length}</span>
                              : <span className="text-slate-300 text-xs">—</span>}
                          </td>
                          {/* sent */}
                          <td className="px-2 py-1 text-center">
                            <input type="number" value={c.quantitySent || ''} onChange={e => updateColor(c.id, { quantitySent: Number(e.target.value) })}
                              className="w-16 px-1 py-1 bg-transparent outline-none text-center font-semibold text-blue-700 focus:bg-blue-50 rounded" />
                            {accSent > 0 && <div className="text-[9px] text-amber-600 font-bold leading-none">ACC {accSent}+</div>}
                          </td>
                          {/* received */}
                          <td className="px-2 py-1 text-center">
                            <input type="number" value={c.received || ''} onChange={e => updateColor(c.id, { received: Number(e.target.value) })}
                              className="w-16 px-1 py-1 bg-transparent outline-none text-center font-semibold text-emerald-700 focus:bg-blue-50 rounded" placeholder="—" />
                            {accReceived > 0 && <div className="text-[9px] text-amber-600 font-bold leading-none">ACC {accReceived}+</div>}
                          </td>
                          {/* remaining */}
                          <td className="px-2 py-1 text-center">
                            {hasSent ? (
                              <>
                                <span className="font-semibold text-orange-600">{remRaw}</span>
                                {accSent > 0 && <div className="text-[9px] text-amber-600 font-bold leading-none">ACC {remAcc}+</div>}
                              </>
                            ) : <span className="text-slate-300">—</span>}
                          </td>
                          {/* status */}
                          <td className="px-2 py-1 text-center">
                            {hasReceived
                              ? <span className="text-[10px] font-semibold px-2 py-1 rounded bg-emerald-100 text-emerald-700">مستلم</span>
                              : hasSent
                                ? <span className="text-[10px] font-semibold px-2 py-1 rounded bg-blue-100 text-blue-700">تم الارسال</span>
                                : <span className="text-[10px] font-semibold px-2 py-1 rounded bg-indigo-100 text-indigo-600">بانتظار</span>}
                          </td>
                          {/* notes */}
                          <td className="px-2 py-1">
                            <input value={c.notes} onChange={e => updateColor(c.id, { notes: e.target.value })}
                              className="w-full px-1 py-1 bg-transparent outline-none text-right text-xs focus:bg-blue-50 rounded" placeholder="ملاحظات..." />
                          </td>
                          {/* actions */}
                          <td className="px-1 py-1 whitespace-nowrap">
                            {ci > 0 && (
                              <button title="اجعله اكسسوار للون السابق" onClick={() => demoteColor(c.id)}
                                className="p-1 text-slate-300 hover:text-indigo-600"><ChevronDown size={13} /></button>
                            )}
                            <button title="حذف اللون" onClick={() => deleteColor(c.id)}
                              className="p-1 text-slate-300 hover:text-red-600"><Trash2 size={13} /></button>
                          </td>
                        </tr>
                        {c.accessories.map(a => (
                          <tr key={a.id} className="bg-slate-50/50 text-xs">
                            <td className="px-2 py-1">
                              <div className="flex items-center gap-1 pr-7">
                                <span className="text-[9px] px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-600 font-medium shrink-0">اكسسوار</span>
                                <input value={a.name} onChange={e => updateAccessory(c.id, a.id, { name: e.target.value })}
                                  className="w-full px-1 py-0.5 bg-transparent outline-none text-right focus:bg-blue-50 rounded" />
                              </div>
                            </td>
                            <td colSpan={7}></td>
                            <td className="px-2 py-1 text-center">
                              <input type="number" value={a.sent || ''} onChange={e => updateAccessory(c.id, a.id, { sent: Number(e.target.value) })}
                                className="w-16 px-1 py-0.5 bg-transparent outline-none text-center text-amber-700 font-semibold focus:bg-blue-50 rounded" />
                            </td>
                            <td className="px-2 py-1 text-center">
                              <input type="number" value={a.received || ''} onChange={e => updateAccessory(c.id, a.id, { received: Number(e.target.value) })}
                                className="w-16 px-1 py-0.5 bg-transparent outline-none text-center text-emerald-700 font-semibold focus:bg-blue-50 rounded" placeholder="—" />
                            </td>
                            <td colSpan={3}></td>
                            <td className="px-1 py-1 whitespace-nowrap">
                              <button title="اجعله لون مستقل" onClick={() => promoteAccessory(c.id, a.id)}
                                className="p-1 text-slate-300 hover:text-indigo-600"><ChevronUp size={13} /></button>
                              <button title="حذف الاكسسوار" onClick={() => deleteAccessory(c.id, a.id)}
                                className="p-1 text-slate-300 hover:text-red-600"><Trash2 size={13} /></button>
                            </td>
                          </tr>
                        ))}
                      </React.Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {parseError && (
                <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">
                  <AlertTriangle size={16} /> {parseError}
                </div>
              )}
            </div>
          )}

          {step === 'importing' && (
            <div className="h-full flex flex-col items-center justify-center text-slate-500">
              <Loader2 className="w-8 h-8 animate-spin mb-3" />
              <p>جارٍ الاستيراد...</p>
            </div>
          )}
        </div>

        {/* Footer */}
        {step === 'review' && (
          <div className="flex items-center justify-between p-4 border-t border-slate-100">
            <button onClick={() => setStep('upload')} className="text-sm text-slate-500 hover:text-slate-700">رجوع</button>
            <button onClick={handleImport} disabled={!canImport}
              className={`flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-semibold transition-colors ${
                canImport ? 'bg-emerald-600 text-white hover:bg-emerald-700' : 'bg-slate-200 text-slate-400 cursor-not-allowed'
              }`}>
              <Check size={16} /> استيراد {colors.length} لون
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
