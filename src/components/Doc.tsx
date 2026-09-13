import React from "react";

type DocProps = {
  fieldSpec: {
    doc?: string
    values?: {
      [key: string]: {
        doc?: string
      }
    }
    docUrl?: string,
    docUrlLinkText?: string
  }
};

export class Doc extends React.Component<DocProps> {
  render () {
    const {fieldSpec} = this.props;

    const {doc, values, docUrl, docUrlLinkText} = fieldSpec;

    const renderValues = (
      !!values &&
      // HACK: Currently we merge additional values into the style spec, so this is required
      // See <https://github.com/maplibre/maputnik/blob/main/src/components/PropertyGroup.jsx#L16>
      !Array.isArray(values)
    );

    return (
      <>
        {doc &&
          <div className="SpecDoc">
            <div className="SpecDoc__doc" data-wd-key='spec-field-doc'>
              {doc}
            </div>
            {renderValues &&
              <ul className="SpecDoc__values">
                {Object.entries(values).map(([key, value]) => {
                  return (
                    <li key={key}>
                      <code>{JSON.stringify(key)}</code>
                      <div>{value.doc}</div>
                    </li>
                  );
                })}
              </ul>
            }
          </div>
        }
        {docUrl && docUrlLinkText &&
          <div className="SpecDoc__learn-more">
            <a href={docUrl}  target="_blank" rel="noreferrer">{docUrlLinkText}</a>
          </div>
        }
      </>
    );
  }
}
