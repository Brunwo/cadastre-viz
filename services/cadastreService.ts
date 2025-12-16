import { InseeResponse } from "../types";

// Base URLs
const API_GEO_URL = "https://geo.api.gouv.fr";
const API_CARTO_URL = "https://apicarto.ign.fr/api/cadastre";

/**
 * Finds the INSEE code for a given commune name.
 * Uses geo.api.gouv.fr
 */
export const getInseeCode = async (communeName: string): Promise<string | null> => {
  try {
    // Fuzzy search for commune
    const response = await fetch(`${API_GEO_URL}/communes?nom=${encodeURIComponent(communeName)}&fields=code&boost=population&limit=1`);
    if (!response.ok) return null;
    
    const data: InseeResponse[] = await response.json();
    if (data && data.length > 0) {
      return data[0].code;
    }
    return null;
  } catch (error) {
    console.error(`Error fetching INSEE for ${communeName}:`, error);
    return null;
  }
};

/**
 * Fetches the GeoJSON for a specific parcel.
 * Uses apicarto.ign.fr
 */
export const getParcelGeometry = async (insee: string, section: string, numero: string): Promise<any | null> => {
  try {
    // Ensure formatting (IGN is strict)
    // Section: sometimes needs 0 padding if provided as single digit, but letters are usually fine as is.
    // Numero: IGN expects 4 digits usually.
    const formattedNumero = numero.padStart(4, '0');
    
    // Construct query
    // API Carto endpoint: /parcelle?code_insee=...&section=...&numero=...
    const url = `${API_CARTO_URL}/parcelle?code_insee=${insee}&section=${section}&numero=${formattedNumero}`;
    
    const response = await fetch(url);
    if (!response.ok) {
        // Try with padded section if failed (e.g. 'C' -> '0C') - uncommon but possible in old data
        if (section.length === 1) {
             const retryUrl = `${API_CARTO_URL}/parcelle?code_insee=${insee}&section=0${section}&numero=${formattedNumero}`;
             const retryResponse = await fetch(retryUrl);
             if (retryResponse.ok) return await retryResponse.json();
        }
        return null;
    }

    const geoJson = await response.json();
    return geoJson;
  } catch (error) {
    console.error(`Error fetching geometry for ${insee} ${section} ${numero}:`, error);
    return null;
  }
};
