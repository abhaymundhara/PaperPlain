import assert from "node:assert/strict";
import test from "node:test";

const loadHelpers = async () => {
  await import("../public/auth-helpers.js");
  return {
    SOCIAL_SIGN_IN_PATH: globalThis.SOCIAL_SIGN_IN_PATH,
    buildSocialSignInPayload: globalThis.buildSocialSignInPayload,
    getSocialRedirectUrl: globalThis.getSocialRedirectUrl,
  };
};

test("buildSocialSignInPayload includes provider and optional callback URLs", async () => {
  const { buildSocialSignInPayload } = await loadHelpers();
  const payload = buildSocialSignInPayload({
    provider: "google",
    callbackURL: "/",
    errorCallbackURL: "/auth/error",
    newUserCallbackURL: "/auth/new",
  });

  assert.deepEqual(payload, {
    provider: "google",
    callbackURL: "/",
    errorCallbackURL: "/auth/error",
    newUserCallbackURL: "/auth/new",
  });
});

test("getSocialRedirectUrl returns url when redirect is true", async () => {
  const { getSocialRedirectUrl } = await loadHelpers();
  const url = getSocialRedirectUrl({
    url: "https://accounts.google.com/o/oauth2/v2/auth",
    redirect: true,
  });

  assert.equal(url, "https://accounts.google.com/o/oauth2/v2/auth");
});

test("getSocialRedirectUrl returns null when redirect is false", async () => {
  const { getSocialRedirectUrl } = await loadHelpers();
  const url = getSocialRedirectUrl({ url: "https://example.com", redirect: false });

  assert.equal(url, null);
});

test("uses the Better Auth social sign-in path", async () => {
  const { SOCIAL_SIGN_IN_PATH } = await loadHelpers();

  assert.equal(SOCIAL_SIGN_IN_PATH, "/api/better-auth/sign-in/social");
});
