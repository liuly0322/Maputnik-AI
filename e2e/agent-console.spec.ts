import {test, describe, beforeEach, expect} from "./utils/fixtures";
import {MaputnikDriver} from "./maputnik-driver";
import {currentPage} from "./utils/fixtures";

describe("agent console", () => {
  const {given, get, when, then} = new MaputnikDriver();

  beforeEach(async () => {
    await given.setupMockBackedResponses();
    await when.setStyle("geojson");
  });

  test("treats the legacy mbgljs renderer as MapLibre", async () => {
    await when.setStyle("legacy_mbgljs");
    await when.click("nav:agent-workspace");

    await then(get.elementByTestId("agent-console:map-status")).shouldContainText("Live map is attached.");
    await when.click("agent-workspace:tab-export");
    await then(get.elementByTestId("agent-export:map-status")).shouldContainText("Live map is attached.");
  });

  test("explains that live map access is unavailable with OpenLayers", async () => {
    await when.click("nav:settings");
    await when.select("modal:settings.maputnik:renderer", "ol");
    await when.modal.close("modal:settings");
    await when.click("nav:agent-workspace");

    const message = "Live map access requires the MapLibreGL JS renderer. Switch the style renderer in Settings.";
    await then(get.elementByTestId("agent-console:map-status")).shouldContainText(message);
    await when.click("agent-workspace:tab-export");
    await then(get.elementByTestId("agent-export:map-status")).shouldContainText(message);
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

  test("creates a session when sending with no current conversation", async () => {
    const page = currentPage();
    await page.route("http://localhost:8888/responses", route => route.fulfill({
      contentType: "text/event-stream",
      body: "",
    }));

    await when.click("nav:agent-workspace");
    await then(get.elementByTestId("agent-console:sessions")).shouldContainText("No sessions yet.");
    await when.click("agent-console:toggle-settings");
    await when.setValue("agent-console:api-key", "test-key");
    await when.setValue("agent-console:endpoint", "http://localhost:8888/responses");
    await when.setValue("agent-console:model", "test-model");
    await when.setValue("agent-console:input", "Create this conversation automatically");
    await when.click("agent-console:send");

    await then(get.elementByTestId("agent-console:generating")).shouldNotBeVisible();
    await then(get.elementByTestId("agent-console:sessions")).shouldContainText("Create this conversation automatically");
    await then(get.elementByTestId("agent-console:messages")).shouldContainText("Create this conversation automatically");
    await then(get.element(".agent-console-session--active")).shouldExist();
  });

  test("stops a streaming reply and keeps the partial text", async () => {
    const page = currentPage();
    await page.evaluate(() => {
      const originalFetch = window.fetch.bind(window);
      window.fetch = (input, init) => {
        const url = input instanceof Request ? input.url : String(input);
        if (url !== "http://localhost:8888/responses") return originalFetch(input, init);

        const signal = init?.signal;
        const encoder = new TextEncoder();
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(encoder.encode([
              "event: response.output_text.delta",
              "data: {\"type\":\"response.output_text.delta\",\"item_id\":\"msg_partial\",\"delta\":\"Partial reply from the agent\"}",
              "",
              "",
            ].join("\n")));
            signal?.addEventListener("abort", () => controller.error(signal.reason), {once: true});
          },
        });
        return Promise.resolve(new Response(body, {
          headers: {"Content-Type": "text/event-stream"},
        }));
      };
    });

    await when.click("nav:agent-workspace");
    await when.click("agent-console:toggle-settings");
    await when.setValue("agent-console:api-key", "test-key");
    await when.setValue("agent-console:endpoint", "http://localhost:8888/responses");
    await when.setValue("agent-console:model", "test-model");
    await when.setValue("agent-console:input", "Start a long reply");
    await when.click("agent-console:send");

    await then(get.elementByTestId("agent-console:messages")).shouldContainText("Partial reply from the agent");
    await then(get.elementByTestId("agent-console:stop")).shouldBeVisible();
    await then(get.element("[data-wd-key='agent-console:stop'] svg")).shouldExist();
    await when.click("agent-console:stop");

    await then(get.elementByTestId("agent-console:stop")).shouldNotBeVisible();
    await then(get.elementByTestId("agent-console:send")).shouldBeVisible();
    await then(get.elementByTestId("agent-console:generating")).shouldNotBeVisible();
    await then(get.elementByTestId("agent-console:messages")).shouldContainText("Partial reply from the agent");
    await then(get.elementByTestId("agent-console:error")).shouldNotExist();
    await then(get.elementByTestId("agent-console:restore-style")).shouldBeVisible();
  });

  test("persists per-session style checkpoints and restores them only on request", async () => {
    const page = currentPage();
    const changedStyleName = "Changed by second session";
    await page.route("http://localhost:8888/responses", async route => {
      const body = route.request().postDataJSON();
      const serializedInput = JSON.stringify(body.input ?? []);
      const hasFunctionCallOutput = (body.input ?? []).some((item: any) => item.type === "function_call_output");

      if (serializedInput.includes("Wait without changing the style")) {
        await new Promise(resolve => setTimeout(resolve, 1200));
        return route.fulfill({contentType: "text/event-stream", body: ""});
      }
      if (!serializedInput.includes("Change the style for session two")) {
        return route.fulfill({contentType: "text/event-stream", body: ""});
      }
      if (hasFunctionCallOutput) {
        return route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({error: {message: "Mock failure after style change"}}),
        });
      }

      const code = `style.name = ${JSON.stringify(changedStyleName)}; return style.name;`;
      return route.fulfill({
        contentType: "text/event-stream",
        body: [
          "event: response.output_item.done",
          `data: {"type":"response.output_item.done","output_index":0,"item":{"type":"function_call","call_id":"change_style","name":"run_javascript","arguments":${JSON.stringify(JSON.stringify({code}))}}}`,
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
    await when.setValue("agent-console:input", "Save original style");
    await when.click("agent-console:send");

    await then(get.elementByTestId("agent-console:restore-style")).shouldBeVisible();
    await when.setValue("agent-console:input", "Wait without changing the style");
    await when.click("agent-console:send");
    expect(await get.elementAttribute("agent-console:restore-style", "disabled").get()).toBe("");
    await then(get.elementByTestId("agent-console:send")).shouldBeVisible();

    await when.click("agent-console:new-session");
    await then(get.elementByTestId("agent-console:restore-style")).shouldNotExist();
    await when.setValue("agent-console:input", "Change the style for session two");
    await when.click("agent-console:send");

    await then(get.elementByTestId("agent-console:error")).shouldContainText("Mock failure after style change");
    await then(get.elementByTestId("agent-console:restore-style")).shouldBeVisible();
    await then(get.styleFromLocalStorage().then(style => style.name)).shouldEqual(changedStyleName);

    await get.element(".agent-console-session-select").filter({hasText: "Save original style"}).click();
    await then(get.styleFromLocalStorage().then(style => style.name)).shouldEqual(changedStyleName);

    await when.modal.close("modal:agent-workspace");
    await when.setStyle("");
    await when.click("nav:agent-workspace");
    await get.element(".agent-console-session-select").filter({hasText: "Save original style"}).click();
    await then(get.elementByTestId("agent-console:restore-style")).shouldBeVisible();
    await when.click("agent-console:restore-style");

    await then(get.elementByTestId("agent-console:notice")).shouldContainText("Map style restored.");
    await then(get.styleFromLocalStorage().then(style => style.name)).shouldEqual("Test Style");
  });

  test("renders turns with markdown and collapsed tool execution details", async () => {
    const page = currentPage();
    const agentCode = "return 6 * 7;";
    await page.route("http://localhost:8888/responses", route => {
      const body = route.request().postDataJSON();
      const hasFunctionCallOutput = (body.input ?? []).some((item: any) => item.type === "function_call_output");
      if (hasFunctionCallOutput) {
        return route.fulfill({
          contentType: "text/event-stream",
          body: [
            "event: response.output_text.delta",
            "data: {\"type\":\"response.output_text.delta\",\"item_id\":\"msg_2\",\"output_index\":0,\"content_index\":0,\"delta\":\"Finished with **forty-two** and `code`.\"}",
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

    await when.click("nav:agent-workspace");
    await when.click("agent-console:toggle-settings");
    await when.setValue("agent-console:api-key", "test-key");
    await when.setValue("agent-console:endpoint", "http://localhost:8888/responses");
    await when.setValue("agent-console:model", "test-model");
    await when.setValue("agent-console:input", "Calculate the answer");
    await when.click("agent-console:send");

    await then(get.elementByTestId("agent-console:messages")).shouldContainText("Finished with forty-two and code.");
    await then(get.element(".agent-console-message-markdown strong")).shouldContainText("forty-two");
    await then(get.element(".agent-console-message--user")).shouldHaveCss("align-items", "flex-end");
    await then(get.element(".agent-console-message--assistant")).shouldHaveCss("align-items", "flex-start");
    await then(get.element(".agent-console-tool-details summary")).shouldContainText("Execution details · 1 call");
    await then(get.element(".agent-console-tool-code")).shouldNotBeVisible();

    await when.click("agent-console:tool-details-toggle");
    await then(get.element(".agent-console-tool-code")).shouldContainText(agentCode);
    await then(get.element(".agent-console-tool-output")).shouldContainText("42");
    await then(get.element(".agent-console-tool-code")).shouldHaveCss("max-height", "320px");
    await then(get.element(".agent-console-tool-output")).shouldHaveCss("overflow-y", "auto");
    await then(get.element(".agent-console-tool-details")).shouldHaveCss("color", "rgb(164, 164, 164)");
  });

  test("renders a single tool call when the model returns no assistant text", async () => {
    const page = currentPage();
    const agentCode = "await new Promise(resolve => setTimeout(resolve, 1200)); return 'tool-only result';";
    await page.route("http://localhost:8888/responses", route => {
      const body = route.request().postDataJSON();
      const hasFunctionCallOutput = (body.input ?? []).some((item: any) => item.type === "function_call_output");
      if (hasFunctionCallOutput) {
        return route.fulfill({contentType: "text/event-stream", body: ""});
      }
      return route.fulfill({
        contentType: "text/event-stream",
        body: [
          "event: response.output_item.done",
          `data: {"type":"response.output_item.done","output_index":0,"item":{"type":"function_call","call_id":"call_only","name":"run_javascript","arguments":${JSON.stringify(JSON.stringify({code: agentCode}))}}}`,
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
    await when.setValue("agent-console:input", "Use one tool and stop");
    await when.click("agent-console:send");

    await then(get.element(".agent-console-tool-details summary")).shouldContainText("Execution details · 1 call");
    await when.click("agent-console:tool-details-toggle");
    await then(get.elementByTestId("agent-console:tool-pending")).shouldContainText("Running tool...");
    await then(get.elementByTestId("agent-console:generating")).shouldNotBeVisible();
    await then(get.element(".agent-console-tool-code")).shouldContainText(agentCode);
    await then(get.element(".agent-console-tool-output")).shouldContainText("tool-only result");
  });

  test("collapses controls to the left and centers the conversation between equal gutters", async () => {
    await when.click("nav:agent-workspace");

    await when.click("agent-console:toggle-sidebar");
    await when.wait(200);
    const consoleBox = await get.elementBox("agent-console").get();
    const sidebar = await get.elementBox("agent-console:sidebar").get();
    const conversation = await get.elementBox("agent-console:chat-card").get();

    expect(consoleBox).not.toBeNull();
    expect(sidebar).not.toBeNull();
    expect(conversation).not.toBeNull();
    expect(sidebar!.x).toBeCloseTo(consoleBox!.x, 1);
    expect(sidebar!.width).toBeCloseTo(48, 1);
    const leftGutter = conversation!.x - consoleBox!.x;
    const rightGutter = consoleBox!.x + consoleBox!.width - conversation!.x - conversation!.width;
    expect(leftGutter).toBeCloseTo(rightGutter, 1);
    expect((await get.elementsText("agent-console:toggle-sidebar").get()).trim()).toBe("");
    expect(await get.elementAttribute("agent-console:toggle-sidebar", "aria-expanded").get()).toBe("false");
    expect(await get.elementAttribute("agent-console:toggle-sidebar", "aria-label").get()).toBe("Expand controls");
  });

  test("sizes the workspace against the map area and clamps it to narrow viewports", async () => {
    await when.setViewportSize(2552, 1267);
    await when.click("nav:agent-workspace");
    const wide = await get.elementBox("modal:agent-workspace").get();

    expect(wide).not.toBeNull();
    expect(wide!.x).toBeCloseTo(768.2, 0);
    expect(wide!.width).toBeCloseTo(1585.6, 0);
    await then(get.elementByTestId("agent-console")).shouldNotOverflowHorizontally();

    await when.setViewportSize(680, 720);
    const narrow = await get.elementBox("modal:agent-workspace").get();
    expect(narrow).not.toBeNull();
    expect(narrow!.x).toBeCloseTo(16, 0);
    expect(narrow!.width).toBeCloseTo(648, 0);
    await then(get.elementByTestId("agent-console")).shouldNotOverflowHorizontally();
    await then(get.elementByTestId("agent-console:chat-card")).shouldNotOverflowHorizontally();
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
