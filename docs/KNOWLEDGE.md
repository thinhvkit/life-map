## Life Map — React Native daily timeline tracker:

  ** Architecture:
  - src/models/types.ts — Full type system (GpsPoint, Segment, Place, DayLog,
  etc.)
  - src/services/tracking.ts — Background geolocation service using
  transistorsoft's v5 nested config API
  - src/services/activityClassifier.ts — Transport mode detection (sensor +
  speed-based)
  - src/services/placeDetection.ts — Place recognition with reverse geocoding +
  clustering
  - src/store/trackingStore.ts — Zustand global state with AsyncStorage
  persistence
  - src/hooks/useTracking.ts — Tracking lifecycle hook with permission handling

  ** Screens (matching the dark navy design):
  - MapScreen — Mapbox dark map with color-coded route polylines (dashed for
  walking, solid for driving/cycling), tappable place markers with category
  icons, stats overlay bar, place detail popup, and Start/Stop tracking FAB
  - TimelineScreen — Date navigator with < > arrows, mini 24h time bar,
  scrollable segment cards with time column + vertical color line, expandable
  metadata pills
  - StatsScreen — Summary cards (distance/moving/places), activity breakdown
  with percentage bars, weekly distance sparkline chart, segment count cards,
  battery/tracking status

  Design tokens: Dark navy #080E1C background, #0D1526 surface, #3B8EF0 accent,
  monospace for numerics, SVG tab icons (no emoji in navigation)

## Battery optimization is now fully wired in. Here's what's active:             
                                                                                
  - PowerManager dynamically switches between 5 GPS profiles (sleep /           
  geofence_only / low_power / balanced / high_accuracy) based on motion,
  battery, charging, time of day, and known places                              
  - MotionDetector requires 2 consecutive motion events within 30s before
  upgrading GPS — prevents battery drain from false positives like phone jostles
  - PlaceGeofenceManager auto-registers geofences around home/work and
  frequently visited places, so the app can sleep in geofence-only mode and wake
   on exit                                                  
  - Activity-specific distance filters (walking=8m, running=15m, cycling=25m,   
  driving=50m) for optimal accuracy-per-watt during each transport mode  

## What the new place detection does:                                     
   
  - Dwell time filtering (120s minimum) — stops at traffic lights or brief      
  pauses won't register as visits. Only stationary periods >2 minutes get
  evaluated as potential places.                                                
  - GPS cluster analysis — instead of naive averaging, it computes a centroid,
  rejects outlier points beyond 2× median distance (GPS spikes), then           
  recalculates from inliers only. The scatter radius (90th percentile of inlier
  distances) sets the place's detection boundary.                               
  - Adaptive place radius — each return visit refines the place's position and
  radius via weighted average, getting more accurate over time.                 
  - Reverse geocoding with POI extraction — pulls namedetails, extratags, and
  addressdetails from Nominatim; prioritizes POI names (cafe name) over street  
  addresses. Results cached 24h to respect rate limits.     
  - Expanded category inference — uses both OSM class and type fields (50+      
  mappings vs the previous 20) for better "food" vs "shopping" vs "transit"     
  classification.
  - AsyncStorage persistence — known places survive app restarts. Geofence enter
   events now pass the place category to the power manager for smarter mode     
  switching.

### what the SQLite migration changed:

  Schema — 6 indexed tables replacing JSON blobs in AsyncStorage:
  - places — all known places with visit stats, indexed by lat/lon
  - segments — trip/visit records, indexed by date for fast day lookups
  - gps_points — individual GPS readings, linked to segments via foreign key
  - simplified_points — Douglas-Peucker simplified routes for map rendering
  - day_logs — cached daily aggregates (distance, time, activity breakdown)
  - geofenced_places — active geofence registrations

  ** What improved:
  - No 6MB cap — SQLite handles gigabytes
  - GPS points stored as individual rows instead of serialized arrays — loading
  a day doesn't parse a massive JSON blob
  - WAL journal mode for fast concurrent reads/writes
  - Foreign keys with ON DELETE CASCADE — deleting a segment auto-cleans its
  points
  - Indexed queries — loading a specific day's segments is O(log n) not O(n)
  - Place lookups by ID are direct primary key hits
