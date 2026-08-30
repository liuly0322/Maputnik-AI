import {describe, expect, it} from "vitest";
import {
  getAccessTokens,
  replaceDevelopmentOpenMapTilesToken,
} from "./tokens";

const localhostToken = "get_your_own_OpIi9ZULNHzrESv6T2vL";

describe("getAccessTokens", () => {
  it("selects the OpenMapTiles token by hostname", () => {
    for (const hostname of ["localhost", "127.0.0.1", "127.255.255.255", "::1", "[::1]"]) {
      expect(getAccessTokens(hostname).openmaptiles).toBe(localhostToken);
    }
    expect(getAccessTokens("example.com").openmaptiles).not.toBe(localhostToken);
  });

  it("replaces the development OpenMapTiles token with the selected token", () => {
    const styleUrl = `https://api.maptiler.com/maps/openstreetmap/style.json?key=${localhostToken}`;
    const localhostResult = replaceDevelopmentOpenMapTilesToken(
      styleUrl,
      getAccessTokens("localhost").openmaptiles
    );
    const hostedResult = replaceDevelopmentOpenMapTilesToken(
      styleUrl,
      getAccessTokens("example.com").openmaptiles
    );

    expect(localhostResult).toBe(styleUrl);
    expect(hostedResult).not.toContain(localhostToken);
  });
});
