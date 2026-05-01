import type { IrisAPI, PluginContext, ToolDefinition } from 'irises-extension-sdk';
import { parseVirtualLoverConfig } from './config.js';
import { sendProactiveMessage } from './proactive.js';
import { loadPromptBundle } from './state.js';

export const VIRTUAL_LOVER_PROACTIVE_TOOL_NAME = 'virtual_lover_proactive_send';

export function createVirtualLoverProactiveTool(ctx: PluginContext, api: IrisAPI): ToolDefinition {
  return {
    declaration: {
      name: VIRTUAL_LOVER_PROACTIVE_TOOL_NAME,
      description: [
        'Trigger a virtual-lover proactive message using the configured delivery binding or target.',
        'Use this when the user explicitly asks to send a companion message, or from scheduled cron jobs.',
        'If text is omitted, the plugin generates a short message from persona/style/rules and lover memory.',
      ].join(' '),
      parameters: {
        type: 'object',
        properties: {
          text: {
            type: 'string',
            description: 'Exact text to send. If omitted or blank, virtual-lover will generate a message.',
          },
          reason: {
            type: 'string',
            description: 'Optional reason/context for generation, e.g. "睡前轻声问候".',
          },
          dryRun: {
            type: 'boolean',
            description: 'If true, generate/preview the message without sending it.',
          },
        },
      },
    },
    parallel: false,
    handler: async (args) => {
      const config = parseVirtualLoverConfig(ctx.readConfigSection('virtual_lover'));
      const agentId = config.agent.defaultAgentId;
      const bundle = loadPromptBundle(ctx.getDataDir(), ctx.getExtensionRootDir(), agentId);
      return await sendProactiveMessage({
        config,
        api,
        bundle,
        agentId,
        text: typeof args.text === 'string' ? args.text : undefined,
        reason: typeof args.reason === 'string' ? args.reason : undefined,
        dryRun: args.dryRun === true,
      });
    },
  };
}
