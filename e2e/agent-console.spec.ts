import {test, describe, beforeEach, expect} from "./utils/fixtures";
import {MaputnikDriver} from "./maputnik-driver";
import {currentPage} from "./utils/fixtures";

describe("agent console", () => {
  const {given, get, when, then} = new MaputnikDriver();

  beforeEach(async () => {
    await given.setupMockBackedResponses();
    await when.setStyle("geojson");
  });

  test("calls the Responses API and renders the assistant reply", async () => {
    const page = currentPage();
    const requestBodies: any[] = [];
    await page.route("http://localhost:8888/responses", route => {
      requestBodies.push(route.request().postDataJSON());
      return route.fulfill({
        contentType: "text/event-stream",
        body: [
          "event: response.output_text.delta",
          "data: {\"type\":\"response.output_text.delta\",\"item_id\":\"msg_1\",\"output_index\":0,\"content_index\":0,\"delta\":\"Hello from the mock agent\"}",
          "",
          "",
        ].join("\n"),
      });
    });

    await when.click("nav:agent-workspace");
    await then(get.elementByTestId("modal:agent-workspace")).shouldExist();
    await then(get.elementByTestId("agent-console:sidebar")).shouldExist();
    await then(get.elementByTestId("agent-console:chat-card")).shouldExist();
    await then(get.elementByTestId("agent-console:api-key")).shouldNotExist();

    await when.click("agent-console:toggle-sidebar");
    await then(get.elementByTestId("agent-console:api-key")).shouldNotExist();
    await when.click("agent-console:toggle-sidebar");

    await when.click("agent-console:toggle-settings");
    await when.setValue("agent-console:api-key", "test-key");
    await when.setValue("agent-console:endpoint", "http://localhost:8888/responses");
    await when.setValue("agent-console:model", "test-model");
    await when.chooseImageFromPicker("test.svg", "<svg xmlns=\"http://www.w3.org/2000/svg\"></svg>");
    await when.setValue("agent-console:input", "Inspect the map");
    await when.click("agent-console:send");

    await then(get.elementByTestId("agent-console:messages")).shouldContainText("Hello from the mock agent");
    expect(requestBodies[0].input[0].content.some((part: any) => part.type === "input_image")).toBe(true);
  });

  test("wraps long unbroken messages without widening the console", async () => {
    await when.click("nav:agent-workspace");
    await when.click("agent-console:toggle-settings");
    await when.setValue("agent-console:api-key", "test-key");
    await when.setValue("agent-console:endpoint", "http://localhost:8888/responses");
    await when.setValue("agent-console:model", "test-model");
    await when.setValue("agent-console:input", `https://example.com/${"a".repeat(1000)}`);
    await when.click("agent-console:send");

    await then(get.elementByTestId("agent-console:messages")).shouldContainText("https://example.com/");
    await then(get.elementByTestId("agent-console")).shouldNotOverflowHorizontally();
    await then(get.elementByTestId("agent-console:chat-card")).shouldNotOverflowHorizontally();
    await then(get.elementByTestId("agent-console:messages")).shouldNotOverflowHorizontally();
    await then(get.element(".maputnik-agent-workspace-modal .maputnik-modal-scroller")).shouldNotOverflowHorizontally();
  });

  test("includes the prior assistant reply in the next request", async () => {
    const page = currentPage();
    const requestBodies: any[] = [];
    await page.route("http://localhost:8888/responses", route => {
      requestBodies.push(route.request().postDataJSON());
      if (requestBodies.length === 1) {
        return route.fulfill({
          contentType: "text/event-stream",
          body: [
            "event: response.output_text.delta",
            "data: {\"type\":\"response.output_text.delta\",\"item_id\":\"msg_1\",\"output_index\":0,\"content_index\":0,\"delta\":\"First reply\"}",
            "",
            "event: response.output_item.done",
            "data: {\"type\":\"response.output_item.done\",\"output_index\":0,\"item\":{\"type\":\"message\",\"id\":\"msg_1\",\"role\":\"assistant\",\"content\":[{\"type\":\"output_text\",\"text\":\"First reply\"}]}}",
            "",
            "",
          ].join("\n"),
        });
      }
      return route.fulfill({
        contentType: "text/event-stream",
        body: [
          "event: response.output_text.delta",
          "data: {\"type\":\"response.output_text.delta\",\"item_id\":\"msg_2\",\"output_index\":0,\"content_index\":0,\"delta\":\"Second reply\"}",
          "",
          "",
        ].join("\n"),
      });
    });

    await when.click("nav:agent-workspace");
    await when.click("agent-console:toggle-settings");
    await when.setValue("agent-console:api-key", "test-key");
    await when.setValue("agent-console:endpoint", "http://localhost:8888/responses");
    await when.setValue("agent-console:model", "test-model");
    await when.setValue("agent-console:input", "First question");
    await when.click("agent-console:send");
    await then(get.elementByTestId("agent-console:generating")).shouldNotBeVisible();

    await when.setValue("agent-console:input", "Follow-up question");
    await when.click("agent-console:send");
    await then(get.elementByTestId("agent-console:generating")).shouldNotBeVisible();

    expect(requestBodies[1].input).toContainEqual(expect.objectContaining({
      type: "message",
      role: "assistant",
      content: [{type: "output_text", text: "First reply"}],
    }));
  });

  test("keeps generating in the background when the workspace is closed", async () => {
    const page = currentPage();
    await page.route("http://localhost:8888/responses", async route => {
      await new Promise(resolve => setTimeout(resolve, 1200));
      return route.fulfill({
        contentType: "text/event-stream",
        body: [
          "event: response.output_text.delta",
          "data: {\"type\":\"response.output_text.delta\",\"item_id\":\"msg_1\",\"output_index\":0,\"content_index\":0,\"delta\":\"Hello from the background agent\"}",
          "",
          "",
        ].join("\n"),
      });
    });

    await when.click("nav:agent-workspace");
    await when.click("agent-console:toggle-settings");
    await when.setValue("agent-console:api-key", "test-key");
    await when.setValue("agent-console:endpoint", "http://localhost:8888/responses");
    await when.setValue("agent-console:model", "test-model");
    await when.setValue("agent-console:input", "Inspect the map");
    await when.click("agent-console:send");

    await then(get.elementByTestId("agent-console:generating")).shouldBeVisible();
    await when.modal.close("modal:agent-workspace");
    await then(get.elementByTestId("agent-console:generating")).shouldNotBeVisible();

    await when.click("nav:agent-workspace");
    await then(get.elementByTestId("agent-console:messages")).shouldContainText("Hello from the background agent");
  });
});
