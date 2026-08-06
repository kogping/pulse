// Property names dev tooling reads to introspect a function/value without
// ever meaning to invoke it — React Fast Refresh's isLikelyComponentType
// (and friends like isReactRefreshBoundary) walk every export of every
// module a client component touches, reading these to decide "is this a
// component", entirely independent of whether the export is ever actually
// used. For a genuinely callable lazy value (client.ts's `sql`, a tagged-
// template function — `callable: false` isn't an option for it), that probe
// alone used to construct the real client and throw on a missing server-only
// env var, just from a client component importing an unrelated named export
// out of the same barrel file. Resolving these directly off the lightweight
// proxy target (never the real factory) breaks that trigger; every other
// property access still lazily constructs exactly as before.
const INTROSPECTION_ONLY_PROPS = new Set<string | symbol>(["prototype", "name", "displayName", "$$typeof"]);

// Wraps a factory in a Proxy so the wrapped value (callable or not) is only
// constructed on first actual use, not at module import time. Needed because
// constructing it eagerly would parse env vars during Next.js's build-time
// module analysis, which runs without real credentials by design.
//
// `callable` should be true only for a value that's genuinely invoked as a
// function/tagged-template (e.g. client.ts's `sql`) — pass `callable: false`
// for anything only ever used via method calls (db, redis — `.select()`,
// `.get()`, etc.), so its proxy target isn't function-shaped in the first
// place and dev tooling's component-detection skips it entirely.
export function lazy<T extends object>(factory: () => T, options: { callable?: boolean } = {}): T {
  const { callable = true } = options;
  let instance: T | undefined;
  const get = () => (instance ??= factory());

  const target = (callable ? function lazyTarget() {} : {}) as unknown as T;

  return new Proxy(target, {
    apply(_target, thisArg, args) {
      return Reflect.apply(get() as unknown as (...a: unknown[]) => unknown, thisArg, args);
    },
    get(_target, prop, receiver) {
      if (INTROSPECTION_ONLY_PROPS.has(prop)) return Reflect.get(target as object, prop, receiver);
      return Reflect.get(get() as object, prop, receiver);
    },
    has(_target, prop) {
      if (INTROSPECTION_ONLY_PROPS.has(prop)) return Reflect.has(target as object, prop);
      return Reflect.has(get() as object, prop);
    },
  });
}
