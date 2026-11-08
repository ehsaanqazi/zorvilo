import type { ApiRequest } from '@/types/models';
import { requestContext } from '@/features/http/execute';
import { invoke } from '@/platform/tauri';

/**
 * "Copy as …" code generation, done by the Rust backend. Variables and
 * inherited auth are resolved with the current scope before generating.
 */

export type CodegenFormatId = 'curl' | 'fetch' | 'python' | 'powershell';

export function generateCode(format: CodegenFormatId, request: ApiRequest): Promise<string> {
  return invoke<string>('generate_code', { args: { format, ...requestContext(request) } });
}

export const generateCurl = (request: ApiRequest) => generateCode('curl', request);
export const generateFetch = (request: ApiRequest) => generateCode('fetch', request);
export const generatePython = (request: ApiRequest) => generateCode('python', request);
export const generatePowerShell = (request: ApiRequest) => generateCode('powershell', request);

export const CODEGEN_FORMATS = [
  { id: 'curl', label: 'cURL', generate: generateCurl },
  { id: 'fetch', label: 'JavaScript (fetch)', generate: generateFetch },
  { id: 'python', label: 'Python (requests)', generate: generatePython },
  { id: 'powershell', label: 'PowerShell', generate: generatePowerShell },
] as const;
