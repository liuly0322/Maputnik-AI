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
    await page.route("http://localhost:8888/responses", route => {
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
    await when.click("agent-console:toggle-settings");
    await when.setValue("agent-console:api-key", "test-key");
    await when.setValue("agent-console:endpoint", "http://localhost:8888/responses");
    await when.setValue("agent-console:model", "test-model");
    await when.setValue("agent-console:input", "Inspect the map");
    await when.click("agent-console:send");

    await then(get.elementByTestId("agent-console:messages")).shouldContainText("Hello from the mock agent");
    await then(get.elementByTestId("agent-console:sessions")).shouldContainText("Inspect the map");
  });

  test("syncs a native MapLibre mutation to the editor", async () => {
    const page = currentPage();
    await page.route("http://localhost:8888/responses", route => {
      const input = route.request().postDataJSON().input ?? [];
      if (input.some((item: any) => item.type === "function_call_output")) {
        return route.fulfill({contentType: "text/event-stream", body: ""});
      }
      const code = 'map.addLayer({id: "agent-native-layer", type: "background"}); return map.getStyle().layers.length;';
      return route.fulfill({
        contentType: "text/event-stream",
        body: [
          "event: response.output_item.done",
          `data: {"type":"response.output_item.done","output_index":0,"item":{"type":"function_call","call_id":"native-mutation","name":"run_javascript","arguments":${JSON.stringify(JSON.stringify({code}))}}}`,
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
    await when.setValue("agent-console:input", "Apply native map changes");
    await when.click("agent-console:send");

    await then(get.styleFromLocalStorage()).shouldDeepNestedInclude({
      id: "test-style",
      layers: [{
        id: "agent-native-layer",
        type: "background",
      }],
    });

    await when.modal.close("modal:agent-workspace");
    await then(get.elementByTestId("layer-list-item:agent-native-layer")).shouldExist();
  });

  test("pastes text and an image into the agent input", async () => {
    const page = currentPage();
    const requestBodies: any[] = [];
    await page.route("http://localhost:8888/responses", route => {
      requestBodies.push(route.request().postDataJSON());
      return route.fulfill({
        contentType: "text/event-stream",
        body: "",
      });
    });

    await when.click("nav:agent-workspace");
    await when.click("agent-console:toggle-settings");
    await when.setValue("agent-console:api-key", "test-key");
    await when.setValue("agent-console:endpoint", "http://localhost:8888/responses");
    await when.setValue("agent-console:model", "test-model");

    await when.focus("agent-console:input");
    await when.typeText("Inspect");
    await when.pasteTextIntoAgentInput(" the map");
    await then(get.elementByTestId("agent-console:input")).shouldHaveValue("Inspect the map");

    await when.pasteImageIntoAgentInput("pasted.png", "image/png", "pasted image");
    await then(get.element(".agent-console-pending-image")).shouldExist();
    await then(get.elementByTestId("agent-console:input")).shouldHaveValue("Inspect the map");

    await when.click("agent-console:send");
    await then(get.elementByTestId("agent-console:send")).shouldBeVisible();

    const content = requestBodies[0].input[0].content;
    expect(content).toEqual(expect.arrayContaining([
      {type: "input_text", text: "Inspect the map"},
    ]));
    expect(content.some((part: any) => part.type === "input_image" && part.image_url.startsWith("data:image/png;base64,"))).toBe(true);
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
    await then(get.elementByTestId("agent-console:load-style")).shouldBeVisible();
  });

  test("persists per-session style checkpoints and loads them only on request", async () => {
    const page = currentPage();
    const changedStyleName = "Changed by second session";
    await page.route("http://localhost:8888/responses", route => {
      const body = route.request().postDataJSON();
      const serializedInput = JSON.stringify(body.input ?? []);
      const hasFunctionCallOutput = (body.input ?? []).some((item: any) => item.type === "function_call_output");

      if (!serializedInput.includes("Change the style for session two")) {
        return route.fulfill({contentType: "text/event-stream", body: ""});
      }
      if (hasFunctionCallOutput) {
        return route.fulfill({contentType: "text/event-stream", body: ""});
      }

      const code = `const nextStyle = map.getStyle(); nextStyle.name = ${JSON.stringify(changedStyleName)}; await new Promise(resolve => { map.once("style.load", resolve); map.setStyle(nextStyle, {diff: false}); }); return map.getStyle().name;`;
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

    await then(get.elementByTestId("agent-console:load-style")).shouldBeVisible();
    await when.click("agent-console:new-session");
    await when.setValue("agent-console:input", "Change the style for session two");
    await when.click("agent-console:send");

    await then(get.elementByTestId("agent-console:load-style")).shouldBeVisible();
    await then(get.styleFromLocalStorage().then(style => style.name)).shouldEqual(changedStyleName);

    await get.element(".agent-console-session-select").filter({hasText: "Save original style"}).click();
    await then(get.styleFromLocalStorage().then(style => style.name)).shouldEqual(changedStyleName);

    await when.modal.close("modal:agent-workspace");
    await when.setStyle("");
    await when.click("nav:agent-workspace");
    await get.element(".agent-console-session-select").filter({hasText: "Save original style"}).click();
    await when.click("agent-console:load-style");

    await then(get.elementByTestId("agent-console:notice")).shouldContainText("The latest saved style for this conversation has been loaded.");
    await then(get.styleFromLocalStorage().then(style => style.name)).shouldEqual("Test Style");
  });

  test("undoes only the latest user turn after multiple tool rounds", async () => {
    const page = currentPage();
    const streamFunctionCall = (callId: string, code: string) => [
      "event: response.output_item.done",
      `data: {"type":"response.output_item.done","output_index":0,"item":{"type":"function_call","call_id":${JSON.stringify(callId)},"name":"run_javascript","arguments":${JSON.stringify(JSON.stringify({code}))}}}`,
      "",
      "",
    ].join("\n");
    await page.route("http://localhost:8888/responses", route => {
      const input = route.request().postDataJSON().input ?? [];
      const serializedInput = JSON.stringify(input);
      const callOutputs = new Set(input
        .filter((item: any) => item.type === "function_call_output")
        .map((item: any) => item.call_id));

      if (serializedInput.includes("Second request")) {
        if (!callOutputs.has("second-name")) {
          return route.fulfill({
            contentType: "text/event-stream",
            body: streamFunctionCall("second-name", "const nextStyle = map.getStyle(); nextStyle.name = 'Second turn style'; await new Promise(resolve => { map.once('style.load', resolve); map.setStyle(nextStyle, {diff: false}); }); return map.getStyle().name;"),
          });
        }
        if (!callOutputs.has("second-metadata")) {
          return route.fulfill({
            contentType: "text/event-stream",
            body: streamFunctionCall("second-metadata", "const nextStyle = map.getStyle(); nextStyle.metadata = {agentTurn: 'second'}; await new Promise(resolve => { map.once('style.load', resolve); map.setStyle(nextStyle, {diff: false}); }); return map.getStyle().metadata;"),
          });
        }
        return route.fulfill({contentType: "text/event-stream", body: ""});
      }

      if (!callOutputs.has("first-name")) {
        return route.fulfill({
          contentType: "text/event-stream",
          body: streamFunctionCall("first-name", "const nextStyle = map.getStyle(); nextStyle.name = 'First turn style'; await new Promise(resolve => { map.once('style.load', resolve); map.setStyle(nextStyle, {diff: false}); }); return map.getStyle().name;"),
        });
      }
      return route.fulfill({contentType: "text/event-stream", body: ""});
    });

    await when.click("nav:agent-workspace");
    await when.click("agent-console:toggle-settings");
    await when.setValue("agent-console:api-key", "test-key");
    await when.setValue("agent-console:endpoint", "http://localhost:8888/responses");
    await when.setValue("agent-console:model", "test-model");
    await when.setValue("agent-console:input", "First request");
    await when.click("agent-console:send");
    await then(get.styleFromLocalStorage().then(style => style.name)).shouldEqual("First turn style");

    await when.chooseImageFromPicker("test.svg", "<svg xmlns=\"http://www.w3.org/2000/svg\"></svg>");
    await when.setValue("agent-console:input", "Second request");
    await when.click("agent-console:send");
    await then(get.styleFromLocalStorage()).shouldDeepNestedInclude({
      name: "Second turn style",
      metadata: {agentTurn: "second"},
    });

    await when.click("agent-console:undo-turn");

    await then(get.elementByTestId("agent-console:notice")).shouldContainText("The latest agent turn has been undone.");
    await then(get.styleFromLocalStorage().then(style => style.name)).shouldEqual("First turn style");
    expect((await get.styleFromLocalStorage().get()).metadata.agentTurn).toBeUndefined();
    expect(await get.elementsText("agent-console:messages").get()).toContain("First request");
    expect(await get.elementsText("agent-console:messages").get()).not.toContain("Second request");
    await then(get.elementByTestId("agent-console:input")).shouldHaveValue("Second request");
    await then(get.element(".agent-console-pending-image")).shouldExist();
    expect(await get.elementAttribute("agent-console:undo-turn", "disabled").get()).toBe("");
  });

  test("previews the saved style delta without reading later live edits", async () => {
    await when.setStyle("rectangles");
    const page = currentPage();
    await page.route("http://localhost:8888/responses", route => {
      const input = route.request().postDataJSON().input ?? [];
      if (input.some((item: any) => item.type === "function_call_output")) {
        return route.fulfill({contentType: "text/event-stream", body: ""});
      }
      const code = "map.setPaintProperty('rectangles', 'fill-opacity', 0.8); return map.getPaintProperty('rectangles', 'fill-opacity');";
      return route.fulfill({
        contentType: "text/event-stream",
        body: [
          "event: response.output_item.done",
          `data: {"type":"response.output_item.done","output_index":0,"item":{"type":"function_call","call_id":"preview-layer","name":"run_javascript","arguments":${JSON.stringify(JSON.stringify({code}))}}}`,
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
    await when.setValue("agent-console:input", "Preview several changes");
    await when.click("agent-console:send");

    await then(get.elementByTestId("agent-console:send")).shouldBeVisible();
    await when.modal.openAgentStyleChanges();

    await then(get.elementByTestId("agent-style-change-preview")).shouldContainText("Changed 1");
    await then(get.elementByTestId("agent-style-change-preview:changed")).shouldContainText('layers["rectangles"].paint.fill-opacity');
    await when.modal.toggleAgentStyleChange(0);
    await then(get.element("#agent-style-change-0")).shouldContainText("0.3");
    await then(get.element("#agent-style-change-0")).shouldContainText("0.8");

    await when.modal.closeAgentStyleChanges();
    await when.modal.close("modal:agent-workspace");
    await when.click("layer-list-item:rectangles");
    await when.setValue("spec-field-input:fill-opacity", "0.1");
    await when.click("layer-editor.layer-id");
    await when.click("nav:agent-workspace");
    await when.modal.openAgentStyleChanges();
    await when.modal.toggleAgentStyleChange(0);
    await then(get.element("#agent-style-change-0")).shouldContainText("0.8");
    expect(await get.element("#agent-style-change-0").innerText()).not.toContain("0.1");
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
    await then(get.element(".agent-console-tool-details summary")).shouldContainText("Execution details · 1 call");
    await then(get.element(".agent-console-tool-code")).shouldNotBeVisible();

    await when.click("agent-console:tool-details-toggle");
    await then(get.element(".agent-console-tool-code")).shouldContainText(agentCode);
    await then(get.element(".agent-console-tool-output")).shouldContainText("42");
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
