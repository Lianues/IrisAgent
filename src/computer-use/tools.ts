/**
 * Computer Use 工具定义
 *
 * 将 Computer 接口包装为 LLM 可调用的 ToolDefinition。
 * 每个 Gemini 预定义函数对应一个工具，走普通 function calling 路径。
 *
 * 坐标约定：LLM 输出 0-999 归一化坐标，handler 内部完成反归一化。
 */

import { ToolDefinition } from '../types';
import type { Computer, EnvState } from './types';
import { denormalizeX, denormalizeY } from './coordinator';

/**
 * 将 EnvState 转为 handler 返回值。
 *
 * 使用 scheduler 的通用 __response / __parts 约定字段。
 * scheduler 会将 __parts（InlineDataPart[]）放入 functionResponse.parts，
 * 使截图作为多模态内联数据回传给模型。
 */
function toResult(state: EnvState): unknown {
  return {
    __response: { url: state.url },
    __parts: [{
      inlineData: {
        mimeType: 'image/png',
        data: state.screenshot.toString('base64'),
      },
    }],
  };
}

/** Computer Use 预定义函数名集合（与 Gemini 官方一致） */
export const COMPUTER_USE_FUNCTION_NAMES = new Set([
  'open_web_browser', 'click_at', 'hover_at', 'type_text_at',
  'scroll_document', 'scroll_at', 'key_combination', 'navigate',
  'go_back', 'go_forward', 'search', 'wait_5_seconds', 'drag_and_drop',
]);

/**
 * 创建全部 Computer Use 工具定义。
 *
 * @param computer 执行环境实例
 * @param excludedFunctions 需要排除的函数名
 */
export function createComputerUseTools(
  computer: Computer,
  excludedFunctions?: string[],
): ToolDefinition[] {
  const excluded = new Set(excludedFunctions ?? []);
  /** 每次调用实时获取屏幕/窗口尺寸，适应窗口大小变化 */
  const sz = () => computer.screenSize();

  const all: ToolDefinition[] = [
    // ---- 浏览器导航 ----
    {
      declaration: {
        name: 'open_web_browser',
        description: '打开浏览器并返回当前屏幕截图。',
      },
      handler: async () => toResult(await computer.openWebBrowser()),
    },
    {
      declaration: {
        name: 'go_back',
        description: '浏览器后退到上一页。',
      },
      handler: async () => toResult(await computer.goBack()),
    },
    {
      declaration: {
        name: 'go_forward',
        description: '浏览器前进到下一页。',
      },
      handler: async () => toResult(await computer.goForward()),
    },
    {
      declaration: {
        name: 'search',
        description: '导航到搜索引擎首页。在需要从新的搜索开始时使用。',
      },
      handler: async () => toResult(await computer.search()),
    },
    {
      declaration: {
        name: 'navigate',
        description: '导航到指定 URL。',
        parameters: {
          type: 'object',
          properties: {
            url: { type: 'string', description: '目标 URL' },
          },
          required: ['url'],
        },
      },
      handler: async (args) => toResult(await computer.navigate(args.url as string)),
    },
    {
      declaration: {
        name: 'wait_5_seconds',
        description: '等待 5 秒，让页面完成加载或动画。',
      },
      handler: async () => toResult(await computer.wait5Seconds()),
    },

    // ---- 鼠标操作 ----
    {
      declaration: {
        name: 'click_at',
        description: '点击屏幕上的指定位置。x 和 y 为 0-999 的归一化坐标，按比例映射到屏幕实际像素。',
        parameters: {
          type: 'object',
          properties: {
            x: { type: 'number', description: 'X 坐标 (0-999)' },
            y: { type: 'number', description: 'Y 坐标 (0-999)' },
          },
          required: ['x', 'y'],
        },
      },
      handler: async (args) => {
        const [sw, sh] = sz();
        return toResult(await computer.clickAt(
          denormalizeX(args.x as number, sw),
          denormalizeY(args.y as number, sh),
        ));
      },
    },
    {
      declaration: {
        name: 'hover_at',
        description: '将鼠标悬停在指定位置。可用于展开悬停子菜单。x 和 y 为 0-999 的归一化坐标。',
        parameters: {
          type: 'object',
          properties: {
            x: { type: 'number', description: 'X 坐标 (0-999)' },
            y: { type: 'number', description: 'Y 坐标 (0-999)' },
          },
          required: ['x', 'y'],
        },
      },
      handler: async (args) => {
        const [sw, sh] = sz();
        return toResult(await computer.hoverAt(
          denormalizeX(args.x as number, sw),
          denormalizeY(args.y as number, sh),
        ));
      },
    },
    {
      declaration: {
        name: 'drag_and_drop',
        description: '将元素从起始坐标拖放到目标坐标。所有坐标为 0-999 的归一化值。',
        parameters: {
          type: 'object',
          properties: {
            x: { type: 'number', description: '起始 X 坐标 (0-999)' },
            y: { type: 'number', description: '起始 Y 坐标 (0-999)' },
            destination_x: { type: 'number', description: '目标 X 坐标 (0-999)' },
            destination_y: { type: 'number', description: '目标 Y 坐标 (0-999)' },
          },
          required: ['x', 'y', 'destination_x', 'destination_y'],
        },
      },
      handler: async (args) => {
        const [sw, sh] = sz();
        return toResult(await computer.dragAndDrop(
          denormalizeX(args.x as number, sw),
          denormalizeY(args.y as number, sh),
          denormalizeX(args.destination_x as number, sw),
          denormalizeY(args.destination_y as number, sh),
        ));
      },
    },

    // ---- 键盘操作 ----
    {
      declaration: {
        name: 'type_text_at',
        description: [
          '在指定位置输入文本。',
          '默认先清空已有内容再输入，输入后默认按回车。',
          'x 和 y 为 0-999 的归一化坐标。',
        ].join(''),
        parameters: {
          type: 'object',
          properties: {
            x: { type: 'number', description: 'X 坐标 (0-999)' },
            y: { type: 'number', description: 'Y 坐标 (0-999)' },
            text: { type: 'string', description: '要输入的文本' },
            press_enter: { type: 'boolean', description: '输入后是否按回车，默认 true' },
            clear_before_typing: { type: 'boolean', description: '输入前是否清空已有内容，默认 true' },
          },
          required: ['x', 'y', 'text'],
        },
      },
      handler: async (args) => {
        const [sw, sh] = sz();
        return toResult(await computer.typeTextAt(
          denormalizeX(args.x as number, sw),
          denormalizeY(args.y as number, sh),
          args.text as string,
          (args.press_enter as boolean | undefined) ?? true,
          (args.clear_before_typing as boolean | undefined) ?? true,
        ));
      },
    },
    {
      declaration: {
        name: 'key_combination',
        description: '按下键盘按键或组合键。例如 "Control+C"、"Enter"、"Alt+Tab"。多个键用 "+" 连接。',
        parameters: {
          type: 'object',
          properties: {
            keys: { type: 'string', description: '按键描述，如 "Enter"、"Control+C"、"Alt+F4"' },
          },
          required: ['keys'],
        },
      },
      handler: async (args) => {
        const keys = (args.keys as string).split('+').map(k => k.trim());
        return toResult(await computer.keyCombination(keys));
      },
    },

    // ---- 滚动 ----
    {
      declaration: {
        name: 'scroll_document',
        description: '滚动整个页面。direction 可选 "up"、"down"、"left"、"right"。',
        parameters: {
          type: 'object',
          properties: {
            direction: { type: 'string', description: '滚动方向: up / down / left / right' },
          },
          required: ['direction'],
        },
      },
      handler: async (args) => toResult(
        await computer.scrollDocument(args.direction as 'up' | 'down' | 'left' | 'right'),
      ),
    },
    {
      declaration: {
        name: 'scroll_at',
        description: [
          '在指定位置按方向滚动指定幅度。',
          '坐标和幅度均为 0-999 的归一化值。默认幅度 800。',
        ].join(''),
        parameters: {
          type: 'object',
          properties: {
            x: { type: 'number', description: 'X 坐标 (0-999)' },
            y: { type: 'number', description: 'Y 坐标 (0-999)' },
            direction: { type: 'string', description: '滚动方向: up / down / left / right' },
            magnitude: { type: 'number', description: '滚动幅度 (0-999)，默认 800' },
          },
          required: ['x', 'y', 'direction'],
        },
      },
      handler: async (args) => {
        const direction = args.direction as 'up' | 'down' | 'left' | 'right';
        const rawMagnitude = (args.magnitude as number | undefined) ?? 800;
        const [sw, sh] = sz();
        // magnitude 也是归一化值，需要按方向反归一化
        const magnitude = (direction === 'up' || direction === 'down')
          ? denormalizeY(rawMagnitude, sh)
          : denormalizeX(rawMagnitude, sw);
        return toResult(await computer.scrollAt(
          denormalizeX(args.x as number, sw),
          denormalizeY(args.y as number, sh),
          direction,
          magnitude,
        ));
      },
    },
  ];

  return all.filter(t => !excluded.has(t.declaration.name));
}
