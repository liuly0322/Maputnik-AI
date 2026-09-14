import React from "react";
import classnames from "classnames";
import { ScrollContainer } from "./ScrollContainer";
import { type WithTranslation, withTranslation } from "react-i18next";
import { IconContext } from "react-icons";

type AppLayoutInternalProps = {
  toolbar: React.ReactElement
  layerList: React.ReactElement
  layerEditor?: React.ReactElement
  codeEditor?: React.ReactElement
  map: React.ReactElement
  agent?: React.ReactElement
  /** Whether the agent column is expanded. It stays mounted while closed. */
  agentOpen: boolean
  /** Width of the agent column in pixels, used while it is open. */
  agentWidth: number
  bottom?: React.ReactElement
  modals?: React.ReactNode
} & WithTranslation;

/** Allows the layout to hand CSS custom properties to its stylesheet. */
type LayoutStyle = React.CSSProperties & Record<`--${string}`, string>;

class AppLayoutInternal extends React.Component<AppLayoutInternalProps> {

  render() {
    document.body.dir = this.props.i18n.dir();

    // The drawer exists only when there is a layer to edit and the user has not
    // collapsed it. The class below gives the fixed bottom panel the offset it
    // cannot take from the flex row.
    const showDrawer = !this.props.codeEditor && Boolean(this.props.layerEditor);
    const layoutClassName = classnames("maputnik-layout", {
      "maputnik-layout--code-editor": Boolean(this.props.codeEditor),
      "maputnik-layout--drawer-collapsed": !this.props.codeEditor && !showDrawer,
    });

    // An open panel sets the column's width; a closed one leaves the
    // stylesheet default of 0, since the column stays mounted.
    const layoutStyle: LayoutStyle | undefined = this.props.agentOpen
      ? {"--layout-agent-width": `${this.props.agentWidth}px`}
      : undefined;

    return <IconContext.Provider value={{size: "14px"}}>
      <div className={layoutClassName} style={layoutStyle}>
        {this.props.toolbar}
        <div className="maputnik-layout-main">
          {this.props.codeEditor && <div className="maputnik-layout-code-editor">
            <ScrollContainer>
              {this.props.codeEditor}
            </ScrollContainer>
          </div>
          }
          {!this.props.codeEditor && <>
            <div className="maputnik-layout-list">
              {this.props.layerList}
            </div>
            {showDrawer && <div className="maputnik-layout-drawer">
              <ScrollContainer>
                {this.props.layerEditor}
              </ScrollContainer>
            </div>}
          </>}
          {this.props.map}
          {this.props.agent && <div className="maputnik-layout-agent">
            {this.props.agent}
          </div>}
        </div>
        {this.props.bottom && <div className="maputnik-layout-bottom">
          {this.props.bottom}
        </div>
        }
        {this.props.modals}
      </div>
    </IconContext.Provider>;
  }
}

export const AppLayout = withTranslation()(AppLayoutInternal);
