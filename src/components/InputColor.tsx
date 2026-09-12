import React from "react";
import Color from "color";
import {HexColorInput, RgbaStringColorPicker} from "react-colorful";
import { throttle } from "lodash-es";

function toRgbaString(value: string | undefined, alpha?: number): string {
  const color = Color(value);
  const {r, g, b} = color.rgb().object();
  return `rgba(${r}, ${g}, ${b}, ${alpha ?? color.alpha()})`;
}

export type InputColorProps = {
  onChange(...args: unknown[]): unknown
  name?: string
  value?: string
  doc?: string
  style?: object
  default?: string
  "aria-label"?: string
};

/*** Number fields with support for min, max and units and documentation*/
export class InputColor extends React.Component<InputColorProps> {
  state = {
    pickerOpened: false,
    hexEditing: null as string | null
  };
  colorInput: HTMLInputElement | null = null;

  constructor (props: InputColorProps) {
    super(props);
    this.onChangeNoCheck = throttle(this.onChangeNoCheck, 1000/30);
  }

  onChangeNoCheck = (v: string) => {
    this.props.onChange(v);
  };

  //TODO: I much rather would do this with absolute positioning
  //but I am too stupid to get it to work together with fixed position
  //and scrollbars so I have to fallback to JavaScript
  calcPickerOffset = () => {
    const elem = this.colorInput;
    if(elem) {
      const pos = elem.getBoundingClientRect();
      return {
        top: pos.top,
        left: pos.left + 196,
      };
    } else {
      return {
        top: 160,
        left: 555,
      };
    }
  };

  togglePicker = () => {
    this.setState({ pickerOpened: !this.state.pickerOpened });
  };

  get color() {
    // Catch invalid color.
    try {
      return toRgbaString(this.props.value);
    }
    catch(err) {
      console.warn("Error parsing color: ", err);
      return "rgba(255, 255, 255, 1)";
    }
  }

  get hexColor(): string {
    if (this.state.hexEditing !== null) {
      return this.state.hexEditing;
    }
    try {
      return Color(this.props.value).hex();
    }
    catch {
      return "";
    }
  }

  onHexFocus = () => {
    this.setState({ hexEditing: this.hexColor });
  };

  onHexBlur = () => {
    this.setState({ hexEditing: null });
  };

  onHexChange = (hex: string) => {
    try {
      this.onChangeNoCheck(toRgbaString(hex, Color(this.props.value).alpha()));
    }
    catch(err) {
      console.warn("Error parsing hex color: ", err);
    }
  };

  onChange (v: string) {
    this.props.onChange(v === "" ? undefined : v);
  }

  render() {
    const offset = this.calcPickerOffset();

    const picker = <div
      className="maputnik-color-picker-offset maputnik-color-picker"
      style={{
        position: "fixed",
        zIndex: 1,
        left: offset.left,
        top: offset.top,
      }}>
      <RgbaStringColorPicker
        color={this.color}
        onChange={this.onChangeNoCheck}
      />
      {/* A wrapper only so focus and blur of the field can be tracked; the
          input overrides `onBlur` internally, so it cannot be passed down. */}
      <div onFocus={this.onHexFocus} onBlur={this.onHexBlur}>
        <HexColorInput
          className="maputnik-color-picker-hex"
          color={this.hexColor}
          prefixed
          onChange={this.onHexChange}
        />
      </div>
      <div
        className="maputnik-color-picker-offset"
        onClick={this.togglePicker}
        style={{
          zIndex: -1,
          position: "fixed",
          top: "0px",
          right: "0px",
          bottom: "0px",
          left: "0px",
        }}
      />
    </div>;

    const swatchStyle = {
      backgroundColor: this.props.value
    };

    return <div className="maputnik-color-wrapper">
      {this.state.pickerOpened && picker}
      <div className="maputnik-color-swatch" style={swatchStyle}></div>
      <input
        aria-label={this.props["aria-label"]}
        spellCheck="false"
        autoComplete="off"
        className="maputnik-color"
        ref={(input) => {this.colorInput = input;}}
        onClick={this.togglePicker}
        style={this.props.style}
        name={this.props.name}
        placeholder={this.props.default}
        value={this.props.value ? this.props.value : ""}
        onChange={(e) => this.onChange(e.target.value)}
      />
    </div>;
  }
}
