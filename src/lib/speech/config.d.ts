export const speechPreferenceKey: string;
export const speechProfiles: { value: string; label: string; bytes: number; encoder: string; files: string[] }[];
export function appendDictation(draft: string, previous: string, confirmed: string, limit?: number): { draft: string; confirmed: string; truncated: boolean };
