import React, { useState, useEffect, useRef } from 'react';
import { X, Printer, FileText, Download } from 'lucide-react';
import { OrderRow, FabricDefinition, YarnAllocationItem, Yarn, DyeingBatch } from '../types';
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
  const [manualMachine, setManualMachine] = useState<string>('');
  
  // New State for Qty and Accessories
  const [editedTotalQty, setEditedTotalQty] = useState<string>('');
  const [accessoryName, setAccessoryName] = useState<string>('');
  const [accessoryQty, setAccessoryQty] = useState<string>('');
  const [dyehouseInfo, setDyehouseInfo] = useState<string>('');
  const [numberOfBatches, setNumberOfBatches] = useState<string>('');

  const [notes, setNotes] = useState<string>('');
  const [checkboxes, setCheckboxes] = useState({
    open: false,
    closed: false,
    production: false,
    sample: false
  });
  const [isDownloading, setIsDownloading] = useState(false);
  const printRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isOpen) {
      const all = [...new Set([...activeMachines, ...plannedMachines])];
      if (all.length > 0) {
        setSelectedMachine(all[0]);
      } else if (order.machine) {
        setSelectedMachine(order.machine);
      } else {
        setSelectedMachine('');
      }
      setNotes(order.notes || '');
      setEditedTotalQty(order.requiredQty?.toString() || '');
      
      // Initialize Accessory Fields
      setAccessoryName(order.accessory || order.accessoryType || '');
      setAccessoryQty(order.accessoryQty?.toString() || '');

      // Initialize Dyehouse Info
      const formattedDyePlan = formatDyeingPlan(order.dyeingPlan);
      setDyehouseInfo(formattedDyePlan || order.requiredQty?.toString() || '');
      
      // Initialize Batch Count
      setNumberOfBatches((order.dyeingPlan ? order.dyeingPlan.length || 1 : 1).toString());

      // Infer initial checkboxes if possible, otherwise default false
      // Currently defaulting to 'Production' checked if not sample
      setCheckboxes({
        open: false,
        closed: false,
        production: !order.isSample,
        sample: !!order.isSample
      });
    }
  }, [isOpen, activeMachines, plannedMachines, order.machine, order.notes, order.isSample, order.requiredQty, order.accessory, order.accessoryType, order.accessoryQty, order.dyeingPlan]);

  const formatDyeingPlan = (plan: DyeingBatch[] | undefined) => {
    if (!plan || plan.length === 0) return '';
    const counts: Record<number, number> = {};
    plan.forEach(p => {
        const cap = p.plannedCapacity || p.quantity || 0;
        counts[cap] = (counts[cap] || 0) + 1;
    });
    return Object.entries(counts).map(([cap, count]) => {
        const capacity = Number(cap);
        if (count > 1) return `${capacity}*${count}`;
        return `${capacity}`;
    }).join(' + ');
  };

  // Handle manual machine input changes
  // If no machine is selected/available, we use this manual value. 
  // We'll display this value in the print view if selectedMachine is empty.

  const currentMachineDisplay = selectedMachine || manualMachine;


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
    
    const counts = new Map<number, number>();
    order.dyeingPlan.forEach(batch => {
      if (batch.quantity) {
        counts.set(batch.quantity, (counts.get(batch.quantity) || 0) + 1);
      }
    });

    return Array.from(counts.entries())
      .map(([capacity, count]) => `${capacity}*${count}`)
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
          <div ref={printRef} className="max-w-[210mm] mx-auto bg-white shadow-lg p-[10mm] min-h-[297mm] text-black text-xs" dir="rtl">
            
            {/* 1. Header Section */}
            <div className="flex border-b-2 border-slate-800 pb-2 mb-4 items-center min-h-[80px]">
                {/* Left: Box */}
                <div className="w-1/3 h-20 border-2 border-slate-800 flex items-center justify-center bg-slate-50">
                    {/* Placeholder for Logo or QR */}
                </div>

                {/* Center: Title */}
                <div className="w-1/3 flex flex-col items-center justify-center">
                    <h1 className="text-lg font-bold border-2 border-slate-800 px-6 py-1 bg-slate-100 shadow-sm">أمر تشغيل</h1>
                </div>

                {/* Right: Info */}
                <div className="w-1/3 text-left pl-2">
                     <div className="flex justify-end flex-col gap-1 text-xs font-bold">
                        <div className="flex items-center justify-end gap-2">
                             <span>التاريخ:</span>
                             <span className="border-b border-dotted border-slate-400 min-w-[100px] text-center">{new Date().toLocaleDateString('en-GB')}</span>
                        </div>
                        {/* Empty lines for manual dates if needed */}
                     </div>
                </div>
            </div>

            {/* 2. Order Data Box */}
            <div className="mb-4">
                 <div className="border-2 border-slate-800 bg-slate-200 text-center font-bold py-0.5 text-xs w-full mb-2">بيانات الأوردار</div>
                 <div className="px-2 space-y-2">
                      {/* Row 1: Client & Fabric */}
                      <div className="flex justify-between items-center gap-4">
                           <div className="flex items-center gap-2 w-1/2">
                                <span className="font-bold whitespace-nowrap min-w-[60px]">العميل :</span>
                                <span className="border-b border-dotted border-slate-400 w-full text-right px-2 font-mono font-bold text-base">{clientName}</span>
                           </div>
                           <div className="flex items-center gap-2 w-1/2">
                                <span className="font-bold whitespace-nowrap min-w-[70px]">نوع القماش :</span>
                                <span className="border-b border-dotted border-slate-400 w-full text-right px-2 font-bold">{fabric?.name || order.material}</span>
                           </div>
                      </div>

                      {/* Row 2: Machine & Order No */}
                      <div className="flex justify-between items-center gap-4">
                           <div className="flex items-center gap-2 w-1/2">
                                <span className="font-bold whitespace-nowrap min-w-[60px]">رقم المكنة :</span>
                                <div className="border-b border-dotted border-slate-400 w-full text-right px-2 font-mono font-bold text-base relative">
                                    {selectedMachine ? (
                                        selectedMachine
                                    ) : (
                                        <input 
                                            type="text" 
                                            value={manualMachine}
                                            onChange={(e) => setManualMachine(e.target.value)}
                                            placeholder="Not Assigned"
                                            className="w-full bg-transparent border-none outline-none text-right placeholder-red-500 text-black font-bold"
                                        />
                                    )}
                                </div>
                           </div>
                           <div className="flex items-center gap-2 w-1/2">
                                {/* Order Number Removed as requested */}
                           </div>
                      </div>
                 </div>
            </div>

            {/* 3. Yarn Allocation Grid */}
            <div className="mb-4 border-2 border-slate-800 mt-4">
                 {/* Header */}
                 <div className="bg-slate-200 border-b border-slate-800 flex font-bold text-xs">
                     <div className="w-1/2 p-0.5 text-center border-l border-slate-800">الخيط</div>
                     <div className="w-1/2 p-0.5 text-center">رقم اللوط</div>
                 </div>
                 
                 {/* Rows */}
                 {Object.entries(order.yarnAllocations || {}).length > 0 ? (
                    Object.entries(order.yarnAllocations || {}).map(([yarnId, allocations], idx) => {
                         const yarnName = getYarnName(yarnId);
                         const lot = (allocations as any[]).map(a => a.lotNumber).join(', ');
                         
                         return (
                             <div className="flex border-b border-slate-300 text-sm last:border-0 min-h-[30px]" key={yarnId}>
                                  <div className="w-1/2 p-1 border-l border-slate-800 pr-2 flex items-center">
                                      <span className="font-bold ml-2 w-6">({idx + 1})</span>
                                      <span className="font-bold">{yarnName}</span>
                                  </div>
                                  <div className="w-1/2 p-1 text-center font-mono font-bold flex items-center justify-center bg-slate-50">
                                      {lot || '-'}
                                  </div>
                             </div>
                         );
                    })
                 ) : (
                    // Empty Placeholders if no yarn allocated
                    Array.from({ length: 4 }).map((_, i) => (
                        <div key={i} className="flex border-b border-slate-300 text-sm last:border-0 min-h-[30px]">
                            <div className="w-1/2 p-1 border-l border-slate-800 pr-2 flex items-center">
                                <span className="font-bold ml-2 w-6">({i + 1})</span>
                            </div>
                            <div className="w-1/2 p-1 bg-slate-50"></div>
                        </div>
                    ))
                 )}
                 {/* Make sure at least 4 rows exist */}
                 {Object.entries(order.yarnAllocations || {}).length < 4 && Array.from({ length: 4 - Object.entries(order.yarnAllocations || {}).length }).map((_, i) => (
                     <div key={`empty-${i}`} className="flex border-b border-slate-300 text-sm last:border-0 min-h-[30px]">
                          <div className="w-1/2 p-1 border-l border-slate-800 pr-2 flex items-center">
                              <span className="font-bold ml-2 w-6">({Object.entries(order.yarnAllocations || {}).length + i + 1})</span>
                          </div>
                          <div className="w-1/2 p-1 bg-slate-50"></div>
                     </div>
                 ))}
            </div>

            {/* 4. Specifications Section */}
            <div className="mb-4 mt-4">
                <div className="border-2 border-slate-800 bg-slate-200 text-center font-bold py-0.5 text-xs w-full mb-2">المواصفة</div>
                
                {/* Row 1: Weight & Width */}
                <div className="flex gap-8 mb-2 px-2">
                     <div className="flex items-center gap-2 w-1/2">
                          <span className="font-bold text-base min-w-[70px]">وزن مجهز :</span>
                          <div className="border-b border-dotted border-slate-400 flex-1 text-center font-bold text-lg font-mono relative">
                            {order.requiredGsm}
                            <span className="absolute right-0 bottom-0 text-[10px] font-sans font-normal text-slate-500">gm/m²</span>
                          </div>
                     </div>
                     <div className="flex items-center gap-2 w-1/2">
                          <span className="font-bold text-base min-w-[70px]">عرض مجهز:</span>
                          <div className="border-b border-dotted border-slate-400 flex-1 text-center font-bold text-lg font-mono relative">
                            {order.requiredWidth}
                            <span className="absolute right-0 bottom-0 text-[10px] font-sans font-normal text-slate-500">cm</span>
                          </div>
                     </div>
                </div>

                {/* Row 2: Grid & Checkboxes */}
                <div className="flex border-2 border-slate-800 min-h-[70px]">
                     {/* Checkboxes */}
                     
                     {/* Right Side Part (Data) */}
                     <div className="w-2/3 border-l-2 border-slate-800 flex">
                           <div className="flex-1 border-l border-slate-400 flex flex-col items-center justify-center p-1">
                                <span className="text-[9px] font-bold text-slate-500 mb-0.5">إجمالي الكمية</span>
                                <input 
                                    type="text" 
                                    value={editedTotalQty} 
                                    onChange={e => setEditedTotalQty(e.target.value)}
                                    className="w-full text-center font-bold font-mono text-base bg-transparent outline-none border-b border-dotted border-slate-300 focus:border-blue-500"
                                />
                           </div>
                           
                           {/* Accessory Column 1: Name */}
                           <div className="flex-1 border-l border-slate-400 flex flex-col items-center justify-center p-1">
                                <span className="text-[9px] font-bold text-slate-500 mb-0.5">اسم الإكسسوار</span>
                                <input 
                                    type="text" 
                                    value={accessoryName} 
                                    onChange={e => setAccessoryName(e.target.value)}
                                    className="w-full text-center font-bold text-[10px] bg-transparent outline-none border-b border-dotted border-slate-300 focus:border-blue-500"
                                    placeholder="-"
                                />
                           </div>

                           {/* Accessory Column 2: Quantity */}
                           <div className="flex-1 border-l border-slate-400 flex flex-col items-center justify-center p-1">
                                <span className="text-[9px] font-bold text-slate-500 mb-0.5">كمية إكسسوار</span>
                                <input 
                                    type="text" 
                                    value={accessoryQty} 
                                    onChange={e => setAccessoryQty(e.target.value)}
                                    className="w-full text-center font-bold font-mono text-base bg-transparent outline-none border-b border-dotted border-slate-300 focus:border-blue-500"
                                    placeholder="-"
                                />
                           </div>

                           <div className="flex-1 border-l border-slate-400 flex flex-col items-center justify-center p-1">
                                <span className="text-[9px] font-bold text-slate-500 mb-0.5">كمية الحوض</span>
                                <input 
                                    type="text" 
                                    value={dyehouseInfo} 
                                    onChange={e => setDyehouseInfo(e.target.value)}
                                    className="w-full text-center font-bold font-mono text-base bg-transparent outline-none border-b border-dotted border-slate-300 focus:border-blue-500"
                                />
                           </div>
                           <div className="flex-1 flex flex-col items-center justify-center p-1">
                                <span className="text-[9px] font-bold text-slate-500 mb-0.5">الأحواض</span>
                                <input 
                                    type="text" 
                                    value={numberOfBatches} 
                                    onChange={e => setNumberOfBatches(e.target.value)}
                                    className="w-full text-center font-bold font-mono text-base bg-transparent outline-none border-b border-dotted border-slate-300 focus:border-blue-500"
                                />
                           </div>
                     </div>

                     {/* Left Side Part (Checkboxes) - Visually Left */}
                     <div className="w-1/3 grid grid-cols-2 gap-1 p-1 bg-slate-50 font-bold text-xs items-center">
                          <div onClick={() => setCheckboxes(prev => ({...prev, open: !prev.open}))} className="flex items-center gap-1 cursor-pointer select-none">
                              <div className={`w-4 h-4 border-2 border-slate-800 flex items-center justify-center ${checkboxes.open ? 'bg-slate-800' : 'bg-white'}`}>
                                {checkboxes.open && <span className="text-white text-[10px]">✓</span>}
                              </div>
                              مفتوح
                          </div>
                          <div onClick={() => setCheckboxes(prev => ({...prev, closed: !prev.closed}))} className="flex items-center gap-1 cursor-pointer select-none">
                              <div className={`w-4 h-4 border-2 border-slate-800 flex items-center justify-center ${checkboxes.closed ? 'bg-slate-800' : 'bg-white'}`}>
                                {checkboxes.closed && <span className="text-white text-[10px]">✓</span>}
                              </div>
                              مقفول
                          </div>
                          <div onClick={() => setCheckboxes(prev => ({...prev, production: !prev.production}))} className="flex items-center gap-1 cursor-pointer select-none">
                              <div className={`w-4 h-4 border-2 border-slate-800 flex items-center justify-center ${checkboxes.production ? 'bg-slate-800' : 'bg-white'}`}>
                                {checkboxes.production && <span className="text-white text-[10px]">✓</span>}
                              </div>
                              انتــاج
                          </div>
                          <div onClick={() => setCheckboxes(prev => ({...prev, sample: !prev.sample}))} className="flex items-center gap-1 cursor-pointer select-none">
                              <div className={`w-4 h-4 border-2 border-slate-800 flex items-center justify-center ${checkboxes.sample ? 'bg-slate-800' : 'bg-white'}`}>
                                {checkboxes.sample && <span className="text-white text-[10px]">✓</span>}
                              </div>
                              عينـــة
                          </div>
                     </div>
                </div>

                {/* Notes Area */}
                <div className="border-x-2 border-b-2 border-slate-800 p-2 min-h-[80px] relative">
                     <div className="absolute top-1 right-2 text-[10px] font-bold underline">ملاحظات:</div>
                     <textarea
                        value={notes}
                        onChange={(e) => setNotes(e.target.value)}
                        className="w-full h-full min-h-[60px] text-center text-lg font-serif mt-2 mx-8 leading-relaxed overflow-hidden text-slate-700 bg-transparent border-none outline-none resize-none placeholder:text-slate-300 placeholder:italic placeholder:text-xs placeholder:font-sans"
                        placeholder=""
                    />
                </div>
            </div>

            {/* 5. Knitting Data */}
            <div className="grid grid-cols-1 border-2 border-slate-800 mb-4 mt-2">
                 {/* Header */}
                 <div className="bg-slate-200 font-bold border-b border-slate-800 py-0.5 text-xs px-2 text-center">بيانات ماكينة التريكو</div>
                 
                 {/* Grid */}
                 <div className="p-2 grid grid-cols-2 gap-x-8 gap-y-1 text-xs bg-slate-50/30">
                      <div className="flex justify-between items-center border-b border-slate-300 h-6">
                          <span className="font-bold">عدد الإبر:</span>
                          <span className="font-mono text-sm font-bold">2640</span>
                      </div>
                      <div className="flex justify-between items-center border-b border-slate-300 h-6">
                          <span className="font-bold">بوصة:</span>
                          <span className="font-mono text-sm font-bold">32</span>
                      </div>
                      <div className="flex justify-between items-center border-b border-slate-300 h-6">
                          <span className="font-bold">عدد المواكيك:</span>
                          <span className="font-mono text-sm font-bold">96</span>
                      </div>
                      <div className="flex justify-between items-center border-b border-slate-300 h-6">
                          <span className="font-bold">جوج:</span>
                          <span className="font-mono text-sm font-bold">28</span>
                      </div>
                      <div className="flex justify-between items-center border-b border-slate-300 h-6">
                          <span className="font-bold">سرعة المكنة:</span>
                          <span className="font-mono text-sm opacity-20">---</span>
                      </div>
                      <div className="flex justify-between items-center border-b border-slate-300 h-6">
                          <span className="font-bold">عدد الغرز:</span>
                          <span className="font-mono text-sm opacity-20">---</span>
                      </div>
                      <div className="flex justify-between items-center border-b border-slate-300 h-6">
                          <span className="font-bold">عرض خام:</span>
                          <span className="font-mono text-sm opacity-20">---</span>
                      </div>
                      <div className="flex justify-between items-center border-b border-slate-300 h-6">
                          <span className="font-bold">وزن خام:</span>
                          <span className="font-mono text-sm opacity-20">---</span>
                      </div>
                 </div>
            </div>

            {/* 6. Signature Area */}
            <div className="flex justify-end mt-4 px-8">
                 <div className="text-center">
                     <div className="text-sm font-bold mb-8">توقيع المسؤول</div>
                     <div className="w-48 border-b border-slate-800"></div>
                 </div>
            </div>

            {/* Footer Text */}
            <div className="mt-8 flex justify-between text-[10px] text-slate-400 font-mono">
                <div>FO-PL-005</div>
                <div>Rev: 02</div>
                <div>Generated: {new Date().toLocaleDateString()}</div>
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
