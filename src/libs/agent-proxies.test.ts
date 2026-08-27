import {describe, expect, it} from "vitest";
import {createMapProxy, createStyleProxy} from "./agent-proxies";

async function flushMicrotasks() {
  await new Promise(resolve => setTimeout(resolve, 0));
}

describe("createStyleProxy", () => {
  it("commits direct object mutations", async () => {
    const style: any = {
      layers: [
        {id: "first"},
      ],
    };
    let commits = 0;
    const proxy = createStyleProxy(style, () => {
      commits += 1;
    });

    proxy.layers.push({id: "second"});
    proxy.name = "Changed";
    await flushMicrotasks();

    expect(commits).toBe(2);
    expect(style.layers).toHaveLength(2);
    expect(style.name).toBe("Changed");
  });
});

describe("createMapProxy", () => {
  it("intercepts native mutating map methods", async () => {
    let addLayerCalled = 0;
    let commits = 0;
    const map: any = {
      addLayer() {
        addLayerCalled += 1;
      },
    } as any;
    const proxy: any = createMapProxy(map, () => {
      commits += 1;
    });

    proxy.addLayer({id: "layer"});
    await flushMicrotasks();

    expect(addLayerCalled).toBe(1);
    expect(commits).toBe(1);
  });
});
