// Wraps a factory in a Proxy so the wrapped value (callable or not) is only
// constructed on first actual use, not at module import time. Needed because
// constructing it eagerly would parse env vars during Next.js's build-time
// module analysis, which runs without real credentials by design.
export function lazy<T extends object>(factory: () => T): T {
  let instance: T | undefined;
  const get = () => (instance ??= factory());

  return new Proxy(function lazyTarget() {} as unknown as T, {
    apply(_target, thisArg, args) {
      return Reflect.apply(get() as unknown as (...a: unknown[]) => unknown, thisArg, args);
    },
    get(_target, prop, receiver) {
      return Reflect.get(get() as object, prop, receiver);
    },
    has(_target, prop) {
      return Reflect.has(get() as object, prop);
    },
  });
}
