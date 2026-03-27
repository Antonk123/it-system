/**
 * Token Refresh Logic
 * Handles automatic refresh of JWT access tokens using refresh tokens
 */

import axios from 'axios';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

let isRefreshing = false;
let refreshSubscribers: Array<(token: string) => void> = [];

// Subscribe to token refresh
function subscribeTokenRefresh(callback: (token: string) => void) {
  refreshSubscribers.push(callback);
}

// Notify all subscribers when token is refreshed
function onRefreshed(token: string) {
  refreshSubscribers.forEach(callback => callback(token));
  refreshSubscribers = [];
}

/**
 * Refresh access token using refresh token
 * @returns New access token or null if refresh fails
 */
export async function refreshAccessToken(): Promise<string | null> {
  try {
    const refreshToken = localStorage.getItem('refreshToken');

    if (!refreshToken) {
      console.error('No refresh token available');
      return null;
    }

    const response = await axios.post(`${API_URL}/api/auth/refresh`, {
      refreshToken,
    });

    const { accessToken } = response.data;

    // Store new access token
    localStorage.setItem('auth_token', accessToken);

    return accessToken;
  } catch (error) {
    console.error('Failed to refresh token:', error);

    // Clear tokens on refresh failure
    localStorage.removeItem('auth_token');
    localStorage.removeItem('refreshToken');

    // Redirect to login
    window.location.href = '/login';

    return null;
  }
}

/**
 * Setup axios interceptor for automatic token refresh
 */
export function setupTokenRefreshInterceptor() {
  // Request interceptor: Add token to all requests
  axios.interceptors.request.use(
    (config) => {
      const token = localStorage.getItem('auth_token');

      if (token && config.headers) {
        config.headers.Authorization = `Bearer ${token}`;
      }

      return config;
    },
    (error) => {
      return Promise.reject(error);
    }
  );

  // Response interceptor: Handle 401 errors with token refresh
  axios.interceptors.response.use(
    (response) => response,
    async (error) => {
      const originalRequest = error.config;

      // If error is 401 and we haven't tried to refresh yet
      if (error.response?.status === 401 && !originalRequest._retry) {
        if (isRefreshing) {
          // If already refreshing, queue this request
          return new Promise((resolve) => {
            subscribeTokenRefresh((token: string) => {
              originalRequest.headers.Authorization = `Bearer ${token}`;
              resolve(axios(originalRequest));
            });
          });
        }

        originalRequest._retry = true;
        isRefreshing = true;

        try {
          const newToken = await refreshAccessToken();

          if (newToken) {
            // Update authorization header
            originalRequest.headers.Authorization = `Bearer ${newToken}`;

            // Notify all queued requests
            onRefreshed(newToken);

            isRefreshing = false;

            // Retry original request with new token
            return axios(originalRequest);
          } else {
            isRefreshing = false;
            return Promise.reject(error);
          }
        } catch (refreshError) {
          isRefreshing = false;
          return Promise.reject(refreshError);
        }
      }

      return Promise.reject(error);
    }
  );
}

/**
 * Logout and clear all tokens
 */
export async function logout() {
  try {
    const refreshToken = localStorage.getItem('refreshToken');

    if (refreshToken) {
      // Notify backend to revoke refresh token
      await axios.post(`${API_URL}/api/auth/logout`, { refreshToken });
    }
  } catch (error) {
    console.error('Error during logout:', error);
  } finally {
    // Clear local storage
    localStorage.removeItem('auth_token');
    localStorage.removeItem('refreshToken');
    localStorage.removeItem('user');

    // Redirect to login
    window.location.href = '/login';
  }
}
