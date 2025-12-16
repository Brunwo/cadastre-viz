export const parseParcelTextRegex = (inputText: string): Array<{ communeName: string; section: string; numero: string }> => {
  const lines = inputText.split('\n').filter(line => line.trim() !== '');
  const results = [];

  for (const line of lines) {
    const cleanLine = line.trim();
    
    // Pattern 1: Explicit markers (e.g., "SCHORBACH S C N° 0584")
    // Format: Commune + (S/Section) + Section + (N°/No) + Number
    // Regex breakdown:
    // ^(.+?)           -> Commune (lazy capture start of line)
    // [\s\t]+          -> Separator
    // (?:S|Section...) -> Section indicator (non-capturing)
    // [\s\t]+          -> Separator
    // ([A-Z0-9]{1,2})  -> Section Code (Captured, 1-2 alphanumeric)
    // [\s\t]+          -> Separator
    // (?:N°|No...)?    -> Number indicator (Optional)
    // \.?              -> Optional dot
    // [\s\t]*          -> Optional whitespace
    // (\d+)            -> Number (Captured digits)
    let match = cleanLine.match(/^(.+?)[\s\t]+(?:S|Section|Sec\.?|Sect\.?)[\s\t]+([A-Z0-9]{1,2})[\s\t]+(?:N°|No|N|Num|Numero)?\.?[\s\t]*(\d+)$/i);
    
    if (match) {
      results.push({
        communeName: match[1].trim(),
        section: match[2].toUpperCase(),
        numero: match[3]
      });
      continue;
    }

    // Pattern 2: Minimalist (e.g., "LENGELSHEIM B 45" or "NOUSSEVILLER-LES-BITCHE 10 0123")
    // Format: Commune + Section(1-2 chars) + Number(digits)
    // We assume the section is short (1-2 chars) and the number is numeric at the end.
    match = cleanLine.match(/^(.+?)[\s\t]+([A-Z0-9]{1,2})[\s\t]+(\d+)$/i);
    
    if (match) {
        // Basic filter: ensure 'section' isn't likely part of the commune name (though difficult without dictionary)
        // This heuristic relies on the user providing data in the "Commune Section Number" order.
        results.push({
            communeName: match[1].trim(),
            section: match[2].toUpperCase(),
            numero: match[3]
        });
        continue;
    }
  }
  return results;
};