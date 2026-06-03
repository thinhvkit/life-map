import { create } from 'zustand';
import { GpsPoint } from '../models/types';
import {
  GroupLivePoint,
  GroupUser,
  groupLiveLocationService,
} from '../services/groupLiveLocation';
import { LIVE_POINT_GROUP_ID } from '../config/liveShare';

export type MemberTrail = [number, number][];

interface GroupStore {
  authLoading: boolean;
  currentUser: GroupUser | null;
  groupId: string;
  liveMembers: GroupLivePoint[];
  memberTrails: Record<string, MemberTrail>;
  error: string | null;
  init: () => () => void;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
  publishPosition: (point: GpsPoint) => Promise<void>;
  markStationary: () => Promise<void>;
  setGroupId: (groupId: string) => void;
}

// Firestore only ever holds ONE live point per member (upserted by uid), so a
// member's moving trail can't be read back — it's reconstructed locally here by
// appending each streamed position. Cleared when their doc is deleted (stationary).
const MAX_TRAIL_POINTS = 120;
let memberTrails: Record<string, MemberTrail> = {};

function accumulateTrails(members: GroupLivePoint[]): Record<string, MemberTrail> {
  const next: Record<string, MemberTrail> = {};
  for (const member of members) {
    // Only moving members grow a trail. A member that stopped (isMoving:false)
    // or went stale (offline) drops out here, so its trail clears instantly
    // while the marker itself lingers as a "last-seen" point.
    if (!member.isOnline || !member.isMoving) continue;
    const coord: [number, number] = [member.longitude, member.latitude];
    const prev = memberTrails[member.uid] ?? [];
    const last = prev[prev.length - 1];
    if (last && last[0] === coord[0] && last[1] === coord[1]) {
      next[member.uid] = prev;
    } else {
      next[member.uid] = [...prev, coord].slice(-MAX_TRAIL_POINTS);
    }
  }
  memberTrails = next;
  return next;
}

let unsubscribeAuth: (() => void) | null = null;
let unsubscribeMembers: (() => void) | null = null;

export const useGroupStore = create<GroupStore>((set, get) => ({
  authLoading: true,
  currentUser: null,
  groupId: LIVE_POINT_GROUP_ID,
  liveMembers: [],
  memberTrails: {},
  error: null,

  init: () => {
    groupLiveLocationService.configure();
    unsubscribeAuth?.();
    unsubscribeAuth = groupLiveLocationService.onAuthStateChanged(user => {
      set({ currentUser: user, authLoading: false, error: null });
      subscribeToMembers(user ? get().groupId : null, set);
    });

    return () => {
      unsubscribeAuth?.();
      unsubscribeMembers?.();
      unsubscribeAuth = null;
      unsubscribeMembers = null;
    };
  },

  signInWithGoogle: async () => {
    set({ error: null });
    try {
      const user = await groupLiveLocationService.signInWithGoogle();
      set({ currentUser: user });
      subscribeToMembers(get().groupId, set);
    } catch (e: any) {
      set({ error: e?.message ?? String(e) });
      throw e;
    }
  },

  signOut: async () => {
    set({ error: null });
    await groupLiveLocationService.signOut();
    unsubscribeMembers?.();
    unsubscribeMembers = null;
    memberTrails = {};
    set({ currentUser: null, liveMembers: [], memberTrails: {} });
  },

  publishPosition: async point => {
    const { currentUser, groupId } = get();
    if (!currentUser) return;
    try {
      await groupLiveLocationService.publishLivePoint(groupId, point);
    } catch (e: any) {
      set({ error: e?.message ?? String(e) });
      if (__DEV__) {
        console.warn('[GroupLive] publish failed:', e);
      }
    }
  },

  markStationary: async () => {
    const { currentUser, groupId } = get();
    if (!currentUser) return;
    try {
      await groupLiveLocationService.markLivePointStationary(groupId);
    } catch (e: any) {
      set({ error: e?.message ?? String(e) });
      if (__DEV__) {
        console.warn('[GroupLive] markStationary failed:', e);
      }
    }
  },

  setGroupId: groupId => {
    set({ groupId });
    subscribeToMembers(get().currentUser ? groupId : null, set);
  },
}));

function subscribeToMembers(
  groupId: string | null,
  set: (partial: Partial<GroupStore>) => void,
) {
  unsubscribeMembers?.();
  unsubscribeMembers = null;
  memberTrails = {};

  if (!groupId) {
    set({ liveMembers: [], memberTrails: {} });
    return;
  }

  unsubscribeMembers = groupLiveLocationService.subscribeGroupLivePoints(
    groupId,
    members =>
      set({
        liveMembers: members,
        memberTrails: accumulateTrails(members),
        error: null,
      }),
    error => set({ error: error.message }),
  );
}
