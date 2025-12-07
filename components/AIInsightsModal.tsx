import React from 'react';

interface Recommendation {
  type: 'RISK' | 'OPTIMIZATION' | 'GOOD';
  title: string;
  message: string;
}

interface AIInsightsModalProps {
  onClose: () => void;
  recommendations: Recommendation[];
}

export const AIInsightsModal: React.FC<AIInsightsModalProps> = ({ onClose, recommendations }) => {
  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-3xl max-h-[80vh] flex flex-col border border-slate-200 animate-fadeIn">
        
        {/* Header */}
        <div className="bg-gradient-to-r from-slate-900 to-slate-800 p-5 text-white flex justify-between items-center rounded-t-xl">
          <div className="flex items-center gap-3">
            <div className="bg-white/10 p-2 rounded-lg">
              <span className="text-2xl">🧠</span>
            </div>
            <div>
              <h3 className="font-bold text-lg tracking-wide">Smart Production Advisor</h3>
              <p className="text-xs text-slate-300">Powered by Gemini 2.0</p>
            </div>
          </div>
          <button onClick={onClose} className="text-white/70 hover:text-white transition-colors bg-white/10 hover:bg-white/20 rounded-full p-1 w-8 h-8 flex items-center justify-center">✕</button>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto custom-scrollbar flex-1 bg-slate-50 space-y-4">
          {recommendations.length === 0 && (
             <div className="text-center py-12 text-slate-400">
                <p>No recommendations generated.</p>
             </div>
          )}

          {recommendations.map((rec, idx) => (
            <div key={idx} className={`p-4 rounded-lg border-l-4 shadow-sm bg-white ${
              rec.type === 'RISK' ? 'border-red-500' : 
              rec.type === 'OPTIMIZATION' ? 'border-blue-500' : 'border-emerald-500'
            }`}>
              <div className="flex items-start gap-4">
                <div className={`p-2 rounded-full shrink-0 ${
                  rec.type === 'RISK' ? 'bg-red-100 text-red-600' : 
                  rec.type === 'OPTIMIZATION' ? 'bg-blue-100 text-blue-600' : 'bg-emerald-100 text-emerald-600'
                }`}>
                  {rec.type === 'RISK' ? (
                    <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                    </svg>
                  ) : rec.type === 'OPTIMIZATION' ? (
                    <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                    </svg>
                  ) : (
                    <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  )}
                </div>
                <div>
                  <h4 className={`font-bold text-lg ${
                    rec.type === 'RISK' ? 'text-red-700' : 
                    rec.type === 'OPTIMIZATION' ? 'text-blue-700' : 'text-emerald-700'
                  }`}>
                    {rec.title}
                  </h4>
                  <p className="text-slate-600 mt-1 leading-relaxed">{rec.message}</p>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="bg-white p-4 border-t border-slate-200 flex justify-between items-center">
          <div className="text-xs text-slate-400 italic">
            AI analysis based on current machine states and future plans.
          </div>
          <button 
            onClick={onClose} 
            className="px-6 py-2 bg-slate-800 hover:bg-slate-900 text-white rounded-lg font-medium transition-colors shadow-lg shadow-slate-200"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};
