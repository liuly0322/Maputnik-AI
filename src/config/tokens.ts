const localhostOpenMapTilesToken = "get_your_own_OpIi9ZULNHzrESv6T2vL";

const defaultAccessTokens = {
  openmaptiles: "Noqb4W4vQdKD35XHMJh0",
  thunderforest: "b71f7f0ba4064f5eb9e903859a9cf5c6",
  locationiq: "pk.put_your_api_key_here7bb23dffeb4",
};

function isLocalDevelopmentHostname(hostname: string) {
  const normalizedHostname = hostname.toLowerCase();
  return normalizedHostname === "localhost"
    || normalizedHostname.startsWith("127.")
    || normalizedHostname === "::1"
    || normalizedHostname === "[::1]";
}

function getAccessTokens(hostname: string) {
  return {
    ...defaultAccessTokens,
    openmaptiles: isLocalDevelopmentHostname(hostname)
      ? localhostOpenMapTilesToken
      : defaultAccessTokens.openmaptiles,
  };
}

const hostname = typeof window === "undefined" ? "" : window.location.hostname;
const tokens = getAccessTokens(hostname);

function replaceDevelopmentOpenMapTilesToken(
  value: string,
  replacementToken = tokens.openmaptiles
) {
  return value.replace(localhostOpenMapTilesToken, replacementToken);
}

export {
  getAccessTokens,
  isLocalDevelopmentHostname,
  replaceDevelopmentOpenMapTilesToken,
};
export default tokens;
