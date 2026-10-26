import type { AgentTool } from "@earendil-works/pi-agent-core";
export const VISION_TOOL_LIMITS: Readonly<Record<string, number>>;
export function createVisionTool(options: {assetBase: string; profile: unknown; getImage: (id: string) => unknown;
  suspendText: (options: {signal: AbortSignal}) => Promise<void>; resumeText: (options: {signal: AbortSignal}) => Promise<void>;
  onState?: (state: {phase: string; status?: string; busy: boolean; error: string | null}) => void;
  loadVision?: (profile: unknown, options: unknown) => Promise<unknown>; timeouts?: Record<string, number>;
}): {tool: AgentTool; readonly state: Record<string, unknown>; dispose(): Promise<void>};
