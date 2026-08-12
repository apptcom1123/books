class LibraryApi {
  async request(method, endpoint, body) {
    const token = await window.libraryAuth.token();
    const headers = { Accept: "application/json" };
    if (token) headers.Authorization = `Bearer ${token}`;
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const response = await fetch(`/api${endpoint}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: "same-origin",
    });
    let result = null;
    try { result = await response.json(); } catch { result = {}; }
    if (!response.ok) {
      const error = new Error(result.message || "要求失敗");
      error.status = response.status;
      error.code = result.error;
      throw error;
    }
    return result;
  }

  get(endpoint) { return this.request("GET", endpoint); }
  post(endpoint, body = {}) { return this.request("POST", endpoint, body); }
  put(endpoint, body = {}) { return this.request("PUT", endpoint, body); }
}

window.libraryApi = new LibraryApi();
