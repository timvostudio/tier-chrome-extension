// OAuth handling via chrome.identity.

async function getAuthToken(interactive = true) {
  return new Promise((resolve, reject) => {
    chrome.identity.getAuthToken({ interactive }, (token) => {
      if (chrome.runtime.lastError || !token) {
        reject(new Error(chrome.runtime.lastError?.message || "No auth token"));
        return;
      }
      resolve(token);
    });
  });
}

async function removeCachedToken(token) {
  return new Promise((resolve) => {
    chrome.identity.removeCachedAuthToken({ token }, () => resolve());
  });
}

async function fetchUserEmail(token) {
  const res = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error("Failed to fetch user info");
  const data = await res.json();
  return data.email;
}

async function fetchUserProfile(token) {
  const res = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error("Failed to fetch user profile");
  const data = await res.json();
  return {
    email:       data.email || "",
    given_name:  data.given_name || "",
    family_name: data.family_name || "",
  };
}

async function disconnect() {
  try {
    const token = await getAuthToken(false);
    await removeCachedToken(token);
    await fetch(`https://accounts.google.com/o/oauth2/revoke?token=${token}`);
  } catch (err) {
    // No cached token to revoke — already disconnected.
  }
  await self.TierStorage.setAuthState({ connected: false, email: null });
}

self.TierAuth = {
  getAuthToken,
  removeCachedToken,
  fetchUserEmail,
  fetchUserProfile,
  disconnect,
};
