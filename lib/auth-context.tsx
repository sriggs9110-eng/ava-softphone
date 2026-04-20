"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  ReactNode,
} from "react";
import { createClient } from "@/lib/supabase/client";

export interface SoftphoneUser {
  id: string;
  email: string;
  full_name: string;
  role: "agent" | "manager" | "admin";
  extension: string | null;
  status: string;
  pepper_spice?: "mild" | "medium" | "hot" | null;
}

interface AuthContextValue {
  user: SoftphoneUser | null;
  isManager: boolean;
  isAdmin: boolean;
  loading: boolean;
  updateStatus: (status: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  isManager: false,
  isAdmin: false,
  loading: true,
  updateStatus: async () => {},
  logout: async () => {},
  refresh: async () => {},
});

export function useAuth() {
  return useContext(AuthContext);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SoftphoneUser | null>(null);
  const [loading, setLoading] = useState(true);
  const supabase = createClient();

  const fetchUser = useCallback(async () => {
    const {
      data: { user: authUser },
    } = await supabase.auth.getUser();

    if (!authUser) {
      setUser(null);
      setLoading(false);
      return;
    }

    const { data, error } = await supabase
      .from("softphone_users")
      .select("id, email, full_name, role, extension, status, pepper_spice")
      .eq("id", authUser.id)
      .single();

    if (error) {
      console.error("[AuthContext] Failed to fetch softphone_users row:", error);
    }

    if (data) {
      setUser(data as SoftphoneUser);
    }
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    fetchUser();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(() => {
      fetchUser();
    });

    return () => subscription.unsubscribe();
  }, [supabase, fetchUser]);

  // Set status to offline on browser close
  useEffect(() => {
    if (!user) return;
    const handleUnload = () => {
      // Use sendBeacon for reliable delivery on page close
      const url = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/softphone_users?id=eq.${user.id}`;
      const body = JSON.stringify({ status: "offline" });
      navigator.sendBeacon(
        url,
        new Blob([body], { type: "application/json" })
      );
    };
    window.addEventListener("beforeunload", handleUnload);
    return () => window.removeEventListener("beforeunload", handleUnload);
  }, [user]);

  // Set status to available on login
  useEffect(() => {
    if (!user) return;
    if (user.status === "offline") {
      supabase
        .from("softphone_users")
        .update({ status: "available" })
        .eq("id", user.id)
        .then(() => {
          setUser((prev) => (prev ? { ...prev, status: "available" } : null));
        });
    }
  }, [user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const updateStatus = useCallback(
    async (status: string) => {
      if (!user) return;
      await supabase
        .from("softphone_users")
        .update({ status })
        .eq("id", user.id);
      setUser((prev) => (prev ? { ...prev, status } : null));
    },
    [user, supabase]
  );

  const logout = useCallback(async () => {
    if (user) {
      await supabase
        .from("softphone_users")
        .update({ status: "offline" })
        .eq("id", user.id);
    }
    await supabase.auth.signOut();
    setUser(null);
    window.location.href = "/login";
  }, [user, supabase]);

  const isManager = user?.role === "manager" || user?.role === "admin";
  const isAdmin = user?.role === "admin";

  return (
    <AuthContext.Provider
      value={{
        user,
        isManager,
        isAdmin,
        loading,
        updateStatus,
        logout,
        refresh: fetchUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}
