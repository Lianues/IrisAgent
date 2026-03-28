import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('terminal shared pages', () => {
  it('已创建可复用的输入页、建议输入页、选项页、确认页、平台面板、模型面板和 extension 面板，并被接入命令界面', () => {
    const inputPagePath = path.resolve(process.cwd(), 'terminal/src/shared/pages/ScrollableInputPage.tsx');
    const suggestableInputPagePath = path.resolve(process.cwd(), 'terminal/src/shared/pages/SuggestableInputPage.tsx');
    const optionPagePath = path.resolve(process.cwd(), 'terminal/src/shared/pages/OptionSelectPage.tsx');
    const confirmPagePath = path.resolve(process.cwd(), 'terminal/src/shared/pages/InfoConfirmPage.tsx');
    const platformsPanelPath = path.resolve(process.cwd(), 'terminal/src/shared/platforms/PlatformsPanel.tsx');
    const modelsPanelPath = path.resolve(process.cwd(), 'terminal/src/shared/models/ModelsPanel.tsx');
    const extensionRuntimePath = path.resolve(process.cwd(), 'terminal/src/shared/extensions/runtime.ts');
    const apiKeyInputPath = path.resolve(process.cwd(), 'terminal/src/commands/onboard/steps/ApiKeyInput.tsx');
    const modelConfigPath = path.resolve(process.cwd(), 'terminal/src/commands/onboard/steps/ModelConfig.tsx');
    const providerSelectPath = path.resolve(process.cwd(), 'terminal/src/commands/onboard/steps/ProviderSelect.tsx');
    const platformSelectPath = path.resolve(process.cwd(), 'terminal/src/commands/onboard/steps/PlatformSelect.tsx');
    const platformsCommandPath = path.resolve(process.cwd(), 'terminal/src/commands/platforms/App.tsx');
    const modelsCommandPath = path.resolve(process.cwd(), 'terminal/src/commands/models/App.tsx');
    const extensionCommandPath = path.resolve(process.cwd(), 'terminal/src/commands/extension/App.tsx');
    const summaryPath = path.resolve(process.cwd(), 'terminal/src/commands/onboard/steps/Summary.tsx');

    expect(fs.existsSync(inputPagePath)).toBe(true);
    expect(fs.existsSync(suggestableInputPagePath)).toBe(true);
    expect(fs.existsSync(optionPagePath)).toBe(true);
    expect(fs.existsSync(confirmPagePath)).toBe(true);
    expect(fs.existsSync(platformsPanelPath)).toBe(true);
    expect(fs.existsSync(modelsPanelPath)).toBe(true);
    expect(fs.existsSync(extensionRuntimePath)).toBe(true);

    const apiKeyInputSource = fs.readFileSync(apiKeyInputPath, 'utf8');
    const modelConfigSource = fs.readFileSync(modelConfigPath, 'utf8');
    const providerSelectSource = fs.readFileSync(providerSelectPath, 'utf8');
    const platformSelectSource = fs.readFileSync(platformSelectPath, 'utf8');
    const platformsCommandSource = fs.readFileSync(platformsCommandPath, 'utf8');
    const modelsCommandSource = fs.readFileSync(modelsCommandPath, 'utf8');
    const extensionCommandSource = fs.readFileSync(extensionCommandPath, 'utf8');
    const summarySource = fs.readFileSync(summaryPath, 'utf8');

    expect(apiKeyInputSource).toContain('ScrollableInputPage');
    expect(modelConfigSource).toContain('ModelsPanel');
    expect(providerSelectSource).toContain('OptionSelectPage');
    expect(platformSelectSource).toContain('PlatformsPanel');
    expect(platformsCommandSource).toContain('PlatformsPanel');
    expect(modelsCommandSource).toContain('OptionSelectPage');
    expect(modelsCommandSource).toContain('ModelsPanel');
    expect(extensionCommandSource).toContain('OptionSelectPage');
    expect(extensionCommandSource).toContain('InfoConfirmPage');
    expect(summarySource).toContain('InfoConfirmPage');

    const platformsPanelSource = fs.readFileSync(platformsPanelPath, 'utf8');
    expect(platformsPanelSource).not.toContain('telegramToken');
    expect(platformsPanelSource).not.toContain('wxworkBotId');
    expect(platformsPanelSource).not.toContain('larkAppId');
    expect(platformsPanelSource).not.toContain('qqWsUrl');

    const modelsPanelSource = fs.readFileSync(modelsPanelPath, 'utf8');
    expect(modelsPanelSource).not.toContain('useTextInput');
    expect(modelsPanelSource).toContain('SuggestableInputPage');
  });
});
