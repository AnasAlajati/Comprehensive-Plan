import React, { useEffect, useState } from 'react';
import { X, Plus, Trash2, Calendar, RotateCcw, Zap } from 'lucide-react';
import { DyeingBatch, DeliveryEvent, ReturnEvent } from '../types';
import { updateDoc, doc, getDoc } from 'firebase/firestore';
import { db } from '../services/firebase';

interface QuickDelivery {
  id: string;
  date: string;
  fabricQty: number;
  accessoryQty: number;
  notes?: string;
}

interface CustomerDeliveryModalProps {
  isOpen: boolean;
  onClose: () => void;
  customerId: string;
  orderId: string;
  batches: DyeingBatch[] | null; // All batches/colors for this order
  quickDeliveries?: QuickDelivery[]; // Order-level quick deliveries
  onQuickDeliveriesChange?: (deliveries: QuickDelivery[]) => void;
}

export const CustomerDeliveryModal: React.FC<CustomerDeliveryModalProps> = ({
  isOpen,
  onClose,
  customerId,
  orderId,
  batches,
  quickDeliveries: initialQuickDeliveries = [],
  onQuickDeliveriesChange,
}) => {
  const [activeTab, setActiveTab] = useState<'quick' | 'colors'>('quick');
  const [colorBatches, setColorBatches] = useState<DyeingBatch[]>([]);
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0]);
  const [selectedColorId, setSelectedColorId] = useState<string | null>(null);
  const [deliveryData, setDeliveryData] = useState<Record<string, { qty: string; accessoryQty: string; reference: string; notes: string }>>({});
  const [loading, setLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [formType, setFormType] = useState<'delivery' | 'return'>('delivery');

  // Quick entry state
  const [quickDeliveries, setQuickDeliveries] = useState<QuickDelivery[]>(initialQuickDeliveries);
  const [quickForm, setQuickForm] = useState<{ date: string; fabricQty: string; accessoryQty: string; notes: string }>({
    date: new Date().toISOString().split('T')[0],
    fabricQty: '',
    accessoryQty: '',
    notes: '',
  });
  const [quickLoading, setQuickLoading] = useState(false);

  useEffect(() => {
    if (isOpen && batches) {
      setColorBatches(batches);
      setShowForm(false);
      setActiveTab('quick');
      // Initialize delivery data for all colors
      const initData: typeof deliveryData = {};
      batches.forEach(batch => {
        initData[batch.id] = { qty: '', accessoryQty: '', reference: '', notes: '' };
      });
      setDeliveryData(initData);
      if (batches.length > 0) {
        setSelectedColorId(batches[0].id);
      }
      setQuickDeliveries(initialQuickDeliveries || []);
    }
  }, [isOpen, batches]);

  // Refresh batch data after adding delivery
  const refreshBatchData = async () => {
    try {
      const orderRef = doc(db, 'CustomerSheets', customerId, 'orders', orderId);
      const docSnap = await getDoc(orderRef);
      if (docSnap.exists()) {
        const data = docSnap.data();
        setColorBatches(data.dyeingPlan || []);
      }
    } catch (error) {
      console.error('Error refreshing batch data:', error);
    }
  };

  const handleAddDelivery = async () => {
    if (!selectedColorId) {
      alert('❌ No color selected');
      return;
    }
    
    const currentData = deliveryData[selectedColorId];
    
    if (!currentData || !currentData.qty || currentData.qty === '') {
      alert('❌ Please enter a quantity');
      return;
    }

    setLoading(true);
    try {
      const orderRef = doc(db, 'CustomerSheets', customerId, 'orders', orderId);
      const docSnap = await getDoc(orderRef);

      if (!docSnap.exists()) {
        alert('❌ Order not found in database');
        setLoading(false);
        return;
      }

      const data = docSnap.data();
      const updatedBatches = [...(data.dyeingPlan || [])];

      // Find the batch and add delivery
      const batchIdx = updatedBatches.findIndex(b => b.id === selectedColorId);
      
      if (batchIdx === -1) {
        alert('❌ Color batch not found in order');
        setLoading(false);
        return;
      }

      const batch = updatedBatches[batchIdx];
      const deliveries = Array.isArray(batch.deliveryEvents) ? [...batch.deliveryEvents] : [];
      
      const accQty = Number(currentData.accessoryQty) || 0;
      
      // Build accessories object
      const accessories: Record<string, number> = {};
      if (accQty > 0) {
        accessories['main'] = accQty;
      }
      
      // Build notes with reference if provided
      let finalNotes = currentData.notes || '';
      if (currentData.reference) {
        finalNotes = `Ref: ${currentData.reference}${finalNotes ? ' | ' + finalNotes : ''}`;
      }

      const newDelivery: DeliveryEvent = {
        id: `delivery_${Date.now()}`,
        date: selectedDate,
        quantityColorDelivered: Number(currentData.qty),
        accessoryDeliveries: accessories,
        deliveredBy: '',
        notes: finalNotes,
      };

      deliveries.push(newDelivery);
      updatedBatches[batchIdx] = { ...batch, deliveryEvents: deliveries };

      await updateDoc(orderRef, { dyeingPlan: updatedBatches });

      // Reset form and refresh data
      setDeliveryData(prev => ({
        ...prev,
        [selectedColorId]: { qty: '', accessoryQty: '', reference: '', notes: '' }
      }));
      setShowForm(false);
      
      // Refresh the batch data to show new delivery
      await refreshBatchData();
      
      alert('✅ Delivery added successfully!');
    } catch (error) {
      console.error('❌ Error saving delivery:', error);
      alert('❌ Failed to save: ' + (error instanceof Error ? error.message : String(error)));
    } finally {
      setLoading(false);
    }
  };

  const handleAddReturn = async () => {
    if (!selectedColorId) {
      alert('❌ No color selected');
      return;
    }
    
    const currentData = deliveryData[selectedColorId];
    
    if (!currentData || !currentData.qty || currentData.qty === '') {
      alert('❌ Please enter a quantity');
      return;
    }

    setLoading(true);
    try {
      const orderRef = doc(db, 'CustomerSheets', customerId, 'orders', orderId);
      const docSnap = await getDoc(orderRef);

      if (!docSnap.exists()) {
        alert('❌ Order not found in database');
        setLoading(false);
        return;
      }

      const data = docSnap.data();
      const updatedBatches = [...(data.dyeingPlan || [])];

      // Find the batch and add return
      const batchIdx = updatedBatches.findIndex(b => b.id === selectedColorId);
      
      if (batchIdx === -1) {
        alert('❌ Color batch not found in order');
        setLoading(false);
        return;
      }

      const batch = updatedBatches[batchIdx];
      const returns = Array.isArray(batch.returnEvents) ? [...batch.returnEvents] : [];
      
      const accQty = Number(currentData.accessoryQty) || 0;
      
      // Build accessories object
      const accessories: Record<string, number> = {};
      if (accQty > 0) {
        accessories['main'] = accQty;
      }
      
      // Build notes with reference if provided
      let finalNotes = currentData.notes || '';
      if (currentData.reference) {
        finalNotes = `Ref: ${currentData.reference}${finalNotes ? ' | ' + finalNotes : ''}`;
      }

      const newReturn: ReturnEvent = {
        id: `return_${Date.now()}`,
        date: selectedDate,
        quantityColorReturned: Number(currentData.qty),
        accessoryReturns: accessories,
        returnedBy: '',
        notes: finalNotes,
      };

      returns.push(newReturn);
      updatedBatches[batchIdx] = { ...batch, returnEvents: returns };

      await updateDoc(orderRef, { dyeingPlan: updatedBatches });

      // Reset form and refresh data
      setDeliveryData(prev => ({
        ...prev,
        [selectedColorId]: { qty: '', accessoryQty: '', reference: '', notes: '' }
      }));
      setShowForm(false);
      
      // Refresh the batch data to show new return
      await refreshBatchData();
      
      alert('✅ Return added successfully!');
    } catch (error) {
      console.error('❌ Error saving return:', error);
      alert('❌ Failed to save: ' + (error instanceof Error ? error.message : String(error)));
    } finally {
      setLoading(false);
    }
  };

  const handleAddQuickDelivery = async () => {
    const fabricQty = Number(quickForm.fabricQty) || 0;
    const accessoryQty = Number(quickForm.accessoryQty) || 0;
    if (fabricQty <= 0 && accessoryQty <= 0) {
      alert('❌ Enter fabric or accessory quantity');
      return;
    }
    setQuickLoading(true);
    try {
      const orderRef = doc(db, 'CustomerSheets', customerId, 'orders', orderId);
      const docSnap = await getDoc(orderRef);
      if (!docSnap.exists()) { alert('❌ Order not found'); setQuickLoading(false); return; }
      const newEntry: QuickDelivery = {
        id: `quick_${Date.now()}`,
        date: quickForm.date,
        fabricQty,
        accessoryQty,
        notes: quickForm.notes || undefined,
      };
      const existing: QuickDelivery[] = docSnap.data().quickDeliveries || [];
      const updated = [...existing, newEntry];
      await updateDoc(orderRef, { quickDeliveries: updated });
      setQuickDeliveries(updated);
      onQuickDeliveriesChange?.(updated);
      setQuickForm({ date: new Date().toISOString().split('T')[0], fabricQty: '', accessoryQty: '', notes: '' });
    } catch (e) {
      alert('❌ Failed to save: ' + (e instanceof Error ? e.message : String(e)));
    } finally {
      setQuickLoading(false);
    }
  };

  const handleDeleteQuickDelivery = async (id: string) => {
    setQuickLoading(true);
    try {
      const orderRef = doc(db, 'CustomerSheets', customerId, 'orders', orderId);
      const docSnap = await getDoc(orderRef);
      if (!docSnap.exists()) { setQuickLoading(false); return; }
      const existing: QuickDelivery[] = docSnap.data().quickDeliveries || [];
      const updated = existing.filter(d => d.id !== id);
      await updateDoc(orderRef, { quickDeliveries: updated });
      setQuickDeliveries(updated);
      onQuickDeliveriesChange?.(updated);
    } catch (e) {
      alert('❌ Failed to delete: ' + (e instanceof Error ? e.message : String(e)));
    } finally {
      setQuickLoading(false);
    }
  };

  if (!isOpen || !batches) return null;

  const currentColor = colorBatches.find(b => b.id === selectedColorId);

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-3xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-6 pb-0 border-b border-slate-200">
          <div className="flex-1">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-xl font-bold text-slate-800">Customer Delivery</h2>
              <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
                <X size={22} />
              </button>
            </div>
            {/* Tabs */}
            <div className="flex gap-1">
              <button
                onClick={() => setActiveTab('quick')}
                className={`flex items-center gap-1.5 px-4 py-2 text-sm font-semibold border-b-2 transition-colors ${activeTab === 'quick' ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
              >
                <Zap size={14} />
                Quick Entry
              </button>
              <button
                onClick={() => setActiveTab('colors')}
                className={`flex items-center gap-1.5 px-4 py-2 text-sm font-semibold border-b-2 transition-colors ${activeTab === 'colors' ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
              >
                By Color
                {colorBatches.length > 0 && <span className="text-xs bg-slate-100 text-slate-500 rounded-full px-1.5">{colorBatches.length}</span>}
              </button>
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">

          {/* ── QUICK ENTRY TAB ── */}
          {activeTab === 'quick' && (
            <div>
              {/* Add form */}
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-5 mb-6">
                <h3 className="text-sm font-semibold text-slate-700 mb-4">Add Delivery Entry</h3>
                <div className="grid grid-cols-2 gap-3 mb-3">
                  <div>
                    <label className="text-xs font-medium text-slate-500 mb-1 block">Date</label>
                    <input
                      type="date"
                      value={quickForm.date}
                      onChange={e => setQuickForm(f => ({ ...f, date: e.target.value }))}
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-slate-500 mb-1 block">Notes (optional)</label>
                    <input
                      type="text"
                      value={quickForm.notes}
                      onChange={e => setQuickForm(f => ({ ...f, notes: e.target.value }))}
                      placeholder="e.g. Invoice #1234"
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3 mb-4">
                  <div>
                    <label className="text-xs font-medium text-slate-500 mb-1 block">Fabric (kg)</label>
                    <input
                      type="number"
                      min="0"
                      step="0.1"
                      value={quickForm.fabricQty}
                      onChange={e => setQuickForm(f => ({ ...f, fabricQty: e.target.value }))}
                      placeholder="0"
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm text-center focus:outline-none focus:ring-2 focus:ring-blue-400"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-slate-500 mb-1 block">Accessory (kg)</label>
                    <input
                      type="number"
                      min="0"
                      step="0.1"
                      value={quickForm.accessoryQty}
                      onChange={e => setQuickForm(f => ({ ...f, accessoryQty: e.target.value }))}
                      placeholder="0"
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm text-center focus:outline-none focus:ring-2 focus:ring-blue-400"
                    />
                  </div>
                </div>
                <button
                  onClick={handleAddQuickDelivery}
                  disabled={quickLoading}
                  className="w-full py-2.5 bg-slate-800 hover:bg-slate-900 disabled:bg-slate-300 text-white font-semibold rounded-lg text-sm transition-colors flex items-center justify-center gap-2"
                >
                  <Plus size={15} />
                  {quickLoading ? 'Saving...' : 'Save Delivery'}
                </button>
              </div>

              {/* History */}
              {quickDeliveries.length > 0 ? (
                <div>
                  <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">History</h3>
                  <div className="space-y-2">
                    {[...quickDeliveries].reverse().map(d => (
                      <div key={d.id} className="flex items-center justify-between bg-white border border-slate-200 rounded-lg px-4 py-3">
                        <div className="flex items-center gap-4">
                          <span className="text-xs text-slate-500 font-medium w-24">{d.date}</span>
                          <span className="text-sm font-semibold text-slate-800">{d.fabricQty} kg fabric</span>
                          {d.accessoryQty > 0 && (
                            <span className="text-sm text-emerald-700 font-medium">+ {d.accessoryQty} kg acc</span>
                          )}
                          {d.notes && <span className="text-xs text-slate-400">{d.notes}</span>}
                        </div>
                        <button
                          onClick={() => handleDeleteQuickDelivery(d.id)}
                          disabled={quickLoading}
                          className="text-slate-300 hover:text-red-500 transition-colors"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    ))}
                  </div>
                  {/* Totals */}
                  <div className="mt-4 flex gap-4 bg-slate-50 border border-slate-200 rounded-lg px-4 py-3">
                    <div className="text-sm">
                      <span className="text-slate-500">Total Fabric:</span>
                      <span className="ml-2 font-bold text-slate-800">{quickDeliveries.reduce((s, d) => s + d.fabricQty, 0)} kg</span>
                    </div>
                    <div className="text-sm">
                      <span className="text-slate-500">Total Accessory:</span>
                      <span className="ml-2 font-bold text-emerald-700">{quickDeliveries.reduce((s, d) => s + d.accessoryQty, 0)} kg</span>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="text-center py-8 text-slate-400 text-sm">No quick deliveries recorded yet</div>
              )}
            </div>
          )}

          {/* ── BY COLOR TAB ── */}
          {activeTab === 'colors' && (<>
          {/* Colors Grid */}
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-6">
            {colorBatches.map(batch => {
              const deliveryCount = (batch.deliveryEvents || []).length;
              const returnCount = (batch.returnEvents || []).length;
              return (
                <button
                  key={batch.id}
                  onClick={() => {
                    setSelectedColorId(batch.id);
                    setShowForm(false);
                  }}
                  className={`p-3 rounded-lg border-2 transition-all text-left ${
                    selectedColorId === batch.id
                      ? 'border-blue-500 bg-blue-50'
                      : 'border-slate-200 bg-white hover:border-slate-300'
                  }`}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <div
                      className="w-6 h-6 rounded-full border border-slate-200"
                      style={{ backgroundColor: batch.colorHex || '#fff' }}
                    />
                    <span className="font-semibold text-sm text-slate-700">{batch.color}</span>
                  </div>
                  <div className="text-xs text-slate-500">Qty: {batch.quantity}kg</div>
                  {(deliveryCount > 0 || returnCount > 0) && (
                    <div className="mt-1 flex gap-2">
                      {deliveryCount > 0 && (
                        <div className="text-xs font-semibold text-blue-600">
                          {deliveryCount} {deliveryCount === 1 ? 'delivery' : 'deliveries'}
                        </div>
                      )}
                      {returnCount > 0 && (
                        <div className="text-xs font-semibold text-red-600">
                          {returnCount} {returnCount === 1 ? 'return' : 'returns'}
                        </div>
                      )}
                    </div>
                  )}
                </button>
              );
            })}
          </div>

          {/* Selected Color Section */}
          {currentColor && (
            <div className="space-y-4">
              {/* Color Header */}
              <div className="flex items-center justify-between pb-4 border-b">
                <div className="flex items-center gap-3">
                  <div
                    className="w-8 h-8 rounded-full border border-slate-300"
                    style={{ backgroundColor: currentColor.colorHex || '#fff' }}
                  />
                  <div>
                    <h3 className="font-semibold text-slate-700">{currentColor.color}</h3>
                    <p className="text-xs text-slate-500">{currentColor.quantity}kg batch</p>
                  </div>
                </div>
                {!showForm && (
                  <div className="flex gap-2">
                    <button
                      onClick={() => {
                        setShowForm(true);
                        setFormType('delivery');
                      }}
                      className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-semibold transition-colors"
                    >
                      <Plus size={16} />
                      Add Delivery
                    </button>
                    <button
                      onClick={() => {
                        setShowForm(true);
                        setFormType('return');
                      }}
                      className="flex items-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm font-semibold transition-colors"
                    >
                      <RotateCcw size={16} />
                      Add Return
                    </button>
                  </div>
                )}
              </div>

              {/* Existing Deliveries and Returns */}
              {!showForm && (
                <div>
                  {((currentColor.deliveryEvents && currentColor.deliveryEvents.length > 0) || 
                    (currentColor.returnEvents && currentColor.returnEvents.length > 0)) ? (
                    <div className="space-y-4">
                      {/* Deliveries */}
                      {currentColor.deliveryEvents && currentColor.deliveryEvents.length > 0 && (
                        <div>
                          <h4 className="text-sm font-semibold text-slate-700 mb-3">Delivery History</h4>
                          <div className="space-y-2">
                            {currentColor.deliveryEvents.map((delivery, idx) => {
                              const totalAcc = Object.values(delivery.accessoryDeliveries || {}).reduce((sum, val) => sum + val, 0);
                              return (
                                <div key={delivery.id} className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                                  <div className="flex items-start justify-between mb-2">
                                    <div className="flex-1">
                                      <div className="flex items-center gap-2 mb-1">
                                        <Calendar size={14} className="text-blue-600" />
                                        <span className="text-sm font-semibold text-blue-700">{delivery.date}</span>
                                      </div>
                                      <div className="grid grid-cols-2 gap-2 text-xs mt-2">
                                        <div>
                                          <span className="text-slate-600">Color:</span>
                                          <span className="ml-1 font-bold text-blue-600">{delivery.quantityColorDelivered}kg</span>
                                        </div>
                                        {totalAcc > 0 && (
                                          <div>
                                            <span className="text-slate-600">Accessory:</span>
                                            <span className="ml-1 font-bold text-emerald-600">{totalAcc}kg</span>
                                          </div>
                                        )}
                                      </div>
                                    </div>
                                  </div>
                                  {delivery.notes && (
                                    <div className="mt-2 pt-2 border-t border-blue-200">
                                      <p className="text-xs text-slate-600">{delivery.notes}</p>
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      {/* Returns */}
                      {currentColor.returnEvents && currentColor.returnEvents.length > 0 && (
                        <div>
                          <h4 className="text-sm font-semibold text-slate-700 mb-3">Return History</h4>
                          <div className="space-y-2">
                            {currentColor.returnEvents.map((returnEvent, idx) => {
                              const totalAcc = Object.values(returnEvent.accessoryReturns || {}).reduce((sum, val) => sum + val, 0);
                              return (
                                <div key={returnEvent.id} className="bg-red-50 border border-red-200 rounded-lg p-4">
                                  <div className="flex items-start justify-between mb-2">
                                    <div className="flex-1">
                                      <div className="flex items-center gap-2 mb-1">
                                        <RotateCcw size={14} className="text-red-600" />
                                        <span className="text-sm font-semibold text-red-700">{returnEvent.date}</span>
                                      </div>
                                      <div className="grid grid-cols-2 gap-2 text-xs mt-2">
                                        <div>
                                          <span className="text-slate-600">Color:</span>
                                          <span className="ml-1 font-bold text-red-600">{returnEvent.quantityColorReturned}kg</span>
                                        </div>
                                        {totalAcc > 0 && (
                                          <div>
                                            <span className="text-slate-600">Accessory:</span>
                                            <span className="ml-1 font-bold text-red-600">{totalAcc}kg</span>
                                          </div>
                                        )}
                                      </div>
                                    </div>
                                  </div>
                                  {returnEvent.notes && (
                                    <div className="mt-2 pt-2 border-t border-red-200">
                                      <p className="text-xs text-slate-600">{returnEvent.notes}</p>
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="text-center py-8 text-slate-400">
                      <p className="text-sm">No deliveries or returns yet for this color</p>
                      <p className="text-xs mt-1">Click "Add Delivery" or "Add Return" to record the first one</p>
                    </div>
                  )}
                </div>
              )}

              {/* Delivery/Return Form (Only shown when showForm is true) */}
              {showForm && (
                <div className={`border rounded-lg p-6 space-y-4 ${
                  formType === 'delivery' ? 'bg-blue-50 border-blue-200' : 'bg-red-50 border-red-200'
                }`}>
                  <div className="flex items-center justify-between pb-3 border-b border-current/20">
                    <h4 className={`font-semibold ${formType === 'delivery' ? 'text-blue-700' : 'text-red-700'}`}>
                      {formType === 'delivery' ? 'New Delivery' : 'New Return'}
                    </h4>
                    <button
                      onClick={() => setShowForm(false)}
                      className="text-slate-400 hover:text-slate-600"
                    >
                      <X size={20} />
                    </button>
                  </div>

                  {/* Date */}
                  <div>
                    <label className="text-xs font-semibold text-slate-600 mb-1 block">
                      {formType === 'delivery' ? 'Delivery Date' : 'Return Date'}
                    </label>
                    <div className="flex items-center gap-2">
                      {formType === 'delivery' ? <Calendar size={16} className="text-slate-400" /> : <RotateCcw size={16} className="text-slate-400" />}
                      <input
                        type="date"
                        value={selectedDate}
                        onChange={(e) => setSelectedDate(e.target.value)}
                        className="px-3 py-2 border border-slate-200 rounded-lg flex-1 text-sm"
                      />
                    </div>
                  </div>

                  {/* Quantity */}
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="text-xs font-semibold text-slate-600 mb-1 block">Color Quantity (kg)</label>
                      <input
                        type="number"
                        value={deliveryData[currentColor.id]?.qty || ''}
                        onChange={(e) => {
                          setDeliveryData(prev => ({
                            ...prev,
                            [currentColor.id]: { 
                              qty: e.target.value,
                              accessoryQty: prev[currentColor.id]?.accessoryQty || '',
                              reference: prev[currentColor.id]?.reference || '',
                              notes: prev[currentColor.id]?.notes || ''
                            }
                          }));
                        }}
                        placeholder="0"
                        min="0"
                        step="0.1"
                        className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm"
                      />
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-slate-600 mb-1 block">Accessory Quantity (kg)</label>
                      <input
                        type="number"
                        value={deliveryData[currentColor.id]?.accessoryQty || ''}
                        onChange={(e) => {
                          setDeliveryData(prev => ({
                            ...prev,
                            [currentColor.id]: { 
                              qty: prev[currentColor.id]?.qty || '',
                              accessoryQty: e.target.value,
                              reference: prev[currentColor.id]?.reference || '',
                              notes: prev[currentColor.id]?.notes || ''
                            }
                          }));
                        }}
                        placeholder="0"
                        min="0"
                        step="0.1"
                        className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm"
                      />
                    </div>
                  </div>

                  {/* Reference */}
                  <div>
                    <label className="text-xs font-semibold text-slate-600 mb-1 block">Reference #</label>
                    <input
                      type="text"
                      value={deliveryData[currentColor.id]?.reference || ''}
                      onChange={(e) => setDeliveryData(prev => ({
                        ...prev,
                        [currentColor.id]: { 
                          qty: prev[currentColor.id]?.qty || '',
                          accessoryQty: prev[currentColor.id]?.accessoryQty || '',
                          reference: e.target.value,
                          notes: prev[currentColor.id]?.notes || ''
                        }
                      }))}
                      placeholder="Reference..."
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm"
                    />
                  </div>

                  {/* Notes */}
                  <div>
                    <label className="text-xs font-semibold text-slate-600 mb-1 block">Notes</label>
                    <textarea
                      value={deliveryData[currentColor.id]?.notes || ''}
                      onChange={(e) => setDeliveryData(prev => ({
                        ...prev,
                        [currentColor.id]: { 
                          qty: prev[currentColor.id]?.qty || '',
                          accessoryQty: prev[currentColor.id]?.accessoryQty || '',
                          reference: prev[currentColor.id]?.reference || '',
                          notes: e.target.value
                        }
                      }))}
                      placeholder="Notes (optional)"
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm h-16 resize-none"
                    />
                  </div>

                  {/* Add Button */}
                  <button
                    onClick={formType === 'delivery' ? handleAddDelivery : handleAddReturn}
                    disabled={loading}
                    className={`w-full font-semibold py-2 rounded-lg transition-colors flex items-center justify-center gap-2 text-white ${
                      formType === 'delivery'
                        ? 'bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300'
                        : 'bg-red-600 hover:bg-red-700 disabled:bg-slate-300'
                    }`}
                  >
                    {formType === 'delivery' ? <Plus size={16} /> : <RotateCcw size={16} />}
                    {loading ? 'Saving...' : (formType === 'delivery' ? 'Save Delivery' : 'Save Return')}
                  </button>
                </div>
              )}
            </div>
          )}
          </>)}
        </div>

        {/* Footer */}
        <div className="border-t border-slate-200 p-4 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};
