import { GoogleGenAI, Type } from "@google/genai";

export const parseParcelText = async (inputText: string): Promise<Array<{ communeName: string; section: string; numero: string }>> => {
  try {
    // Initialize inside the function to ensure process.env is ready and prevent top-level crashes
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: `Extract French cadastral parcel information from the following text.
      
      Rules:
      1. 'numero' (parcel number) must be 4 digits (pad with leading zeros if necessary, e.g., '584' -> '0584').
      2. 'section' is usually 1 or 2 letters.
         - CRITICAL: "S" often stands for "Section". Do NOT include "S" in the section value if it is used as a prefix.
         - Example: "SCHORBACH S C N° 0584" -> Commune: SCHORBACH, Section: C, Numero: 0584.
         - Example: "S AB" -> Section: AB.
      3. 'communeName' is the city/town name.
      4. Ignore header lines or irrelevant text.
      
      Input Text:
      ${inputText}`,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              communeName: { type: Type.STRING },
              section: { type: Type.STRING },
              numero: { type: Type.STRING },
            },
            required: ["communeName", "section", "numero"],
          },
        },
      },
    });

    if (response.text) {
      return JSON.parse(response.text);
    }
    return [];
  } catch (error) {
    console.error("Error parsing with Gemini:", error);
    throw error;
  }
};