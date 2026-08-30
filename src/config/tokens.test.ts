import {describe, expect, it} from "vitest";
import {getAccessTokens} from "./tokens";

describe("getAccessTokens", () => {
  it("selects the OpenMapTiles token by hostname", () => {
    const localhostToken = "get_your_own_OpIi9ZULNHzrESv6T2vL";

    expect(getAccessTokens("localhost").openmaptiles).toBe(localhostToken);
    expect(getAccessTokens("example.com").openmaptiles).not.toBe(localhostToken);
  });
});
