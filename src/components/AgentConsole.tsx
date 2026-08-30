import React from "react";
import cloneDeep from "lodash.clonedeep";
import {MdAdd, MdChevronLeft, MdChevronRight, MdDelete, MdImage, MdRestore, MdSend, MdStop} from "react-icons/md";
import {type WithTranslation, withTranslation} from "react-i18next";
import type {Map as MapLibreMap, StyleSpecification} from "maplibre-gl";

import {
  buildAgentInstructions,
  createFunctionCallOutputItem,
  createUserInputItem,
  defaultAgentSettings,
  streamResponsesApi,
  type AgentInputItem,
  type AgentSettings,
} from "../libs/agent-client";
import {
  createAgentExecutionContext,
  executeAgentJavaScript,
  stringifyResult,
  truncateToolOutput,
  type AgentExecutionContext,
} from "../libs/agent-executor";
import {createChatMessages, type ChatMessage} from "../libs/agent-conversation";
import {AgentSessionStore, type AgentSession} from "../libs/agent-session-store";
import {createDatasetWorkspace, type Dataset} from "../libs/dataset";
import type {DatasetStore} from "../libs/dataset-store";
import {AgentConversation} from "./AgentConversation";

type AgentConsoleInternalProps = {
  getMap(): MapLibreMap | null;
  getStyle(): StyleSpecification;
  setStyle(style: StyleSpecification): void;
  datasetStore: DatasetStore;
  onOpenData(): void;
  renderer: "mlgljs" | "ol";
} & WithTranslation;

type AgentConsoleSession = AgentSession & {
  messages: ChatMessage[];
};

type AgentConsoleInternalState = {
  apiKey: string;
  endpoint: string;
  model: string;
  input: string;
  pendingImages: string[];
  sessions: AgentConsoleSession[];
  sessionsReady: boolean;
  activeSessionId: string | null;
  settingsOpen: boolean;
  sidebarOpen: boolean;
  busy: boolean;
  error?: string;
  notice?: string;
};

const SETTINGS_KEY = "maputnik:agent_settings";
const MAX_TOOL_ROUNDS = 20;

function getDatasetCsvSummary(dataset: Dataset) {
  switch (dataset.type) {
    case "csv":
      return {
        rowCount: dataset.data.rows.length,
        columns: dataset.data.columns,
      };
  }
}

function generateId() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function loadSettings(): AgentSettings {
  const defaults = defaultAgentSettings();
  try {
    const raw = window.localStorage.getItem(SETTINGS_KEY);
    if (raw) {
      return {
        ...defaults,
        ...JSON.parse(raw),
      };
    }
  }
  catch {
    // Fall back to defaults.
  }
  return defaults;
}

function saveSettings(settings: AgentSettings) {
  try {
    window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  }
  catch {
    // LocalStorage can be unavailable or full.
  }
}

function updateSession(
  sessions: AgentConsoleSession[],
  sessionId: string,
  patch: Partial<AgentConsoleSession>
) {
  return sessions.map(session => {
    if (session.id !== sessionId) {
      return session;
    }
    return {
      ...session,
      ...patch,
      updatedAt: Date.now(),
    };
  });
}

function extractAssistantText(item: Record<string, any>) {
  if (Array.isArray(item.content)) {
    return item.content
      .map((part: any) => part.text ?? part.output_text ?? "")
      .filter(Boolean)
      .join("\n");
  }
  return typeof item.content === "string" ? item.content : stringifyResult(item.content);
}

class AgentConsoleInternal extends React.Component<AgentConsoleInternalProps, AgentConsoleInternalState> {
  private imageInputRef = React.createRef<HTMLInputElement>();
  private messagesEndRef = React.createRef<HTMLDivElement>();
  private sessionStore = new AgentSessionStore();
  private settingsSaveTimer: number | null = null;
  private responseAbortController: AbortController | null = null;
  private mounted = false;

  constructor(props: AgentConsoleInternalProps) {
    super(props);
    const settings = loadSettings();
    this.state = {
      apiKey: settings.apiKey,
      endpoint: settings.endpoint,
      model: settings.model,
      input: "",
      pendingImages: [],
      sessions: [],
      sessionsReady: false,
      activeSessionId: null,
      settingsOpen: false,
      sidebarOpen: true,
      busy: false,
    };
  }

  componentDidMount() {
    this.mounted = true;
    void this.loadSessions();
  }

  loadSessions = async () => {
    try {
      const storedSessions = await this.sessionStore.init();
      const sessions = storedSessions.map(session => ({
        ...session,
        messages: createChatMessages(session.inputItems),
      }));
      if (!this.mounted) {
        this.sessionStore.close();
        return;
      }
      this.setState({
        sessions,
        sessionsReady: true,
        activeSessionId: sessions[0]?.id ?? null,
      });
    }
    catch (error) {
      if (!this.mounted) return;
      this.setState({
        sessionsReady: true,
        error: `${this.props.t("Could not load agent sessions")}: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  };

  componentDidUpdate(_prevProps: AgentConsoleInternalProps, prevState: AgentConsoleInternalState) {
    if (prevState.sessions === this.state.sessions) {
      return;
    }

    const prevSession = prevState.sessions.find(session => session.id === prevState.activeSessionId);
    const currentSession = this.state.sessions.find(session => session.id === this.state.activeSessionId);
    const prevLast = prevSession?.messages[prevSession.messages.length - 1]?.content ?? "";
    const currentLast = currentSession?.messages[currentSession.messages.length - 1]?.content ?? "";

    if (prevSession?.messages.length !== currentSession?.messages.length || prevLast !== currentLast) {
      this.messagesEndRef.current?.scrollIntoView({behavior: "smooth", block: "end"});
    }
  }

  buildExecutionContext = (): AgentExecutionContext => {
    return createAgentExecutionContext({
      getMap: this.props.getMap,
      getStyle: this.props.getStyle,
      setStyle: this.props.setStyle,
      datasets: createDatasetWorkspace(this.props.datasetStore),
    });
  };

  componentWillUnmount() {
    this.mounted = false;
    if (this.settingsSaveTimer !== null) {
      window.clearTimeout(this.settingsSaveTimer);
    }
    this.saveSettingsNow();
    this.sessionStore.close();
  }

  saveSettingsNow = () => {
    saveSettings({
      apiKey: this.state.apiKey,
      endpoint: this.state.endpoint,
      model: this.state.model,
    });
  };

  scheduleSettingsSave = () => {
    if (this.settingsSaveTimer !== null) {
      window.clearTimeout(this.settingsSaveTimer);
    }
    this.settingsSaveTimer = window.setTimeout(() => {
      this.settingsSaveTimer = null;
      this.saveSettingsNow();
    }, 300);
  };

  onSettingsChange = (key: "apiKey" | "endpoint" | "model", value: string) => {
    this.setState({[key]: value} as Pick<AgentConsoleInternalState, typeof key>, () => {
      this.scheduleSettingsSave();
    });
  };

  onAddImage = () => {
    this.imageInputRef.current?.click();
  };

  onImageChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    for (const file of files) {
      if (!file.type.startsWith("image/")) {
        continue;
      }
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result === "string") {
          this.setState(state => ({
            pendingImages: [...state.pendingImages, reader.result as string],
          }));
        }
      };
      reader.readAsDataURL(file);
    }
    event.target.value = "";
  };

  onRemovePendingImage = (index: number) => {
    this.setState(state => ({
      pendingImages: state.pendingImages.filter((_image, imageIndex) => imageIndex !== index),
    }));
  };

  persistSession = async (session: AgentConsoleSession): Promise<boolean> => {
    try {
      await this.sessionStore.put({
        id: session.id,
        title: session.title,
        inputItems: session.inputItems,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
        styleCheckpoint: session.styleCheckpoint,
      });
      return true;
    }
    catch (error) {
      if (this.mounted) {
        this.setState({
          error: `${this.props.t("Could not save agent session")}: ${error instanceof Error ? error.message : String(error)}`,
        });
      }
      return false;
    }
  };

  saveStyleCheckpoint = async (sessionId: string) => {
    try {
      const session = this.state.sessions.find(candidate => candidate.id === sessionId);
      if (!session) return;

      const updatedAt = Date.now();
      const styleCheckpoint = this.props.getStyle();
      const checkpointSession = {
        ...session,
        updatedAt,
        styleCheckpoint,
      };
      if (!await this.persistSession(checkpointSession) || !this.mounted) return;

      this.setState(state => ({
        sessions: state.sessions.map(candidate => candidate.id === sessionId
          ? {...candidate, updatedAt, styleCheckpoint}
          : candidate),
      }));
    }
    catch (error) {
      if (!this.mounted) return;
      this.setState({
        error: `${this.props.t("Could not save agent session")}: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  };

  onToggleSidebar = () => {
    this.setState(state => ({sidebarOpen: !state.sidebarOpen}));
  };

  onNewSession = () => {
    if (!this.state.sessionsReady) return;
    const session: AgentConsoleSession = {
      id: generateId(),
      title: "New session",
      messages: [],
      inputItems: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      styleCheckpoint: null,
    };
    const sessions = [session, ...this.state.sessions];
    this.setState({sessions, activeSessionId: session.id, input: "", pendingImages: [], error: undefined, notice: undefined});
    void this.persistSession(session);
  };

  onSelectSession = (sessionId: string) => {
    this.setState({activeSessionId: sessionId, input: "", pendingImages: [], error: undefined, notice: undefined});
  };

  onDeleteSession = (sessionId: string) => {
    const sessions = this.state.sessions.filter(session => session.id !== sessionId);
    const activeSessionId = this.state.activeSessionId === sessionId
      ? sessions[0]?.id ?? null
      : this.state.activeSessionId;
    this.setState({sessions, activeSessionId, input: "", pendingImages: [], error: undefined, notice: undefined});
    void this.sessionStore.delete(sessionId).catch(error => {
      if (!this.mounted) return;
      this.setState({
        error: `${this.props.t("Could not delete agent session")}: ${error instanceof Error ? error.message : String(error)}`,
      });
    });
  };

  onStop = () => {
    this.responseAbortController?.abort();
  };

  onRestoreStyle = () => {
    if (this.state.busy) return;
    const session = this.state.sessions.find(candidate => candidate.id === this.state.activeSessionId);
    if (!session?.styleCheckpoint) return;

    try {
      this.props.setStyle(cloneDeep(session.styleCheckpoint));
      this.setState({
        error: undefined,
        notice: this.props.t("Map style restored."),
      });
    }
    catch (error) {
      this.setState({
        notice: undefined,
        error: `${this.props.t("Could not restore map style")}: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  };

  onSend = async () => {
    const text = this.state.input.trim();
    if (!text || this.state.busy || !this.state.sessionsReady) {
      return;
    }

    const settings = {
      apiKey: this.state.apiKey.trim(),
      endpoint: this.state.endpoint.trim(),
      model: this.state.model.trim(),
    };
    if (!settings.apiKey || !settings.endpoint || !settings.model) {
      this.setState({error: "API key, endpoint, and model are required."});
      return;
    }

    this.saveSettingsNow();

    const abortController = new AbortController();
    this.responseAbortController = abortController;

    const userMessage: ChatMessage = {
      id: generateId(),
      role: "user",
      content: text,
      images: this.state.pendingImages,
    };
    const userItem = createUserInputItem(text, this.state.pendingImages);

    let sessions = [...this.state.sessions];
    let activeSessionId = this.state.activeSessionId;
    const activeSession = sessions.find(session => session.id === activeSessionId);

    if (activeSession) {
      sessions = updateSession(sessions, activeSession.id, {
        messages: [...activeSession.messages, userMessage],
        inputItems: [...activeSession.inputItems, userItem],
        title: activeSession.messages.length === 0 ? text.slice(0, 60) : activeSession.title,
      });
    }
    else {
      const session: AgentConsoleSession = {
        id: generateId(),
        title: text.slice(0, 60),
        messages: [userMessage],
        inputItems: [userItem],
        createdAt: Date.now(),
        updatedAt: Date.now(),
        styleCheckpoint: null,
      };
      sessions = [session, ...sessions];
      activeSessionId = session.id;
    }

    this.setState({
      sessions,
      input: "",
      pendingImages: [],
      activeSessionId,
      busy: true,
      error: undefined,
      notice: undefined,
    });

    const nextSession = sessions.find(session => session.id === activeSessionId)!;
    const sessionId = nextSession.id;
    await this.persistSession(nextSession);
    try {
      await this.runStreamingLoop(
        settings,
        buildAgentInstructions(this.props.datasetStore.getAll()),
        sessionId,
        nextSession.inputItems,
        nextSession.messages,
        sessions,
        abortController.signal
      );
    }
    catch (error) {
      if (!abortController.signal.aborted) {
        this.setState({
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    finally {
      if (this.responseAbortController === abortController) {
        await this.saveStyleCheckpoint(sessionId);
        this.responseAbortController = null;
        if (this.mounted) this.setState({busy: false});
      }
    }
  };

  runStreamingLoop = async (
    settings: AgentSettings,
    instructions: string,
    sessionId: string,
    initialInputItems: AgentInputItem[],
    initialMessages: ChatMessage[],
    initialSessions: AgentConsoleSession[],
    signal: AbortSignal
  ) => {
    let sessions = initialSessions;
    let inputItems = initialInputItems;
    let messages = initialMessages;
    let functionCalls: Array<Record<string, any>> = [];
    const updateMessages = () => {
      sessions = updateSession(sessions, sessionId, {
        messages,
      });
      this.setState({sessions});
    };

    const commitInputItems = async () => {
      sessions = updateSession(sessions, sessionId, {
        messages,
        inputItems,
      });
      this.setState({sessions});
      const session = sessions.find(candidate => candidate.id === sessionId);
      if (session) {
        await this.persistSession(session);
      }
    };

    for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
      functionCalls = [];
      const messageIdsByItemId = new Map<string, string>();
      const completedItemIds = new Set<string>();
      const commitPartialMessages = async () => {
        const partialMessages = Array.from(messageIdsByItemId.entries())
          .filter(([itemId]) => !completedItemIds.has(itemId))
          .map(([, messageId]) => messages.find(message => message.id === messageId))
          .filter((message): message is ChatMessage => !!message?.content)
          .map(message => ({
            type: "message",
            role: "assistant",
            content: [{type: "output_text", text: message.content}],
          }));
        if (partialMessages.length > 0) {
          inputItems = [...inputItems, ...partialMessages];
          await commitInputItems();
        }
      };

      try {
        for await (const event of streamResponsesApi(settings, instructions, inputItems, signal)) {
          const data = event.data;

          if (event.type === "response.output_text.delta" && data.delta) {
            let messageId = messageIdsByItemId.get(data.item_id);
            if (!messageId) {
              messageId = generateId();
              messageIdsByItemId.set(data.item_id, messageId);
              messages = [...messages, {id: messageId, role: "assistant", content: ""}];
            }
            messages = messages.map(message => {
              if (message.id !== messageId) return message;
              return {...message, content: message.content + data.delta};
            });
            updateMessages();
          }
          else if (event.type === "response.output_item.done" && data.item) {
            const item = data.item;
            if (typeof item.id === "string") completedItemIds.add(item.id);
            inputItems = [...inputItems, item];
            if (item.type === "function_call") {
              functionCalls.push(item);
            }
            else if (item.type === "message" && item.role === "assistant") {
              const text = extractAssistantText(item);
              let messageId = messageIdsByItemId.get(item.id);
              if (!messageId && text) {
                messageId = generateId();
                messageIdsByItemId.set(item.id, messageId);
                messages = [...messages, {id: messageId, role: "assistant", content: text}];
              }
              else if (messageId) {
                messages = messages.map(message => message.id === messageId ? {...message, content: text} : message);
              }
            }
            await commitInputItems();
          }
        }
      }
      catch (error) {
        if (!signal.aborted) throw error;
        await commitPartialMessages();
        return;
      }

      if (signal.aborted) {
        await commitPartialMessages();
        return;
      }

      if (functionCalls.length === 0) {
        break;
      }

      for (const functionCall of functionCalls) {
        if (signal.aborted) return;
        let code = "";
        try {
          code = JSON.parse(functionCall.arguments ?? "{}").code ?? "";
        }
        catch {
          // Keep the default empty code when tool arguments cannot be parsed.
        }
        let output: string;
        try {
          output = await executeAgentJavaScript(code, this.buildExecutionContext());
        }
        catch (error) {
          output = `Error: ${error instanceof Error ? error.stack || error.message : String(error)}`;
        }
        if (signal.aborted) return;
        output = truncateToolOutput(output);
        inputItems = [...inputItems, createFunctionCallOutputItem(functionCall.call_id, output)];
        messages = [...messages, {
          id: generateId(),
          role: "tool",
          content: output || "(no output)",
          callId: functionCall.call_id,
        }];
        await commitInputItems();
      }
    }

    if (functionCalls.length > 0) {
      messages = [...messages, {
        id: generateId(),
        role: "assistant",
        content: `Reached the maximum of ${MAX_TOOL_ROUNDS} tool calls. Send another message to continue.`,
      }];
      updateMessages();
    }
  };

  onInputChange = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
    this.setState({input: event.target.value});
  };

  onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void this.onSend();
    }
  };

  render() {
    const {t} = this.props;
    const liveMap = this.props.getMap();
    const mapStatus = this.props.renderer === "ol"
      ? t("Live map access requires the MapLibreGL JS renderer. Switch the style renderer in Settings.")
      : liveMap
        ? t("Live map is attached.")
        : t("Waiting for the map to load...");
    const activeSession = this.state.sessions.find(session => session.id === this.state.activeSessionId);

    return <div
      className={`agent-console ${this.state.sidebarOpen ? "agent-console--sidebar-open" : "agent-console--sidebar-closed"}`}
      data-wd-key="agent-console"
    >
      <div className="agent-console-sidebar-slot">
        <aside
          className={`agent-console-sidebar ${this.state.sidebarOpen ? "agent-console-sidebar--open" : ""}`}
          data-wd-key="agent-console:sidebar"
          id="agent-console-sidebar"
        >
          <div className="agent-console-sidebar-header">
            <span>{t("Controls")}</span>
            <button
              className="maputnik-button agent-console-sidebar-toggle"
              onClick={this.onToggleSidebar}
              title={this.state.sidebarOpen ? t("Collapse controls") : t("Expand controls")}
              aria-label={this.state.sidebarOpen ? t("Collapse controls") : t("Expand controls")}
              aria-expanded={this.state.sidebarOpen}
              aria-controls="agent-console-sidebar"
              data-wd-key="agent-console:toggle-sidebar"
            >
              {this.state.sidebarOpen ? <MdChevronLeft /> : <MdChevronRight />}
            </button>
          </div>
          {this.state.sidebarOpen && <div className="agent-console-sidebar-content">
            <div className="agent-console-controls">
              <section className="agent-console-control-block">
                <div className="agent-console-settings-header">
                  <h1>{t("Agent settings")}</h1>
                  <button className="maputnik-button" onClick={() => this.setState(state => ({settingsOpen: !state.settingsOpen}))} data-wd-key="agent-console:toggle-settings">
                    {this.state.settingsOpen ? t("Hide") : t("Settings")}
                  </button>
                </div>
                {this.state.settingsOpen && <div className="agent-console-settings">
                  <label>
                    <span>{t("API key")}</span>
                    <input
                      type="password"
                      value={this.state.apiKey}
                      onChange={e => this.onSettingsChange("apiKey", e.target.value)}
                      data-wd-key="agent-console:api-key"
                    />
                  </label>
                  <label>
                    <span>{t("Endpoint")}</span>
                    <input
                      type="text"
                      value={this.state.endpoint}
                      onChange={e => this.onSettingsChange("endpoint", e.target.value)}
                      data-wd-key="agent-console:endpoint"
                    />
                  </label>
                  <label>
                    <span>{t("Model")}</span>
                    <input
                      type="text"
                      value={this.state.model}
                      onChange={e => this.onSettingsChange("model", e.target.value)}
                      data-wd-key="agent-console:model"
                    />
                  </label>
                </div>}
                <p data-wd-key="agent-console:map-status">{mapStatus}</p>
              </section>

              <section className="agent-console-control-block">
                <div className="agent-console-sessions-header">
                  <h1>{t("Sessions")}</h1>
                  <button className="maputnik-button" onClick={this.onNewSession} disabled={!this.state.sessionsReady} data-wd-key="agent-console:new-session">
                    <MdAdd />
                    {t("New session")}
                  </button>
                </div>
                <div className="agent-console-sessions" data-wd-key="agent-console:sessions">
                  {this.state.sessions.length === 0 && <p>{t("No sessions yet.")}</p>}
                  {this.state.sessions.map(session => {
                    return <div
                      className={`agent-console-session ${session.id === this.state.activeSessionId ? "agent-console-session--active" : ""}`}
                      key={session.id}
                      data-wd-key={`agent-console:session:${session.id}`}
                    >
                      <button
                        className="agent-console-session-select"
                        onClick={() => this.onSelectSession(session.id)}
                      >
                        {session.title}
                      </button>
                      <button
                        className="agent-console-session-delete"
                        onClick={() => this.onDeleteSession(session.id)}
                        aria-label={t("Delete session")}
                        data-wd-key={`agent-console:delete-session:${session.id}`}
                      >
                        <MdDelete />
                      </button>
                    </div>;
                  })}
                </div>
              </section>

              <section className="agent-console-control-block">
                <div className="agent-console-context-header">
                  <h1>{t("Dataset context")}</h1>
                  <button className="maputnik-button" onClick={this.props.onOpenData} data-wd-key="agent-console:manage-data">
                    {t("Manage data")}
                  </button>
                </div>
                <div className="agent-console-dataset-chips" data-wd-key="agent-console:dataset-chips">
                  {this.props.datasetStore.getAll().length === 0 && <p>{t("No datasets loaded.")}</p>}
                  {this.props.datasetStore.getAll().map(dataset => {
                    const summary = getDatasetCsvSummary(dataset);
                    return <div
                      key={dataset.id}
                      className="agent-console-dataset-chip"
                      data-wd-key={`agent-console:dataset-chip:${dataset.id}`}
                    >
                      <span className="agent-console-dataset-chip-name">{dataset.name}</span>
                      <span className="agent-console-dataset-chip-meta">
                        {dataset.type} · {summary.rowCount} {t("rows")} · {summary.columns.slice(0, 4).join(", ")}
                      </span>
                    </div>;
                  })}
                </div>
              </section>
            </div>
          </div>
          }
        </aside>
      </div>
      <main className="agent-console-main">
        {this.state.error && <p className="agent-console-error" data-wd-key="agent-console:error">{this.state.error}</p>}
        {this.state.notice && <p className="agent-console-notice" role="status" data-wd-key="agent-console:notice">{this.state.notice}</p>}

        <section className="agent-console-chat-card" data-wd-key="agent-console:chat-card">
          <header className="agent-console-chat-header">
            <h1>{t("Conversation")}</h1>
            {activeSession?.styleCheckpoint && <button
              className="maputnik-button"
              onClick={this.onRestoreStyle}
              disabled={this.state.busy}
              data-wd-key="agent-console:restore-style"
            >
              <MdRestore />
              {t("Restore map style")}
            </button>}
          </header>
          <AgentConversation
            session={activeSession}
            busy={this.state.busy}
            messagesEndRef={this.messagesEndRef}
          />

          <div className="agent-console-composer">
            <input
              ref={this.imageInputRef}
              type="file"
              accept="image/*"
              multiple
              style={{display: "none"}}
              onChange={this.onImageChange}
              data-wd-key="agent-console:image-input"
            />
            {this.state.pendingImages.length > 0 && <div className="agent-console-pending-images">
              {this.state.pendingImages.map((image, index) => {
                return <div className="agent-console-pending-image" key={`${image}-${index}`}>
                  <img src={image} alt="" />
                  <button onClick={() => this.onRemovePendingImage(index)} aria-label={t("Remove image")}>
                    ×
                  </button>
                </div>;
              })}
            </div>}
            <textarea
              value={this.state.input}
              onChange={this.onInputChange}
              onKeyDown={this.onKeyDown}
              placeholder={t("Describe what you want to inspect or change...")}
              disabled={this.state.busy || !this.state.sessionsReady}
              data-wd-key="agent-console:input"
            />
            <div className="agent-console-toolbar">
              <button className="maputnik-button" onClick={this.onAddImage} data-wd-key="agent-console:add-image">
                <MdImage />
                {t("Add image")}
              </button>
              {this.state.busy
                ? <button className="maputnik-button agent-console-stop" onClick={this.onStop} data-wd-key="agent-console:stop" aria-label={t("Stop generating")}>
                  <MdStop />
                  {t("Stop generating")}
                </button>
                : <button className="maputnik-button" onClick={() => void this.onSend()} disabled={!this.state.sessionsReady} data-wd-key="agent-console:send">
                  <MdSend />
                  {t("Send")}
                </button>}
            </div>
          </div>
        </section>
      </main>
    </div>;
  }
}

export const AgentConsole = withTranslation()(AgentConsoleInternal);
