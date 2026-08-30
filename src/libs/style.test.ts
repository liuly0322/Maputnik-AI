import {describe, expect, it} from "vitest";
import type {StyleSpecification} from "maplibre-gl";
import {replaceAccessTokenInUrl} from "./style";

describe("replaceAccessTokenInUrl", () => {
  it("replaces MapTiler placeholders and the development token", () => {
    const accessToken = "style-specific-token";
    const mapStyle = {
      version: 8,
      sources: {},
      layers: [],
      metadata: {"maputnik:openmaptiles_access_token": accessToken},
    } as StyleSpecification;
    const developmentTokenUrl = "https://api.maptiler.com/fonts/{fontstack}/{range}.pbf?key=get_your_own_OpIi9ZULNHzrESv6T2vL";
    const placeholderUrl = "https://api.maptiler.com/tiles/v3-openmaptiles/tiles.json?key={key}";

    expect(replaceAccessTokenInUrl(developmentTokenUrl, mapStyle)).toContain(`key=${accessToken}`);
    expect(replaceAccessTokenInUrl(placeholderUrl, mapStyle)).toContain(`key=${accessToken}`);
  });
});
