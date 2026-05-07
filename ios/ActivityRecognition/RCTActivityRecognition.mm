#import <CoreMotion/CoreMotion.h>
#import "RCTActivityRecognition.h"
#import <React/RCTLog.h>

@interface RCTActivityRecognition ()
@end

@implementation RCTActivityRecognition {
  CMMotionActivityManager *_activityManager;
  BOOL _isRunning;
}

RCT_EXPORT_MODULE(ActivityRecognition)

- (instancetype)init {
  self = [super init];
  if (self) {
    _activityManager = [[CMMotionActivityManager alloc] init];
    _isRunning = NO;
  }
  return self;
}

+ (BOOL)requiresMainQueueSetup {
  return NO;
}

#pragma mark - NativeActivityRecognitionSpec

- (void)startActivityUpdates:(double)intervalMs
                     resolve:(RCTPromiseResolveBlock)resolve
                      reject:(RCTPromiseRejectBlock)reject {
  if (![CMMotionActivityManager isActivityAvailable]) {
    reject(@"UNAVAILABLE", @"Activity recognition is not available on this device", nil);
    return;
  }

  if (_isRunning) {
    resolve(nil);
    return;
  }

  __weak __typeof__(self) weakSelf = self;
  [_activityManager startActivityUpdatesToQueue:[NSOperationQueue mainQueue]
                                    withHandler:^(CMMotionActivity * _Nullable activity) {
    __strong __typeof__(weakSelf) strongSelf = weakSelf;
    if (!strongSelf || !activity) return;

    NSString *activityType;
    NSInteger confidence;
    [strongSelf classifyActivity:activity type:&activityType confidence:&confidence];

    NSDictionary *event = @{
      @"activity": activityType,
      @"confidence": @(confidence),
      @"timestamp": @(activity.startDate.timeIntervalSince1970 * 1000),
      @"raw": @{
        @"stationary": @(activity.stationary),
        @"walking": @(activity.walking),
        @"running": @(activity.running),
        @"cycling": @(activity.cycling),
        @"automotive": @(activity.automotive),
        @"unknown": @(activity.unknown),
      }
    };

    [strongSelf emitOnActivityChange:event];
  }];

  _isRunning = YES;
  resolve(nil);
}

- (void)stopActivityUpdates:(RCTPromiseResolveBlock)resolve
                     reject:(RCTPromiseRejectBlock)reject {
  [_activityManager stopActivityUpdates];
  _isRunning = NO;
  resolve(nil);
}

- (void)queryActivities:(double)startMs
                  endMs:(double)endMs
                resolve:(RCTPromiseResolveBlock)resolve
                 reject:(RCTPromiseRejectBlock)reject {
  if (![CMMotionActivityManager isActivityAvailable]) {
    resolve(@[]);
    return;
  }

  NSDate *startDate = [NSDate dateWithTimeIntervalSince1970:startMs / 1000];
  NSDate *endDate = [NSDate dateWithTimeIntervalSince1970:endMs / 1000];

  __weak __typeof__(self) weakSelf = self;
  [_activityManager queryActivityStartingFromDate:startDate
                                           toDate:endDate
                                          toQueue:[NSOperationQueue mainQueue]
                                      withHandler:^(NSArray<CMMotionActivity *> * _Nullable activities, NSError * _Nullable error) {
    __strong __typeof__(weakSelf) strongSelf = weakSelf;
    if (error) {
      reject(@"QUERY_ERROR", error.localizedDescription, error);
      return;
    }

    if (!strongSelf || !activities) {
      resolve(@[]);
      return;
    }

    NSMutableArray *results = [NSMutableArray arrayWithCapacity:activities.count];
    for (CMMotionActivity *activity in activities) {
      NSString *activityType;
      NSInteger confidence;
      [strongSelf classifyActivity:activity type:&activityType confidence:&confidence];

      [results addObject:@{
        @"activity": activityType,
        @"confidence": @(confidence),
        @"timestamp": @(activity.startDate.timeIntervalSince1970 * 1000),
        @"raw": @{
          @"stationary": @(activity.stationary),
          @"walking": @(activity.walking),
          @"running": @(activity.running),
          @"cycling": @(activity.cycling),
          @"automotive": @(activity.automotive),
          @"unknown": @(activity.unknown),
        }
      }];
    }

    resolve(results);
  }];
}

- (void)isAvailable:(RCTPromiseResolveBlock)resolve
             reject:(RCTPromiseRejectBlock)reject {
  if (![CMMotionActivityManager isActivityAvailable]) {
    resolve(@NO);
    return;
  }
  if (@available(iOS 11.0, *)) {
    CMAuthorizationStatus status = [CMMotionActivityManager authorizationStatus];
    if (status == CMAuthorizationStatusDenied ||
        status == CMAuthorizationStatusRestricted) {
      resolve(@NO);
      return;
    }
  }
  resolve(@YES);
}

#pragma mark - TurboModule

- (std::shared_ptr<facebook::react::TurboModule>)getTurboModule:(const facebook::react::ObjCTurboModule::InitParams &)params {
  return std::make_shared<facebook::react::NativeActivityRecognitionSpecJSI>(params);
}

#pragma mark - Activity Classification

- (void)classifyActivity:(CMMotionActivity *)activity
                    type:(NSString **)outType
              confidence:(NSInteger *)outConfidence {
  NSInteger confidence = 50;
  switch (activity.confidence) {
    case CMMotionActivityConfidenceLow:    confidence = 30; break;
    case CMMotionActivityConfidenceMedium: confidence = 60; break;
    case CMMotionActivityConfidenceHigh:   confidence = 95; break;
  }
  *outConfidence = confidence;

  if (activity.running)    { *outType = @"running";    return; }
  if (activity.cycling)    { *outType = @"cycling";    return; }
  if (activity.automotive) { *outType = @"automotive"; return; }
  if (activity.walking)    { *outType = @"walking";    return; }
  if (activity.stationary) { *outType = @"stationary"; return; }
  *outType = @"unknown";
}

@end
