

import React, { useState, useRef } from 'react';
import { MachineRow, MachineStatus, PlanItem } from '../types';
import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';
import { recalculateSchedule } from '../services/data';
import { FactoryService } from '../services/factoryService'; // Import Service

interface ExcelTableProps {
  machines: MachineRow[];
  onUpdate: (machine: MachineRow, reportDate?: string) => Promise<void>; // Updated signature
  onDelete: (id: number) => void;
  externalProduction?: number;
  onUpdateExternal?: (val: number) => void;
}

export const ExcelTable: React.FC<ExcelTableProps> = ({ 
  machines, 
  onUpdate, 
  onDelete,
  externalProduction = 0,
  onUpdateExternal
}) => {
  const [editingPlansId, setEditingPlansId] = useState<number | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);
  const printRef = useRef<HTMLDivElement>(null);
  const [draggedMachineId, setDraggedMachineId] = useState<number | null>(null);
  
  // Date Picker State for the Report
  const [reportDate, setReportDate] = useState<string>(new Date().toISOString().split('T')[0]);

  // Field ordering for keyboard navigation
  const EDITABLE_FIELDS: (keyof MachineRow)[] = [
    'brand', 
    'type', 
    'machineName', 
    'status', 
    'avgProduction', 
    'dayProduction', 
    'material', 
    'client', 
    'remainingMfg', 
    'scrap', 
    'reason'
  ];

  const getCellId = (machineId: number, field: string) => `cell-${machineId}-${field}`;

  const handleKeyDown = (
    e: React.KeyboardEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>, 
    machineIndex: number, 
    field: keyof MachineRow
  ) => {
    if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) return;
    
    // Only prevent default if we aren't in a multiline textarea requiring up/down nav within text
    if (e.target instanceof HTMLTextAreaElement && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) return;
    
    e.preventDefault();

    let targetMachineIndex = machineIndex;
    let targetFieldIndex = EDITABLE_FIELDS.indexOf(field);

    if (e.key === 'ArrowUp') {
      targetMachineIndex = Math.max(0, machineIndex - 1);
    } else if (e.key === 'ArrowDown') {
      targetMachineIndex = Math.min(machines.length - 1, machineIndex + 1);
    } else if (e.key === 'ArrowLeft') {
      targetFieldIndex = Math.max(0, targetFieldIndex - 1);
    } else if (e.key === 'ArrowRight') {
      targetFieldIndex = Math.min(EDITABLE_FIELDS.length - 1, targetFieldIndex + 1);
    }

    const targetMachine = machines[targetMachineIndex];
    const targetField = EDITABLE_FIELDS[targetFieldIndex];
    
    if (targetMachine && targetField) {
      const el = document.getElementById(getCellId(targetMachine.id, targetField));
      el?.focus();
    }
  };

  const handleBlur = (
    e: React.FocusEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement> | React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>,
    machine: MachineRow,
    field: keyof MachineRow
  ) => {
    const newVal = e.target.type === 'number' ? Number(e.target.value) : e.target.value;
    if (machine[field] !== newVal) {
      // Pass reportDate to ensure log is created for the selected date
      onUpdate({ ...machine, [field]: newVal }, reportDate);
    }
  };

  const handleDragStart = (e: React.DragEvent, id: number) => {
    setDraggedMachineId(id);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDrop = async (e: React.DragEvent, targetId: number) => {
    e.preventDefault();
    if (draggedMachineId === null || draggedMachineId === targetId) return;

    const draggedIndex = machines.findIndex(m => m.id === draggedMachineId);
    const targetIndex = machines.findIndex(m => m.id === targetId);
    
    if (draggedIndex === -1 || targetIndex === -1) return;

    const newMachines = [...machines];
    const [removed] = newMachines.splice(draggedIndex, 1);
    newMachines.splice(targetIndex, 0, removed);

    try {
      // Use FactoryService for reordering
      await FactoryService.updateMachineOrder(newMachines);
    } catch (err) {
      console.error("Failed to reorder machines", err);
      alert("Failed to save new order.");
    }

    setDraggedMachineId(null);
  };

  const handleDownloadPDF = async () => {
    if (!printRef.current) return;
    setIsDownloading(true);

    try {
      const element = printRef.current;

      // Force report header to be visible during capture
      const header = element.querySelector('.print-header') as HTMLElement;
      if (header) {
        header.classList.remove('hidden');
        header.style.display = 'block';
      }
      
      const canvas = await html2canvas(element, {
        scale: 2, 
        useCORS: true,
        backgroundColor: '#ffffff',
        onclone: (clonedDoc) => {
          // Replace inputs with text for clean PDF
          const inputs = clonedDoc.querySelectorAll('input, textarea');
          inputs.forEach((input: any) => {
            const span = clonedDoc.createElement('span');
            span.textContent = input.value;
            span.style.display = 'flex';
            span.style.alignItems = 'center';
            span.style.justifyContent = 'center';
            span.style.width = '100%';
            span.style.height = '100%';
            span.style.fontSize = getComputedStyle(input).fontSize;
            span.style.fontWeight = getComputedStyle(input).fontWeight;
            span.style.color = getComputedStyle(input).color;
            span.style.textAlign = 'center';
            span.style.whiteSpace = 'pre-wrap';
            if (input.tagName === 'TEXTAREA') {
               span.style.textAlign = 'center'; 
            }
            if (input.parentNode) {
              input.parentNode.replaceChild(span, input);
            }
          });

          // Handle selects
          const selects = clonedDoc.querySelectorAll('select');
          selects.forEach((select) => {
            const span = clonedDoc.createElement('span');
            const selectedOption = select.options[select.selectedIndex];
            span.textContent = selectedOption ? selectedOption.text : '';
            span.style.display = 'flex';
            span.style.alignItems = 'center';
            span.style.justifyContent = 'center';
            span.style.width = '100%';
            span.style.height = '100%';
            span.style.fontSize = getComputedStyle(select).fontSize;
            span.style.fontWeight = 'bold';
            if (select.parentNode) {
              select.parentNode.replaceChild(span, select);
            }
          });

          const scrollables = clonedDoc.querySelectorAll('.overflow-x-auto');
          scrollables.forEach(el => {
             (el as HTMLElement).style.overflow = 'visible';
             (el as HTMLElement).style.display = 'block';
          });
          
          const handles = clonedDoc.querySelectorAll('.drag-handle');
          handles.forEach(el => (el as HTMLElement).style.display = 'none');
          
          const noPrints = clonedDoc.querySelectorAll('.no-print');
          noPrints.forEach(el => (el as HTMLElement).style.display = 'none');
        }
      });

      // Hide header again after capture
      if (header) {
        header.classList.add('hidden');
        header.style.display = '';
      }

      const imgData = canvas.toDataURL('image/png');
      const pdf = new jsPDF('l', 'mm', 'a4');

      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      
      const margin = 10;
      const maxContentWidth = pageWidth - (margin * 2);
      const maxContentHeight = pageHeight - (margin * 2);
      
      const imgProps = pdf.getImageProperties(imgData);
      
      let contentWidth = maxContentWidth;
      let contentHeight = (imgProps.height * maxContentWidth) / imgProps.width;

      // Fit to page
      if (contentHeight > maxContentHeight) {
        contentHeight = maxContentHeight;
        contentWidth = (imgProps.width * maxContentHeight) / imgProps.height;
      }
      
      const x = margin + (maxContentWidth - contentWidth) / 2;
      
      pdf.addImage(imgData, 'PNG', x, margin, contentWidth, contentHeight);
      pdf.save(`Daily-Machine-Plan-${reportDate}.pdf`);

    } catch (err) {
      console.error("PDF Generation failed", err);
      alert("Failed to generate PDF. Please try again.");
    } finally {
      setIsDownloading(false);
    }
  };

  const getStatusLabel = (status: MachineStatus) => {
    switch (status) {
      case MachineStatus.WORKING: return 'تعمل';
      case MachineStatus.UNDER_OP: return 'تحت التشغيل';
      case MachineStatus.NO_ORDER: return 'متوقفة';
      case MachineStatus.OUT_OF_SERVICE: return 'خارج الخدمة';
      case MachineStatus.QALB: return 'قلب'; // Renamed
      case MachineStatus.OTHER: return 'Other'; // Renamed
      default: return status;
    }
  };

  const getStatusColor = (status: MachineStatus) => {
    switch (status) {
      case MachineStatus.WORKING: return 'bg-emerald-50 text-emerald-900';
      case MachineStatus.UNDER_OP: return 'bg-amber-50 text-amber-900';
      case MachineStatus.NO_ORDER: return 'bg-slate-100 text-slate-500';
      case MachineStatus.OUT_OF_SERVICE: return 'bg-red-50 text-red-900';
      case MachineStatus.QALB: return 'bg-purple-100 text-purple-900';
      case MachineStatus.OTHER: return 'bg-pink-50 text-pink-900';
      default: return 'bg-white';
    }
  };

  const bousMachines = machines.filter(m => m.type === 'BOUS');
  const wideMachines = machines.filter(m => m.type !== 'BOUS');
  const bousProduction = bousMachines.reduce((sum, m) => sum + (Number(m.dayProduction) || 0), 0);
  const wideProduction = wideMachines.reduce((sum, m) => sum + (Number(m.dayProduction) || 0), 0);
  const totalProduction = wideProduction + bousProduction + Number(externalProduction);
  const totalScrap = machines.reduce((sum, m) => sum + (Number(m.scrap) || 0), 0);
  const scrapPercentage = totalProduction > 0 ? (totalScrap / totalProduction) * 100 : 0;
  
  const statusCounts = machines.reduce((acc, m) => {
    acc[m.status] = (acc[m.status] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-between items-center bg-white p-3 rounded-xl border border-slate-200 shadow-sm">
        <div className="flex items-center gap-3">
            <span className="text-sm font-bold text-slate-500 uppercase tracking-wider">Report Date:</span>
            <input 
              type="date" 
              value={reportDate}
              onChange={(e) => setReportDate(e.target.value)}
              className="bg-slate-50 border border-slate-300 text-slate-700 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block p-2 outline-none font-medium shadow-sm"
            />
        </div>
        
        <button 
          onClick={handleDownloadPDF}
          disabled={isDownloading}
          className="flex items-center gap-2 bg-slate-800 hover:bg-slate-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50 shadow-sm"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
          </svg>
          {isDownloading ? 'Processing...' : 'Export PDF'}
        </button>
      </div>

      <div ref={printRef} className="flex flex-col gap-6 bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
        
        {/* Header for PDF only */}
        <div className="hidden print-header mb-4 text-center border-b border-slate-100 pb-4">
            <h1 className="text-xl font-bold text-slate-800 uppercase tracking-wide">Daily Machine Plan</h1>
            <p className="text-sm text-slate-500">Date: {new Date(reportDate).toLocaleDateString('en-GB', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</p>
        </div>

        <div className="overflow-x-auto border border-slate-200 rounded-lg shadow-sm bg-white">
          <table className="w-full text-xs text-center border-collapse min-w-[1000px]">
            <thead className="bg-slate-50 text-slate-700 font-bold">
              <tr>
                <th className="p-2 border border-slate-200 w-8 drag-handle no-print">::</th>
                <th className="p-2 border border-slate-200 w-12">م</th>
                <th className="p-2 border border-slate-200 w-24">الماركة</th>
                <th className="p-2 border border-slate-200 w-20">النوع</th>
                <th className="p-2 border border-slate-200 w-32">اسم الماكينة</th>
                <th className="p-2 border border-slate-200 w-32">الحالة</th>
                <th className="p-2 border border-slate-200 w-20">متوسط الانتاج</th>
                <th className="p-2 border border-slate-200 w-20">انتاج اليوم</th>
                <th className="p-2 border border-slate-200 w-16 text-red-600">الفرق</th>
                <th className="p-2 border border-slate-200 min-w-[140px]">الخامة</th>
                <th className="p-2 border border-slate-200 w-20">العميل</th>
                <th className="p-2 border border-slate-200 w-20">المتبقي</th>
                <th className="p-2 border border-slate-200 w-16">السقط</th>
                <th className="p-2 border border-slate-200 min-w-[120px]">السبب</th>
                <th className="p-2 border border-slate-200 w-24 no-print" data-html2canvas-ignore>خطط</th>
              </tr>
            </thead>
            <tbody>
              {machines.map((machine, index) => {
                const diff = machine.dayProduction - machine.avgProduction;
                const isOther = machine.status === MachineStatus.OTHER;

                return (
                  <tr 
                    key={machine.id} 
                    className={`hover:bg-blue-50/50 transition-colors align-middle ${draggedMachineId === machine.id ? 'opacity-50 bg-blue-100' : ''}`}
                    draggable
                    onDragStart={(e) => handleDragStart(e, machine.id)}
                    onDragOver={handleDragOver}
                    onDrop={(e) => handleDrop(e, machine.id)}
                  >
                    <td className="border border-slate-200 p-0 text-slate-400 cursor-move drag-handle hover:bg-slate-100 select-none align-middle no-print">
                      ⠿
                    </td>
                    <td className="border border-slate-200 p-2 text-slate-500 align-middle">{machine.id}</td>
                    
                    <td className="border border-slate-200 p-0 align-middle">
                      <input 
                        id={getCellId(machine.id, 'brand')}
                        defaultValue={machine.brand}
                        onBlur={(e) => handleBlur(e, machine, 'brand')}
                        onKeyDown={(e) => handleKeyDown(e, index, 'brand')}
                        className="w-full h-full p-2 text-center bg-transparent focus:bg-blue-50 focus:outline-none"
                      />
                    </td>
                    
                    <td className="border border-slate-200 p-0 align-middle">
                      <select 
                          id={getCellId(machine.id, 'type')}
                          defaultValue={machine.type}
                          onChange={(e) => handleBlur(e, machine, 'type')}
                          onKeyDown={(e) => handleKeyDown(e, index, 'type')}
                          className="w-full h-full p-2 text-center bg-transparent focus:bg-blue-50 focus:outline-none appearance-none"
                      >
                        <option value="SINGLE">SINGLE</option>
                        <option value="DOUBLE">DOUBLE</option>
                        <option value="MELTON">MELTON</option>
                        <option value="INTERLOCK">INTERLOCK</option>
                        <option value="RIB">RIB</option>
                        <option value="BOUS">بوص</option>
                      </select>
                    </td>
                    
                    <td className="border border-slate-200 p-0 align-middle h-full">
                      <textarea
                        id={getCellId(machine.id, 'machineName')}
                        defaultValue={machine.machineName}
                        onBlur={(e) => handleBlur(e, machine, 'machineName')}
                        onKeyDown={(e) => handleKeyDown(e, index, 'machineName')}
                        rows={1}
                        className="w-full h-full p-2 text-center bg-transparent focus:bg-blue-50 focus:outline-none font-medium text-slate-700 resize-none overflow-hidden"
                        style={{ minHeight: '40px', display: 'block' }}
                      />
                    </td>
                    
                    <td className={`border border-slate-200 p-0 align-middle ${getStatusColor(machine.status)}`}>
                        <div className="flex flex-col h-full w-full relative group">
                            {isOther ? (
                                <>
                                    <input 
                                        className="w-full h-full text-center text-xs p-2 bg-pink-50/50 focus:bg-white outline-none font-medium"
                                        placeholder="Type status..."
                                        defaultValue={machine.customStatusNote}
                                        onBlur={(e) => handleBlur(e, machine, 'customStatusNote')}
                                        autoFocus
                                    />
                                    {/* Small reset button to switch back from Other */}
                                    <button 
                                        onClick={() => onUpdate({ ...machine, status: MachineStatus.WORKING })}
                                        className="absolute top-0 right-0 p-1 text-slate-300 hover:text-slate-500 opacity-0 group-hover:opacity-100 transition-opacity"
                                        title="Change Status"
                                    >
                                        ▼
                                    </button>
                                </>
                            ) : (
                                <select 
                                    id={getCellId(machine.id, 'status')}
                                    defaultValue={machine.status}
                                    onChange={(e) => handleBlur(e, machine, 'status')}
                                    onKeyDown={(e) => handleKeyDown(e, index, 'status')}
                                    className="w-full h-full p-2 text-center bg-transparent focus:bg-blue-50 focus:outline-none appearance-none font-bold text-[10px]"
                                >
                                    {Object.values(MachineStatus).map(s => <option key={s} value={s}>{getStatusLabel(s)}</option>)}
                                </select>
                            )}
                        </div>
                    </td>
                    
                    <td className="border border-slate-200 p-0 align-middle">
                      <input 
                        type="number"
                        id={getCellId(machine.id, 'avgProduction')}
                        defaultValue={machine.avgProduction}
                        onBlur={(e) => handleBlur(e, machine, 'avgProduction')}
                        onKeyDown={(e) => handleKeyDown(e, index, 'avgProduction')}
                        className="w-full h-full p-2 text-center bg-transparent focus:bg-blue-50 focus:outline-none"
                      />
                    </td>
                    
                    <td className="border border-slate-200 p-0 align-middle">
                      <input 
                        type="number"
                        id={getCellId(machine.id, 'dayProduction')}
                        defaultValue={machine.dayProduction}
                        onBlur={(e) => handleBlur(e, machine, 'dayProduction')}
                        onKeyDown={(e) => handleKeyDown(e, index, 'dayProduction')}
                        className="w-full h-full p-2 text-center bg-transparent focus:bg-blue-50 focus:outline-none font-semibold text-slate-800"
                      />
                    </td>
                    
                    <td className={`border border-slate-200 p-2 font-bold align-middle ${diff < 0 ? 'text-red-500' : 'text-emerald-500'}`}>
                      {diff.toFixed(1)}
                    </td>
                    
                    <td className="border border-slate-200 p-0 align-middle h-full">
                      <textarea 
                        id={getCellId(machine.id, 'material')}
                        defaultValue={machine.material}
                        onBlur={(e) => handleBlur(e, machine, 'material')}
                        onKeyDown={(e) => handleKeyDown(e, index, 'material')}
                        rows={2}
                        className="w-full h-full p-1 text-center bg-transparent focus:bg-blue-50 focus:outline-none text-[10px] resize-none leading-tight"
                        style={{ minHeight: '40px' }}
                      />
                    </td>
                    
                    <td className="border border-slate-200 p-0 align-middle">
                      <input 
                        id={getCellId(machine.id, 'client')}
                        defaultValue={machine.client}
                        onBlur={(e) => handleBlur(e, machine, 'client')}
                        onKeyDown={(e) => handleKeyDown(e, index, 'client')}
                        className="w-full h-full p-2 text-center bg-transparent focus:bg-blue-50 focus:outline-none"
                      />
                    </td>
                    
                    <td className="border border-slate-200 p-0 align-middle">
                      <input 
                        type="number"
                        id={getCellId(machine.id, 'remainingMfg')}
                        defaultValue={machine.remainingMfg}
                        onBlur={(e) => handleBlur(e, machine, 'remainingMfg')}
                        onKeyDown={(e) => handleKeyDown(e, index, 'remainingMfg')}
                        className="w-full h-full p-2 text-center bg-transparent focus:bg-blue-50 focus:outline-none"
                      />
                    </td>
                    
                    <td className="border border-slate-200 p-0 align-middle">
                      <input 
                        type="number"
                        id={getCellId(machine.id, 'scrap')}
                        defaultValue={machine.scrap}
                        onBlur={(e) => handleBlur(e, machine, 'scrap')}
                        onKeyDown={(e) => handleKeyDown(e, index, 'scrap')}
                        className={`w-full h-full p-2 text-center bg-transparent focus:bg-blue-50 focus:outline-none ${machine.scrap > 0 ? 'text-red-600 font-bold' : ''}`}
                      />
                    </td>
                    
                    <td className="border border-slate-200 p-0 align-middle h-full">
                      <textarea 
                        id={getCellId(machine.id, 'reason')}
                        defaultValue={machine.reason}
                        onBlur={(e) => handleBlur(e, machine, 'reason')}
                        onKeyDown={(e) => handleKeyDown(e, index, 'reason')}
                        rows={2}
                        className="w-full h-full p-1 text-center bg-transparent focus:bg-blue-50 focus:outline-none text-red-500 text-[10px] resize-none leading-tight"
                        style={{ minHeight: '40px' }}
                      />
                    </td>
                    
                    <td className="border border-slate-200 p-1 no-print align-middle" data-html2canvas-ignore>
                      <button 
                        onClick={() => setEditingPlansId(machine.id)}
                        className="text-blue-600 hover:text-blue-800 hover:bg-blue-50 px-2 py-0.5 rounded text-[10px] font-medium transition-colors"
                      >
                        تعديل الخطط
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Footer */}
        <div className="border border-slate-200 rounded-lg bg-white shadow-sm overflow-hidden mt-4">
          <div className="flex flex-col-reverse md:flex-row">
            <div className="md:w-64 border-r border-slate-200 bg-slate-50 p-3 flex flex-col justify-center gap-2">
               <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1 border-b border-slate-200 pb-1">Status Overview</h4>
               {Object.values(MachineStatus).map(status => (
                 <div key={status} className="flex justify-between items-center text-xs">
                    <span className="text-slate-600">{getStatusLabel(status)}</span>
                    <span className={`font-bold px-2 rounded-full ${getStatusColor(status).replace('text-', 'text-opacity-100 text-').replace('bg-', 'bg-opacity-20 bg-')}`}>
                      {statusCounts[status] || 0}
                    </span>
                 </div>
               ))}
            </div>

            <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-slate-200">
               <div className="p-4 flex flex-col justify-center items-center bg-yellow-50/30">
                 <span className="text-xs text-amber-900/60 font-bold uppercase tracking-wider mb-1">انتاج البوص (Bous)</span>
                 <span className="text-2xl font-bold text-amber-700">{bousProduction.toLocaleString()}</span>
               </div>
               <div className="p-4 flex flex-col justify-center items-center">
                 <span className="text-xs text-slate-400 font-bold uppercase tracking-wider mb-1">مكن عريض (Wide)</span>
                 <span className="text-2xl font-bold text-slate-700">{wideProduction.toLocaleString()}</span>
               </div>
               <div className="p-4 flex flex-col justify-center items-center hover:bg-blue-50/50 transition-colors group cursor-pointer relative">
                 <span className="text-xs text-blue-900/60 font-bold uppercase tracking-wider mb-1 flex items-center gap-1">
                   خارجي (External)
                 </span>
                 <input 
                    type="number" 
                    value={externalProduction}
                    onChange={(e) => onUpdateExternal && onUpdateExternal(Number(e.target.value))}
                    className="w-full text-center bg-transparent font-bold text-2xl text-blue-700 outline-none border-b border-transparent group-hover:border-blue-300 focus:border-blue-500"
                 />
               </div>
               <div className="p-4 flex flex-col justify-center items-center bg-slate-900 text-white relative overflow-hidden">
                 <div className="absolute top-0 right-0 p-1">
                    <div className="flex items-center gap-1 bg-white/10 px-2 py-0.5 rounded text-[10px]">
                        <span className="text-red-300">Scrap:</span>
                        <span className="font-bold text-white">{totalScrap} ({scrapPercentage.toFixed(2)}%)</span>
                    </div>
                 </div>
                 <span className="text-xs text-slate-400 font-bold uppercase tracking-wider mb-1">الاجمالي (Total)</span>
                 <span className="text-3xl font-bold">{totalProduction.toLocaleString()}</span>
               </div>
            </div>
          </div>
        </div>
      </div>

      {editingPlansId !== null && (
        <FuturePlansModal 
          machine={machines.find(m => m.id === editingPlansId)!} 
          onClose={() => setEditingPlansId(null)}
          onSave={(updatedPlans) => {
            const machine = machines.find(m => m.id === editingPlansId)!;
            // Use FactoryService logic implicitly via onUpdate
            onUpdate({ ...machine, futurePlans: updatedPlans }, reportDate);
          }}
        />
      )}
    </div>
  );
};

const FuturePlansModal: React.FC<{
  machine: MachineRow;
  onClose: () => void;
  onSave: (plans: PlanItem[]) => void;
}> = ({ machine, onClose, onSave }) => {
  const [plans, setPlans] = useState<PlanItem[]>(machine.futurePlans || []);
  const [draggedPlanIndex, setDraggedPlanIndex] = useState<number | null>(null);

  const handlePlanChange = (index: number, field: keyof PlanItem, value: any) => {
    let newPlans = [...plans];
    newPlans[index] = { ...newPlans[index], [field]: value };
    newPlans = recalculateSchedule(newPlans, machine);
    setPlans(newPlans);
  };

  const addPlan = () => {
    const newPlan: PlanItem = {
      type: 'PRODUCTION',
      fabric: '',
      productionPerDay: machine.avgProduction || 150,
      quantity: 0,
      days: 0,
      startDate: '',
      endDate: '',
      remaining: 0,
      orderName: '',
      originalSampleMachine: '',
      notes: ''
    };
    const newPlans = recalculateSchedule([...plans, newPlan], machine);
    setPlans(newPlans);
  };

  const removePlan = (index: number) => {
    const filteredPlans = plans.filter((_, i) => i !== index);
    setPlans(recalculateSchedule(filteredPlans, machine));
  };

  const handleDragStart = (e: React.DragEvent, index: number) => {
    setDraggedPlanIndex(index);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDrop = (e: React.DragEvent, targetIndex: number) => {
    e.preventDefault();
    if (draggedPlanIndex === null || draggedPlanIndex === targetIndex) return;
    
    const newPlans = [...plans];
    const [removed] = newPlans.splice(draggedPlanIndex, 1);
    newPlans.splice(targetIndex, 0, removed);
    
    setPlans(recalculateSchedule(newPlans, machine));
    setDraggedPlanIndex(null);
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-0 sm:p-4">
      <div className="bg-white rounded-none sm:rounded-lg shadow-xl w-full max-w-6xl h-full sm:h-auto sm:max-h-[90vh] flex flex-col">
        <div className="p-4 border-b border-slate-200 flex justify-between items-center bg-slate-50 sm:rounded-t-lg sticky top-0 z-10">
          <h3 className="font-bold text-lg text-slate-800">Future Plans: {machine.machineName}</h3>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-700">✕</button>
        </div>
        
        <div className="p-2 sm:p-4 overflow-auto flex-1">
          <table className="w-full text-sm text-center border-collapse min-w-[800px]">
            <thead className="bg-slate-100 text-slate-700">
              <tr>
                <th className="p-2 border border-slate-300 w-8">::</th>
                <th className="p-2 border border-slate-300">Start</th>
                <th className="p-2 border border-slate-300">End</th>
                <th className="p-2 border border-slate-300">Type</th>
                <th className="p-2 border border-slate-300">Order</th>
                <th className="p-2 border border-slate-300">Orig. Machine</th>
                <th className="p-2 border border-slate-300">Fabric/Notes</th>
                <th className="p-2 border border-slate-300">Prod/Day</th>
                <th className="p-2 border border-slate-300">Qty</th>
                <th className="p-2 border border-slate-300">Days</th>
                <th className="p-2 border border-slate-300">Remaining</th>
                <th className="p-2 border border-slate-300 w-16">Action</th>
              </tr>
            </thead>
            <tbody>
              {plans.map((plan, index) => {
                const isSettings = plan.type === 'SETTINGS';
                return (
                  <tr 
                    key={index} 
                    className={`${isSettings ? 'bg-amber-50' : 'bg-white'} ${draggedPlanIndex === index ? 'opacity-50' : ''}`}
                    draggable
                    onDragStart={(e) => handleDragStart(e, index)}
                    onDragOver={handleDragOver}
                    onDrop={(e) => handleDrop(e, index)}
                  >
                    <td className="border p-0 cursor-move text-slate-400 hover:bg-slate-100">⠿</td>
                    <td className="border p-0"><input type="date" className="w-full p-2 text-center outline-none focus:bg-blue-50 text-xs bg-transparent text-slate-900" value={plan.startDate || ''} onChange={(e) => handlePlanChange(index, 'startDate', e.target.value)} /></td>
                    <td className="border p-0"><input type="date" className="w-full p-2 text-center outline-none focus:bg-blue-50 text-xs bg-transparent text-slate-900" value={plan.endDate || ''} onChange={(e) => handlePlanChange(index, 'endDate', e.target.value)} /></td>
                    <td className="border p-0">
                       <select className="w-full p-2 outline-none text-xs bg-transparent text-slate-900" value={plan.type || 'PRODUCTION'} onChange={(e) => handlePlanChange(index, 'type', e.target.value)}>
                         <option value="PRODUCTION">Prod</option>
                         <option value="SETTINGS">Settings</option>
                       </select>
                    </td>
                    <td className="border p-0"><input className="w-full p-2 text-center outline-none focus:bg-blue-50 bg-transparent text-slate-900" value={plan.orderName || ''} onChange={(e) => handlePlanChange(index, 'orderName', e.target.value)} placeholder="-" disabled={isSettings} /></td>
                    <td className="border p-0"><input className="w-full p-2 text-center outline-none focus:bg-blue-50 bg-transparent text-slate-900" value={plan.originalSampleMachine || ''} onChange={(e) => handlePlanChange(index, 'originalSampleMachine', e.target.value)} placeholder="-" disabled={isSettings} /></td>
                    <td className="border p-0">
                       {isSettings ? 
                         <input className="w-full p-2 text-left outline-none focus:bg-amber-100 bg-transparent text-amber-800" value={plan.notes || ''} onChange={(e) => handlePlanChange(index, 'notes', e.target.value)} placeholder="Notes..." /> :
                         <input className="w-full p-2 text-center outline-none focus:bg-blue-50 bg-transparent text-slate-900" value={plan.fabric} onChange={(e) => handlePlanChange(index, 'fabric', e.target.value)} />
                       }
                    </td>
                    <td className="border p-0"><input type="number" className="w-full p-2 text-center outline-none focus:bg-blue-50 bg-transparent text-slate-900" value={plan.productionPerDay} onChange={(e) => handlePlanChange(index, 'productionPerDay', Number(e.target.value))} disabled={isSettings} /></td>
                    <td className="border p-0"><input type="number" className="w-full min-w-[80px] p-2 text-center outline-none focus:bg-blue-50 bg-transparent text-slate-900" value={plan.quantity} onChange={(e) => handlePlanChange(index, 'quantity', Number(e.target.value))} disabled={isSettings} /></td>
                    <td className="border p-0"><input type="number" className="w-full min-w-[60px] p-2 text-center outline-none focus:bg-blue-50 bg-transparent text-slate-900" value={plan.days} onChange={(e) => handlePlanChange(index, 'days', Number(e.target.value))} /></td>
                    <td className="border p-0"><input type="number" className="w-full p-2 text-center outline-none focus:bg-blue-50 bg-transparent text-slate-900" value={plan.remaining} onChange={(e) => handlePlanChange(index, 'remaining', Number(e.target.value))} disabled={isSettings} /></td>
                    <td className="border p-1">
                      <div className="flex justify-center gap-1">
                         <button 
                            onClick={() => {
                              if (index === 0) return;
                              const newPlans = [...plans];
                              [newPlans[index - 1], newPlans[index]] = [newPlans[index], newPlans[index - 1]];
                              setPlans(recalculateSchedule(newPlans, machine));
                            }}
                            className="text-slate-400 hover:text-blue-600 px-1"
                         >
                            ↑
                         </button>
                         <button 
                            onClick={() => {
                              if (index === plans.length - 1) return;
                              const newPlans = [...plans];
                              [newPlans[index + 1], newPlans[index]] = [newPlans[index], newPlans[index + 1]];
                              setPlans(recalculateSchedule(newPlans, machine));
                            }}
                            className="text-slate-400 hover:text-blue-600 px-1"
                         >
                            ↓
                         </button>
                        <button onClick={() => removePlan(index)} className="text-red-500 hover:text-red-700 font-bold px-1">✕</button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <button onClick={addPlan} className="mt-4 flex items-center gap-2 text-blue-600 hover:text-blue-800 font-medium">
            <span className="text-xl">+</span> Add Plan Row
          </button>
        </div>

        <div className="p-4 border-t border-slate-200 flex justify-end gap-2 bg-slate-50 sm:rounded-b-lg sticky bottom-0 z-10">
          <button onClick={onClose} className="px-4 py-2 text-slate-600 hover:text-slate-800">Cancel</button>
          <button onClick={() => { onSave(plans); onClose(); }} className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded shadow-sm">Save Changes</button>
        </div>
      </div>
    </div>
  );
};
