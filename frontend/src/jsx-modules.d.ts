declare module "*.jsx" {
  import type { ComponentType } from "react";

  const component: ComponentType<any>;
  export const AuthProvider: ComponentType<any>;
  export const AppProvider: ComponentType<any>;
  export const useAuth: (...args: any[]) => any;
  export const useAppContext: (...args: any[]) => any;
  export default component;
}

declare module "./components/AuthContext.jsx" {
  import type { ComponentType, ReactNode } from "react";

  export interface AuthContextValue {
    user: any;
    loading: boolean;
    login: (...args: any[]) => Promise<any>;
    register: (...args: any[]) => Promise<any>;
    logout: (...args: any[]) => Promise<any>;
    authFetch: (url: string, options?: RequestInit) => Promise<Response>;
    socket: any;
  }

  export const AuthProvider: ComponentType<{ children?: ReactNode }>;
  export function useAuth(): AuthContextValue;
}

declare module "./contexts/AppContext.jsx" {
  import type { ComponentType, ReactNode } from "react";

  export interface AppContextValue {
    calls: any[];
    bulkStatus: any;
    loadingCalls: boolean;
    refreshCalls: () => Promise<any[]>;
    makeCall: (payload: { to: string; agent?: string }) => Promise<any>;
    endCall: (uuid: string) => Promise<any>;
    saveCallNotes: (payload: {
      uuid: string;
      content: string;
      outcome: string;
    }) => Promise<any>;
  }

  export const AppProvider: ComponentType<{ children?: ReactNode }>;
  export function useAppContext(): AppContextValue;
}
