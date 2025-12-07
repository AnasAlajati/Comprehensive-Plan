
import React, { useState } from 'react';
import { MachineStatus, MachineRow, PlanItem } from '../types';

interface AddMachineFormProps {
  onAdd: (machine: MachineRow) => Promise<boolean>;
  isConnected: boolean;
}

export const AddMachineForm: React.FC<AddMachineFormProps> = ({ onAdd, isConnected }) => {
  const [formData, setFormData] = useState({
    id: '',
    machineName: '',
    brand: '',
    type: 'SINGLE',
    status: MachineStatus.WORKING,
    customStatusNote: '',
    dayProduction: '',
    remainingMfg: '',
    scrap: '',
    reason: '',
    client: ''
  });

  // State for the Future Plan
  const [planData, setPlanData] = useState({
    fabric: '',
    productionPerDay: '',
    quantity: '',
    days: '',
    endDate: '',
    remaining: '',
    orderName: '',
    originalSampleMachine: ''
  });

  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handlePlanChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setPlanData(prev => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isConnected || !formData.id || !formData.machineName) return;

    setIsSubmitting(true);
    
    // Create PlanItem from form data
    const newPlan: PlanItem = {
      type: 'PRODUCTION',
      fabric: planData.fabric || 'Not Specified',
      productionPerDay: Number(planData.productionPerDay) || 0,
      quantity: Number(planData.quantity) || 0,
      days: Number(planData.days) || 0,
      startDate: new Date().toISOString().split('T')[0], // Default to today
      endDate: planData.endDate || new Date().toISOString().split('T')[0],
      remaining: Number(planData.remaining) || 0,
      orderName: planData.orderName || '-',
      originalSampleMachine: planData.originalSampleMachine || '',
      notes: ''
    };

    const newMachine: MachineRow = {
      id: Number(formData.id),
      machineName: formData.machineName,
      brand: formData.brand || 'Generic',
      type: formData.type,
      status: formData.status as MachineStatus,
      customStatusNote: formData.status === MachineStatus.OTHER ? (formData.customStatusNote || '') : '',
      avgProduction: 0,
      dayProduction: Number(formData.dayProduction) || 0,
      remainingMfg: Number(formData.remainingMfg) || 0,
      scrap: Number(formData.scrap) || 0,
      reason: formData.reason || '',
      material: '-',
      client: formData.client || '-',
      futurePlans: [newPlan], // Add the single plan to the array
      orderIndex: 0 // Add default orderIndex
    };

    const success = await onAdd(newMachine);
    
    if (success) {
      // Reset Form
      setFormData({
        id: '',
        machineName: '',
        brand: '',
        type: 'SINGLE',
        status: MachineStatus.WORKING,
        customStatusNote: '',
        dayProduction: '',
        remainingMfg: '',
        scrap: '',
        reason: '',
        client: ''
      });
      // Reset Plan Data
      setPlanData({
        fabric: '',
        productionPerDay: '',
        quantity: '',
        days: '',
        endDate: '',
        remaining: '',
        orderName: '',
        originalSampleMachine: ''
      });
    }
    setIsSubmitting(false);
  };

  return (
    <form onSubmit={handleSubmit} className="bg-white p-4 sm:p-6 rounded-xl shadow-sm border border-slate-100">
      <h3 className="text-lg font-bold text-slate-800 mb-4 flex items-center gap-2">
        <svg className="w-5 h-5 text-firebase-navy" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v3m0 0v3m0-3h3m-3 0H9m12 0a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        اضافة ماكينة (Add Machine)
      </h3>

      <div className="space-y-6">
        {/* Section 1: Basic Machine Info */}
        <div>
          <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3 border-b border-slate-100 pb-1">Machine Details</h4>
          <div className="grid grid-cols-1 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">ID (رقم الماكينة) *</label>
              <input
                type="number"
                name="id"
                value={formData.id}
                onChange={handleChange}
                placeholder="101"
                className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-firebase-navy outline-none"
                required
                disabled={isSubmitting}
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">Machine Name (اسم الماكينة) *</label>
              <input
                type="text"
                name="machineName"
                value={formData.machineName}
                onChange={handleChange}
                placeholder="Unit A-1"
                className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-firebase-navy outline-none"
                required
                disabled={isSubmitting}
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">Brand (الماركة)</label>
                <input
                  type="text"
                  name="brand"
                  value={formData.brand}
                  onChange={handleChange}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-sm"
                  disabled={isSubmitting}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">Type (النوع)</label>
                <select
                  name="type"
                  value={formData.type}
                  onChange={handleChange}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-sm"
                  disabled={isSubmitting}
                >
                  <option value="SINGLE">Single</option>
                  <option value="DOUBLE">Double</option>
                  <option value="MELTON">Melton</option>
                  <option value="INTERLOCK">Interlock</option>
                  <option value="RIB">Rib</option>
                  <option value="BOUS">بوص</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className={formData.status === MachineStatus.OTHER ? "sm:col-span-2" : ""}>
                    <label className="block text-xs font-medium text-slate-500 mb-1">Status (الحالة)</label>
                    <div className="flex gap-2">
                        <select
                            name="status"
                            value={formData.status}
                            onChange={handleChange}
                            className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-sm"
                            disabled={isSubmitting}
                        >
                            {Object.values(MachineStatus).map(status => (
                            <option key={status} value={status}>{status}</option>
                            ))}
                        </select>
                        {formData.status === MachineStatus.OTHER && (
                            <input 
                                type="text"
                                name="customStatusNote"
                                value={formData.customStatusNote}
                                onChange={handleChange}
                                placeholder="Specify status..."
                                className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-firebase-navy outline-none"
                            />
                        )}
                    </div>
                </div>
                {formData.status !== MachineStatus.OTHER && (
                    <div>
                    <label className="block text-xs font-medium text-slate-500 mb-1">Client (العميل)</label>
                    <input
                        type="text"
                        name="client"
                        value={formData.client}
                        onChange={handleChange}
                        className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-sm"
                        disabled={isSubmitting}
                        placeholder="e.g. OR"
                    />
                    </div>
                )}
            </div>
          </div>
        </div>

        {/* Section 2: Future Plans */}
        <div className="bg-slate-50 p-4 rounded-lg border border-slate-200">
          <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider mb-3">
            Initial Plan (خطة مبدئية)
          </h4>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
             <div className="sm:col-span-2">
              <label className="block text-[10px] font-bold text-slate-500 mb-1">Order (الطلبية)</label>
              <input
                type="text"
                name="orderName"
                value={planData.orderName}
                onChange={handlePlanChange}
                placeholder="ORD-XXX"
                className="w-full px-3 py-1.5 bg-white border border-slate-300 rounded text-xs outline-none"
                disabled={isSubmitting}
              />
            </div>

            <div>
              <label className="block text-[10px] font-bold text-slate-500 mb-1">Original Sample (ماكينة الاصل)</label>
              <input
                type="text"
                name="originalSampleMachine"
                value={planData.originalSampleMachine}
                onChange={handlePlanChange}
                className="w-full px-3 py-1.5 bg-white border border-slate-300 rounded text-xs outline-none"
                disabled={isSubmitting}
              />
            </div>

             <div className="sm:col-span-2">
              <label className="block text-[10px] font-bold text-slate-500 mb-1">Fabric (الخامة)</label>
              <input
                type="text"
                name="fabric"
                value={planData.fabric}
                onChange={handlePlanChange}
                className="w-full px-3 py-1.5 bg-white border border-slate-300 rounded text-xs outline-none"
                disabled={isSubmitting}
              />
            </div>

            <div>
              <label className="block text-[10px] font-bold text-slate-500 mb-1">Prod/Day (انتاج)</label>
              <input
                type="number"
                name="productionPerDay"
                value={planData.productionPerDay}
                onChange={handlePlanChange}
                className="w-full px-3 py-1.5 bg-white border border-slate-300 rounded text-xs outline-none"
                disabled={isSubmitting}
              />
            </div>

            <div>
              <label className="block text-[10px] font-bold text-slate-500 mb-1">Qty (الكمية)</label>
              <input
                type="number"
                name="quantity"
                value={planData.quantity}
                onChange={handlePlanChange}
                className="w-full px-3 py-1.5 bg-white border border-slate-300 rounded text-xs outline-none"
                disabled={isSubmitting}
              />
            </div>
          </div>
        </div>
      </div>

      <div className="mt-6 pt-4 border-t border-slate-100">
        <button
          type="submit"
          disabled={!isConnected || isSubmitting}
          className={`w-full py-2.5 px-4 rounded-lg font-medium text-sm text-white transition-all shadow-sm
            ${isConnected ? 'bg-slate-900 hover:bg-slate-800' : 'bg-slate-400 cursor-not-allowed'}
          `}
        >
          {isSubmitting ? 'Saving...' : 'Add Machine'}
        </button>
      </div>
    </form>
  );
};