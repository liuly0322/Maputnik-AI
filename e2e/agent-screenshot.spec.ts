import {test, describe, beforeEach, expect} from "./utils/fixtures";
import {MaputnikDriver} from "./maputnik-driver";

describe("agent screenshots", () => {
  const {given, when, get, then} = new MaputnikDriver();
  const endpoint = "http://localhost:8888/responses";

  beforeEach(async () => {
    await given.setupMockBackedResponses();
    await when.setViewportSize(2000, 1200);
    await when.setStyle("geojson");
  });

  test("returns a bounded image of the changed live map for the next model round", async () => {
    const code = 'map.addLayer({id: "screenshot-background", type: "background", paint: {"background-color": "#ff0000"}}); return "Updated";';
    const requests = await given.mockEventStream(endpoint, [[
      {type: "response.output_item.done", item: {id: "js", type: "function_call", call_id: "change", name: "run_javascript", arguments: JSON.stringify({code})}},
      {type: "response.output_item.done", item: {id: "capture", type: "function_call", call_id: "screenshot", name: "capture_map_screenshot", arguments: "{}"}},
    ], [
      {type: "response.output_item.done", item: {id: "reply", type: "message", role: "assistant", content: [{type: "output_text", text: "Screenshot checked"}]}},
    ]]);

    await when.openAgentWorkspace();
    await when.click("agent-console-group:API settings");
    await when.setValue("agent-console:api-key", "test-key");
    await when.setValue("agent-console:endpoint", endpoint);
    await when.setValue("agent-console:model", "test-model");
    await when.setValue("agent-console:input", "Change the map and check a screenshot");
    await when.click("agent-console:send");

    await then(get.elementByTestId("agent-console:messages")).shouldContainText("Screenshot checked");
    expect(requests).toHaveLength(2);
    expect(requests[0].tools.map((tool: any) => tool.name)).toContain("capture_map_screenshot");
    const result = requests[1].input.find((item: any) => item.type === "function_call_output" && item.call_id === "screenshot");
    expect(result.output[1]).toMatchObject({type: "input_image", detail: "auto"});
    expect(result.output[1].image_url).toMatch(/^data:image\/jpeg;base64,/);
    expect(result.output[1].image_url.length).toBeLessThanOrEqual(256 * 1024);
    const metadata = JSON.parse(result.output[0].text);
    expect(Math.max(metadata.width, metadata.height)).toBe(1024);

    await when.click("agent-console:tool-details-toggle");
    await then(get.elementByTestId("agent-console:tool-screenshot")).shouldBeVisible();
    const image = await get.imageDetails("agent-console:tool-screenshot").get();
    expect(image.width).toBe(metadata.width);
    expect(image.height).toBe(metadata.height);
    // A real red map frame, rather than a stale or cleared WebGL buffer.
    expect(image.centerPixel[0]).toBeGreaterThan(240);
    expect(image.centerPixel[1]).toBeLessThan(15);
    expect(image.centerPixel[2]).toBeLessThan(15);
    await then(get.styleFromLocalStorage()).shouldDeepNestedInclude({layers: [{
      id: "screenshot-background", type: "background", paint: {"background-color": "#ff0000"},
    }]});
  });
});
