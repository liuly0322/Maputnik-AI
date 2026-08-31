import React from "react";
import {MdChevronRight, MdClose} from "react-icons/md";
import {useTranslation} from "react-i18next";
import type {StyleSpecification} from "maplibre-gl";

import {compareStyles, formatStyleChangePath, type StyleChange, type StyleChangeKind} from "../libs/style-change";

type AgentStyleChangePreviewProps = {
  before: StyleSpecification;
  after: StyleSpecification;
  onClose(): void;
};

const GROUPS: StyleChangeKind[] = ["added", "changed", "removed"];

function jsonValue(value: unknown) {
  return JSON.stringify(value, null, 2) ?? String(value);
}

export function AgentStyleChangePreview({before, after, onClose}: AgentStyleChangePreviewProps) {
  const {t} = useTranslation();
  const changes = React.useMemo(() => compareStyles(before, after), [before, after]);
  const [expanded, setExpanded] = React.useState<Set<number>>(() => new Set());

  const toggle = (index: number) => {
    setExpanded(current => {
      const next = new Set(current);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  const counts = Object.fromEntries(GROUPS.map(kind => [kind, changes.filter(change => change.kind === kind).length])) as Record<StyleChangeKind, number>;

  return <aside className="agent-style-change-preview" id="agent-style-change-preview" data-wd-key="agent-style-change-preview">
    <header className="agent-style-change-preview-header">
      <div>
        <h2>{t("Style changes")}</h2>
        <div className="agent-style-change-counts">
          {GROUPS.map(kind => <span className={`agent-style-change-badge agent-style-change-badge--${kind}`} key={kind}>
            {t(kind === "added" ? "Added" : kind === "changed" ? "Changed" : "Removed")} {counts[kind]}
          </span>)}
        </div>
      </div>
      <button
        className="maputnik-button maputnik-button--with-icon agent-style-change-close"
        onClick={onClose}
        aria-label={t("Close style changes")}
        data-wd-key="agent-style-change-preview:close"
      >
        <MdClose />
      </button>
    </header>

    <div className="agent-style-change-preview-content">
      {changes.length === 0 && <p className="agent-style-change-empty" data-wd-key="agent-style-change-preview:empty">
        {t("No style changes in the latest turn")}
      </p>}
      {GROUPS.map(kind => {
        const group = changes.map((change, index) => ({change, index})).filter(item => item.change.kind === kind);
        if (group.length === 0) return null;
        return <section className="agent-style-change-group" key={kind} data-wd-key={`agent-style-change-preview:${kind}`}>
          <h3>{t(kind === "added" ? "Added" : kind === "changed" ? "Changed" : "Removed")}</h3>
          {group.map(({change, index}) => <StyleChangeItem
            key={`${change.kind}:${formatStyleChangePath(change.path)}`}
            change={change}
            index={index}
            open={expanded.has(index)}
            onToggle={() => toggle(index)}
          />)}
        </section>;
      })}
    </div>
  </aside>;
}

function StyleChangeItem({change, index, open, onToggle}: {change: StyleChange; index: number; open: boolean; onToggle(): void}) {
  const {t} = useTranslation();
  const contentId = `agent-style-change-${index}`;
  return <div className={`agent-style-change-item agent-style-change-item--${change.kind}`}>
    <button
      className="agent-style-change-item-toggle"
      onClick={onToggle}
      aria-expanded={open}
      aria-controls={contentId}
      data-wd-key={`agent-style-change-preview:item:${index}`}
    >
      <MdChevronRight className="agent-style-change-chevron" />
      <code>{formatStyleChangePath(change.path)}</code>
    </button>
    {open && <div className="agent-style-change-values" id={contentId}>
      {change.kind !== "added" && <StyleValue label={t("Before")} value={change.before} />}
      {change.kind !== "removed" && <StyleValue label={t("After")} value={change.after} />}
    </div>}
  </div>;
}

function StyleValue({label, value}: {label: string; value: unknown}) {
  return <section className="agent-style-change-value">
    <h4>{label}</h4>
    <pre>{jsonValue(value)}</pre>
  </section>;
}
