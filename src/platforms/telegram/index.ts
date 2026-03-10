/**
 * Telegram 平台适配器
 *
 * 基于 grammY 官方 SDK。
 *
 * 使用前提：
 *   1. 通过 @BotFather 创建 Bot 并获取 Token
 *   2. 将 Token 填入 config.yaml 的 platform.telegram.token
 */

import { Bot, Context } from 'grammy';
import { PlatformAdapter, splitText } from '../base';
import { createLogger } from '../../logger';

const logger = createLogger('Telegram');

const MESSAGE_MAX_LENGTH = 4096;

export interface TelegramConfig {
  token: string;
}

export class TelegramPlatform extends PlatformAdapter {
  private bot: Bot;

  constructor(config: TelegramConfig) {
    super();
    this.bot = new Bot(config.token);
  }

  async start(): Promise<void> {
    this.bot.on('message:text', (ctx) => this.handleMessage(ctx));

    // 启动 long polling
    this.bot.start({
      onStart: (info) => {
        logger.info(`已连接 | Bot: ${info.username}`);
      },
    });

    logger.info('平台已启动');
  }

  async stop(): Promise<void> {
    await this.bot.stop();
    logger.info('平台已停止');
  }

  async sendMessage(sessionId: string, text: string): Promise<void> {
    const chatId = sessionId.replace('telegram-', '');
    const chunks = splitText(text, MESSAGE_MAX_LENGTH);
    for (const chunk of chunks) {
      await this.bot.api.sendMessage(chatId, chunk);
    }
  }

  // ============ 内部方法 ============

  private async handleMessage(ctx: Context): Promise<void> {
    const text = ctx.message?.text;
    if (!text) return;

    const chatId = ctx.chat?.id;
    if (!chatId) return;

    const sessionId = `telegram-${chatId}`;
    if (this.messageHandler) {
      try {
        await this.messageHandler({
          sessionId,
          parts: [{ text }],
          platformContext: ctx,
        });
      } catch (err) {
        logger.error('处理消息时出错:', err);
      }
    }
  }
}
