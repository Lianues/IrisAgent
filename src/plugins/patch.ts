/**
 * 通用 monkey-patch 工具
 *
 * 让插件可以安全地替换任意对象上的方法，支持链式叠加和自动恢复。
 *
 * 用法：
 *   const dispose = patchMethod(backend, 'chat', async (original, ...args) => {
 *     console.log('before chat');
 *     const result = await original(...args);
 *     console.log('after chat');
 *     return result;
 *   });
 *
 *   // 恢复原始方法
 *   dispose();
 */

/** 拆解函数参数和返回值 */
type AnyFunction = (...args: any[]) => any;

/** 包装器类型：接收 original 和原始参数，返回相同类型 */
type MethodWrapper<T extends AnyFunction> = (
  original: T,
  ...args: Parameters<T>
) => ReturnType<T>;

/** 释放函数：调用后恢复原始方法 */
export type PatchDisposer = () => void;

/**
 * 替换对象上的方法。
 *
 * wrapper 接收 original 作为第一个参数，后续参数与原始方法一致。
 * 可多次对同一方法调用，形成洋葱式调用链。
 * 返回的 dispose 函数可以恢复到本次 patch 前的状态。
 *
 * @example
 *   const dispose = patchMethod(backend, 'chat', async (original, sessionId, text) => {
 *     console.log(`chat called: session=${sessionId}`);
 *     return original(sessionId, text);
 *   });
 */
export function patchMethod<
  TTarget extends Record<string, any>,
  TKey extends keyof TTarget,
>(
  target: TTarget,
  methodName: TKey,
  wrapper: TTarget[TKey] extends AnyFunction
    ? MethodWrapper<TTarget[TKey]>
    : never,
): PatchDisposer {
  const original = target[methodName] as unknown as AnyFunction;
  if (typeof original !== 'function') {
    throw new Error(`patchMethod: ${String(methodName)} 不是一个函数`);
  }

  const bound = original.bind(target);
  const patched = function (this: any, ...args: any[]) {
    return (wrapper as any)(bound, ...args);
  };

  // 保留原始函数的名称，方便调试
  Object.defineProperty(patched, 'name', {
    value: `patched_${String(methodName)}`,
    configurable: true,
  });

  (target as any)[methodName] = patched;

  let disposed = false;
  return () => {
    if (disposed) return;
    disposed = true;
    // 只有当前 patch 仍然在位时才恢复，避免覆盖后续 patch
    if ((target as any)[methodName] === patched) {
      (target as any)[methodName] = original;
    }
  };
}

/**
 * 替换对象原型上的方法。
 * 影响该类的所有实例。
 */
export function patchPrototype<
  TTarget extends Record<string, any>,
  TKey extends keyof TTarget,
>(
  targetClass: new (...args: any[]) => TTarget,
  methodName: TKey,
  wrapper: TTarget[TKey] extends AnyFunction
    ? MethodWrapper<TTarget[TKey]>
    : never,
): PatchDisposer {
  return patchMethod(targetClass.prototype, methodName, wrapper as any);
}
