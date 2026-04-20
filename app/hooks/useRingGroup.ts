"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";

export interface IncomingGroupCall {
  call_control_id?: string;
  from: string;
  to: string;
  group_id: string;
  group_name: string;
  strategy: "simultaneous" | "round_robin";
  member_user_ids: string[];
  ring_timeout_seconds: number;
  sent_at: string;
}

export interface RingGroupPickup {
  group_id: string;
  call_control_id?: string;
  by_user_id: string;
  by_name: string;
}

interface UseRingGroupArgs {
  userId: string | null;
  currentUserName?: string;
}

/**
 * Subscribes to Supabase Realtime broadcasts on `user:${userId}`:
 *   - `incoming_group_call` — shown as an overlay decoration
 *   - `ring_group_pickup`   — another agent claimed the call; dismiss overlay
 *
 * Exposes `claimPickup()` for the accepting client to broadcast the pickup
 * to every other member of the group.
 */
export function useRingGroup({ userId, currentUserName }: UseRingGroupArgs) {
  const [groupCall, setGroupCall] = useState<IncomingGroupCall | null>(null);
  const [pickupToast, setPickupToast] = useState<RingGroupPickup | null>(null);

  // Track what the user is currently seeing so we can compare on pickup events.
  const groupCallRef = useRef<IncomingGroupCall | null>(null);
  groupCallRef.current = groupCall;

  const supabase = createClient();

  // Broadcast pickup to every other member. Called by the client that accepts.
  const claimPickup = useCallback(
    async (payload: { call_control_id?: string; group_id: string; member_user_ids: string[] }) => {
      if (!userId) return;
      const targets = payload.member_user_ids.filter((u) => u !== userId);
      for (const target of targets) {
        const ch = supabase.channel(`user:${target}`, {
          config: { broadcast: { ack: false, self: false } },
        });
        await ch.subscribe();
        await ch.send({
          type: "broadcast",
          event: "ring_group_pickup",
          payload: {
            group_id: payload.group_id,
            call_control_id: payload.call_control_id,
            by_user_id: userId,
            by_name: currentUserName || "a teammate",
          } satisfies RingGroupPickup,
        });
        await supabase.removeChannel(ch);
      }
    },
    [userId, currentUserName, supabase]
  );

  const dismissGroupCall = useCallback(() => setGroupCall(null), []);
  const dismissToast = useCallback(() => setPickupToast(null), []);

  useEffect(() => {
    if (!userId) return;
    const channel = supabase.channel(`user:${userId}`);

    channel
      .on("broadcast", { event: "incoming_group_call" }, ({ payload }) => {
        console.log("[ring-group] incoming", payload);
        setGroupCall(payload as IncomingGroupCall);
      })
      .on("broadcast", { event: "ring_group_pickup" }, ({ payload }) => {
        console.log("[ring-group] pickup", payload);
        const p = payload as RingGroupPickup;
        // Only clear if we were showing the same group
        if (groupCallRef.current?.group_id === p.group_id) {
          setGroupCall(null);
          setPickupToast(p);
          setTimeout(() => setPickupToast(null), 3500);
        }
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId, supabase]);

  return { groupCall, pickupToast, claimPickup, dismissGroupCall, dismissToast };
}
