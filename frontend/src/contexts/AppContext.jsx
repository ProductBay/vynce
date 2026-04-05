import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useAuth } from "../components/AuthContext";

const AppContext = createContext(null);

function getCallKey(call) {
  return call?._id || call?.id || call?.uuid || null;
}

function mergeCalls(previousCalls, incomingCalls) {
  const callMap = new Map();

  previousCalls.forEach((call) => {
    const key = getCallKey(call);
    if (key) callMap.set(key, call);
  });

  incomingCalls.forEach((call) => {
    const key = getCallKey(call);
    if (!key) return;
    callMap.set(key, { ...callMap.get(key), ...call });
  });

  return Array.from(callMap.values()).sort(
    (left, right) =>
      new Date(right.createdAt || 0).getTime() -
      new Date(left.createdAt || 0).getTime()
  );
}

export function AppProvider({ children }) {
  const { authFetch, socket, user, loading: authLoading } = useAuth();
  const [calls, setCalls] = useState([]);
  const [bulkStatus, setBulkStatus] = useState(null);
  const [loadingCalls, setLoadingCalls] = useState(false);
  const hasHydratedRef = useRef(false);

  const refreshCalls = useCallback(async () => {
    if (authLoading || !user) return [];

    setLoadingCalls(true);
    try {
      const response = await authFetch("/api/calls");
      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(payload.message || "Failed to fetch calls");
      }

      const nextCalls = Array.isArray(payload)
        ? payload
        : Array.isArray(payload.calls)
        ? payload.calls
        : [];

      setCalls((previousCalls) => mergeCalls(previousCalls, nextCalls));
      return nextCalls;
    } finally {
      setLoadingCalls(false);
    }
  }, [authFetch, authLoading, user]);

  const makeCall = useCallback(
    async ({ to, agent }) => {
      const response = await authFetch("/api/make-call", {
        method: "POST",
        body: JSON.stringify({ to, agent }),
      });
      const payload = await response.json().catch(() => ({}));

      if (!response.ok || !payload.success) {
        throw new Error(payload.message || "Call failed");
      }

      const nextCall = payload.call || payload.data;
      if (nextCall) {
        setCalls((previousCalls) => mergeCalls(previousCalls, [nextCall]));
      } else {
        await refreshCalls();
      }

      return payload;
    },
    [authFetch, refreshCalls]
  );

  const endCall = useCallback(
    async (uuid) => {
      if (!uuid) {
        throw new Error("A call uuid is required");
      }

      const response = await authFetch("/api/end-call", {
        method: "POST",
        body: JSON.stringify({ uuid }),
      });
      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(payload.message || "Failed to end call");
      }

      if (payload.call) {
        setCalls((previousCalls) => mergeCalls(previousCalls, [payload.call]));
      } else {
        await refreshCalls();
      }

      return payload;
    },
    [authFetch, refreshCalls]
  );

  const saveCallNotes = useCallback(
    async ({ uuid, content, outcome }) => {
      if (!uuid) {
        throw new Error("A call uuid is required");
      }

      const response = await authFetch(`/api/calls/${uuid}/notes`, {
        method: "POST",
        body: JSON.stringify({ content, outcome }),
      });
      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(payload.message || "Failed to save notes");
      }

      if (payload.call) {
        setCalls((previousCalls) => mergeCalls(previousCalls, [payload.call]));
      }

      return payload;
    },
    [authFetch]
  );

  useEffect(() => {
    if (authLoading || !user || hasHydratedRef.current) return;

    hasHydratedRef.current = true;
    refreshCalls().catch((error) => {
      console.error("Failed to hydrate app calls:", error);
    });
  }, [authLoading, refreshCalls, user]);

  useEffect(() => {
    if (!user) {
      hasHydratedRef.current = false;
      setCalls([]);
      setBulkStatus(null);
    }
  }, [user]);

  useEffect(() => {
    if (!socket) return;

    const handleCallUpdate = (updatedCall) => {
      setCalls((previousCalls) => mergeCalls(previousCalls, [updatedCall]));
    };

    const handleBulkStatusUpdate = (status) => {
      setBulkStatus(status);
    };

    socket.on("callUpdate", handleCallUpdate);
    socket.on("bulkStatusUpdate", handleBulkStatusUpdate);

    return () => {
      socket.off("callUpdate", handleCallUpdate);
      socket.off("bulkStatusUpdate", handleBulkStatusUpdate);
    };
  }, [socket]);

  const value = useMemo(
    () => ({
      calls,
      bulkStatus,
      loadingCalls,
      refreshCalls,
      makeCall,
      endCall,
      saveCallNotes,
    }),
    [bulkStatus, calls, endCall, loadingCalls, makeCall, refreshCalls, saveCallNotes]
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useAppContext() {
  const context = useContext(AppContext);

  if (!context) {
    throw new Error("useAppContext must be used within AppProvider");
  }

  return context;
}
