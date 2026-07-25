import React, { useState } from 'react';
import { Plus, Trash2, ChevronDown, ChevronUp, Copy, Layers } from 'lucide-react';
import {
  Field, Input, ViscoHeaderInput, TathbeetMeasFields,
  emptyYarnRow, emptyViscoRow, VISCO_HEADER_PRESETS, VISCO_MIN_ROWS, VISCO_MAX_ROWS,
  makeSampleVariant,
} from './SampleCertificatePage';
import type { YarnRow, ViscoRow, TathbeetData, SampleVariant } from './SampleCertificatePage';

const genId = () => `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

const autoShrink = (v: SampleVariant) => ({
  len: v.rawWeight && v.finishedWeight ? (((+v.rawWeight - +v.finishedWeight) / +v.rawWeight) * 100).toFixed(1) + '%' : '',
  width: v.rawWidth && v.finishedWidth ? (((+v.rawWidth - +v.finishedWidth) / +v.rawWidth) * 100).toFixed(1) + '%' : '',
});

export function SampleVariantsSection({ variants, onChange }: {
  variants: SampleVariant[];
  onChange: (variants: SampleVariant[]) => void;
}) {
  const [openIds, setOpenIds] = useState<Set<string>>(new Set(variants[0] ? [variants[0].id] : []));
  const toggleOpen = (id: string) =>
    setOpenIds(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const patchVariant = (id: string, patch: Partial<SampleVariant>) =>
    onChange(variants.map(v => v.id === id ? { ...v, ...patch } : v));

  const addVariant = () => {
    const last = variants[variants.length - 1];
    const next: SampleVariant = last
      ? { ...makeSampleVariant(`متغير ${variants.length + 1}`), yarns: last.yarns.map(y => ({ ...y, id: genId() })) }
      : makeSampleVariant('متغير 1');
    onChange([...variants, next]);
    setOpenIds(prev => new Set(prev).add(next.id));
  };

  const duplicateVariant = (id: string) => {
    const src = variants.find(v => v.id === id);
    if (!src) return;
    const idx = variants.findIndex(v => v.id === id);
    const copy: SampleVariant = {
      ...src,
      id: genId(),
      label: src.label ? `${src.label} (نسخة)` : '',
      yarns: src.yarns.map(y => ({ ...y, id: genId() })),
    };
    onChange([...variants.slice(0, idx + 1), copy, ...variants.slice(idx + 1)]);
    setOpenIds(prev => new Set(prev).add(copy.id));
  };

  const removeVariant = (id: string) => {
    if (variants.length <= 1) return;
    onChange(variants.filter(v => v.id !== id));
  };

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
      <div className="px-5 py-4 flex items-center justify-between border-b border-slate-100">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-amber-50"><Layers size={16} className="text-amber-600" /></div>
          <div className="text-right">
            <p className="font-bold text-slate-800 text-base">المتغيرات</p>
            <p className="text-xs text-slate-400 mt-0.5">خام · زيرو · جاهز وخيوط مختلفة لكل تركيبة تجربها</p>
          </div>
        </div>
        <span className="text-xs font-semibold text-slate-400 bg-slate-50 border border-slate-200 px-2.5 py-1 rounded-full shrink-0">
          {variants.length}
        </span>
      </div>

      <div className="p-5 space-y-3">
        {variants.map((v, idx) => (
          <VariantCard
            key={v.id}
            variant={v}
            index={idx}
            open={openIds.has(v.id)}
            onToggle={() => toggleOpen(v.id)}
            onPatch={patch => patchVariant(v.id, patch)}
            onDuplicate={() => duplicateVariant(v.id)}
            onRemove={() => removeVariant(v.id)}
            canRemove={variants.length > 1}
          />
        ))}
        <button type="button" onClick={addVariant}
          className="w-full py-3 rounded-xl border-2 border-dashed border-amber-200 text-amber-500 hover:text-amber-700 hover:border-amber-400 hover:bg-amber-50/40 transition-all flex items-center justify-center gap-2 text-sm font-bold">
          <Plus size={16} /> إضافة متغير
        </button>
      </div>
    </div>
  );
}

function VariantCard({ variant: v, index, open, onToggle, onPatch, onDuplicate, onRemove, canRemove }: {
  variant: SampleVariant;
  index: number;
  open: boolean;
  onToggle: () => void;
  onPatch: (patch: Partial<SampleVariant>) => void;
  onDuplicate: () => void;
  onRemove: () => void;
  canRemove: boolean;
}) {
  const shrink = autoShrink(v);
  const viscoHeaderOptions = Array.from(new Set([...VISCO_HEADER_PRESETS, ...v.viscoRows.map(r => r.header).filter(Boolean)]));

  const updateYarnField = (yarnId: string, field: keyof YarnRow, val: string) =>
    onPatch({ yarns: v.yarns.map(y => y.id === yarnId ? { ...y, [field]: val } : y) });
  const addYarnRow = () => onPatch({ yarns: [...v.yarns, emptyYarnRow()] });
  const removeYarnRow = (yarnId: string) => {
    if (v.yarns.length <= 1) return;
    onPatch({ yarns: v.yarns.filter(y => y.id !== yarnId) });
  };

  const updateViscoRow = (idx: number, field: keyof ViscoRow, val: string) =>
    onPatch({ viscoRows: v.viscoRows.map((r, i) => i === idx ? { ...r, [field]: val } : r) });
  const addViscoRow = () => { if (v.viscoRows.length >= VISCO_MAX_ROWS) return; onPatch({ viscoRows: [...v.viscoRows, emptyViscoRow()] }); };
  const removeViscoRow = (idx: number) => { if (v.viscoRows.length <= VISCO_MIN_ROWS) return; onPatch({ viscoRows: v.viscoRows.filter((_, i) => i !== idx) }); };

  return (
    <div className={`rounded-xl border overflow-hidden transition-colors ${open ? 'border-amber-300' : 'border-slate-200'}`}>
      {/* Header */}
      <div className={`flex items-center gap-3 px-4 py-3 ${open ? 'bg-amber-50/60' : 'bg-slate-50 hover:bg-slate-100'} transition-colors`}>
        <button type="button" onClick={onToggle} className="shrink-0 text-slate-400">
          {open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </button>
        <span className="text-xs font-bold text-slate-400 shrink-0">#{index + 1}</span>
        <input dir="rtl" placeholder={`متغير ${index + 1}`} value={v.label}
          onChange={e => onPatch({ label: e.target.value })}
          onClick={e => e.stopPropagation()}
          className="flex-1 min-w-0 bg-transparent outline-none text-sm font-bold text-slate-800 placeholder:text-slate-400 placeholder:font-normal border-b border-transparent focus:border-amber-300 transition-colors" />

        {/* Quick summary badges */}
        <div className="hidden md:flex items-center gap-1.5 shrink-0">
          {v.zeroWeight && (
            <span className="text-[11px] font-mono bg-blue-50 text-blue-700 border border-blue-100 px-2 py-0.5 rounded-full">زيرو {v.zeroWeight}g</span>
          )}
          {v.yarns.filter(y => y.type.trim()).length > 0 && (
            <span className="text-[11px] bg-rose-50 text-rose-600 border border-rose-100 px-2 py-0.5 rounded-full">{v.yarns.filter(y => y.type.trim()).length} خيوط</span>
          )}
        </div>

        <button type="button" onClick={onDuplicate} title="نسخ المتغير"
          className="shrink-0 p-1.5 rounded-lg text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 transition-colors">
          <Copy size={14} />
        </button>
        <button type="button" onClick={onRemove} disabled={!canRemove} title="حذف المتغير"
          className="shrink-0 p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors">
          <Trash2 size={14} />
        </button>
      </div>

      {!open ? null : (
        <div className="p-4 space-y-5 border-t border-amber-100">

          {/* Measurements */}
          <div>
            <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">المقاسات — خام · زيرو · جاهز</p>
            <div className="grid grid-cols-3 gap-3">
              {([
                { key: 'raw',      label: 'خام',  sub: 'Raw',      cls: 'border-slate-200  bg-slate-50   text-slate-700'  },
                { key: 'zero',     label: 'زيرو', sub: 'Zero',     cls: 'border-blue-200   bg-blue-50    text-blue-700'   },
                { key: 'finished', label: 'جاهز', sub: 'Finished', cls: 'border-emerald-200 bg-emerald-50 text-emerald-700' },
              ] as const).map(col => (
                <div key={col.key} className={`rounded-xl border p-3 space-y-2.5 ${col.cls}`}>
                  <p className="text-center font-bold text-xs">{col.label} <span className="text-[10px] font-normal opacity-60">({col.sub})</span></p>
                  <Field label="الوزن" sublabel="g/m²">
                    <Input type="number" placeholder="0" unit="g" className="bg-white"
                      value={(v as any)[`${col.key}Weight`]}
                      onChange={e => onPatch({ [`${col.key}Weight`]: e.target.value } as any)} />
                  </Field>
                  <Field label="العرض" sublabel="cm">
                    <Input type="number" placeholder="0" unit="cm" className="bg-white"
                      value={(v as any)[`${col.key}Width`]}
                      onChange={e => onPatch({ [`${col.key}Width`]: e.target.value } as any)} />
                  </Field>
                </div>
              ))}
            </div>

            {(shrink.len || shrink.width) && (
              <div className="flex items-center gap-3 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2 mt-3">
                <span className="text-[11px] font-semibold text-amber-700">الانكماش المحسوب تلقائياً:</span>
                {shrink.len   && <span className="text-[11px] bg-amber-100 text-amber-800 px-2 py-0.5 rounded font-mono">طولي: {shrink.len}</span>}
                {shrink.width && <span className="text-[11px] bg-amber-100 text-amber-800 px-2 py-0.5 rounded font-mono">عرضي: {shrink.width}</span>}
              </div>
            )}
            <div className="grid grid-cols-2 gap-3 mt-3">
              <Field label="الانكماش الطولى" sublabel="يمكن تعديله">
                <Input placeholder={shrink.len || '5%'} value={v.shrinkageLength} onChange={e => onPatch({ shrinkageLength: e.target.value })} />
              </Field>
              <Field label="الانكماش العرضى" sublabel="يمكن تعديله">
                <Input placeholder={shrink.width || '3%'} value={v.shrinkageWidth} onChange={e => onPatch({ shrinkageWidth: e.target.value })} />
              </Field>
            </div>
          </div>

          {/* Yarns */}
          <div>
            <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">الغزول</p>
            <div className="space-y-3">
              {v.yarns.map((yarn, yIdx) => (
                <div key={yarn.id} className="bg-slate-50 rounded-xl p-3 border border-slate-100 relative group">
                  <div className="flex items-center justify-between mb-2.5">
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] font-bold text-slate-500 bg-white border border-slate-200 px-2 py-0.5 rounded-full">غزل #{yIdx + 1}</span>
                      {yarn.type && <span className="text-[11px] text-rose-600 font-medium bg-rose-50 border border-rose-100 px-2 py-0.5 rounded-full">{yarn.type}</span>}
                    </div>
                    {v.yarns.length > 1 && (
                      <button type="button" onClick={() => removeYarnRow(yarn.id)}
                        className="opacity-0 group-hover:opacity-100 transition-opacity p-1 text-red-400 hover:text-red-600 hover:bg-red-50 rounded">
                        <Trash2 size={13} />
                      </button>
                    )}
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-2.5 mb-2.5">
                    <Field label="نوع الغزل">
                      <Input placeholder="كوتن 30/1" value={yarn.type} onChange={e => updateYarnField(yarn.id, 'type', e.target.value)} />
                    </Field>
                    <Field label="رقم اللوط" sublabel="Lot No.">
                      <Input placeholder="BEL YARN 100" value={yarn.lotNumber ?? ''} onChange={e => updateYarnField(yarn.id, 'lotNumber', e.target.value)} />
                    </Field>
                    <Field label="النسبة المئوية" sublabel="%">
                      <Input type="number" unit="%" value={yarn.percentage} onChange={e => updateYarnField(yarn.id, 'percentage', e.target.value)} />
                    </Field>
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
                    <Field label="عدد الكونات">
                      <Input type="number" value={yarn.cones} onChange={e => updateYarnField(yarn.id, 'cones', e.target.value)} />
                    </Field>
                    <Field label="نوع الغزل تفصيل">
                      <Input value={yarn.yarnDetail} onChange={e => updateYarnField(yarn.id, 'yarnDetail', e.target.value)} />
                    </Field>
                    <Field label="عدد الفتل بالمكوك">
                      <Input type="number" value={yarn.twistCount} onChange={e => updateYarnField(yarn.id, 'twistCount', e.target.value)} />
                    </Field>
                    <Field label="عدد المواكيك">
                      <Input type="number" value={yarn.feeders} onChange={e => updateYarnField(yarn.id, 'feeders', e.target.value)} />
                    </Field>
                  </div>
                </div>
              ))}
              <button type="button" onClick={addYarnRow}
                className="w-full py-2 rounded-xl border-2 border-dashed border-rose-200 text-rose-400 hover:text-rose-600 hover:border-rose-400 hover:bg-rose-50/30 transition-all flex items-center justify-center gap-2 text-xs font-medium">
                <Plus size={13} /> إضافة غزل
              </button>
            </div>
          </div>

          {/* Stitch length + Visco */}
          <div>
            <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">إعدادات الغرزة</p>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-3">
              <Field label="طول غرزة"><Input value={v.stitchLength} onChange={e => onPatch({ stitchLength: e.target.value })} /></Field>
            </div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-semibold text-slate-600">ويسكو</label>
              <button type="button" onClick={addViscoRow} disabled={v.viscoRows.length >= VISCO_MAX_ROWS}
                className="inline-flex items-center gap-1 text-xs font-medium px-2 py-1 rounded-lg text-indigo-600 hover:bg-indigo-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
                <Plus size={13} /> إضافة صف
              </button>
            </div>
            <div className="space-y-2">
              <div className="grid grid-cols-[1fr_1fr_32px] gap-2 px-1 text-[11px] font-semibold text-slate-400">
                <span>العنوان</span><span>القيمة</span><span></span>
              </div>
              {v.viscoRows.map((r, idx) => (
                <div key={idx} className="grid grid-cols-[1fr_1fr_32px] gap-2 items-center">
                  <ViscoHeaderInput value={r.header} options={viscoHeaderOptions}
                    onChange={val => updateViscoRow(idx, 'header', val)} />
                  <Input value={r.value} onChange={e => updateViscoRow(idx, 'value', e.target.value)} />
                  <button type="button" onClick={() => removeViscoRow(idx)} disabled={v.viscoRows.length <= VISCO_MIN_ROWS}
                    title="حذف الصف"
                    className="p-1.5 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors">
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Dyehouse override */}
          <div className="pt-3 border-t border-slate-100">
            <label className="flex items-center gap-2 cursor-pointer w-fit">
              <input type="checkbox" checked={v.hasCustomDyehouse}
                onChange={e => onPatch({ hasCustomDyehouse: e.target.checked })}
                className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500" />
              <span className="text-xs font-semibold text-slate-600">لهذا المتغير بيانات مصبغة مختلفة</span>
            </label>
            {!v.hasCustomDyehouse ? (
              <p className="text-[11px] text-slate-400 mt-1.5 mr-6">يتبع الإعدادات العامة للمصبغة (في قسم بيانات المصبغة بالأسفل)</p>
            ) : (
              <div className="mt-3 space-y-3 bg-indigo-50/50 border border-indigo-100 rounded-xl p-3">
                <div className="flex flex-wrap gap-1.5">
                  {Object.keys(v.dyehouseSteps).map(step => {
                    const on = v.dyehouseSteps[step];
                    const isTathbeet = step === 'تثبيت';
                    return (
                      <button key={step} type="button"
                        onClick={() => onPatch({ dyehouseSteps: { ...v.dyehouseSteps, [step]: !on } })}
                        className={`px-3 py-1.5 rounded-full text-[11px] font-medium border-2 transition-all ${on
                          ? isTathbeet ? 'bg-teal-600 text-white border-teal-600' : 'bg-indigo-600 text-white border-indigo-600'
                          : 'bg-white text-slate-500 border-slate-200 hover:border-indigo-300 hover:text-indigo-600'}`}>
                        {on && '✓ '}{step}
                      </button>
                    );
                  })}
                </div>

                {v.dyehouseSteps['تثبيت'] && (() => {
                  const t = v.tathbeet;
                  const setT = (patch: Partial<TathbeetData>) => onPatch({ tathbeet: { ...t, ...patch } });
                  return (
                    <div className="bg-white border border-teal-200 rounded-xl p-3 space-y-3">
                      <div className="flex gap-2">
                        {([
                          { v: 'before', label: 'قبل الصباغة' },
                          { v: 'after',  label: 'بعد الصباغة'  },
                          { v: 'both',   label: 'قبل وبعد'     },
                        ] as { v: TathbeetData['timing']; label: string }[]).map(opt => (
                          <button key={opt.v} type="button" onClick={() => setT({ timing: opt.v })}
                            className={`flex-1 py-1.5 rounded-lg text-[11px] font-bold border-2 transition-all ${t.timing === opt.v
                              ? 'bg-teal-600 text-white border-teal-600'
                              : 'bg-white text-slate-500 border-slate-200 hover:border-teal-300 hover:text-teal-700'}`}>
                            {opt.label}
                          </button>
                        ))}
                      </div>
                      {(t.timing === 'before' || t.timing === 'both') && (
                        <TathbeetMeasFields prefix="before" label="قبل الصباغة" tathbeet={t} onChange={setT} />
                      )}
                      {(t.timing === 'after' || t.timing === 'both') && (
                        <TathbeetMeasFields prefix="after" label="بعد الصباغة" tathbeet={t} onChange={setT} />
                      )}
                    </div>
                  );
                })()}

                <textarea rows={2} dir="rtl" placeholder="ملاحظات المصبغة لهذا المتغير..."
                  value={v.dyehouseNotes} onChange={e => onPatch({ dyehouseNotes: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 bg-white text-sm resize-none outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 transition-all" />
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
