import axios from "axios";
import { API_BASE_URL, API_URL, resolveApiUrl } from "./api";

const apiClient = axios.create({
  baseURL: API_BASE_URL || "",
  withCredentials: true,
});

apiClient.interceptors.request.use(
  (config) => {
    const originalUrl = String(config.url || "").trim();

    if (!originalUrl) {
      config.url = API_URL;
      return config;
    }

    if (/^https?:\/\//i.test(originalUrl)) {
      return config;
    }

    if (originalUrl.startsWith("/api/")) {
      config.url = resolveApiUrl(originalUrl);
      return config;
    }

    if (originalUrl.startsWith("/")) {
      config.url = resolveApiUrl(`/api${originalUrl}`);
      return config;
    }

    config.url = resolveApiUrl(`/api/${originalUrl}`);
    return config;
  },
  (error) => Promise.reject(error)
);

apiClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;

    if (originalRequest._retry) return Promise.reject(error);

    const isAuthRoute =
      originalRequest.url?.includes("/auth/login") ||
      originalRequest.url?.includes("/auth/refresh");

    if (isAuthRoute) {
      return Promise.reject(error);
    }

    if (error.response?.status === 401 && !originalRequest._retry) {
      originalRequest._retry = true;

      try {
        const refreshResponse = await axios.post(
          resolveApiUrl("/api/auth/refresh"),
          {},
          { withCredentials: true }
        );

        const newAccessToken = refreshResponse.data?.token;

        if (!newAccessToken) {
          throw new Error("Refresh successful but no token received");
        }

        localStorage.setItem("vynce_token", newAccessToken);
        apiClient.defaults.headers.common.Authorization = `Bearer ${newAccessToken}`;

        originalRequest.headers.Authorization = `Bearer ${newAccessToken}`;
        return apiClient(originalRequest);
      } catch (refreshError) {
        console.error("Token refresh failed:", refreshError.message);

        localStorage.removeItem("vynce_token");
        delete apiClient.defaults.headers.common.Authorization;

        return Promise.reject(refreshError);
      }
    }

    return Promise.reject(error);
  }
);

export default apiClient;
