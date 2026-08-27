import {test, describe, beforeEach} from "./utils/fixtures";
import {MaputnikDriver} from "./maputnik-driver";
import {currentPage} from "./utils/fixtures";

const csv = "name,lon,lat,value\nA,1,2,10\nB,3,4,20";
const agentCode = [
  "const id = runtime.datasets.list()[0].id;",
  "log(runtime.datasets.columns(id).join(\",\"));",
  "runtime.addDatasetLayer(id, {",
  "  geometry: { type: \"Point\", coordinates: [\"lon\", \"lat\"] },",
  "  type: \"circle\",",
  "  paint: { \"circle-radius\": [\"get\", \"value\"] }",
  "});",
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
    return route.fulfill({
      contentType: "text/event-stream",
      body: [
        "event: response.output_item.done",
        `data: {"type":"response.output_item.done","output_index":0,"item":{"type":"function_call","call_id":"call_1","name":"run_javascript","arguments":${JSON.stringify(JSON.stringify({code: agentCode}))}}}`,
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
    await then(get.elementByTestId("datasets:list")).shouldContainText("name, lon, lat, value");

    await when.modal.close("modal:agent-workspace");
    await when.setStyle("");
    await when.wait(1000);
    await when.click("nav:agent-workspace");
    await when.click("agent-workspace:tab-data");
    await then(get.elementByTestId("datasets:list")).shouldContainText("points.csv");
  });

  test("exposes dataset columns and adds a dataset layer from the Agent Console", async () => {
    const page = currentPage();
    await when.click("nav:agent-workspace");
    await when.click("agent-workspace:tab-data");
    await when.chooseCsvFromPicker("points.csv", csv);
    await when.click("agent-workspace:back-to-chat");

    await then(get.elementByTestId("agent-console:dataset-chips")).shouldContainText("points.csv");
    await when.click("agent-console:toggle-settings");
    await when.setValue("agent-console:api-key", "test-key");
    await when.setValue("agent-console:endpoint", "http://localhost:8888/responses");
    await when.setValue("agent-console:model", "test-model");
    await mockResponsesApi(page);
    await when.setValue("agent-console:input", "Add a point layer for this dataset");
    await when.click("agent-console:send");

    await then(get.elementByTestId("agent-console:messages")).shouldContainText("name,lon,lat,value");
    await then(get.elementByTestId("agent-console:messages")).shouldContainText("Layer added");
    await then(get.styleFromLocalStorage()).shouldDeepNestedInclude({
      layers: [
        {
          type: "circle",
          paint: {
            "circle-radius": ["get", "value"],
          },
        },
      ],
    });
    await then(
      get.styleFromLocalStorage().then(style => Object.keys(style.sources).some(key => key.startsWith("agent-dataset:")))
    ).shouldEqual(true);
  });
});
