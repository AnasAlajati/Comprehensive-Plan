import { GoogleGenAI, Type } from "@google/genai";
import { MachineRow, PlanItem } from '../types';

/**
 * Safely retrieve the API key from various environment configurations.
 * This prevents "process is not defined" errors in browsers.
 */
const getAiClient = () => {
  // Check for Vite env (most likely on Vercel) or Standard React env
  // @ts-ignore
  const apiKey = import.meta.env?.VITE_GOOGLE_API_KEY || process.env.REACT_APP_GOOGLE_API_KEY || process.env.API_KEY || "AIzaSyC4dqr5i9Bo_oKNzdgl2Uv1CtHMB8wBPdo";

  if (!apiKey) {
    throw new Error("Missing Google API Key. Please set VITE_GOOGLE_API_KEY in your environment variables.");
  }

  return new GoogleGenAI({ apiKey });
};

/**
 * Uses Gemini to parse natural language text into a structured PlanItem.
 */
export const parseTextToPlan = async (text: string): Promise<PlanItem | null> => {
  try {
    const ai = getAiClient();
    const response = await ai.models.generateContent({
      model: "gemini-2.0-flash",
      contents: `You are an expert textile production planner. Extract production plan details from the following text into a JSON object.
      
      Input Text: "${text}"
      
      Context & Rules:
      - 'productionPerDay': Estimate this based on standard textile machine rates if not specified (default to 150).
      - 'quantity': The total amount (kg/units) needed.
      - 'days': Calculate as (quantity / productionPerDay). Round up to nearest integer.
      - 'remaining': Should equal 'quantity' initially.
      - 'endDate': If a specific date is mentioned (e.g., "next Friday", "Jan 15"), calculate the exact YYYY-MM-DD. If relative time is given (e.g. "in 5 days"), calculate from today.
      - 'client': Extract the Client Name (e.g. "Zara", "H&M").
      - 'orderName': Extract the Order Number or Reference ID.
      - 'fabric': Extract the material type (e.g., Cotton, Lycra, Single Jersey).
      `,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            fabric: { type: Type.STRING },
            productionPerDay: { type: Type.NUMBER },
            quantity: { type: Type.NUMBER },
            days: { type: Type.NUMBER },
            endDate: { type: Type.STRING },
            remaining: { type: Type.NUMBER },
            client: { type: Type.STRING },
            orderName: { type: Type.STRING },
          },
          required: ["fabric", "quantity", "client"],
        },
      },
    });

    if (response.text) {
      return JSON.parse(response.text) as PlanItem;
    }
    return null;
  } catch (error) {
    console.error("AI Parsing Error:", error);
    return null;
  }
};

/**
 * Uses Gemini to analyze the current list of machines and provide operational insights.
 */
export const analyzeFactoryStatus = async (machines: MachineRow[]): Promise<string> => {
  try {
    const ai = getAiClient();
    
    // Simplify data to send fewer tokens while keeping key metrics
    const machineSummary = machines.map(m => ({
      id: m.id,
      name: m.machineName,
      status: m.status,
      scrap: m.scrap,
      production_diff: m.dayProduction - m.avgProduction, // Negative means underperforming
      active_plans: m.futurePlans.length
    }));

    const response = await ai.models.generateContent({
      model: "gemini-2.0-flash",
      contents: `You are a Senior Factory Manager AI. Analyze this textile factory data and provide a concise, high-level operational report in Markdown.
      
      Data: ${JSON.stringify(machineSummary)}

      Report Structure:
      1. **🚨 Critical Alerts**: Identify machines with high scrap or significant underproduction (negative production_diff).
      2. **⚠️ Bottlenecks**: Machines "Under Operation" or "Out of Service" that are halting production.
      3. **📅 Planning Gaps**: Identify machines that are "Working" but have 0 active plans (Idle risk).
      4. **📊 Executive Summary**: A 2-sentence health check of the entire floor.
      
      Tone: Professional, direct, and actionable. Use emojis for readability.`,
    });

    return response.text || "Could not generate analysis.";
  } catch (error) {
    console.error("AI Analysis Error:", error);
    return "Error generating AI analysis. Please check your API key configuration.";
  }
};

/**
 * Analyzes the schedule for optimization opportunities and risks.
 */
export const getScheduleRecommendations = async (machines: MachineRow[]): Promise<{ type: 'RISK' | 'OPTIMIZATION' | 'GOOD', title: string, message: string }[]> => {
  try {
    const ai = getAiClient();
    
    // Prepare a lean dataset for the AI
    const scheduleData = machines.map(m => ({
      machine: m.machineName,
      current_fabric: m.material,
      current_remaining: m.remainingMfg,
      avg_speed: m.avgProduction,
      current_speed: m.dayProduction,
      plans: m.futurePlans.map(p => ({
        order: p.orderName,
        fabric: p.fabric,
        qty: p.quantity,
        days: p.days
      }))
    }));

    const response = await ai.models.generateContent({
      model: "gemini-2.0-flash",
      contents: `You are an expert Production Planner. Analyze this factory schedule and return a JSON array of specific, actionable recommendations.
      
      Data: ${JSON.stringify(scheduleData)}

      Focus on:
      1. **RISK**: Identify orders that might be late because 'current_speed' is lower than 'avg_speed'.
      2. **OPTIMIZATION**: Identify idle machines (0 remaining, 0 plans) that could take work from overloaded machines.
      3. **OPTIMIZATION**: Suggest grouping similar fabrics (e.g. "Move Cotton job to Machine 5 which is already running Cotton").
      
      Return ONLY a JSON array with this structure:
      [
        { "type": "RISK", "title": "Late Delivery Risk", "message": "Machine 1 is running 20% slower than planned. Order X may be delayed by 2 days." },
        { "type": "OPTIMIZATION", "title": "Load Balancing", "message": "Machine 4 is idle. Consider moving a future plan from Machine 2 to Machine 4." }
      ]
      
      If everything looks perfect, return one item with type "GOOD".`,
      config: {
        responseMimeType: "application/json"
      }
    });

    if (response.text) {
      return JSON.parse(response.text);
    }
    return [];
  } catch (error) {
    console.error("AI Schedule Analysis Error:", error);
    return [{ type: 'RISK', title: 'Analysis Failed', message: 'Could not connect to AI service.' }];
  }
};
