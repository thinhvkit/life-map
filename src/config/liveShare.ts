import * as LocalConfig from '../config.local';

type LiveShareLocalConfig = {
  GOOGLE_WEB_CLIENT_ID?: string;
  GOOGLE_IOS_CLIENT_ID?: string;
  LIVE_POINT_GROUP_ID?: string;
  FAMILY_GROUP_ID?: string;
};

const local = LocalConfig as LiveShareLocalConfig;

export const GOOGLE_WEB_CLIENT_ID = local.GOOGLE_WEB_CLIENT_ID;
export const GOOGLE_IOS_CLIENT_ID = local.GOOGLE_IOS_CLIENT_ID;
export const LIVE_POINT_GROUP_ID =
  local.LIVE_POINT_GROUP_ID ?? local.FAMILY_GROUP_ID ?? 'family';

export const LIVE_POINT_ONLINE_WINDOW_MS = 2 * 60 * 1000;
