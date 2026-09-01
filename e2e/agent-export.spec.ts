import {test, describe, beforeEach, expect} from "./utils/fixtures";
import {MaputnikDriver} from "./maputnik-driver";
import {currentPage} from "./utils/fixtures";

describe("agent export", () => {
  const {given, when} = new MaputnikDriver();

  beforeEach(async () => {
    await given.setupMockBackedResponses();
    await when.setStyle("agent_export");
  });

  test("downloads base and overlay PNGs", async () => {
    const downloadNames: string[] = [];
    currentPage().on("download", download => downloadNames.push(download.suggestedFilename()));

    await when.click("nav:agent-workspace");
    await when.click("agent-workspace:tab-export");
    await when.click("agent-export:both");

    await expect.poll(() => downloadNames.length).toBe(2);
    expect(downloadNames).toEqual([
      "test_style-base.png",
      "test_style-overlay.png",
    ]);
  });
});
