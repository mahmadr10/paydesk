import axios, { AxiosError, type InternalAxiosRequestConfig } from "axios";
import { API_BASE_URL } from "../config";

// The access token now lives ONLY in memory (a plain module variable) -
// never in localStorage. This is the frontend half of the access/refresh
// upgrade: since the refresh token sits in an httpOnly cookie the browser
// manages automatically, the frontend never needs to persist anything
// itself. The trade-off is that a hard page refresh loses the in-memory
// token - AuthContext handles that by calling /auth/refresh once on
// startup, which silently exchanges the still-valid cookie for a fresh
// access token.
let accessToken: string | null = null;
export function setAccessToken(token: string | null) {
  accessToken = token;
}
export function getAccessToken() {
  return accessToken;
}

export const api = axios.create({
  baseURL: API_BASE_URL,
  // Required for the browser to send/receive the httpOnly refresh-token
  // cookie on a cross-origin request (frontend :5173, backend :4000).
  withCredentials: true,
});

api.interceptors.request.use((config) => {
  if (accessToken) {
    config.headers.Authorization = `Bearer ${accessToken}`;
  }
  return config;
});

// A separate, plain axios call for the refresh endpoint itself - it must
// NOT go through the response interceptor below (that would recurse: a
// failed refresh triggering another refresh attempt forever).
async function performRefresh() {
  const res = await axios.post(`${API_BASE_URL}/auth/refresh`, {}, { withCredentials: true });
  const { accessToken: newToken, user } = res.data.data;
  setAccessToken(newToken);
  return { accessToken: newToken as string, user };
}

let onAuthFailure: (() => void) | null = null;
export function registerAuthFailureHandler(fn: () => void) {
  onAuthFailure = fn;
}

// Response interceptor: if a request comes back 401 (access token expired -
// they only live 15 minutes), try ONE silent refresh and replay the
// original request. `_retry` stops this from looping if the refreshed
// request somehow 401s again (e.g. the refresh token itself is also dead -
// at that point we give up and log the user out).
declare module "axios" {
  interface InternalAxiosRequestConfig {
    _retry?: boolean;
  }
}

api.interceptors.response.use(
  (res) => res,
  async (error: AxiosError) => {
    const original = error.config as InternalAxiosRequestConfig | undefined;
    const isAuthEndpoint = original?.url?.includes("/auth/login") || original?.url?.includes("/auth/register");

    if (error.response?.status === 401 && original && !original._retry && !isAuthEndpoint) {
      original._retry = true;
      try {
        const { accessToken: newToken } = await performRefresh();
        original.headers.Authorization = `Bearer ${newToken}`;
        return api(original);
      } catch {
        setAccessToken(null);
        onAuthFailure?.();
      }
    }
    return Promise.reject(error);
  }
);

export { performRefresh };

export function getApiErrorMessage(err: unknown): string {
  if (axios.isAxiosError(err) && err.response?.data?.error?.message) {
    return err.response.data.error.message as string;
  }
  return "Something went wrong. Please try again.";
}

export function getApiErrorCode(err: unknown): string | null {
  if (axios.isAxiosError(err) && err.response?.data?.error?.code) {
    return err.response.data.error.code as string;
  }
  return null;
}
