import React, { useState, useEffect, useRef, useMemo } from 'react';
import { 
  collection, 
  onSnapshot, 
  doc, 
  addDoc, 
  updateDoc,
  deleteDoc
} from 'firebase/firestore';
import { db } from '../services/firebase';
import { DataService } from '../services/dataService';
import { CustomerSheet, OrderRow, MachineSS, MachineStatus } from '../types';
import { 
  Plus, 
  Trash2, 
  UserPlus, 
  Search,
  FileSpreadsheet,
  MapPin,
  CheckCircle2,
  AlertCircle,
  X,
  Calendar,
  Calculator,
  CheckSquare,
  Square
} from 'lucide-react';

// Global CSS to hide number input spinners
const globalStyles = `
  input[type="number"]::-webkit-inner-spin-button,
  input[type="number"]::-webkit-outer-spin-button {
    -webkit-appearance: none;
    margin: 0;
  }
  input[type="number"] {
    -moz-appearance: textfield;
  }
`;

interface SearchDropdownProps {
  id: string;
  options: any[];
  value: string;
  onChange: (value: string) => void;
  onCreateNew?: (newValue: string) => void;
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  onFocus?: () => void;
  placeholder?: string;
  className?: string;
}

const SearchDropdown: React.FC<SearchDropdownProps> = ({
  id,
  options,
  value,
  onChange,
  onCreateNew,
  onKeyDown,
  onFocus,
  placeholder = '---',
  className
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [inputValue, setInputValue] = useState(value);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setInputValue(value);
  }, [value]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Close on scroll to prevent detached fixed element
  useEffect(() => {
    const handleScroll = () => {
      if (isOpen) setIsOpen(false);
    };
    window.addEventListener('scroll', handleScroll, true);
    return () => window.removeEventListener('scroll', handleScroll, true);
  }, [isOpen]);

  const filteredOptions = options.filter(opt =>
    opt.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const handleSelect = (optionName: string) => {
    setInputValue(optionName);
    onChange(optionName);
    setSearchTerm('');
    setIsOpen(false);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setInputValue(val);
    setSearchTerm(val);
    setIsOpen(true);
    if (!val) {
      onChange('');
    }
  };

  return (
    <div className="relative w-full h-full" ref={containerRef}>
      <input
        id={id}
        type="text"
        value={inputValue}
        onChange={handleInputChange}
        onFocus={() => {
          setIsOpen(true);
          if (onFocus) onFocus();
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && filteredOptions.length > 0) {
             handleSelect(filteredOptions[0].name);
          } else if (e.key === 'Enter' && onCreateNew && searchTerm) {
             onCreateNew(searchTerm);
             setIsOpen(false);
          }
          if (onKeyDown) onKeyDown(e);
        }}
        placeholder={placeholder}
        className={className || "w-full h-full px-2 py-1 bg-transparent outline-none focus:bg-blue-50 text-center"}
        autoComplete="off"
      />
      {isOpen && (searchTerm || filteredOptions.length > 0) && (
        <div className="fixed z-[9999] min-w-[200px] bg-white border border-slate-200 shadow-xl rounded-md mt-1 max-h-60 overflow-y-auto"
             style={{
               top: containerRef.current ? containerRef.current.getBoundingClientRect().bottom : 'auto',
               left: containerRef.current ? containerRef.current.getBoundingClientRect().left : 'auto'
             }}>
          {filteredOptions.length > 0 ? (
            <>
              {filteredOptions.map((opt, idx) => (
                <div
                  key={idx}
                  onClick={() => handleSelect(opt.name)}
                  className="px-3 py-2 hover:bg-blue-50 cursor-pointer text-sm border-b border-slate-50 last:border-b-0 text-left"
                >
                  {opt.name}
                </div>
              ))}
              {onCreateNew && searchTerm && !options.some(o => o.name.toLowerCase() === searchTerm.toLowerCase()) && (
                <div
                  onClick={() => {
                    onCreateNew(searchTerm);
                    setIsOpen(false);
                  }}
                  className="px-3 py-2 hover:bg-emerald-50 cursor-pointer text-sm border-t border-slate-100 text-emerald-600 font-medium text-left"
                >
                  + Add "{searchTerm}"
                </div>
              )}
            </>
          ) : onCreateNew && searchTerm ? (
            <div
              onClick={() => {
                onCreateNew(searchTerm);
                setIsOpen(false);
              }}
              className="px-3 py-2 hover:bg-emerald-50 cursor-pointer text-sm text-emerald-600 font-medium text-left"
            >
              + Add "{searchTerm}"
            </div>
          ) : (
            <div className="px-3 py-2 text-sm text-slate-400 text-left">No options</div>
          )}
        </div>
      )}
    </div>
  );
};

export const ClientOrdersPage: React.FC = () => {
  const [customers, setCustomers] = useState<CustomerSheet[]>([]);
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [newCustomerName, setNewCustomerName] = useState('');
  const [isAddingCustomer, setIsAddingCustomer] = useState(false);
  const [fabrics, setFabrics] = useState<any[]>([]);
  const [machines, setMachines] = useState<MachineSS[]>([]);
  const [activeDay, setActiveDay] = useState<string>(new Date().toISOString().split('T')[0]);
  
  // Fix for state reset issue
  const initialSelectionMade = useRef(false);

  // Bulk Selection State
  const [selectedRows, setSelectedRows] = useState<Set<string>>(new Set());
  const [bulkDate, setBulkDate] = useState<string>('');
  const [showBulkDateInput, setShowBulkDateInput] = useState(false);

  // Plan Search Modal State
  const [planSearchModal, setPlanSearchModal] = useState<{
    isOpen: boolean;
    reference: string;
    results: { machineName: string; type: 'ACTIVE' | 'PLANNED'; details: string; date?: string }[];
  }>({ isOpen: false, reference: '', results: [] });

  // Fetch Data
  useEffect(() => {
    // Customers
    const unsubCustomers = onSnapshot(collection(db, 'CustomerSheets'), (snapshot) => {
      const data = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as CustomerSheet));
      data.sort((a, b) => a.name.localeCompare(b.name));
      setCustomers(data);
      
      // Only set initial selection once
      if (!initialSelectionMade.current && data.length > 0) {
        setSelectedCustomerId(data[0].id);
        initialSelectionMade.current = true;
      }
    });

    // Machines (for active status)
    const unsubMachines = onSnapshot(collection(db, 'MachineSS'), (snapshot) => {
      const data = snapshot.docs.map(d => d.data() as MachineSS);
      setMachines(data);
    });

    // Fabrics
    DataService.getFabrics().then(setFabrics);

    // Active Day
    const unsubSettings = onSnapshot(doc(db, 'settings', 'global'), (doc) => {
      if (doc.exists() && doc.data().activeDay) {
        setActiveDay(doc.data().activeDay);
      }
    });

    return () => {
      unsubCustomers();
      unsubMachines();
      unsubSettings();
    };
  }, []);

  const selectedCustomer = customers.find(c => c.id === selectedCustomerId);

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
    }
  };

  const handleDeleteCustomer = async (id: string) => {
    if (!window.confirm("Delete customer and all orders?")) return;
    try {
      await deleteDoc(doc(db, 'CustomerSheets', id));
      if (selectedCustomerId === id) setSelectedCustomerId(null);
    } catch (error) {
      console.error("Error deleting customer:", error);
    }
  };

  const handleAddRow = async () => {
    if (!selectedCustomerId || !selectedCustomer) return;
    const newRow: OrderRow = {
      id: crypto.randomUUID(),
      material: '',
      machine: '',
      requiredQty: 0,
      accessory: '',
      manufacturedQty: 0,
      remainingQty: 0,
      orderReceiptDate: new Date().toISOString().split('T')[0],
      startDate: '',
      endDate: '',
      scrapQty: 0,
      others: '',
      notes: '',
      batchDeliveries: '',
      accessoryDeliveries: ''
    };
    const updatedOrders = [...selectedCustomer.orders, newRow];
    await updateDoc(doc(db, 'CustomerSheets', selectedCustomerId), { orders: updatedOrders });
  };

  const handleUpdateOrder = async (rowId: string, updates: Partial<OrderRow>) => {
    if (!selectedCustomerId || !selectedCustomer) return;
    
    let finalUpdates = { ...updates };
    const currentRow = selectedCustomer.orders.find(o => o.id === rowId);
    
    // Smart Accessory Logic
    if (currentRow && (updates.accessory !== undefined || updates.requiredQty !== undefined)) {
       const newAccessory = updates.accessory !== undefined ? updates.accessory : currentRow.accessory;
       const newRequiredQty = updates.requiredQty !== undefined ? updates.requiredQty : currentRow.requiredQty;
       
       // Parse percentage if accessory text changed or qty changed
       if (newAccessory) {
          const match = newAccessory.match(/(\d+(?:\.\d+)?)%\s*(.*)/);
          if (match) {
             const pct = parseFloat(match[1]);
             const type = match[2] || 'Accessory';
             finalUpdates.accessoryPercentage = pct;
             finalUpdates.accessoryType = type;
             // Auto-calculate quantity
             finalUpdates.accessoryQty = Math.round(newRequiredQty * (pct / 100));
          }
       }
    }

    // Optimistic Update
    const updatedOrders = selectedCustomer.orders.map(order => {
      if (order.id === rowId) {
        return { ...order, ...finalUpdates };
      }
      return order;
    });

    // Update local state immediately
    setCustomers(prev => prev.map(c => {
      if (c.id === selectedCustomerId) {
        return { ...c, orders: updatedOrders };
      }
      return c;
    }));

    // Send to Firestore
    await updateDoc(doc(db, 'CustomerSheets', selectedCustomerId), { orders: updatedOrders });
  };

  const toggleSelectAll = () => {
    if (!selectedCustomer) return;
    if (selectedRows.size === selectedCustomer.orders.length) {
      setSelectedRows(new Set());
    } else {
      setSelectedRows(new Set(selectedCustomer.orders.map(o => o.id)));
    }
  };

  const toggleSelectRow = (id: string) => {
    const newSet = new Set(selectedRows);
    if (newSet.has(id)) {
      newSet.delete(id);
    } else {
      newSet.add(id);
    }
    setSelectedRows(newSet);
  };

  const handleBulkUpdateDate = async () => {
    if (!selectedCustomerId || !selectedCustomer || !bulkDate) return;
    
    const updatedOrders = selectedCustomer.orders.map(order => {
      if (selectedRows.has(order.id)) {
        return { ...order, orderReceiptDate: bulkDate };
      }
      return order;
    });

    // Optimistic Update
    setCustomers(prev => prev.map(c => {
      if (c.id === selectedCustomerId) {
        return { ...c, orders: updatedOrders };
      }
      return c;
    }));

    await updateDoc(doc(db, 'CustomerSheets', selectedCustomerId), { orders: updatedOrders });
    setShowBulkDateInput(false);
    setBulkDate('');
    setSelectedRows(new Set());
  };

  const getDetailedStatus = (order: OrderRow) => {
    if (!selectedCustomer || !order.material) return null;
    
    const refCode = `${selectedCustomer.name}-${order.material}`;
    const activeMachines: string[] = [];
    const plannedMachines: string[] = [];
    let remaining = 0;

    machines.forEach(m => {
      // Check Active
      const log = m.dailyLogs?.find(l => l.date === activeDay);
      if (log && (log.status === 'Working' || log.status === 'تعمل')) {
        if (log.orderReference === refCode || (log.client === selectedCustomer.name && log.fabric === order.material)) {
          activeMachines.push(m.name);
          remaining += (Number(log.remainingMfg) || 0);
        }
      }

      // Check Planned
      if (m.futurePlans) {
        m.futurePlans.forEach(plan => {
          if (plan.client === selectedCustomer.name && plan.fabric === order.material) {
            plannedMachines.push(m.name);
          }
        });
      }
    });

    if (activeMachines.length === 0 && plannedMachines.length === 0) return null;

    return {
      active: activeMachines,
      planned: plannedMachines,
      remaining: activeMachines.length > 0 ? remaining : order.remainingQty
    };
  };

  const handleDeleteRow = async (rowId: string) => {
    if (!selectedCustomerId || !selectedCustomer) return;
    if (!window.confirm("Delete this order row?")) return;
    const updatedOrders = selectedCustomer.orders.filter(o => o.id !== rowId);
    await updateDoc(doc(db, 'CustomerSheets', selectedCustomerId), { orders: updatedOrders });
  };

  const handlePlanSearch = (clientName: string, fabricName: string) => {
    const reference = `${clientName}-${fabricName}`;
    const results: { machineName: string; type: 'ACTIVE' | 'PLANNED'; details: string; date?: string }[] = [];
  
    machines.forEach(machine => {
      // Check Active (Daily Logs)
      const activeLog = machine.dailyLogs?.find(l => l.date === activeDay);
      if (activeLog) {
         // Check match by explicit reference OR by client/fabric combination
         const isMatch = (activeLog.client === clientName && activeLog.fabric === fabricName) || 
                         (activeLog.orderReference === reference);
         
         if (isMatch) {
           results.push({
             machineName: machine.name,
             type: 'ACTIVE',
             details: `Running on ${activeDay} (Rem: ${activeLog.remainingMfg})`,
             date: activeDay
           });
         }
      }
  
      // Check Future Plans
      if (machine.futurePlans) {
        machine.futurePlans.forEach(plan => {
           // Check if plan matches
           if (plan.client === clientName && plan.fabric === fabricName) {
              results.push({
                machineName: machine.name,
                type: 'PLANNED',
                details: `Planned for ${plan.days} days (Qty: ${plan.quantity})`,
                date: plan.startDate
              });
           }
        });
      }
    });
  
    setPlanSearchModal({
      isOpen: true,
      reference,
      results
    });
  };

  const handleCreateFabric = async (name: string) => {
    await DataService.addFabric({ 
      name,
      fabricId: crypto.randomUUID(),
      type: 'General'
    });
    setFabrics(await DataService.getFabrics());
  };

  const filteredCustomers = customers.filter(c => 
    c.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="flex h-[calc(100vh-100px)] bg-slate-50 rounded-xl overflow-hidden border border-slate-200 shadow-sm">
      <style>{globalStyles}</style>
      
      {/* Sidebar */}
      <div className="w-64 bg-white border-r border-slate-200 flex flex-col">
        <div className="p-4 border-b border-slate-100">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-bold text-slate-700 flex items-center gap-2">
              <UserPlus className="w-5 h-5 text-blue-600" />
              Clients
            </h2>
            <button onClick={() => setIsAddingCustomer(true)} className="p-1 hover:bg-blue-50 text-blue-600 rounded">
              <Plus className="w-5 h-5" />
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
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col overflow-hidden bg-white">
        {selectedCustomer ? (
          <>
            <div className="p-4 border-b border-slate-200 flex justify-between items-center bg-white">
              <div>
                <h1 className="text-xl font-bold text-slate-800 flex items-center gap-2">
                  <FileSpreadsheet className="w-6 h-6 text-emerald-600" />
                  {selectedCustomer.name} Order Sheet
                </h1>
              </div>
              <button 
                onClick={handleAddRow}
                className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors shadow-sm"
              >
                <Plus className="w-4 h-4" />
                Add Order
              </button>
            </div>

            {/* Bulk Actions */}
            {selectedRows.size > 0 && (
              <div className="px-4 py-2 bg-blue-50 border-b border-blue-100 flex items-center gap-4 animate-in slide-in-from-top-2">
                <span className="text-sm font-medium text-blue-700">{selectedRows.size} rows selected</span>
                <div className="h-4 w-px bg-blue-200"></div>
                
                {showBulkDateInput ? (
                  <div className="flex items-center gap-2">
                    <input 
                      type="date" 
                      value={bulkDate}
                      onChange={(e) => setBulkDate(e.target.value)}
                      className="px-2 py-1 text-sm border border-blue-200 rounded bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                    <button 
                      onClick={handleBulkUpdateDate}
                      disabled={!bulkDate}
                      className="px-3 py-1 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 disabled:opacity-50"
                    >
                      Apply
                    </button>
                    <button 
                      onClick={() => setShowBulkDateInput(false)}
                      className="p-1 text-slate-500 hover:text-slate-700"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ) : (
                  <button 
                    onClick={() => setShowBulkDateInput(true)}
                    className="flex items-center gap-2 px-3 py-1 bg-white border border-blue-200 text-blue-700 text-sm rounded hover:bg-blue-100"
                  >
                    <Calendar className="w-4 h-4" />
                    Set Receive Date
                  </button>
                )}
              </div>
            )}

            <div className="flex-1 overflow-auto p-4 bg-slate-50">
              <div className="bg-white rounded-lg shadow border border-slate-200 overflow-visible">
                <table className="w-full text-sm border-collapse">
                  <thead className="bg-slate-100 text-slate-600 font-semibold sticky top-0 z-10 shadow-sm text-xs uppercase tracking-wider">
                    <tr>
                      <th className="p-3 w-10 border-b border-r border-slate-200 text-center">
                        <button onClick={toggleSelectAll} className="text-slate-400 hover:text-slate-600">
                          {selectedCustomer.orders.length > 0 && selectedRows.size === selectedCustomer.orders.length ? (
                            <CheckSquare className="w-4 h-4 text-blue-600" />
                          ) : (
                            <Square className="w-4 h-4" />
                          )}
                        </button>
                      </th>
                      <th className="p-3 text-left border-b border-r border-slate-200 min-w-[120px]">Fabric</th>
                      <th className="p-3 text-left border-b border-r border-slate-200 min-w-[140px]">Accessories</th>
                      <th className="p-3 text-right border-b border-r border-slate-200 w-20">Acc. Qty</th>
                      <th className="p-3 text-right border-b border-r border-slate-200 w-24">Ordered</th>
                      <th className="p-3 text-right border-b border-r border-slate-200 w-24 bg-slate-50">Remaining</th>
                      <th className="p-3 text-center border-b border-r border-slate-200 w-32">Receive Date</th>
                      <th className="p-3 text-center border-b border-r border-slate-200 w-16">Plan</th>
                      <th className="p-3 text-center border-b border-slate-200 w-24">Status</th>
                      <th className="p-3 w-10 border-b border-slate-200"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {selectedCustomer.orders.map((row) => {
                      const statusInfo = getDetailedStatus(row);
                      const refCode = row.material ? `${selectedCustomer.name}-${row.material}` : '-';
                      const displayRemaining = statusInfo ? statusInfo.remaining : row.remainingQty;
                      const isSelected = selectedRows.has(row.id);

                      return (
                        <tr key={row.id} className={`transition-colors group text-sm ${isSelected ? 'bg-blue-50' : 'hover:bg-blue-50/30'}`}>
                          {/* Checkbox */}
                          <td className="p-0 border-r border-slate-200 text-center align-middle">
                            <button onClick={() => toggleSelectRow(row.id)} className="p-2 w-full h-full flex items-center justify-center text-slate-400 hover:text-blue-600">
                              {isSelected ? <CheckSquare className="w-4 h-4 text-blue-600" /> : <Square className="w-4 h-4" />}
                            </button>
                          </td>

                          {/* Fabric */}
                          <td className="p-0 border-r border-slate-200" title={refCode}>
                            <SearchDropdown
                              id={`fabric-${row.id}`}
                              options={fabrics}
                              value={row.material}
                              onChange={(val) => handleUpdateOrder(row.id, { material: val })}
                              onCreateNew={handleCreateFabric}
                              placeholder="Select Fabric..."
                            />
                          </td>

                          {/* Accessories */}
                          <td className="p-0 border-r border-slate-200 relative">
                            <input 
                              type="text"
                              className="w-full h-full px-3 py-2 bg-transparent outline-none focus:bg-blue-50"
                              value={row.accessory}
                              onChange={(e) => handleUpdateOrder(row.id, { accessory: e.target.value })}
                              placeholder=""
                            />
                            {row.accessoryPercentage && (
                              <div className="absolute right-1 top-1/2 -translate-y-1/2 text-[10px] bg-slate-100 text-slate-500 px-1 rounded pointer-events-none">
                                {row.accessoryPercentage}%
                              </div>
                            )}
                          </td>

                          {/* Acc. Qty */}
                          <td className="p-0 border-r border-slate-200">
                             <input 
                              type="number"
                              className="w-full h-full px-2 py-2 text-right bg-transparent outline-none focus:bg-blue-50 font-mono text-slate-600 text-xs"
                              value={row.accessoryQty ?? ''}
                              onChange={(e) => handleUpdateOrder(row.id, { accessoryQty: Number(e.target.value) })}
                              placeholder="-"
                            />
                          </td>

                          {/* Ordered Qty */}
                          <td className="p-0 border-r border-slate-200">
                            <input 
                              type="number"
                              className="w-full h-full px-2 py-2 text-right bg-transparent outline-none focus:bg-blue-50 font-mono text-slate-700"
                              value={row.requiredQty ?? ''}
                              onChange={(e) => {
                                const val = e.target.value === '' ? 0 : Number(e.target.value);
                                const updates: Partial<OrderRow> = { requiredQty: val };
                                // If not active, update remaining too
                                if (!statusInfo || (statusInfo.active.length === 0)) {
                                   updates.remainingQty = val;
                                }
                                handleUpdateOrder(row.id, updates);
                              }}
                            />
                          </td>

                          {/* Remaining Qty */}
                          <td className={`p-2 text-right border-r border-slate-200 font-mono font-bold ${statusInfo && statusInfo.active.length > 0 ? 'text-emerald-600 bg-emerald-50/30' : 'text-slate-600'}`}>
                            {displayRemaining?.toLocaleString()}
                          </td>

                          {/* Receive Date */}
                          <td className="p-0 border-r border-slate-200">
                            <input 
                              type="date"
                              className="w-full h-full px-2 py-2 bg-transparent outline-none focus:bg-blue-50 text-center text-slate-600 text-xs"
                              value={row.orderReceiptDate}
                              onChange={(e) => handleUpdateOrder(row.id, { orderReceiptDate: e.target.value })}
                            />
                          </td>

                          {/* Plan Button */}
                          <td className="p-0 border-r border-slate-200 text-center align-middle">
                             <button
                              onClick={() => handlePlanSearch(selectedCustomer.name, row.material)}
                              className="p-1.5 text-blue-600 hover:bg-blue-50 rounded transition-colors"
                              title="Search Plan"
                            >
                              <Search className="w-4 h-4" />
                            </button>
                          </td>

                          {/* Status / Location */}
                          <td className="p-0 border-r border-slate-200 text-center align-middle">
                            {statusInfo ? (
                              <div className="flex flex-col gap-1 items-center justify-center p-1">
                                {statusInfo.active.map((m, i) => (
                                  <span key={`a-${i}`} className="text-[10px] px-1.5 py-0.5 bg-emerald-100 text-emerald-700 rounded-full font-medium whitespace-nowrap" title="Active">
                                    {m}
                                  </span>
                                ))}
                                {statusInfo.planned.map((m, i) => (
                                  <span key={`p-${i}`} className="text-[10px] px-1.5 py-0.5 bg-blue-100 text-blue-700 rounded-full font-medium whitespace-nowrap" title="Planned">
                                    {m}
                                  </span>
                                ))}
                              </div>
                            ) : (
                              (displayRemaining || 0) > 0 ? (
                                <span className="text-[10px] text-amber-600 font-medium bg-amber-50 px-2 py-0.5 rounded-full whitespace-nowrap">
                                  Not Planned
                                </span>
                              ) : (
                                <span className="text-[10px] text-slate-400 font-medium bg-slate-100 px-2 py-0.5 rounded-full whitespace-nowrap">
                                  Finished
                                </span>
                              )
                            )}
                          </td>

                          {/* Actions */}
                          <td className="p-0 text-center">
                            <button 
                              onClick={() => handleDeleteRow(row.id)}
                              className="p-2 text-slate-400 hover:text-red-500 transition-colors opacity-0 group-hover:opacity-100"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-slate-400">
            Select a client to view orders
          </div>
        )}

        {/* Plan Search Modal */}
        {planSearchModal.isOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
            <div className="bg-white rounded-lg shadow-xl w-full max-w-md p-6 m-4">
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-lg font-bold text-slate-800">
                  Plan Search: {planSearchModal.reference}
                </h3>
                <button onClick={() => setPlanSearchModal(prev => ({ ...prev, isOpen: false }))}>
                  <X className="w-5 h-5 text-slate-500" />
                </button>
              </div>
              
              <div className="max-h-[60vh] overflow-y-auto">
                {planSearchModal.results.length > 0 ? (
                  <div className="space-y-3">
                    {planSearchModal.results.map((res, idx) => (
                      <div key={idx} className={`p-3 rounded border ${res.type === 'ACTIVE' ? 'bg-emerald-50 border-emerald-200' : 'bg-blue-50 border-blue-200'}`}>
                        <div className="flex justify-between items-start">
                          <span className="font-bold text-slate-700">{res.machineName}</span>
                          <span className={`text-xs px-2 py-1 rounded-full font-bold ${res.type === 'ACTIVE' ? 'bg-emerald-100 text-emerald-700' : 'bg-blue-100 text-blue-700'}`}>
                            {res.type}
                          </span>
                        </div>
                        <div className="text-sm text-slate-600 mt-1">{res.details}</div>
                        {res.date && <div className="text-xs text-slate-400 mt-1">Date: {res.date}</div>}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-8 text-slate-500">
                    <AlertCircle className="w-12 h-12 mx-auto mb-2 text-slate-300" />
                    <p>No active or planned records found for this reference.</p>
                  </div>
                )}
              </div>
              
              <div className="mt-6 flex justify-end">
                <button 
                  onClick={() => setPlanSearchModal(prev => ({ ...prev, isOpen: false }))}
                  className="px-4 py-2 bg-slate-100 text-slate-700 rounded hover:bg-slate-200"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
