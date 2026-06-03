jest.mock('@react-native-firebase/auth', () => {
  const auth = () => ({
    currentUser: null,
    onAuthStateChanged: callback => {
      callback(null);
      return jest.fn();
    },
    signInWithCredential: jest.fn(),
    signOut: jest.fn(),
  });
  auth.GoogleAuthProvider = {
    credential: jest.fn(token => ({ token })),
  };
  return auth;
});

jest.mock('@react-native-firebase/firestore', () => {
  const collection = jest.fn(() => ({
    doc: jest.fn(() => ({
      collection,
      set: jest.fn(),
    })),
    orderBy: jest.fn(() => ({
      onSnapshot: jest.fn(() => jest.fn()),
    })),
  }));
  const firestore = () => ({ collection });
  firestore.FieldValue = {
    serverTimestamp: jest.fn(() => ({ seconds: 0, nanoseconds: 0 })),
  };
  return firestore;
});

jest.mock('@react-native-google-signin/google-signin', () => ({
  GoogleSignin: {
    configure: jest.fn(),
    hasPlayServices: jest.fn(),
    signIn: jest.fn(),
    signOut: jest.fn(),
  },
  statusCodes: {
    SIGN_IN_CANCELLED: 'SIGN_IN_CANCELLED',
    IN_PROGRESS: 'IN_PROGRESS',
    PLAY_SERVICES_NOT_AVAILABLE: 'PLAY_SERVICES_NOT_AVAILABLE',
  },
}));

jest.mock('@rnmapbox/maps', () => {
  const React = require('react');
  const { View } = require('react-native');
  const Component = ({ children }) => React.createElement(View, null, children);

  return {
    __esModule: true,
    default: {
      setAccessToken: jest.fn(),
      StyleURL: { Dark: 'dark' },
      MapView: Component,
      Camera: Component,
      ShapeSource: Component,
      LineLayer: Component,
      MarkerView: Component,
      UserLocation: Component,
    },
  };
});

jest.mock('./src/services/database', () => ({
  database: {
    init: jest.fn(),
    getDayLog: jest.fn(async () => null),
    getDayLogsInRange: jest.fn(async () => []),
    insertSegment: jest.fn(async () => undefined),
    upsertDayLog: jest.fn(async () => undefined),
    appendPendingPoint: jest.fn(),
    loadPendingSegment: jest.fn(() => null),
    clearPendingSegment: jest.fn(),
    clearDate: jest.fn(async () => 0),
    getSegmentsByDate: jest.fn(async () => []),
  },
}));

jest.mock('./src/services/tracking', () => ({
  trackingService: {
    configure: jest.fn(async () => undefined),
    start: jest.fn(async () => undefined),
    stop: jest.fn(async () => undefined),
    getCurrentPosition: jest.fn(async () => ({
      latitude: 0,
      longitude: 0,
      altitude: 0,
      accuracy: 0,
      speed: 0,
      heading: 0,
      timestamp: Date.now(),
      isMoving: false,
      activity: 'stationary',
      confidence: 1,
    })),
    simulateRoute: jest.fn(),
    simulateStay: jest.fn(),
    stopSimulation: jest.fn(),
    rematchTrips: jest.fn(async () => ({ ok: 0, failed: 0, skipped: 0 })),
  },
}));
