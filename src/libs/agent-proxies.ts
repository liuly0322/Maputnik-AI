import type {Map} from "maplibre-gl";

type CommitFn = () => void;

const MUTATING_MAP_METHODS = new Set([
  "setStyle",
  "addSource",
  "addLayer",
  "removeSource",
  "removeLayer",
  "setLayerZoomRange",
  "setFilter",
  "setPaintProperty",
  "setLayoutProperty",
  "moveLayer",
  "setData",
  "removeFeatureState",
]);

const MUTATING_ARRAY_METHODS = new Set([
  "push",
  "pop",
  "shift",
  "unshift",
  "splice",
  "sort",
  "reverse",
  "fill",
  "copyWithin",
]);

export function createBatchScheduler(callback: CommitFn): CommitFn {
  let scheduled = false;
  return () => {
    if (scheduled) return;
    scheduled = true;
    const run = () => {
      scheduled = false;
      callback();
    };
    if (typeof queueMicrotask === "function") {
      queueMicrotask(run);
    }
    else {
      Promise.resolve().then(run);
    }
  };
}

export function createStyleProxy<T extends object>(target: T, commit: CommitFn): T {
  const seen = new WeakMap<object, object>();

  const proxyValue = (value: unknown): unknown => {
    if (value === null || typeof value !== "object") {
      return value;
    }
    if (seen.has(value)) {
      return seen.get(value);
    }

    const proxy = new Proxy(value, {
      get(object: any, property: string | symbol, receiver: any) {
        const currentValue = Reflect.get(object, property, receiver);
        if (Array.isArray(object) && typeof property === "string" && MUTATING_ARRAY_METHODS.has(property)) {
          return (...args: unknown[]) => {
            const result = (currentValue as (...args: unknown[]) => unknown).apply(object, args);
            commit();
            return result;
          };
        }
        return proxyValue(currentValue);
      },
      set(object: any, property: string | symbol, value: unknown) {
        const result = Reflect.set(object, property, value);
        commit();
        return result;
      },
      deleteProperty(object: any, property: string | symbol) {
        const result = Reflect.deleteProperty(object, property);
        if (result) {
          commit();
        }
        return result;
      },
    });

    seen.set(value, proxy);
    return proxy;
  };

  return proxyValue(target) as T;
}

export function createMapProxy(map: Map, commit: CommitFn): Map {
  return new Proxy(map, {
    get(target: Map, property: string | symbol, receiver: any) {
      const value = Reflect.get(target, property, receiver);
      if (typeof value === "function" && typeof property === "string" && MUTATING_MAP_METHODS.has(property)) {
        return (...args: unknown[]) => {
          const result = (value as (...args: unknown[]) => unknown).apply(target, args);
          commit();
          return result;
        };
      }
      return value;
    },
  });
}
