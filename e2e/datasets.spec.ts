import {test, describe, beforeEach} from "./utils/fixtures";
import {MaputnikDriver} from "./maputnik-driver";

const csv = "name,lon,lat,value\nA,1,2,10\nB,3,4,20";

describe("datasets", () => {
  const {given, get, when, then} = new MaputnikDriver();

  beforeEach(async () => {
    await given.setupMockBackedResponses();
    await when.setStyle("");
  });

  test("uploads a CSV dataset, shows its chat context, and keeps it after reload", async () => {
    await when.click("nav:agent-workspace");
    await then(get.elementByTestId("modal:agent-workspace")).shouldExist();
    await when.click("agent-workspace:tab-data");

    await when.chooseCsvFromPicker("points.csv", csv);
    await then(get.elementByTestId("datasets:list")).shouldContainText("points.csv");
    await then(get.elementByTestId("datasets:list")).shouldContainText("2 rows");
    await then(get.elementByTestId("datasets:list")).shouldContainText("name, lon, lat, value");

    await when.click("agent-workspace:back-to-chat");
    await then(get.elementByTestId("agent-console:dataset-chips")).shouldContainText("points.csv");
    await then(get.elementByTestId("agent-console:dataset-chips")).shouldContainText("csv · 2 rows");
    await then(get.element("div.agent-console-dataset-chip")).shouldExist();
    await then(get.element("button.agent-console-dataset-chip")).shouldNotExist();

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
});
