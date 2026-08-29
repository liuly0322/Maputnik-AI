import {test, describe, beforeEach, expect} from "./utils/fixtures";
import {MaputnikDriver} from "./maputnik-driver";
import {currentPage} from "./utils/fixtures";

const csv = "name,lon,lat,value\nA,1,2,10\nB,3,4,20";
const agentCode = (id: string) => [
  `const id = ${JSON.stringify(id)};`,
  "const dataset = datasets.get(id);",
  "const data = datasets.csv.toGeoJSON(dataset, {type: \"Point\", coordinates: [\"lon\", \"lat\"]});",
  "const created = [\"values\", \"highlights\"].map((name, index) => {",
  "  const sourceId = `agent-dataset:${id}:${name}-source`;",
  "  const layerId = `agent-dataset:${id}:${name}`;",
  "  style.sources[sourceId] = {type: \"geojson\", data};",
  "  style.layers.push({id: layerId, type: \"circle\", source: sourceId, metadata: {\"maputnik:role\": \"overlay\"}, paint: {\"circle-radius\": index + 4}});",
  "  return {sourceId, layerId};",
  "});",
  "return {created};",
].join("\n");

async function mockResponsesApi(page: any) {
  await page.route("http://localhost:8888/responses", (route: any) => {
    const request = route.request();
    const body = request.postDataJSON();
    const hasFunctionCallOutput = (body.input ?? []).some((item: any) => item.type === "function_call_output");
    if (hasFunctionCallOutput) {
      return route.fulfill({
        contentType: "text/event-stream",
        body: [
          "event: response.output_text.delta",
          "data: {\"type\":\"response.output_text.delta\",\"item_id\":\"msg_2\",\"output_index\":0,\"content_index\":0,\"delta\":\"Layer added\"}",
          "",
          "",
        ].join("\n"),
      });
    }
    const catalog = JSON.parse(body.instructions.split("# Dataset catalog\n\n")[1]);
    const code = agentCode(catalog[0].id);
    return route.fulfill({
      contentType: "text/event-stream",
      body: [
        "event: response.output_item.done",
        `data: {"type":"response.output_item.done","output_index":0,"item":{"type":"function_call","call_id":"call_1","name":"run_javascript","arguments":${JSON.stringify(JSON.stringify({code}))}}}`,
        "",
        "",
      ].join("\n"),
    });
  });
}

describe("agent export", () => {
  const {given, get, when, then} = new MaputnikDriver();

  beforeEach(async () => {
    await given.setupMockBackedResponses();
    await when.setStyle("layer");
  });

  test("exports base and overlay PNGs for agent dataset layers", async () => {
    const page = currentPage();
    await when.click("nav:agent-workspace");
    await when.click("agent-workspace:tab-data");
    await when.chooseCsvFromPicker("points.csv", csv);
    await when.click("agent-workspace:back-to-chat");

    await when.click("agent-console:toggle-settings");
    await when.setValue("agent-console:api-key", "test-key");
    await when.setValue("agent-console:endpoint", "http://localhost:8888/responses");
    await when.setValue("agent-console:model", "test-model");
    await mockResponsesApi(page);
    await when.setValue("agent-console:input", "Add a point layer for this dataset");
    await when.click("agent-console:send");

    await then(get.elementByTestId("agent-console:messages")).shouldContainText("Layer added");
    await when.click("agent-workspace:tab-export");
    await then(get.elementByTestId("agent-workspace:export")).shouldExist();

    const firstDownload = page.waitForEvent("download");
    await when.click("agent-export:both");
    const baseDownload = await firstDownload;
    const secondDownload = page.waitForEvent("download");
    const overlayDownload = await secondDownload;
    expect(baseDownload.suggestedFilename()).toBe("test_style-base.png");
    expect(overlayDownload.suggestedFilename()).toBe("test_style-overlay.png");

    await then(get.styleFromLocalStorage()).shouldDeepNestedInclude({
      layers: [
        {id: "background", type: "background"},
        {
          id: expect.stringMatching(/^agent-dataset:.*:values$/),
          source: expect.stringMatching(/^agent-dataset:.*:values-source$/),
          metadata: {"maputnik:role": "overlay"},
        },
        {
          id: expect.stringMatching(/^agent-dataset:.*:highlights$/),
          source: expect.stringMatching(/^agent-dataset:.*:highlights-source$/),
          metadata: {"maputnik:role": "overlay"},
        },
      ],
    });
  });
});
