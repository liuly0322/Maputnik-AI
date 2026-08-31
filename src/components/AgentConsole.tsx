import React from "react";
import cloneDeep from "lodash.clonedeep";
import isEqual from "lodash.isequal";
import {type WithTranslation, withTranslation} from "react-i18next";
import type {Map as MapLibreMap, StyleSpecification} from "maplibre-gl";

import {
  buildAgentInstructions,
  createUserInputItem,
  defaultAgentSettings,
  type AgentSettings,
} from "../libs/agent-client";
import {
  createAgentExecutionContext,
  type AgentExecutionContext,
} from "../libs/agent-executor";
import {createChatMessages, type AgentConsoleSession, type ChatMessage} from "../libs/agent-conversation";
import {runAgentResponseLoop} from "../libs/agent-response-runner";
import {AgentSessionStore} from "../libs/agent-session-store";
import {
  createAgentTurnUndoStyle,
  undoLatestAgentTurn,
  type AgentTurnUndoStyle,
} from "../libs/agent-turn-undo";
import {createDatasetWorkspace} from "../libs/dataset";
import type {DatasetStore} from "../libs/dataset-store";
import {AgentConsoleChat} from "./AgentConsoleChat";
import {AgentConsoleComposer} from "./AgentConsoleComposer";
import {AgentConsoleSidebar} from "./AgentConsoleSidebar";

type AgentConsoleInternalProps = {
  getMap(): MapLibreMap | null;
  getStyle(): StyleSpecification;
  setStyle(style: StyleSpecification): void;
  datasetStore: DatasetStore;
  onOpenData(): void;
  renderer: "mlgljs" | "ol";
} & WithTranslation;

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
  stylePreviewOpen: boolean;
  busy: boolean;
  error?: string;
  notice?: string;
};

const SETTINGS_KEY = "maputnik:agent_settings";

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

class AgentConsoleInternal extends React.Component<AgentConsoleInternalProps, AgentConsoleInternalState> {
  private imageInputRef = React.createRef<HTMLInputElement>();
  private messagesEndRef = React.createRef<HTMLDivElement>();
  private sessionStore = new AgentSessionStore();
  private settingsSaveTimer: number | null = null;
  private responseAbortController: AbortController | null = null;
  private turnUndoStyles = new Map<string, AgentTurnUndoStyle>();
  private previewReadySessionIds = new Set<string>();
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
      stylePreviewOpen: false,
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
      const styleCheckpoint = cloneDeep(this.props.getStyle());
      const checkpointSession = {
        ...session,
        updatedAt,
        styleCheckpoint,
      };
      if (!await this.persistSession(checkpointSession) || !this.mounted) return;

      this.previewReadySessionIds.add(sessionId);
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
    this.setState({sessions, activeSessionId: session.id, input: "", pendingImages: [], stylePreviewOpen: false, error: undefined, notice: undefined});
    void this.persistSession(session);
  };

  onSelectSession = (sessionId: string) => {
    this.setState({activeSessionId: sessionId, input: "", pendingImages: [], stylePreviewOpen: false, error: undefined, notice: undefined});
  };

  onDeleteSession = (sessionId: string) => {
    this.turnUndoStyles.delete(sessionId);
    this.previewReadySessionIds.delete(sessionId);
    const sessions = this.state.sessions.filter(session => session.id !== sessionId);
    const activeSessionId = this.state.activeSessionId === sessionId
      ? sessions[0]?.id ?? null
      : this.state.activeSessionId;
    this.setState({sessions, activeSessionId, input: "", pendingImages: [], stylePreviewOpen: false, error: undefined, notice: undefined});
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

  onLoadStyle = () => {
    if (this.state.busy) return;
    const session = this.state.sessions.find(candidate => candidate.id === this.state.activeSessionId);
    if (!session?.styleCheckpoint) return;

    try {
      this.props.setStyle(cloneDeep(session.styleCheckpoint));
      this.setState({
        error: undefined,
        notice: this.props.t("The latest saved style for this conversation has been loaded."),
      });
    }
    catch (error) {
      this.setState({
        notice: undefined,
        error: `${this.props.t("Could not load map style")}: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  };

  onUndoTurn = async () => {
    if (this.state.busy) return;
    this.setState({stylePreviewOpen: false});
    const sessionId = this.state.activeSessionId;
    if (!sessionId) return;

    const session = this.state.sessions.find(candidate => candidate.id === sessionId);
    const styleBefore = this.turnUndoStyles.get(sessionId);
    if (!session || !styleBefore) return;

    const currentStyle = cloneDeep(this.props.getStyle());
    if (!session.styleCheckpoint || !isEqual(currentStyle, session.styleCheckpoint)) {
      this.setState({
        notice: undefined,
        error: this.props.t("The map has changed since this turn ended. Load this conversation's saved style before undoing the turn."),
      });
      return;
    }

    const result = undoLatestAgentTurn(session, styleBefore);
    if (!result) {
      this.setState({
        notice: undefined,
        error: this.props.t("Could not undo agent turn"),
      });
      return;
    }

    const undoneSession: AgentConsoleSession = {
      ...result.session,
      messages: createChatMessages(result.session.inputItems),
    };

    try {
      this.props.setStyle(cloneDeep(styleBefore));
      if (!await this.persistSession(undoneSession)) {
        this.props.setStyle(currentStyle);
        return;
      }
      if (!this.mounted) return;

      this.turnUndoStyles.delete(sessionId);
      this.previewReadySessionIds.delete(sessionId);
      this.setState(state => ({
        sessions: state.sessions.map(candidate => candidate.id === sessionId ? undoneSession : candidate),
        input: result.input,
        pendingImages: result.pendingImages,
        stylePreviewOpen: false,
        error: undefined,
        notice: this.props.t("The latest agent turn has been undone."),
      }));
    }
    catch (error) {
      this.setState({
        notice: undefined,
        error: `${this.props.t("Could not undo agent turn")}: ${error instanceof Error ? error.message : String(error)}`,
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
    const turnSessionId = activeSession?.id ?? generateId();
    this.previewReadySessionIds.delete(turnSessionId);
    this.turnUndoStyles.set(turnSessionId, createAgentTurnUndoStyle(this.props.getStyle()));

    if (activeSession) {
      sessions = updateSession(sessions, activeSession.id, {
        messages: [...activeSession.messages, userMessage],
        inputItems: [...activeSession.inputItems, userItem],
        title: activeSession.messages.length === 0 ? text.slice(0, 60) : activeSession.title,
      });
    }
    else {
      const session: AgentConsoleSession = {
        id: turnSessionId,
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
      stylePreviewOpen: false,
      error: undefined,
      notice: undefined,
    });

    const nextSession = sessions.find(session => session.id === activeSessionId)!;
    const sessionId = nextSession.id;
    await this.persistSession(nextSession);
    let streamingSessions = sessions;
    try {
      await runAgentResponseLoop({
        settings,
        instructions: buildAgentInstructions(this.props.datasetStore.getAll()),
        initialInputItems: nextSession.inputItems,
        initialMessages: nextSession.messages,
        signal: abortController.signal,
        createExecutionContext: this.buildExecutionContext,
        generateId,
        onMessagesChange: messages => {
          streamingSessions = updateSession(streamingSessions, sessionId, {messages});
          this.setState({sessions: streamingSessions});
        },
        onInputItemsChange: async (inputItems, messages) => {
          streamingSessions = updateSession(streamingSessions, sessionId, {messages, inputItems});
          this.setState({sessions: streamingSessions});
          const session = streamingSessions.find(candidate => candidate.id === sessionId);
          if (session) await this.persistSession(session);
        },
      });
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
    const previewStyleBefore = activeSession ? this.turnUndoStyles.get(activeSession.id) : undefined;
    const previewAvailable = !!previewStyleBefore
      && !!activeSession?.styleCheckpoint
      && this.previewReadySessionIds.has(activeSession.id)
      && !this.state.busy;

    return <div
      className={`agent-console ${this.state.sidebarOpen ? "agent-console--sidebar-open" : "agent-console--sidebar-closed"}`}
      data-wd-key="agent-console"
    >
      <AgentConsoleSidebar
        t={t}
        open={this.state.sidebarOpen}
        settingsOpen={this.state.settingsOpen}
        settings={{
          apiKey: this.state.apiKey,
          endpoint: this.state.endpoint,
          model: this.state.model,
        }}
        mapStatus={mapStatus}
        sessions={this.state.sessions}
        sessionsReady={this.state.sessionsReady}
        activeSessionId={this.state.activeSessionId}
        datasetStore={this.props.datasetStore}
        onToggle={this.onToggleSidebar}
        onToggleSettings={() => this.setState(state => ({settingsOpen: !state.settingsOpen}))}
        onSettingsChange={this.onSettingsChange}
        onNewSession={this.onNewSession}
        onSelectSession={this.onSelectSession}
        onDeleteSession={this.onDeleteSession}
        onOpenData={this.props.onOpenData}
      />
      <main className="agent-console-main">
        {this.state.error && <p className="agent-console-error" data-wd-key="agent-console:error">{this.state.error}</p>}
        {this.state.notice && <p className="agent-console-notice" role="status" data-wd-key="agent-console:notice">{this.state.notice}</p>}
        <AgentConsoleChat
          t={t}
          session={activeSession}
          busy={this.state.busy}
          canUndo={!!activeSession && this.turnUndoStyles.has(activeSession.id)}
          messagesEndRef={this.messagesEndRef}
          previewStyleBefore={previewStyleBefore}
          previewAvailable={previewAvailable}
          stylePreviewOpen={this.state.stylePreviewOpen}
          onToggleStylePreview={() => this.setState(state => ({stylePreviewOpen: !state.stylePreviewOpen}))}
          onUndoTurn={() => void this.onUndoTurn()}
          onLoadStyle={this.onLoadStyle}
          onCloseStylePreview={() => this.setState({stylePreviewOpen: false})}
          composer={<AgentConsoleComposer
            t={t}
            imageInputRef={this.imageInputRef}
            input={this.state.input}
            pendingImages={this.state.pendingImages}
            busy={this.state.busy}
            sessionsReady={this.state.sessionsReady}
            onImageChange={this.onImageChange}
            onRemovePendingImage={this.onRemovePendingImage}
            onInputChange={this.onInputChange}
            onKeyDown={this.onKeyDown}
            onAddImage={this.onAddImage}
            onStop={this.onStop}
            onSend={() => void this.onSend()}
          />}
        />
      </main>
    </div>;
  }
}

export const AgentConsole = withTranslation()(AgentConsoleInternal);
