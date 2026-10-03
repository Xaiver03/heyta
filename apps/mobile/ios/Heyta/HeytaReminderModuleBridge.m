#import <React/RCTBridgeModule.h>

// The Swift type keeps its Objective-C runtime name `HeytaReminderModule`,
// while JavaScript consumes the stable public name `HeytaReminder`. Using
// RCT_EXTERN_MODULE here silently exported the former and left
// NativeModules.HeytaReminder undefined on iOS.
@interface RCT_EXTERN_REMAP_MODULE(HeytaReminder, HeytaReminderModule, NSObject)

RCT_EXTERN_METHOD(authorizationStatus:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(requestAuthorization:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(schedule:(NSString *)identifier
                  atMs:(double)atMs
                  title:(NSString *)title
                  body:(NSString *)body
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(cancel:(NSString *)identifier
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(cancelStale:(NSArray *)keepIdentifiers
                  pendingIdentifiers:(NSArray *)pendingIdentifiers
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(peekDelivered:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(peekUncertain:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(acknowledgeDelivered:(NSArray *)identifiers
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)

@end
