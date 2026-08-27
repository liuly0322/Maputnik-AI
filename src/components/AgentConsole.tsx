import React from "react";
import {MdAdd, MdDelete, MdImage, MdSend} from "react-icons/md";
import {type WithTranslation, withTranslation} from "react-i18next";

import type {AgentRuntime} from "../libs/agent-runtime";
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
  executeAgentJavaScript,
  stringifyResult,
  type AgentExecutionContext,
} from "../libs/agent-executor";
import type {DatasetStore} from "../libs/dataset-store";

type AgentConsoleInternalProps = {
  runtime: AgentRuntime;
  datasetStore: DatasetStore;
  onDatasetsChange(): void;
  onOpenData(): void;
} & WithTranslation;

type ChatMessage = {
  id: string;
  role: "user" | "assistant" | "tool";
  content: string;
  images?: string[];
};

type AgentSession = {
  id: string;
  title: string;
  messages: ChatMessage[];
  inputItems: AgentInputItem[];
  createdAt: number;
  updatedAt: number;
};

type AgentConsoleInternalState = {
  apiKey: string;
  endpoint: string;
  model: string;
  input: string;
  pendingImages: string[];
  sessions: AgentSession[];
  activeSessionId: string | null;
  settingsOpen: boolean;
  sidebarOpen: boolean;
  selectedDatasetIds: string[];
  busy: boolean;
  error?: string;
};

const SETTINGS_KEY = "maputnik:agent_settings";
const SESSIONS_KEY = "maputnik:agent_sessions";
const MAX_TOOL_ROUNDS = 20;

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

function loadSessions(): AgentSession[] {
  try {
    const raw = window.localStorage.getItem(SESSIONS_KEY);
    if (raw) {
      return JSON.parse(raw) as AgentSession[];
    }
  }
  catch {
    // Fall through.
  }
  return [];
}

function saveSessions(sessions: AgentSession[]) {
  try {
    window.localStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions));
  }
  catch {
    // LocalStorage can be unavailable or full.
  }
}

function updateSession(
  sessions: AgentSession[],
  sessionId: string,
  patch: Partial<AgentSession>
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
  private settingsSaveTimer: number | null = null;

  constructor(props: AgentConsoleInternalProps) {
    super(props);
    const settings = loadSettings();
    const sessions = loadSessions();
    this.state = {
      apiKey: settings.apiKey,
      endpoint: settings.endpoint,
      model: settings.model,
      input: "",
      pendingImages: [],
      sessions,
      activeSessionId: sessions[0]?.id ?? null,
      settingsOpen: false,
      sidebarOpen: true,
      selectedDatasetIds: props.datasetStore.list().map(dataset => dataset.id),
      busy: false,
    };
  }

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
    const runtime = this.props.runtime;
    const snapshot = runtime.getState();
    return {
      map: runtime.map,
      style: runtime.style,
      runtime,
      datasets: runtime.datasets,
      workspace: {
        selection: snapshot.selection,
        selectedLayerIndex: snapshot.selectedLayerIndex,
        selectedLayer: snapshot.selectedLayer,
        layers: snapshot.layers,
        style: snapshot.style,
        datasets: snapshot.datasets,
      },
    };
  };

  componentWillUnmount() {
    if (this.settingsSaveTimer !== null) {
      window.clearTimeout(this.settingsSaveTimer);
    }
    this.saveSettingsNow();
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

  persistSessions = (sessions: AgentSession[]) => {
    saveSessions(sessions);
    this.setState({sessions});
  };

  onToggleDataset = (datasetId: string) => {
    this.setState(state => {
      const selected = state.selectedDatasetIds.includes(datasetId);
      return {
        selectedDatasetIds: selected
          ? state.selectedDatasetIds.filter(id => id !== datasetId)
          : [...state.selectedDatasetIds, datasetId],
      };
    });
  };

  onToggleSidebar = () => {
    this.setState(state => ({sidebarOpen: !state.sidebarOpen}));
  };

  onNewSession = () => {
    const session: AgentSession = {
      id: generateId(),
      title: "New session",
      messages: [],
      inputItems: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    const sessions = [session, ...this.state.sessions];
    this.persistSessions(sessions);
    this.setState({activeSessionId: session.id, input: "", pendingImages: [], error: undefined});
  };

  onSelectSession = (sessionId: string) => {
    this.setState({activeSessionId: sessionId, input: "", pendingImages: [], error: undefined});
  };

  onDeleteSession = (sessionId: string) => {
    const sessions = this.state.sessions.filter(session => session.id !== sessionId);
    const activeSessionId = this.state.activeSessionId === sessionId
      ? sessions[0]?.id ?? null
      : this.state.activeSessionId;
    this.persistSessions(sessions);
    this.setState({activeSessionId, input: "", pendingImages: [], error: undefined});
  };

  onSend = async () => {
    const text = this.state.input.trim();
    if (!text || this.state.busy) {
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
      const session: AgentSession = {
        id: generateId(),
        title: text.slice(0, 60),
        messages: [userMessage],
        inputItems: [userItem],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      sessions = [session, ...sessions];
      activeSessionId = session.id;
    }

    this.persistSessions(sessions);
    this.setState({
      input: "",
      pendingImages: [],
      activeSessionId,
      busy: true,
      error: undefined,
    });

    const nextSession = sessions.find(session => session.id === activeSessionId)!;
    const sessionId = nextSession.id;
    try {
      const snapshot = this.props.runtime.getState();
      await this.runStreamingLoop(
        settings,
        buildAgentInstructions(snapshot, this.state.selectedDatasetIds),
        sessionId,
        nextSession.inputItems,
        nextSession.messages,
        sessions
      );
    }
    catch (error) {
      this.setState({
        error: error instanceof Error ? error.message : String(error),
      });
    }
    finally {
      this.setState({busy: false});
    }
  };

  runStreamingLoop = async (
    settings: AgentSettings,
    instructions: string,
    sessionId: string,
    initialInputItems: AgentInputItem[],
    initialMessages: ChatMessage[],
    initialSessions: AgentSession[]
  ) => {
    let sessions = initialSessions;
    let inputItems = initialInputItems;
    let messages = initialMessages;
    let functionCalls: Array<Record<string, any>> = [];

    const updateUi = () => {
      sessions = updateSession(sessions, sessionId, {
        messages,
        inputItems,
      });
      this.persistSessions(sessions);
    };

    for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
      functionCalls = [];
      const messageIdsByItemId = new Map<string, string>();

      for await (const event of streamResponsesApi(settings, instructions, inputItems)) {
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
          updateUi();
        }
        else if (event.type === "response.output_item.done" && data.item) {
          const item = data.item;
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
            updateUi();
          }
        }
      }

      if (functionCalls.length === 0) {
        break;
      }

      for (const functionCall of functionCalls) {
        inputItems = [...inputItems, functionCall];
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
        inputItems = [...inputItems, createFunctionCallOutputItem(functionCall.call_id, output)];
        messages = [...messages, {id: generateId(), role: "tool", content: output || "(no output)"}];
        updateUi();
      }
    }

    if (functionCalls.length > 0) {
      messages = [...messages, {
        id: generateId(),
        role: "assistant",
        content: `Reached the maximum of ${MAX_TOOL_ROUNDS} tool calls. Send another message to continue.`,
      }];
      updateUi();
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
    const liveMap = this.props.runtime.map;
    const activeSession = this.state.sessions.find(session => session.id === this.state.activeSessionId);

    return <div className="agent-console" data-wd-key="agent-console">
      <aside className={`agent-console-sidebar ${this.state.sidebarOpen ? "agent-console-sidebar--open" : ""}`} data-wd-key="agent-console:sidebar">
        <div className="agent-console-sidebar-header">
          <span>{t("Controls")}</span>
          <button className="maputnik-button" onClick={this.onToggleSidebar} data-wd-key="agent-console:toggle-sidebar">
            {this.state.sidebarOpen ? t("Collapse") : t("Expand")}
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
              <p>
                {liveMap ? t("Live map is attached.") : t("Waiting for the map to load...")}
              </p>
            </section>

            <section className="agent-console-control-block">
              <div className="agent-console-sessions-header">
                <h1>{t("Sessions")}</h1>
                <button className="maputnik-button" onClick={this.onNewSession} data-wd-key="agent-console:new-session">
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
                {this.props.datasetStore.list().length === 0 && <p>{t("No datasets loaded.")}</p>}
                {this.props.datasetStore.list().map(dataset => {
                  const selected = this.state.selectedDatasetIds.includes(dataset.id);
                  return <button
                    key={dataset.id}
                    className={`agent-console-dataset-chip ${selected ? "agent-console-dataset-chip--active" : ""}`}
                    onClick={() => this.onToggleDataset(dataset.id)}
                    data-wd-key={`agent-console:dataset-chip:${dataset.id}`}
                  >
                    <span className="agent-console-dataset-chip-name">{dataset.name}</span>
                    <span className="agent-console-dataset-chip-meta">{dataset.rowCount} · {dataset.columns.slice(0, 4).join(", ")}</span>
                  </button>;
                })}
              </div>
            </section>
          </div>
        </div>
        }
      </aside>
      <main className="agent-console-main">
        {this.state.error && <p className="agent-console-error" data-wd-key="agent-console:error">{this.state.error}</p>}

        <section className="agent-console-chat-card" data-wd-key="agent-console:chat-card">
          <header className="agent-console-chat-header">
            <h1>{t("Conversation")}</h1>
          </header>
          <div className="agent-console-messages" data-wd-key="agent-console:messages">
            {!activeSession && <p>{t("Select or create a session.")}</p>}
            {activeSession?.messages.length === 0 && <p>{t("Ask the agent to inspect or modify the live map.")}</p>}
            {activeSession?.messages.map(message => {
              return <div className={`agent-console-message agent-console-message--${message.role}`} key={message.id}>
                <div className="agent-console-message-role">{message.role}</div>
                <pre className="agent-console-message-content">{message.content}</pre>
                {message.images && message.images.length > 0 && <div className="agent-console-message-images">
                  {message.images.map((image, index) => {
                    return <img className="agent-console-message-image" src={image} alt="" key={`${message.id}-${index}`} />;
                  })}
                </div>}
              </div>;
            })}
            {this.state.busy && <div className="agent-console-generating" data-wd-key="agent-console:generating">
              <svg className="agent-console-generating-spinner" viewBox="0 0 24 24" aria-hidden="true">
                <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="2" opacity="0.25" />
                <path d="M21 12a9 9 0 0 0-9-9" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
              <span>{t("Generating reply...")}</span>
            </div>}
            <div ref={this.messagesEndRef} />
          </div>

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
              disabled={this.state.busy}
              data-wd-key="agent-console:input"
            />
            <div className="agent-console-toolbar">
              <button className="maputnik-button" onClick={this.onAddImage} data-wd-key="agent-console:add-image">
                <MdImage />
                {t("Add image")}
              </button>
              <button className="maputnik-button" onClick={() => void this.onSend()} disabled={this.state.busy} data-wd-key="agent-console:send">
                <MdSend />
                {t("Send")}
              </button>
            </div>
          </div>
        </section>
      </main>
    </div>;
  }
}

export const AgentConsole = withTranslation()(AgentConsoleInternal);
