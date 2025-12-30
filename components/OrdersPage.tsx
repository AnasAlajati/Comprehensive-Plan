import React, { useState, useEffect, useRef } from 'react';
import { 
  collection, 
  onSnapshot, 
  doc, 
  setDoc, 
  deleteDoc, 
  addDoc, 
  updateDoc
} from 'firebase/firestore';
import { db } from '../services/firebase';
import { CustomerSheet, OrderRow, YarnInventoryItem, FabricDefinition } from '../types';
import { 
  Plus, 
  Trash2, 
  UserPlus, 
  Search,
  FileSpreadsheet,
  X,
  CalendarPlus,
  Package,
  AlertCircle,
  CheckCircle2,
  Loader2,
  Upload
} from 'lucide-react';
import { CreatePlanModal } from './CreatePlanModal';

const NAVIGABLE_FIELDS: (keyof OrderRow)[] = [
  'material', 'machine', 'requiredQty', 'accessory', 
  'manufacturedQty', 'remainingQty', 'orderReceiptDate', 
  'startDate', 'endDate', 'scrapQty', 'others', 
  'notes', 'batchDeliveries', 'accessoryDeliveries'
];

export const OrdersPage: React.FC = () => {
  const [customers, setCustomers] = useState<CustomerSheet[]>([]);
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [newCustomerName, setNewCustomerName] = useState('');
  const [isAddingCustomer, setIsAddingCustomer] = useState(false);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  // Inventory & Fabric Data
  const [yarnInventory, setYarnInventory] = useState<YarnInventoryItem[]>([]);
  const [fabrics, setFabrics] = useState<FabricDefinition[]>([]);

  const [createPlanModal, setCreatePlanModal] = useState<{
    isOpen: boolean;
    order: OrderRow | null;
    customerName: string;
  }>({ isOpen: false, order: null, customerName: '' });

  // Refs for keyboard navigation
  const tableRef = useRef<HTMLTableElement>(null);

  // 1. Fetch Customers
  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'CustomerSheets'), (snapshot) => {
      const data = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as CustomerSheet));
      // Sort alphabetically
      data.sort((a, b) => a.name.localeCompare(b.name));
      setCustomers(data);
      setLoading(false);
      
      // Select first customer if none selected and data exists
      if (!selectedCustomerId && data.length > 0) {
        setSelectedCustomerId(data[0].id);
      }
    });
    return () => unsub();
  }, []);

  // 2. Fetch Inventory & Fabrics
  useEffect(() => {
      const unsubInventory = onSnapshot(collection(db, 'yarn_inventory'), (snapshot) => {
          const data = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as YarnInventoryItem));
          setYarnInventory(data);
      });

      const unsubFabrics = onSnapshot(collection(db, 'FabricSS'), (snapshot) => {
          const data = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as FabricDefinition));
          setFabrics(data);
      });

      return () => {
          unsubInventory();
          unsubFabrics();
      };
  }, []);

  // 1.5 Fetch Machines
  
  // 2. Handlers
  const handleAddCustomer = async () => {
    if (!newCustomerName.trim()) return;
    try {
      await addDoc(collection(db, 'CustomerSheets'), {
        name: newCustomerName.trim(),
        orders: []
      });
      setNewCustomerName('');
      setIsAddingCustomer(false);
    } catch (error) {
      console.error("Error adding customer:", error);
      alert("Failed to add customer");
    }
  };

  const handleDeleteCustomer = async (id: string) => {
    if (!window.confirm("Are you sure you want to delete this customer and all their orders?")) return;
    try {
      await deleteDoc(doc(db, 'CustomerSheets', id));
      if (selectedCustomerId === id) setSelectedCustomerId(null);
    } catch (error) {
      console.error("Error deleting customer:", error);
    }
  };

  // --- EXCEL IMPORT LOGIC ---
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    
    const newRow: OrderRow = {
      id: crypto.randomUUID(),
      material: '',
      machine: '',
      requiredQty: 0,
      accessory: '',
      manufacturedQty: 0,
      remainingQty: 0,
      orderReceiptDate: '',
      startDate: '',
      endDate: '',
      scrapQty: 0,
      others: '',
      notes: '',
      batchDeliveries: '',
      accessoryDeliveries: ''
    };

    const updatedOrders = [...selectedCustomer.orders, newRow];
    await updateDoc(doc(db, 'CustomerSheets', selectedCustomerId), {
      orders: updatedOrders
    });
  };

  const handleUpdateRow = async (rowId: string, field: keyof OrderRow, value: any) => {
    if (!selectedCustomerId || !selectedCustomer) return;

    const updatedOrders = selectedCustomer.orders.map(order => {
      if (order.id === rowId) {
        const updated = { ...order, [field]: value };
        
        // Auto-calculate remaining
        if (field === 'requiredQty' || field === 'manufacturedQty') {
          const req = field === 'requiredQty' ? Number(value) : Number(order.requiredQty);
          const mfg = field === 'manufacturedQty' ? Number(value) : Number(order.manufacturedQty);
          updated.remainingQty = req - mfg;
        }
        
        return updated;
      }
      return order;
    });

    // Optimistic update could be done here, but for now we just write to DB
    // To prevent cursor jumping on every keystroke, we might need local state or debounce
    // For this implementation, we'll use onBlur or specific key handling for text inputs
    // But for simplicity in this demo, we'll update directly. 
    // *Note*: In a real heavy-use app, debounce this.
    
    await updateDoc(doc(db, 'CustomerSheets', selectedCustomerId), {
      orders: updatedOrders
    });
  };

  // Keyboard Navigation
  const handleKeyDown = (e: React.KeyboardEvent, rowIndex: number, fieldIndex: number) => {
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      const nextInput = tableRef.current?.querySelector(
        `input[data-row="${rowIndex}"][data-col="${fieldIndex + 1}"]`
      ) as HTMLInputElement;
      nextInput?.focus();
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      const prevInput = tableRef.current?.querySelector(
        `input[data-row="${rowIndex}"][data-col="${fieldIndex - 1}"]`
      ) as HTMLInputElement;
      prevInput?.focus();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      const downInput = tableRef.current?.querySelector(
        `input[data-row="${rowIndex + 1}"][data-col="${fieldIndex}"]`
      ) as HTMLInputElement;
      downInput?.focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      const upInput = tableRef.current?.querySelector(
        `input[data-row="${rowIndex - 1}"][data-col="${fieldIndex}"]`
      ) as HTMLInputElement;
      upInput?.focus();
    }
  };

  const filteredCustomers = customers.filter(c => 
    c.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="flex h-[calc(100vh-100px)] bg-slate-50 rounded-xl overflow-hidden border border-slate-200 shadow-sm">
      {/* Sidebar - Customer List */}
      <div className="w-64 bg-white border-r border-slate-200 flex flex-col">
        <div className="p-4 border-b border-slate-100">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-bold text-slate-700 flex items-center gap-2">
              <Users className="w-5 h-5 text-blue-600" />
              Customers
            </h2>
            <button 
              onClick={() => setIsAddingCustomer(true)}
              className="p-1 hover:bg-blue-50 text-blue-600 rounded transition-colors"
            >
              <UserPlus className="w-5 h-5" />
            </button>
          </div>

          {/* Import Button */}
          <div className="mb-4">
             <input 
               type="file" 
               ref={fileInputRef}
               onChange={handleFileUpload}
               className="hidden"
               accept=".xlsx, .xls"
             />
             <button 
               onClick={() => fileInputRef.current?.click()}
               disabled={importing}
               className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-emerald-50 text-emerald-700 rounded-lg hover:bg-emerald-100 transition-colors text-sm font-medium border border-emerald-200"
             >
               {importing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
               Import Excel
             </button>
          </div>
          
          {isAddingCustomer && (
            <div className="mb-3 flex gap-2">
              <input
                autoFocus
                type="text"
                placeholder="Name..."
                className="w-full px-2 py-1 text-sm border rounded"
                value={newCustomerName}
                onChange={e => setNewCustomerName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleAddCustomer()}
              />
              <button onClick={handleAddCustomer} className="text-green-600 hover:bg-green-50 p-1 rounded">
                <Plus className="w-4 h-4" />
              </button>
            </div>
          )}

          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input 
              type="text" 
              placeholder="Search..." 
              className="w-full pl-8 pr-2 py-1.5 text-sm bg-slate-50 border border-slate-200 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500"
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="p-4 text-center text-slate-400 text-sm">Loading...</div>
          ) : (
            <div className="divide-y divide-slate-50">
              {filteredCustomers.map(customer => (
                <div 
                  key={customer.id}
                  onClick={() => setSelectedCustomerId(customer.id)}
                  className={`
                    group flex items-center justify-between p-3 cursor-pointer transition-all
                    ${selectedCustomerId === customer.id ? 'bg-blue-50 border-l-4 border-blue-500' : 'hover:bg-slate-50 border-l-4 border-transparent'}
                  `}
                >
                  <span className={`text-sm font-medium ${selectedCustomerId === customer.id ? 'text-blue-700' : 'text-slate-600'}`}>
                    {customer.name}
                  </span>
                  <button 
                    onClick={(e) => { e.stopPropagation(); handleDeleteCustomer(customer.id); }}
                    className="opacity-0 group-hover:opacity-100 p-1 text-slate-400 hover:text-red-500 transition-opacity"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Main Content - Order Sheet */}
      <div className="flex-1 flex flex-col overflow-hidden bg-white">
        {selectedCustomer ? (
          <>
            {/* Header */}
            <div className="p-4 border-b border-slate-200 flex justify-between items-center bg-white">
              <div>
                <h1 className="text-xl font-bold text-slate-800 flex items-center gap-2">
                  <FileSpreadsheet className="w-6 h-6 text-emerald-600" />
                  {selectedCustomer.name}
                </h1>
                <p className="text-xs text-slate-500 mt-1">
                  {selectedCustomer.orders.length} active orders
                </p>
              </div>
              <button 
                onClick={handleAddRow}
                className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors shadow-sm"
              >
                <Plus className="w-4 h-4" />
                Add Order Row
              </button>
            </div>

            {/* Yarn Requirements Summary Panel */}
            <div className="px-4 py-3 bg-slate-50 border-b border-slate-200">
                <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2 flex items-center gap-2">
                    <Package size={14} />
                    Yarn Requirements & Inventory Status
                </h3>
                
                <div className="bg-white rounded-lg border border-slate-200 overflow-hidden shadow-sm">
                    <table className="w-full text-sm text-left">
                        <thead className="bg-slate-50 text-slate-500 font-medium border-b border-slate-200">
                            <tr>
                                <th className="px-4 py-2 w-1/3">Yarn Name</th>
                                <th className="px-4 py-2 text-right">Total Requirement</th>
                                <th className="px-4 py-2 text-right">Inventory (Total)</th>
                                <th className="px-4 py-2 text-right">Net Available</th>
                                <th className="px-4 py-2 text-center">Status</th>
                                <th className="px-4 py-2 text-center">Action</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {(() => {
                                // 1. Calculate Requirements
                                const requirements: Record<string, number> = {};
                                
                                selectedCustomer.orders.forEach(order => {
                                    if (!order.requiredQty) return;
                                    
                                    // Try to find fabric definition
                                    const fabricDef = fabrics.find(f => 
                                        f.name.toLowerCase().trim() === (order.material || '').toLowerCase().trim()
                                    );
                                    
                                    if (fabricDef && fabricDef.variants && fabricDef.variants.length > 0) {
                                        // Use first variant for now (or match variantId if available)
                                        const variant = fabricDef.variants[0];
                                        variant.yarns.forEach(yarn => {
                                            const yarnQty = order.requiredQty * (yarn.percentage / 100);
                                            const yarnName = yarn.name.trim();
                                            requirements[yarnName] = (requirements[yarnName] || 0) + yarnQty;
                                        });
                                    } else {
                                        // Fallback: Assume Material Name IS the Yarn Name
                                        const materialName = (order.material || 'Unknown').trim();
                                        if (materialName) {
                                            requirements[materialName] = (requirements[materialName] || 0) + order.requiredQty;
                                        }
                                    }
                                });

                                if (Object.keys(requirements).length === 0) {
                                    return (
                                        <tr>
                                            <td colSpan={6} className="px-4 py-8 text-center text-slate-400 italic">
                                                No yarn requirements calculated yet. Add orders with quantities to see requirements.
                                            </td>
                                        </tr>
                                    );
                                }

                                // 2. Match with Inventory & Render
                                return Object.entries(requirements).map(([yarnName, requiredQty]) => {
                                    // Find inventory items for this yarn
                                    const inventoryItems = yarnInventory.filter(item => 
                                        item.yarnName.toLowerCase().trim() === yarnName.toLowerCase().trim()
                                    );
                                    
                                    const totalStock = inventoryItems.reduce((sum, item) => sum + (item.quantity || 0), 0);
                                    
                                    // Calculate Allocations
                                    let totalAllocated = 0;
                                    let allocatedToThisCustomer = 0;
                                    
                                    inventoryItems.forEach(item => {
                                        if (item.allocations) {
                                            item.allocations.forEach(alloc => {
                                                totalAllocated += (alloc.quantity || 0);
                                                if (alloc.customerId === selectedCustomerId) {
                                                    allocatedToThisCustomer += (alloc.quantity || 0);
                                                }
                                            });
                                        }
                                    });
                                    
                                    const netAvailable = totalStock - totalAllocated;
                                    const availableForThisCustomer = netAvailable + allocatedToThisCustomer;
                                    
                                    const isEnough = availableForThisCustomer >= requiredQty;
                                    const deficit = requiredQty - availableForThisCustomer;

                                    return (
                                        <tr key={yarnName} className="hover:bg-slate-50 transition-colors">
                                            <td className="px-4 py-2 font-medium text-slate-700">
                                                {yarnName}
                                            </td>
                                            <td className="px-4 py-2 text-right font-mono font-bold text-slate-800">
                                                {requiredQty.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} kg
                                            </td>
                                            <td className="px-4 py-2 text-right font-mono text-slate-600">
                                                {totalStock.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} kg
                                            </td>
                                            <td className={`px-4 py-2 text-right font-mono font-bold ${availableForThisCustomer < requiredQty ? 'text-red-600' : 'text-emerald-600'}`}>
                                                {availableForThisCustomer.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} kg
                                            </td>
                                            <td className="px-4 py-2 text-center">
                                                {isEnough ? (
                                                    <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-emerald-100 text-emerald-700 text-xs font-bold">
                                                        <CheckCircle2 size={12} />
                                                        Available
                                                    </span>
                                                ) : (
                                                    <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-red-100 text-red-700 text-xs font-bold" title={`Shortage: ${deficit.toFixed(1)} kg`}>
                                                        <AlertCircle size={12} />
                                                        Shortage
                                                    </span>
                                                )}
                                            </td>
                                            <td className="px-4 py-2 text-center">
                                                <button className="p-1 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors">
                                                    <Search size={16} />
                                                </button>
                                            </td>
                                        </tr>
                                    );
                                });
                            })()}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Excel Table */}
            <div className="flex-1 overflow-auto p-4 bg-slate-50">
              <div className="bg-white rounded-lg shadow border border-slate-200 overflow-hidden">
                <table className="w-full text-sm border-collapse" ref={tableRef}>
                  <thead className="bg-slate-100 text-slate-600 font-semibold sticky top-0 z-10 shadow-sm">
                    <tr>
                      <th className="p-3 text-left border-b border-r border-slate-200 min-w-[500px]">الخامة (Material)</th>
                      <th className="p-3 text-left border-b border-r border-slate-200 min-w-[120px]">الماكينة (Machine)</th>
                      <th className="p-3 text-right border-b border-r border-slate-200 w-24">الكمية المطلوبة</th>
                      <th className="p-3 text-left border-b border-r border-slate-200 min-w-[120px]">الاكسسوار</th>
                      <th className="p-3 text-right border-b border-r border-slate-200 w-24">ما تم تصنيعه</th>
                      <th className="p-3 text-right border-b border-r border-slate-200 w-24 bg-slate-50">المتبقى</th>
                      <th className="p-3 text-center border-b border-r border-slate-200 w-32">تاريخ الاستلام</th>
                      <th className="p-3 text-center border-b border-r border-slate-200 w-32">بداية</th>
                      <th className="p-3 text-center border-b border-r border-slate-200 w-32">نهاية</th>
                      <th className="p-3 text-right border-b border-r border-slate-200 w-20">السقط</th>
                      <th className="p-3 text-left border-b border-r border-slate-200 min-w-[100px]">Others</th>
                      <th className="p-3 text-left border-b border-r border-slate-200 min-w-[150px]">ملاحظات</th>
                      <th className="p-3 text-left border-b border-r border-slate-200 min-w-[120px]">تسليمات الاحواض</th>
                      <th className="p-3 text-left border-b border-slate-200 min-w-[120px]">تسليمات الاكسسوار</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {selectedCustomer.orders.map((row, rowIndex) => (
                      <tr key={row.id} className="hover:bg-blue-50/30 transition-colors group">
                        {/* Material */}
                        <td className="p-0 border-r border-slate-200">
                          <input 
                            type="text"
                            className="w-full h-full px-3 py-2 bg-transparent outline-none focus:bg-blue-50 focus:ring-2 focus:ring-inset focus:ring-blue-500"
                            value={row.material}
                            onChange={(e) => handleUpdateRow(row.id, 'material', e.target.value)}
                            data-row={rowIndex}
                            data-col={0}
                            onKeyDown={(e) => handleKeyDown(e, rowIndex, 0)}
                          />
                        </td>
                        {/* Machine */}
                        <td className="p-0 border-r border-slate-200 relative group/cell">
                          <div className="flex items-center h-full">
                            <input
                              type="text"
                              className="flex-1 h-full px-3 py-2 bg-transparent outline-none focus:bg-blue-50 focus:ring-2 focus:ring-inset focus:ring-blue-500"
                              value={row.machine}
                              onChange={(e) => handleUpdateRow(row.id, 'machine', e.target.value)}
                              data-row={rowIndex}
                              data-col={1}
                              onKeyDown={(e) => handleKeyDown(e, rowIndex, 1)}
                            />
                            <button
                              onClick={() => setCreatePlanModal({ isOpen: true, order: row, customerName: selectedCustomer.name })}
                              className="opacity-0 group-hover/cell:opacity-100 p-1 text-blue-600 hover:bg-blue-100 rounded mr-1"
                              title="Create Plan"
                            >
                              <CalendarPlus size={16} />
                            </button>
                          </div>
                        </td>
                        {/* Accessory */}
                        <td className="p-0 border-r border-slate-200">
                          <input 
                            type="text"
                            className="w-full h-full px-3 py-2 bg-transparent outline-none focus:bg-blue-50 focus:ring-2 focus:ring-inset focus:ring-blue-500"
                            value={row.accessory}
                            onChange={(e) => handleUpdateRow(row.id, 'accessory', e.target.value)}
                            data-row={rowIndex}
                            data-col={3}
                            onKeyDown={(e) => handleKeyDown(e, rowIndex, 3)}
                          />
                        </td>
                        {/* Manufactured Qty */}
                        <td className="p-0 border-r border-slate-200">
                          <input 
                            type="number"
                            className="w-full h-full px-3 py-2 text-right bg-transparent outline-none focus:bg-blue-50 focus:ring-2 focus:ring-inset focus:ring-blue-500 font-mono text-emerald-600 font-medium"
                            value={row.manufacturedQty || ''}
                            onChange={(e) => handleUpdateRow(row.id, 'manufacturedQty', e.target.value)}
                            data-row={rowIndex}
                            data-col={4}
                            onKeyDown={(e) => handleKeyDown(e, rowIndex, 4)}
                          />
                        </td>
        </div>

        {/* Add Customer Button */}
        {isAddingCustomer ? (
          <div className="flex items-center gap-2 ml-2">
            <input
              autoFocus
              type="text"
              placeholder="Customer name..."
              className="px-3 py-2 text-sm border border-blue-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              value={newCustomerName}
              onChange={e => setNewCustomerName(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') handleAddCustomer();
                if (e.key === 'Escape') setIsAddingCustomer(false);
              }}
              onBlur={() => setIsAddingCustomer(false)}
            />
          </div>
        ) : (
          <button 
            onClick={() => setIsAddingCustomer(true)}
            className="flex items-center gap-1.5 px-3 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors text-sm font-medium whitespace-nowrap ml-2"
          >
            <Plus className="w-4 h-4" />
            Add Customer
          </button>
        )}
      </div>

      {createPlanModal.isOpen && createPlanModal.order && (
        <CreatePlanModal
          isOpen={createPlanModal.isOpen}
          onClose={() => setCreatePlanModal({ ...createPlanModal, isOpen: false })}
          order={createPlanModal.order}
          customerName={createPlanModal.customerName}
        />
      )}
    </div>
  );
};