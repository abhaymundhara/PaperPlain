const SOCIAL_SIGN_IN_PATH = "/api/better-auth/sign-in/social";

function buildSocialSignInPayload({
  provider,
  callbackURL,
  errorCallbackURL,
  newUserCallbackURL,
} = {}) {
  const body = { provider };
  if (callbackURL) body.callbackURL = callbackURL;
  if (errorCallbackURL) body.errorCallbackURL = errorCallbackURL;
  if (newUserCallbackURL) body.newUserCallbackURL = newUserCallbackURL;
  return body;
}

function getSocialRedirectUrl(response) {
  if (!response || typeof response.url !== "string" || !response.url) {
    return null;
  }
  if (response.redirect === false) return null;
  return response.url;
}

if (typeof globalThis !== "undefined") {
  globalThis.SOCIAL_SIGN_IN_PATH = SOCIAL_SIGN_IN_PATH;
  globalThis.buildSocialSignInPayload = buildSocialSignInPayload;
  globalThis.getSocialRedirectUrl = getSocialRedirectUrl;
}
