/**
 * Computer Use 配置解析
 */

import { ComputerUseConfig } from './types';

export function parseComputerUseConfig(raw: any): ComputerUseConfig | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  if (!raw.enabled) return undefined;

  return {
    enabled: true,
    environment: raw.environment === 'screen' ? 'screen' : 'browser',
    screenWidth: typeof raw.screenWidth === 'number' ? raw.screenWidth : undefined,
    screenHeight: typeof raw.screenHeight === 'number' ? raw.screenHeight : undefined,
    excludedFunctions: Array.isArray(raw.excludedFunctions)
      ? raw.excludedFunctions.filter((s: unknown): s is string => typeof s === 'string')
      : undefined,
    postActionDelay: typeof raw.postActionDelay === 'number' ? raw.postActionDelay : undefined,
    screenshotFormat: raw.screenshotFormat === 'jpeg' ? 'jpeg' : undefined,
    screenshotQuality: typeof raw.screenshotQuality === 'number' ? raw.screenshotQuality : undefined,
    headless: typeof raw.headless === 'boolean' ? raw.headless : undefined,
    initialUrl: typeof raw.initialUrl === 'string' ? raw.initialUrl : undefined,
    searchEngineUrl: typeof raw.searchEngineUrl === 'string' ? raw.searchEngineUrl : undefined,
    highlightMouse: typeof raw.highlightMouse === 'boolean' ? raw.highlightMouse : undefined,
    maxRecentScreenshots: typeof raw.maxRecentScreenshots === 'number' ? raw.maxRecentScreenshots : undefined,
    targetWindow: typeof raw.targetWindow === 'string' ? raw.targetWindow : undefined,
  };
}
