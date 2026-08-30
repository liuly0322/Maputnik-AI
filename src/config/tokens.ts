const localhostOpenMapTilesToken = "get_your_own_OpIi9ZULNHzrESv6T2vL";

const defaultAccessTokens = {
  openmaptiles: "Noqb4W4vQdKD35XHMJh0",
  thunderforest: "b71f7f0ba4064f5eb9e903859a9cf5c6",
  locationiq: "pk.put_your_api_key_here7bb23dffeb4",
};

function getAccessTokens(hostname: string) {
  return {
    ...defaultAccessTokens,
    openmaptiles: hostname.toLowerCase() === "localhost"
      ? localhostOpenMapTilesToken
      : defaultAccessTokens.openmaptiles,
  };
}

const hostname = typeof window === "undefined" ? "" : window.location.hostname;
const tokens = getAccessTokens(hostname);

export { getAccessTokens };
export default tokens;
