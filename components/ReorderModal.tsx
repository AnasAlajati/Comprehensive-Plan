import React, { useState } from 'react';
import { X } from 'lucide-react';
import { OrderRow, Dyehouse, FabricDefinition } from '../types';

interface ReorderModalProps {
  show: boolean;
  onClose: () => void;
  parentOrder: OrderRow;
  dyehouses: Dyehouse[];
  fabrics: FabricDefinition[];
  onCreateReorder: (reorderData: Partial<OrderRow>) => Promise<void>;
}

export const ReorderModal: React.FC<ReorderModalProps> = ({
  show,
  onClose,
  parentOrder,
  dyehouses,
  fabrics,
  onCreateReorder,
}) => {
  const [reorderType, setReorderType] = useState<'طلب عميل' | 'استعواد'>('طلب عميل');
  const [reorderReason, setReorderReason] = useState('');
  const [requiredQty, setRequiredQty] = useState('');
  const [variantId, setVariantId] = useState('');
  const [selectedDyehouse, setSelectedDyehouse] = useState('');
  const [loading, setLoading] = useState(false);

  const fabricDef = fabrics.find(f => f.name === parentOrder.material);
  const variants = fabricDef?.variants || [];

  const handleSubmit = async () => {
    if (!requiredQty || !selectedDyehouse) {
      alert('الرجاء ملء جميع الحقول المطلوبة');
      return;
    }

    if (reorderType === 'استعواد' && !reorderReason.trim()) {
      alert('الرجاء إدخال السبب لإعادة الطلب');
      return;
    }

    setLoading(true);
    try {
      const newReorder: Partial<OrderRow> = {
        material: parentOrder.material,
        seasonId: parentOrder.seasonId,
        seasonName: parentOrder.seasonName,
        requiredQty: Number(requiredQty),
        variantId: variantId || undefined,
        dyehouse: selectedDyehouse,
        parentOrderId: parentOrder.id,
        reorderType,
        reorderReason: reorderType === 'استعواد' ? reorderReason : undefined,
        // Fresh start for these fields
        machine: '',
        accessory: '',
        manufacturedQty: 0,
        remainingQty: Number(requiredQty),
        orderReceiptDate: new Date().toISOString().split('T')[0],
        startDate: '',
        endDate: '',
        scrapQty: 0,
        others: '',
        notes: `إعادة طلب من: ${parentOrder.material}`,
        batchDeliveries: 0,
        accessoryDeliveries: 0,
      };

      await onCreateReorder(newReorder);
      
      // Reset form
      setReorderType('طلب عميل');
      setReorderReason('');
      setRequiredQty('');
      setVariantId('');
      setSelectedDyehouse('');
      onClose();
    } catch (error: any) {
      alert('خطأ في إنشاء إعادة الطلب: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  if (!show) return null;

  return (
    <div className="fixed inset-0 bg-black/60 z-[9999] flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md flex flex-col overflow-hidden">
        {/* Header */}
        <div className="bg-gradient-to-r from-indigo-600 to-blue-600 px-5 py-4 flex items-center justify-between">
          <div>
            <p className="text-blue-200 text-xs font-medium uppercase tracking-wide">إعادة طلب</p>
            <h2 className="text-white font-bold text-lg leading-tight">{parentOrder.material}</h2>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-blue-200 hover:text-white hover:bg-white/20 rounded-full transition"
          >
            <X size={18} />
          </button>
        </div>

        <div className="p-5 space-y-4 overflow-auto max-h-[calc(100vh-200px)]">
          {/* Parent Order Info - Read Only */}
          <div className="bg-slate-50 p-3 rounded-lg border border-slate-200 space-y-1">
            <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wide">من الطلب الأصلي</p>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div>
                <span className="text-slate-500">الخامة:</span>
                <p className="font-medium text-slate-700">{parentOrder.material}</p>
              </div>
              <div>
                <span className="text-slate-500">الموسم:</span>
                <p className="font-medium text-slate-700">{parentOrder.seasonName || parentOrder.seasonId}</p>
              </div>
            </div>
          </div>

          {/* Reorder Type */}
          <div>
            <label className="block text-xs font-bold text-slate-500 uppercase tracking-wide mb-2">
              نوع إعادة الطلب
            </label>
            <select
              value={reorderType}
              onChange={(e) => setReorderType(e.target.value as any)}
              className="w-full border-2 border-slate-200 rounded-xl px-3 py-2.5 text-sm bg-white focus:outline-none focus:border-indigo-500 transition-colors"
            >
              <option value="طلب عميل">📋 طلب عميل (طلب من العميل)</option>
              <option value="استعواد">🔄 استعواد (إعادة تخزين)</option>
            </select>
          </div>

          {/* Reason - Show only for استعواد */}
          {reorderType === 'استعواد' && (
            <div>
              <label className="block text-xs font-bold text-slate-500 uppercase tracking-wide mb-2">
                سبب إعادة الطلب *
              </label>
              <textarea
                value={reorderReason}
                onChange={(e) => setReorderReason(e.target.value)}
                placeholder="مثال: طلب جديد من العميل، أو إعادة تخزين للمخزون..."
                className="w-full border-2 border-slate-200 rounded-xl px-3 py-2 text-sm bg-white focus:outline-none focus:border-indigo-500 transition-colors resize-none"
                rows={3}
              />
            </div>
          )}

          {/* Required Qty */}
          <div>
            <label className="block text-xs font-bold text-slate-500 uppercase tracking-wide mb-2">
              الكمية المطلوبة (كجم) *
            </label>
            <input
              type="number"
              value={requiredQty}
              onChange={(e) => setRequiredQty(e.target.value)}
              placeholder="أدخل الكمية"
              className="w-full border-2 border-slate-200 rounded-xl px-3 py-2.5 text-sm bg-white focus:outline-none focus:border-indigo-500 transition-colors"
            />
          </div>

          {/* Variant Selector */}
          <div>
            <label className="block text-xs font-bold text-slate-500 uppercase tracking-wide mb-2">
              النسيج / Variant (اختياري)
            </label>
            {variants.length > 0 ? (
              <select
                value={variantId}
                onChange={(e) => setVariantId(e.target.value)}
                className="w-full border-2 border-slate-200 rounded-xl px-3 py-2.5 text-sm bg-white focus:outline-none focus:border-indigo-500 transition-colors"
              >
                <option value="">- بدون تحديد -</option>
                {variants.map(v => (
                  <option key={v.id} value={v.id}>
                    {v.yarns.map(y => `${y.percentage}% ${y.name}`).join(', ')}
                  </option>
                ))}
              </select>
            ) : (
              <div className="text-sm text-slate-400 italic p-2.5 bg-slate-50 border border-slate-200 rounded-xl">
                لا توجد نسج متاحة لهذه الخامة
              </div>
            )}
          </div>

          {/* Dyehouse Selection */}
          <div>
            <label className="block text-xs font-bold text-slate-500 uppercase tracking-wide mb-2">
              الصبغية *
            </label>
            {dyehouses.length > 0 ? (
              <select
                value={selectedDyehouse}
                onChange={(e) => setSelectedDyehouse(e.target.value)}
                className="w-full border-2 border-slate-200 rounded-xl px-3 py-2.5 text-sm bg-white focus:outline-none focus:border-indigo-500 transition-colors"
              >
                <option value="">-- اختر الصبغية --</option>
                {dyehouses.map(d => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </select>
            ) : (
              <div className="text-sm text-slate-400 italic p-2.5 bg-slate-50 border border-slate-200 rounded-xl">
                لا توجد صبغيات متاحة
              </div>
            )}
          </div>

          {/* Info Message */}
          <div className="bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 text-[10px] text-blue-700 leading-relaxed">
            <p className="font-bold mb-1">ℹ️ معلومات مهمة:</p>
            <ul className="list-disc list-inside space-y-0.5">
              <li>سيتم إنشاء إعادة طلب جديدة تماماً مستقلة عن الطلب الأصلي</li>
              <li>الخامة والموسم فقط هما نفسههما من الطلب الأصلي</li>
              <li>سيكون لها معرف طلب مختلف وحالة منفصلة</li>
            </ul>
          </div>
        </div>

        {/* Footer */}
        <div className="border-t border-slate-100 px-5 py-4 flex gap-3">
          <button
            onClick={onClose}
            disabled={loading}
            className="flex-1 py-2.5 rounded-xl border-2 border-slate-200 text-slate-600 font-semibold text-sm hover:bg-slate-50 transition disabled:opacity-50"
          >
            إلغاء
          </button>
          <button
            onClick={handleSubmit}
            disabled={loading || !requiredQty || !selectedDyehouse}
            className={`flex-1 py-2.5 rounded-xl font-bold text-sm transition ${
              loading || !requiredQty || !selectedDyehouse
                ? 'bg-slate-100 text-slate-400 cursor-not-allowed'
                : 'bg-indigo-600 hover:bg-indigo-700 text-white shadow-sm'
            }`}
          >
            {loading ? 'جاري الإنشاء...' : 'إنشاء إعادة طلب'}
          </button>
        </div>
      </div>
    </div>
  );
};
