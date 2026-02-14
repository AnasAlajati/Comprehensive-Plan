import React, { useState, useMemo } from 'react';
import { ChevronLeft, ChevronRight, Calendar as CalendarIcon, Check } from 'lucide-react';

interface ProfessionalDatePickerProps {
  selectedDate: string; // YYYY-MM-DD
  onChange: (date: string) => void;
  highlightedDates?: string[]; // Array of YYYY-MM-DD
  activeDay?: string; // Global active day
}

export const ProfessionalDatePicker: React.FC<ProfessionalDatePickerProps> = ({
  selectedDate,
  onChange,
  highlightedDates = [],
  activeDay
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [viewDate, setViewDate] = useState(new Date(selectedDate || new Date()));

  // Helper to format date as YYYY-MM-DD WITHOUT timezone conversion
  const formatDateString = (year: number, month: number, day: number): string => {
    const m = String(month + 1).padStart(2, '0');
    const d = String(day).padStart(2, '0');
    return `${year}-${m}-${d}`;
  };

  const daysInMonth = (year: number, month: number) => new Date(year, month + 1, 0).getDate();
  const firstDayOfMonth = (year: number, month: number) => new Date(year, month, 1).getDay();

  const calendarData = useMemo(() => {
    const year = viewDate.getFullYear();
    const month = viewDate.getMonth();
    
    const days = [];
    const totalDays = daysInMonth(year, month);
    const startDay = firstDayOfMonth(year, month);
    
    // Previous month filler
    const prevMonthDays = daysInMonth(year, month - 1);
    for (let i = startDay - 1; i >= 0; i--) {
      days.push({
        day: prevMonthDays - i,
        month: month - 1,
        year: year,
        isCurrentMonth: false
      });
    }
    
    // Current month days
    for (let i = 1; i <= totalDays; i++) {
      days.push({
        day: i,
        month: month,
        year: year,
        isCurrentMonth: true
      });
    }
    
    // Next month filler
    const remainingSlots = 42 - days.length; // 6 rows of 7 days
    for (let i = 1; i <= remainingSlots; i++) {
      days.push({
        day: i,
        month: month + 1,
        year: year,
        isCurrentMonth: false
      });
    }
    
    return days;
  }, [viewDate]);

  const handleDateClick = (dayObj: any) => {
    const dateStr = formatDateString(dayObj.year, dayObj.month, dayObj.day);
    onChange(dateStr);
    setIsOpen(false);
  };

  const isSelected = (day: number, month: number, year: number) => {
    const dateStr = formatDateString(year, month, day);
    return dateStr === selectedDate;
  };

  const isToday = (day: number, month: number, year: number) => {
    const today = formatDateString(new Date().getFullYear(), new Date().getMonth(), new Date().getDate());
    const dateStr = formatDateString(year, month, day);
    return dateStr === today;
  };

  const isHighlighted = (day: number, month: number, year: number) => {
    const dateStr = formatDateString(year, month, day);
    return highlightedDates.includes(dateStr);
  };

  const isActiveDay = (day: number, month: number, year: number) => {
    const dateStr = formatDateString(year, month, day);
    return dateStr === activeDay;
    return dateStr === activeDay;
  };

  const monthNames = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"
  ];

  return (
    <div className="relative inline-block text-left">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 bg-white px-3 py-2 rounded-xl border border-slate-200 hover:border-blue-400 hover:shadow-md transition-all duration-200 group"
      >
        <CalendarIcon size={18} className="text-slate-400 group-hover:text-blue-500" />
        <span className="text-sm font-bold text-slate-700">
          {new Date(selectedDate).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' })}
        </span>
        <div className={`w-2 h-2 rounded-full transition-colors ${highlightedDates.includes(selectedDate) ? 'bg-emerald-500' : 'bg-slate-300'}`} />
      </button>

      {isOpen && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setIsOpen(false)} />
          <div className="absolute left-0 mt-2 w-72 bg-white rounded-2xl shadow-2xl z-50 border border-slate-100 overflow-hidden animate-in fade-in zoom-in duration-200">
            {/* Header */}
            <div className="bg-slate-50 p-4 border-b border-slate-100 flex items-center justify-between">
              <button 
                onClick={() => setViewDate(new Date(viewDate.setMonth(viewDate.getMonth() - 1)))}
                className="p-1.5 hover:bg-white rounded-lg border border-transparent hover:border-slate-200 text-slate-500 transition-all"
              >
                <ChevronLeft size={18} />
              </button>
              
              <div className="text-sm font-bold text-slate-800">
                {monthNames[viewDate.getMonth()]} {viewDate.getFullYear()}
              </div>

              <button 
                onClick={() => setViewDate(new Date(viewDate.setMonth(viewDate.getMonth() + 1)))}
                className="p-1.5 hover:bg-white rounded-lg border border-transparent hover:border-slate-200 text-slate-500 transition-all"
              >
                <ChevronRight size={18} />
              </button>
            </div>

            {/* Calendar Grid */}
            <div className="p-3">
              <div className="grid grid-cols-7 mb-2">
                {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map(day => (
                  <div key={day} className="text-center text-[10px] font-bold text-slate-400 uppercase">
                    {day}
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-7 gap-1">
                {calendarData.map((d, i) => {
                  const selected = isSelected(d.day, d.month, d.year);
                  const highlighted = isHighlighted(d.day, d.month, d.year);
                  const isAct = isActiveDay(d.day, d.month, d.year);
                  const today = isToday(d.day, d.month, d.year);

                  return (
                    <button
                      key={i}
                      onClick={() => handleDateClick(d)}
                      disabled={!d.isCurrentMonth}
                      className={`
                        relative h-9 w-full flex flex-col items-center justify-center rounded-xl text-xs font-semibold transition-all
                        ${d.isCurrentMonth ? 'hover:bg-blue-50 hover:text-blue-600' : 'text-slate-200 cursor-default'}
                        ${selected ? 'bg-blue-600 text-white hover:bg-blue-600 hover:text-white shadow-lg shadow-blue-200' : ''}
                        ${!selected && today ? 'ring-2 ring-blue-100 text-blue-600' : ''}
                      `}
                    >
                      <span>{d.day}</span>
                      
                      {/* Status Indicators */}
                      <div className="absolute bottom-1.5 flex gap-0.5">
                        {highlighted && (
                          <div className={`w-1 h-1 rounded-full ${selected ? 'bg-white/80' : 'bg-emerald-400'}`} />
                        )}
                        {isAct && (
                          <div className={`w-1 h-1 rounded-full ${selected ? 'bg-white/80' : 'bg-amber-400'}`} />
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Footer */}
            <div className="bg-slate-50/50 p-3 border-t border-slate-100 flex items-center justify-between">
              <div className="flex items-center gap-3 text-[10px] text-slate-400 font-medium">
                 <div className="flex items-center gap-1">
                    <div className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                    <span>Report</span>
                 </div>
                 <div className="flex items-center gap-1">
                    <div className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                    <span>Active</span>
                 </div>
              </div>
              <button 
                onClick={() => {
                  const now = new Date();
                  const today = formatDateString(now.getFullYear(), now.getMonth(), now.getDate());
                  onChange(today);
                  setIsOpen(false);
                }}
                className="text-[10px] font-bold text-blue-600 hover:underline"
              >
                Today
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
};
