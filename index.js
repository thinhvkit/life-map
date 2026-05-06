/**
 * @format
 */

import './src/services/backgroundTasks';
import MapboxGL from '@rnmapbox/maps';
import { AppRegistry } from 'react-native';
import App from './App';
import { name as appName } from './app.json';
import { MAPBOX_ACCESS_TOKEN } from './src/config.local';

MapboxGL.setAccessToken(MAPBOX_ACCESS_TOKEN);

AppRegistry.registerComponent(appName, () => App);
