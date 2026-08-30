import {test, describe, beforeEach, expect} from "./utils/fixtures";
import {MaputnikDriver} from "./maputnik-driver";
import {currentPage} from "./utils/fixtures";

describe("agent export", () => {
  const {given, get, when, then} = new MaputnikDriver();

  beforeEach(async () => {
    await given.setupMockBackedResponses();
    await when.setStyle("agent_export");
  });

  test("exports base and overlay PNGs for marked overlay layers", async () => {
    const downloadNames: string[] = [];
    currentPage().on("download", download => downloadNames.push(download.suggestedFilename()));

    await when.click("nav:agent-workspace");
    await when.click("agent-workspace:tab-export");
    await then(get.elementByTestId("agent-workspace:export")).shouldExist();
    await then(get.elementByTestId("agent-export:map-status")).shouldContainText("Live map is attached.");

    await when.click("agent-export:both");

    await expect.poll(() => downloadNames.length).toBe(2);
    await then(get.elementByTestId("agent-export:status")).shouldContainText("Export complete");
    expect(downloadNames).toEqual([
      "test_style-base.png",
      "test_style-overlay.png",
    ]);
  });
});
