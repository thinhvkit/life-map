import auth, { FirebaseAuthTypes } from '@react-native-firebase/auth';
import firestore, {
  FirebaseFirestoreTypes,
} from '@react-native-firebase/firestore';
import {
  GoogleSignin,
  statusCodes,
} from '@react-native-google-signin/google-signin';
import { ActivityType, GpsPoint } from '../models/types';
import {
  GOOGLE_IOS_CLIENT_ID,
  GOOGLE_WEB_CLIENT_ID,
  LIVE_POINT_ONLINE_WINDOW_MS,
} from '../config/liveShare';

export interface GroupUser {
  uid: string;
  displayName: string;
  email?: string | null;
  photoURL?: string | null;
}

export interface GroupLivePoint {
  uid: string;
  displayName: string;
  email?: string | null;
  photoURL?: string | null;
  latitude: number;
  longitude: number;
  heading?: number;
  speed?: number;
  activity?: ActivityType;
  updatedAtMillis: number;
  isOnline: boolean;
  isMoving: boolean;
}

// Group/member docs only need an occasional refresh — rewriting them on every
// live point tripled write volume for no benefit. Touch them at most this often.
const MEMBERSHIP_WRITE_INTERVAL_MS = 60_000;

class GroupLiveLocationService {
  private configured = false;
  private lastMembershipWriteMillis = 0;

  configure(): void {
    if (this.configured) return;

    GoogleSignin.configure(
      Object.assign(
        { offlineAccess: false },
        GOOGLE_WEB_CLIENT_ID ? { webClientId: GOOGLE_WEB_CLIENT_ID } : {},
        GOOGLE_IOS_CLIENT_ID ? { iosClientId: GOOGLE_IOS_CLIENT_ID } : {},
      ),
    );
    this.configured = true;
  }

  onAuthStateChanged(listener: (user: GroupUser | null) => void): () => void {
    return auth().onAuthStateChanged(user => {
      listener(user ? this.toGroupUser(user) : null);
    });
  }

  async signInWithGoogle(): Promise<GroupUser> {
    this.configure();

    try {
      await GoogleSignin.hasPlayServices({
        showPlayServicesUpdateDialog: true,
      });
      const result = await GoogleSignin.signIn();
      const idToken = result.data?.idToken;

      if (!idToken) {
        throw new Error('Google sign-in did not return an id token.');
      }

      const credential = auth.GoogleAuthProvider.credential(idToken);
      const userCredential = await auth().signInWithCredential(credential);
      return this.toGroupUser(userCredential.user);
    } catch (e: any) {
      if (e?.code === statusCodes.SIGN_IN_CANCELLED) {
        throw new Error('Google sign-in was cancelled.');
      }
      if (e?.code === statusCodes.IN_PROGRESS) {
        throw new Error('Google sign-in is already in progress.');
      }
      if (e?.code === statusCodes.PLAY_SERVICES_NOT_AVAILABLE) {
        throw new Error('Google Play Services is not available or outdated.');
      }
      throw e;
    }
  }

  async signOut(): Promise<void> {
    this.configure();
    this.lastMembershipWriteMillis = 0;
    await Promise.allSettled([GoogleSignin.signOut(), auth().signOut()]);
  }

  subscribeGroupLivePoints(
    groupId: string,
    listener: (members: GroupLivePoint[]) => void,
    onError?: (error: Error) => void,
  ): () => void {
    return firestore()
      .collection('groups')
      .doc(groupId)
      .collection('livePoints')
      .orderBy('updatedAtMillis', 'desc')
      .onSnapshot(snapshot => {
        const now = Date.now();
        const members = snapshot.docs
          .map(doc => this.toLivePoint(doc, now))
          .filter((point): point is GroupLivePoint => Boolean(point));
        listener(members);
      }, onError);
  }

  async publishLivePoint(groupId: string, point: GpsPoint): Promise<void> {
    const currentUser = auth().currentUser;
    if (!currentUser) return;

    const user = this.toGroupUser(currentUser);
    const updatedAtMillis = Date.now();
    const payload = {
      uid: user.uid,
      displayName: user.displayName,
      email: user.email ?? null,
      photoURL: user.photoURL ?? null,
      latitude: point.latitude,
      longitude: point.longitude,
      heading: Number.isFinite(point.heading) ? point.heading : null,
      speed: Number.isFinite(point.speed) ? point.speed : null,
      activity: point.activity,
      updatedAt: firestore.FieldValue.serverTimestamp(),
      updatedAtMillis,
      isOnline: true,
      isMoving: true,
    };

    const groupRef = firestore().collection('groups').doc(groupId);

    // Hot path: a single livePoint write per push.
    const writes: Promise<void>[] = [
      groupRef.collection('livePoints').doc(user.uid).set(payload, {
        merge: true,
      }),
    ];

    // Cold path: refresh the group + member roster docs at most once a minute.
    if (
      updatedAtMillis - this.lastMembershipWriteMillis >=
      MEMBERSHIP_WRITE_INTERVAL_MS
    ) {
      this.lastMembershipWriteMillis = updatedAtMillis;
      writes.push(
        groupRef.set(
          {
            updatedAt: firestore.FieldValue.serverTimestamp(),
            updatedAtMillis,
          },
          { merge: true },
        ),
        groupRef
          .collection('members')
          .doc(user.uid)
          .set(
            {
              uid: user.uid,
              displayName: user.displayName,
              email: user.email ?? null,
              photoURL: user.photoURL ?? null,
              joinedAt: firestore.FieldValue.serverTimestamp(),
              lastSeenAt: firestore.FieldValue.serverTimestamp(),
              lastSeenAtMillis: updatedAtMillis,
            },
            { merge: true },
          ),
      );
    }

    await Promise.all(writes);
  }

  // Stationary: turn the live point into a "last-seen" point. The doc is kept
  // (not deleted) so it still renders, and the existing 2-min online window
  // decides when it flips to "Last seen". isMoving:false stops the local trail.
  async markLivePointStationary(groupId: string): Promise<void> {
    const currentUser = auth().currentUser;
    if (!currentUser) return;

    const groupRef = firestore().collection('groups').doc(groupId);
    const updatedAtMillis = Date.now();
    await Promise.all([
      groupRef.collection('livePoints').doc(currentUser.uid).set(
        {
          isMoving: false,
          updatedAt: firestore.FieldValue.serverTimestamp(),
          updatedAtMillis,
        },
        { merge: true },
      ),
      groupRef
        .collection('members')
        .doc(currentUser.uid)
        .set(
          {
            lastSeenAt: firestore.FieldValue.serverTimestamp(),
            lastSeenAtMillis: updatedAtMillis,
          },
          { merge: true },
        ),
    ]);
  }

  private toGroupUser(user: FirebaseAuthTypes.User): GroupUser {
    return {
      uid: user.uid,
      displayName:
        user.displayName ||
        user.email?.split('@')[0] ||
        `Member ${user.uid.slice(0, 4)}`,
      email: user.email,
      photoURL: user.photoURL,
    };
  }

  private toLivePoint(
    doc: FirebaseFirestoreTypes.QueryDocumentSnapshot<FirebaseFirestoreTypes.DocumentData>,
    now: number,
  ): GroupLivePoint | null {
    const data = doc.data();
    if (
      typeof data.latitude !== 'number' ||
      typeof data.longitude !== 'number' ||
      typeof data.uid !== 'string'
    ) {
      return null;
    }

    const updatedAtMillis =
      typeof data.updatedAtMillis === 'number' ? data.updatedAtMillis : 0;
    const isOnline =
      data.isOnline !== false &&
      now - updatedAtMillis <= LIVE_POINT_ONLINE_WINDOW_MS;

    return {
      uid: data.uid,
      displayName:
        typeof data.displayName === 'string' && data.displayName.length > 0
          ? data.displayName
          : `Member ${data.uid.slice(0, 4)}`,
      email: typeof data.email === 'string' ? data.email : null,
      photoURL: typeof data.photoURL === 'string' ? data.photoURL : null,
      latitude: data.latitude,
      longitude: data.longitude,
      heading: typeof data.heading === 'number' ? data.heading : undefined,
      speed: typeof data.speed === 'number' ? data.speed : undefined,
      activity: data.activity,
      updatedAtMillis,
      isOnline,
      isMoving: data.isMoving !== false,
    };
  }
}

export const groupLiveLocationService = new GroupLiveLocationService();
