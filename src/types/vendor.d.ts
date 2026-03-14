/**
 * 第三方库的类型声明补充
 */

declare module 'ink-text-input' {
  import { FC } from 'react';

  interface TextInputProps {
    value: string;
    onChange: (value: string) => void;
    onSubmit?: (value: string) => void;
    placeholder?: string;
    focus?: boolean;
    mask?: string;
    showCursor?: boolean;
  }

  const TextInput: FC<TextInputProps>;
  export default TextInput;
}

declare module 'ink-gradient' {
  import { FC } from 'react';
  interface GradientProps {
    name: 'rainbow' | 'atlas' | 'crystal' | 'teen' | 'mind' | 'morning' | 'vice' | 'passion' | 'fruit' | 'instagram' | 'retro' | 'summer' | 'cool' | 'fire';
    children: React.ReactNode;
  }
  const Gradient: FC<GradientProps>;
  export default Gradient;
}

declare module 'ink-divider' {
  import { FC } from 'react';
  interface DividerProps {
    title?: string;
    width?: number;
    padding?: number;
    dividerChar?: string;
    dividerColor?: string;
    titleColor?: string;
    titlePadding?: number;
  }
  const Divider: FC<DividerProps>;
  export default Divider;
}

declare module 'marked' {
  export interface MarkedStatic {
    lexer(markdown: string): unknown[];
  }

  export const marked: MarkedStatic;
}

declare module 'cli-highlight' {
  export interface HighlightOptions {
    language?: string;
    ignoreIllegals?: boolean;
  }

  export function highlight(code: string, options?: HighlightOptions): string;
}

