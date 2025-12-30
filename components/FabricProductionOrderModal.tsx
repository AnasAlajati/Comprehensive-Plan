import React, { useState, useEffect, useRef } from 'react';
import { X, Printer, FileText, Download } from 'lucide-react';
import { OrderRow, FabricDefinition, YarnAllocationItem, Yarn } from '../types';
import { toJpeg } from 'html-to-image';
import { jsPDF } from 'jspdf';

interface FabricProductionOrderModalProps {
  isOpen: boolean;
  onClose: () => void;
  order: OrderRow;
  clientName: string;
  fabric: FabricDefinition | undefined;
  activeMachines: string[];
  plannedMachines: string[];
  allYarns: Yarn[];
  onMarkPrinted: () => void;
}

export const FabricProductionOrderModal: React.FC<FabricProductionOrderModalProps> = ({
  isOpen,
  onClose,
  order,
  clientName,
  fabric,
  activeMachines,
  plannedMachines,
  allYarns,
  onMarkPrinted
}) => {
  const [selectedMachine, setSelectedMachine] = useState<string>('');
  const [notes, setNotes] = useState<string>('');
  const [isDownloading, setIsDownloading] = useState(false);
  const printRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isOpen) {
      const all = [...new Set([...activeMachines, ...plannedMachines])];
      if (all.length > 0) {
        setSelectedMachine(all[0]);
      } else if (order.machine) {
        setSelectedMachine(order.machine);
      }
    }
  }, [isOpen, activeMachines, plannedMachines, order.machine]);

  if (!isOpen) return null;

  const allMachines = [...new Set([...activeMachines, ...plannedMachines])];
  if (allMachines.length === 0 && order.machine) {
    allMachines.push(order.machine);
  }

  const handleDownloadPDF = async () => {
    if (!printRef.current) return;
    setIsDownloading(true);

    try {
      const element = printRef.current;
      
      // Use html-to-image to generate JPEG for smaller file size
      const dataUrl = await toJpeg(element, {
        cacheBust: true,
        backgroundColor: '#ffffff',
        pixelRatio: 2, // Higher quality
        quality: 0.7, // Compression for smaller file size
      });

      const pdf = new jsPDF('p', 'mm', 'a4');
      const pdfWidth = pdf.internal.pageSize.getWidth();
      const pdfHeight = pdf.internal.pageSize.getHeight();
      
      // Calculate image dimensions to fit A4
      const imgProps = pdf.getImageProperties(dataUrl);
      const imgHeight = (imgProps.height * pdfWidth) / imgProps.width;
      
      pdf.addImage(dataUrl, 'JPEG', 0, 0, pdfWidth, imgHeight);
      pdf.save(`Production_Order_${order.material}_${new Date().toISOString().split('T')[0]}.pdf`);
      
      onMarkPrinted();
    } catch (error) {
      console.error('Error generating PDF:', error);
      alert('Failed to generate PDF. Please try again.');
    } finally {
      setIsDownloading(false);
    }
  };



  // Helper to get yarn name
  const getYarnName = (id: string) => {
    const y = allYarns.find(y => y.id === id || y.yarnId === id);
    return y ? y.name : id;
  };

  // Helper to format dyehouse machines
  const getDyehouseMachines = () => {
    if (!order.dyeingPlan || order.dyeingPlan.length === 0) return 'Not Specified';
    
    const counts = new Map<string, number>();
    order.dyeingPlan.forEach(batch => {
      if (batch.machine) {
        counts.set(batch.machine, (counts.get(batch.machine) || 0) + 1);
      }
    });

    return Array.from(counts.entries())
      .map(([machine, count]) => `${machine}*${count}`)
      .join(' + ');
  };

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col overflow-hidden">
        
        {/* Header */}
        <div className="p-4 border-b border-slate-200 flex justify-between items-center bg-slate-50">
          <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2">
            <FileText className="w-6 h-6 text-blue-600" />
            Fabric Production Order
          </h2>
          <div className="flex items-center gap-2">
            <button 
              onClick={handleDownloadPDF}
              disabled={isDownloading}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isDownloading ? (
                <>Generating...</>
              ) : (
                <>
                  <Download size={18} />
                  Download PDF
                </>
              )}
            </button>
            <button 
              onClick={onClose}
              className="p-2 hover:bg-slate-200 rounded-full transition-colors text-slate-500"
            >
              <X size={20} />
            </button>
          </div>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto p-8 bg-slate-100">
          
          {/* A4 Page Layout */}
          <div ref={printRef} className="max-w-[210mm] mx-auto bg-white shadow-lg p-6 min-h-[297mm]">
            
            {/* Title Section */}
            <div className="text-center border-b-2 border-black pb-2 mb-4">
              <h1 className="text-2xl font-bold uppercase tracking-wider mb-1">Production Order</h1>
              <div className="text-xs text-slate-500">
                Date: {new Date().toLocaleDateString()}
              </div>
            </div>
            
            {/* Key Info Grid */}
            <div className="grid grid-cols-2 gap-x-8 gap-y-4 mb-4">
              <div className="border-b border-slate-200 pb-1">
                <span className="text-xs font-bold text-slate-500 uppercase block mb-1">Client</span>
                <div className="text-base font-bold">{clientName}</div>
              </div>
              <div className="border-b border-slate-200 pb-1">
                <span className="text-xs font-bold text-slate-500 uppercase block mb-1">Machine</span>
                <div className="text-base font-bold">{selectedMachine || 'Not Assigned'}</div>
              </div>
              <div className="border-b border-slate-200 pb-1">
                <span className="text-xs font-bold text-slate-500 uppercase block mb-1">Fabric Name</span>
                <div className="text-base font-bold leading-relaxed whitespace-pre-wrap" style={{ direction: 'rtl', textAlign: 'right' }}>
                  {fabric?.name || order.material}
                </div>
              </div>
              <div className="border-b border-slate-200 pb-1">
                <span className="text-xs font-bold text-slate-500 uppercase block mb-1">Order Quantity</span>
                <div className="text-base font-bold">{order.requiredQty} kg</div>
              </div>
            </div>

            {/* Specs Grid */}
            <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 mb-4">
              <h3 className="font-bold text-slate-800 border-b border-slate-200 pb-1 mb-2 uppercase text-xs">
                Technical Specifications
              </h3>
              <div className="grid grid-cols-4 gap-4">
                <div>
                  <span className="text-[10px] text-slate-500 block">Required GSM</span>
                  <span className="font-bold text-base">{order.requiredGsm || '-'}</span>
                </div>
                <div>
                  <span className="text-[10px] text-slate-500 block">Required Width</span>
                  <span className="font-bold text-base">{order.requiredWidth || '-'}</span>
                </div>
                <div>
                  <span className="text-[10px] text-slate-500 block">Accessories</span>
                  <span className="font-bold text-base">{order.accessory || 'None'}</span>
                </div>
                <div>
                  <span className="text-[10px] text-slate-500 block">Acc. Qty</span>
                  <span className="font-bold text-base">{order.accessoryQty || '-'}</span>
                </div>
              </div>
            </div>

            {/* Yarn Allocations */}
            <div className="mb-4">
              <h3 className="font-bold text-slate-800 border-b-2 border-black pb-1 mb-2 uppercase text-xs">
                Yarn Allocation
              </h3>
              <table className="w-full text-xs text-left">
                <thead>
                  <tr className="border-b border-slate-300">
                    <th className="py-1 font-bold w-1/3">Yarn Type</th>
                    <th className="py-1 font-bold">Allocated Lot #</th>
                    <th className="py-1 font-bold text-right">Quantity</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {order.yarnAllocations && Object.entries(order.yarnAllocations).length > 0 ? (
                    Object.entries(order.yarnAllocations).map(([yarnId, allocations]) => (
                      <tr key={yarnId}>
                        <td className="py-2 align-top font-medium leading-relaxed" style={{ direction: 'rtl', textAlign: 'right' }}>
                          {getYarnName(yarnId)}
                        </td>
                        <td className="py-2 align-top">
                          <div className="flex flex-col gap-1">
                            {allocations.map((alloc, i) => (
                              <span key={i} className="bg-slate-100 px-1.5 py-0.5 rounded">
                                {alloc.lotNumber}
                              </span>
                            ))}
                          </div>
                        </td>
                        <td className="py-2 align-top text-right font-mono">
                          {allocations.reduce((sum, a) => sum + (a.quantity || 0), 0).toFixed(1)} kg
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={3} className="py-2 text-center text-slate-400 italic">
                        No specific yarn lots allocated.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Dyehouse Info */}
            <div className="mb-4">
              <h3 className="font-bold text-slate-800 border-b-2 border-black pb-1 mb-2 uppercase text-xs">
                Dyehouse Information
              </h3>
              <div className="grid grid-cols-2 gap-8">
                <div>
                  <span className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Dyehouse</span>
                  <div className="text-base font-bold">{order.dyehouse || 'Not Specified'}</div>
                </div>
                <div>
                  <span className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Machines</span>
                  <div className="text-base font-bold">{getDyehouseMachines()}</div>
                </div>
              </div>
            </div>

            {/* Notes Section */}
            <div className="mb-4">
              <h3 className="font-bold text-slate-800 border-b-2 border-black pb-1 mb-2 uppercase text-xs">
                Production Notes
              </h3>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Enter any additional notes here..."
                className="w-full min-h-[60px] p-2 border border-slate-300 rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
              />
              {order.notes && (
                <div className="mt-2 p-2 bg-yellow-50 border border-yellow-100 rounded text-xs">
                  <span className="font-bold block mb-1">Order Notes:</span>
                  {order.notes}
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="mt-8 pt-4 border-t-2 border-black flex justify-between text-[10px] text-slate-500">
              <div>
                <span className="font-bold">Generated By:</span> System
              </div>
              <div>
                <span className="font-bold">Approved By:</span> _______________________
              </div>
            </div>

          </div>
        </div>
        
        {/* Machine Selection Footer (Outside PDF) */}
        {allMachines.length > 1 && (
          <div className="p-4 bg-slate-50 border-t border-slate-200">
             <label className="block text-sm font-bold text-slate-700 mb-2">
               Select Machine for Order Sheet:
             </label>
             <div className="flex flex-wrap gap-2">
               {allMachines.map(m => (
                 <button
                   key={m}
                   onClick={() => setSelectedMachine(m)}
                   className={`px-3 py-1 rounded border text-sm font-medium transition-colors ${
                     selectedMachine === m 
                       ? 'bg-blue-600 text-white border-blue-600' 
                       : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
                   }`}
                 >
                   {m}
                 </button>
               ))}
             </div>
          </div>
        )}
      </div>
    </div>
  );
};
