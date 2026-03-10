/**
 * Discord 平台适配器
 *
 * 基于 discord.js 官方 SDK。
 *
 * 使用前提：
 *   1. 在 Discord Developer Portal 创建 Bot 并获取 Token
 *   2. 在 Bot 设置页开启 MESSAGE CONTENT Intent
 *   3. 将 Token 填入 config.yaml 的 platform.discord.token
 */

import { Client, GatewayIntentBits, Message, Partials } from 'discord.js';
import { PlatformAdapter, splitText } from '../base';
import { createLogger } from '../../logger';

const logger = createLogger('Discord');

const MESSAGE_MAX_LENGTH = 2000;

export interface DiscordConfig {
  token: string;
}

export class DiscordPlatform extends PlatformAdapter {
  private client: Client;
  private token: string;

  constructor(config: DiscordConfig) {
    super();
    this.token = config.token;
    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.MessageContent,
      ],
      partials: [Partials.Channel],  // 支持私信
    });
  }

  async start(): Promise<void> {
    this.client.on('ready', ()=> {
      logger.info(`已连接 | Bot: ${this.client.user?.tag}`);
    });

    this.client.on('messageCreate', (msg) => this.handleMessage(msg));

    await this.client.login(this.token);
    logger.info('平台已启动');
  }

  async stop(): Promise<void> {
    await this.client.destroy();
    logger.info('平台已停止');
 }

  async sendMessage(sessionId: string, text: string): Promise<void> {
    const channelId = sessionId.replace('discord-', '');
    const channel = await this.client.channels.fetch(channelId);
    if (!channel?.isTextBased()) return;

    const chunks = splitText(text, MESSAGE_MAX_LENGTH);
    for (const chunk of chunks) {
      await (channel as any).send(chunk);
    }
  }

  // ============ 内部方法 ============

  private async handleMessage(msg: Message): Promise<void> {
    if (msg.author.bot) return;
    if (!msg.content) return;

    const isDM = !msg.guild;
    const isMentioned = msg.mentions.has(this.client.user!);

    if (!isDM && !isMentioned) return;

    // Strip bot mention from content
    let content = msg.content;
    if (isMentioned && this.client.user) {
      content = content.replace(new RegExp(`<@!?${this.client.user.id}>`, 'g'), '').trim();
    }
    if (!content) return;

    const sessionId = `discord-${msg.channelId}`;
    if (this.messageHandler) {
      try {
        await this.messageHandler({
          sessionId,
          parts: [{ text: content }],
          platformContext: msg,
        });
      } catch (err) {
        logger.error('处理消息时出错:', err);
      }
    }
  }
}

