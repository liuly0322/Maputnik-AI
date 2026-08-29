import {test, describe, beforeEach, expect} from "./utils/fixtures";
import {MaputnikDriver} from "./maputnik-driver";
import {currentPage} from "./utils/fixtures";

const csv = "name,lon,lat,value\nA,1,2,10\nB,3,4,20";
const agentCode = (id: string) => [
  `const id = ${JSON.stringify(id)};`,
  "const dataset = datasets.get(id);",
  "const data = datasets.csv.toGeoJSON(dataset, {type: \"Point\", coordinates: [\"lon\", \"lat\"]});",
  "const visualizations = [",
  "  {name: \"value-circles\", paint: {\"circle-radius\": [\"to-number\", [\"get\", \"value\"]], \"circle-color\": \"#238b45\"}},",
  "  {name: \"highlight-circles\", paint: {\"circle-radius\": 4, \"circle-color\": \"#d95f0e\"}}",
  "];",
  "const created = visualizations.map(visualization => {",
  "  const sourceId = `agent-dataset:${id}:${visualization.name}-source`;",
  "  const layerId = `agent-dataset:${id}:${visualization.name}`;",
  "  style.sources[sourceId] = {type: \"geojson\", data};",
  "  style.layers.push({id: layerId, type: \"circle\", source: sourceId, metadata: {\"maputnik:role\": \"overlay\"}, paint: visualization.paint});",
  "  return {sourceId, layerId};",
  "});",
  "return {columns: dataset.data.columns, created};",
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

describe("datasets", () => {
  const {given, get, when, then} = new MaputnikDriver();

  beforeEach(async () => {
    await given.setupMockBackedResponses();
    await when.setStyle("");
  });

  test("uploads a CSV dataset and keeps it after reload", async () => {
    await when.click("nav:agent-workspace");
    await then(get.elementByTestId("modal:agent-workspace")).shouldExist();
    await when.click("agent-workspace:tab-data");

    await when.chooseCsvFromPicker("points.csv", csv);
    await then(get.elementByTestId("datasets:list")).shouldContainText("points.csv");
    await then(get.elementByTestId("datasets:list")).shouldContainText("2 rows");
    await then(get.elementByTestId("datasets:list")).shouldContainText("name, lon, lat, value");

    await when.modal.close("modal:agent-workspace");
    await when.setStyle("");
    await when.wait(1000);
    await when.click("nav:agent-workspace");
    await when.click("agent-workspace:tab-data");
    await then(get.elementByTestId("datasets:list")).shouldContainText("points.csv");
  });

  test("deletes an uploaded CSV dataset", async () => {
    await when.click("nav:agent-workspace");
    await when.click("agent-workspace:tab-data");
    await when.chooseCsvFromPicker("remove-me.csv", csv);

    await when.removeFirstDataset();

    await then(get.element(".maputnik-dataset-item")).shouldNotExist();
  });

  test("shows a parsing error without adding a malformed CSV dataset", async () => {
    await when.click("nav:agent-workspace");
    await when.click("agent-workspace:tab-data");

    await when.chooseCsvFromPicker("broken.csv", 'name,value\n"unterminated,1');

    await then(get.element(".maputnik-modal-error")).shouldContainText("Could not parse CSV");
    await then(get.element(".maputnik-dataset-item")).shouldNotExist();
  });

  test("shows static dataset context and creates two independent overlays from one dataset", async () => {
    const page = currentPage();
    await when.click("nav:agent-workspace");
    await when.click("agent-workspace:tab-data");
    await when.chooseCsvFromPicker("points.csv", csv);
    await when.click("agent-workspace:back-to-chat");

    await then(get.elementByTestId("agent-console:dataset-chips")).shouldContainText("points.csv");
    await then(get.elementByTestId("agent-console:dataset-chips")).shouldContainText("csv · 2 rows");
    await then(get.element("div.agent-console-dataset-chip")).shouldExist();
    await then(get.element("button.agent-console-dataset-chip")).shouldNotExist();
    await when.click("agent-console:toggle-settings");
    await when.setValue("agent-console:api-key", "test-key");
    await when.setValue("agent-console:endpoint", "http://localhost:8888/responses");
    await when.setValue("agent-console:model", "test-model");
    await mockResponsesApi(page);
    await when.setValue("agent-console:input", "Add a point layer for this dataset");
    await when.click("agent-console:send");

    await then(get.elementByTestId("agent-console:messages")).shouldContainText("value-circles");
    await then(get.elementByTestId("agent-console:messages")).shouldContainText("Layer added");
    await then(get.styleFromLocalStorage()).shouldDeepNestedInclude({
      layers: [
        {
          id: expect.stringMatching(/^agent-dataset:.*:value-circles$/),
          type: "circle",
          source: expect.stringMatching(/^agent-dataset:.*:value-circles-source$/),
          metadata: {"maputnik:role": "overlay"},
          paint: {
            "circle-radius": ["to-number", ["get", "value"]],
            "circle-color": "#238b45",
          },
        },
        {
          id: expect.stringMatching(/^agent-dataset:.*:highlight-circles$/),
          type: "circle",
          source: expect.stringMatching(/^agent-dataset:.*:highlight-circles-source$/),
          metadata: {"maputnik:role": "overlay"},
          paint: {
            "circle-radius": 4,
            "circle-color": "#d95f0e",
          },
        },
      ],
    });
    await then(
      get.styleFromLocalStorage().then(style => {
        const sourceIds = Object.keys(style.sources);
        const layerSourceIds = style.layers.map((layer: any) => layer.source);
        return {
          sourceCount: sourceIds.length,
          allSourcesMarked: sourceIds.every(id => id.startsWith("agent-dataset:")),
          distinctLayerSources: new Set(layerSourceIds).size,
          everyLayerSourceExists: layerSourceIds.every((id: string) => sourceIds.includes(id)),
        };
      })
    ).shouldDeepNestedInclude({
      sourceCount: 2,
      allSourcesMarked: true,
      distinctLayerSources: 2,
      everyLayerSourceExists: true,
    });
  });
});
