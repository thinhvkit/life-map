  1. Battery & background reliability (most impactful for a tracking app)       
  - Enable adaptive duty cycling: longer GPS intervals when stationary, shorter
  when moving (your powerManager already does this — could be tuned more        
  aggressively)                                                         
  - Use significant location changes API on iOS / passive provider on Android   
  during idle states                                                         
  - Add WorkManager-based scheduling for non-critical writes                    
  
  2. Map performance & UX                                                       
  - Replace MarkerView with Mapbox SymbolLayer + ShapeSource for places —
  MarkerView mounts a real React view per pin and gets slow past ~20 pins       
  - Add live polyline drawing (the in-progress trip you asked about earlier)
  - Memoize the route GeoJSON instead of rebuilding on every render             
                                                                              
  3. Release build & APK size                                                   
  - Enable Proguard/R8 (enableProguardInReleaseBuilds = true) — typically halves
   APK size                                                                     
  - Already have arm64-only ✓                                                   
  - Enable bundle splitting (splits.abi per-architecture APKs for Play Store)   
                                                            
  4. Data & persistence                                                         
  - Batch GPS writes (currently every motion change does an immediate
  transaction)                                                                  
  - Add an index on gps_points.timestamp if you ever query by time range
  - Vacuum/prune old data — no retention policy currently exists                
                                                                              
  5. Code health                                                                
  - The App.tsx init has a race: mock data writes after loadDayLog may overwrite
   real data on slow startups                                                   
  - Consider extracting tracking lifecycle into a single state machine —
  currently spread across tracking.ts, powerManager, motionDetector             
                                                                              
