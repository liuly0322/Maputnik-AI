import {test, describe, beforeEach, expect, currentPage} from "./utils/fixtures";
import {MaputnikDriver} from "./maputnik-driver";

const csv = "name,lon,lat,value\nA,1,2,10\nB,3,4,20";

describe("datasets", () => {
  const {given, get, when, then} = new MaputnikDriver();

  beforeEach(async () => {
    await given.setupMockBackedResponses();
    await when.setStyle("");
  });

  test("uploads a CSV dataset and keeps it after reload", async () => {
    await when.openAgentWorkspace();
    await then(get.elementByTestId("agent-workspace-panel")).shouldExist();
    await when.click("agent-console-group:Data");

    await when.chooseCsvFromPicker("points.csv", csv);
    await then(get.elementByTestId("datasets:list")).shouldContainText("points.csv");
    await then(get.elementByTestId("datasets:list")).shouldContainText("2 rows");
    await then(get.elementByTestId("datasets:list")).shouldContainText("name");
    await then(get.elementByTestId("datasets:list")).shouldContainText("lon");
    await then(get.elementByTestId("datasets:list")).shouldContainText("lat");
    await then(get.elementByTestId("datasets:list")).shouldContainText("value");

    await when.modal.close("agent-workspace-panel");
    await when.setStyle("");
    await when.wait(1000);
    await when.openAgentWorkspace();
    await then(get.elementByTestId("datasets:list")).shouldContainText("points.csv");
  });

  test("deletes an uploaded CSV dataset", async () => {
    await when.openAgentWorkspace();
    await when.click("agent-console-group:Data");
    await when.chooseCsvFromPicker("remove-me.csv", csv);

    await when.removeFirstDataset();

    await then(get.element(".maputnik-dataset-item")).shouldNotExist();
  });

  test("passes the dataset catalog to the model", async () => {
    const requests: any[] = [];
    await currentPage().route("http://localhost:8888/responses", route => {
      requests.push(route.request().postDataJSON());
      return route.fulfill({contentType: "text/event-stream", body: ""});
    });

    await when.openAgentWorkspace();
    await when.click("agent-console-group:Data");
    await when.chooseCsvFromPicker("catalog.csv", csv);

    await when.click("agent-console-group:API settings");
    await when.setValue("agent-console:api-key", "test-key");
    await when.setValue("agent-console:endpoint", "http://localhost:8888/responses");
    await when.setValue("agent-console:model", "test-model");
    await when.setValue("agent-console:input", "Inspect the data");
    await when.click("agent-console:send");

    await expect.poll(() => requests.length).toBe(1);
    expect(requests[0].instructions).toContain("catalog.csv");
    expect(requests[0].instructions).toContain("lon");
  });

  test("shows a parsing error without adding a malformed CSV dataset", async () => {
    await when.openAgentWorkspace();
    await when.click("agent-console-group:Data");

    await when.chooseCsvFromPicker("broken.csv", 'name,value\n"unterminated,1');

    await then(get.element(".maputnik-modal-error")).shouldContainText("Could not parse CSV");
    await then(get.element(".maputnik-dataset-item")).shouldNotExist();
  });
});
