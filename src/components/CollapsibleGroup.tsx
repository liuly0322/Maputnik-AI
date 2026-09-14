import React from "react";
import {MdArrowDropDown, MdArrowDropUp} from "react-icons/md";
import {
  AccordionItem,
  AccordionItemHeading,
  AccordionItemButton,
  AccordionItemPanel,
} from "react-accessible-accordion";


type CollapsibleGroupProps = {
  "id"?: string
  "data-wd-key"?: string
  title: string
  /** Namespaces this group's test id, so sharing panels do not collide. */
  testIdPrefix: string
  children: React.ReactElement
};


/**
 * A titled section that collapses, shared by the layer editor and the agent
 * console. Expansion is owned by the surrounding `Accordion` and the arrow
 * icons follow `aria-expanded`, so this holds no state of its own.
 */
export class CollapsibleGroup extends React.Component<CollapsibleGroupProps> {
  render() {
    return <AccordionItem uuid={this.props.id}>
      <AccordionItemHeading className="maputnik-collapsible-group"
        data-wd-key={this.props.testIdPrefix + ":" + this.props["data-wd-key"]}
      >
        <AccordionItemButton className="maputnik-collapsible-group__button">
          <span style={{flexGrow: 1, alignContent: "center"}}>{this.props.title}</span>
          <MdArrowDropUp size={"2em"} className="maputnik-collapsible-group__button__icon maputnik-collapsible-group__button__icon--up"></MdArrowDropUp>
          <MdArrowDropDown size={"2em"} className="maputnik-collapsible-group__button__icon maputnik-collapsible-group__button__icon--down"></MdArrowDropDown>
        </AccordionItemButton>
      </AccordionItemHeading>
      <AccordionItemPanel>
        {this.props.children}
      </AccordionItemPanel>
    </AccordionItem>;
  }
}
