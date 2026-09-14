import type {TFunction} from "i18next";
import {MdAdd, MdArrowDropDown, MdDelete} from "react-icons/md";
import {Wrapper, Button, Menu, MenuItem} from "react-aria-menubutton";

import type {AgentSession} from "../libs/agent-session-store";

const NEW_SESSION_VALUE = "new-session";
const DELETE_PREFIX = "delete-session:";

type AgentSessionPickerProps = {
  t: TFunction;
  sessions: AgentSession[];
  sessionsReady: boolean;
  activeSessionId: string | null;
  onNewSession(): void;
  onSelectSession(sessionId: string): void;
  onDeleteSession(sessionId: string): void;
};

/**
 * The session switcher, living behind the conversation's own title. The list
 * is a way of switching the conversation, so it belongs next to the thing it
 * switches rather than in a section beside the settings.
 */
export function AgentSessionPicker(props: AgentSessionPickerProps) {
  const {t} = props;
  const activeSession = props.sessions.find(session => session.id === props.activeSessionId);
  // With nothing selected the trigger has to read as "pick one", not as a
  // button that makes one, and with none to pick it says what it does.
  const title = activeSession
    ? activeSession.title
    : props.sessions.length === 0
      ? t("New session")
      : t("Select a session");

  const handleSelection = (value: string) => {
    if (value === NEW_SESSION_VALUE) {
      props.onNewSession();
      return;
    }
    if (value.startsWith(DELETE_PREFIX)) {
      props.onDeleteSession(value.slice(DELETE_PREFIX.length));
      return;
    }
    props.onSelectSession(value);
  };

  return <Wrapper
    className="agent-session-picker"
    onSelection={value => handleSelection(value as string)}
  >
    <Button
      className="maputnik-button agent-session-picker__button"
      disabled={!props.sessionsReady}
      data-wd-key="agent-console:session-picker"
    >
      <span className="agent-session-picker__title">
        {title}
      </span>
      <MdArrowDropDown />
    </Button>
    <Menu>
      <ul className="agent-session-picker__menu" data-wd-key="agent-console:sessions">
        <li>
          <MenuItem
            value={NEW_SESSION_VALUE}
            className="agent-session-picker__item agent-session-picker__new"
            data-wd-key="agent-console:new-session"
          >
            <MdAdd />
            {t("New session")}
          </MenuItem>
        </li>
        {props.sessions.map(session => <li key={session.id} className="agent-session-picker__row">
          <MenuItem
            value={session.id}
            className={`agent-session-picker__item agent-session-picker__select ${session.id === props.activeSessionId ? "agent-session-picker__select--active" : ""}`}
            data-wd-key={`agent-console:session:${session.id}`}
          >
            {session.title}
          </MenuItem>
          <MenuItem
            value={`${DELETE_PREFIX}${session.id}`}
            className="agent-session-picker__item agent-session-picker__delete"
            aria-label={t("Delete session")}
            data-wd-key={`agent-console:delete-session:${session.id}`}
          >
            <MdDelete />
          </MenuItem>
        </li>)}
      </ul>
    </Menu>
  </Wrapper>;
}
